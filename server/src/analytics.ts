import { isDbReady } from './db.js';
import { ReadingModel } from './models.js';
import { getSettings } from './settings.js';
import { machines } from './store.js';

/**
 * Energy, efficiency and period-over-period analytics.
 *
 * Everything here is derived from the `power` and `rpm` fields that were already being
 * recorded on every reading and never shown anywhere. Nothing new is sensed.
 *
 * Two honesty notes:
 *  - Energy is integrated from instantaneous power samples (kW x elapsed hours). That is a
 *    genuine Riemann sum, not an assumed constant, but it is only as accurate as the sample
 *    rate -- a fast transient between two ticks is invisible to it.
 *  - "Efficiency" here is specific energy: kWh per unit produced. It deliberately is not
 *    called motor efficiency, which would need shaft power that no sensor in this project
 *    reports.
 */

interface EnergyAccumulator {
  kwh: number;
  /** Sum of power samples and their count, for a mean without storing every value. */
  powerSum: number;
  samples: number;
  /** Mean power over the first window, used as the "normal" reference. */
  baselineKw: number | null;
  baselineSamples: number;
  baselineSum: number;
  peakKw: number;
  runHours: number;
}

// Samples collected before the baseline is locked in, treated as the asset's normal operating
// signature. Low enough to settle in about a minute at the default tick rate; a real
// deployment would learn this over a full production shift instead.
const BASELINE_SAMPLE_TARGET = 15;

const energy = new Map<string, EnergyAccumulator>();

const blank = (): EnergyAccumulator => ({
  kwh: 0, powerSum: 0, samples: 0,
  baselineKw: null, baselineSamples: 0, baselineSum: 0,
  peakKw: 0, runHours: 0
});

/** Integrates power into energy on every simulator tick. */
export function recordEnergy(elapsedMs: number): void {
  const hours = elapsedMs / 3_600_000;
  for (const m of machines) {
    const a = energy.get(m.id) ?? blank();
    const kw = m.reading.power;

    // A machine in a critical state is treated as stopped, so idle draw does not inflate
    // the energy-per-unit figure for equipment that is not producing anything.
    if (m.status !== 'critical') {
      a.kwh += kw * hours;
      a.runHours += hours;
    }
    a.powerSum += kw;
    a.samples += 1;
    a.peakKw = Math.max(a.peakKw, kw);

    if (a.baselineKw === null) {
      a.baselineSum += kw;
      a.baselineSamples += 1;
      if (a.baselineSamples >= BASELINE_SAMPLE_TARGET) a.baselineKw = a.baselineSum / a.baselineSamples;
    }
    energy.set(m.id, a);
  }
}

/** Per-asset energy, cost and deviation from the asset's own baseline. */
export function getEnergy(unitsByMachine: Record<string, number> = {}) {
  const { energyTariff, energyCurrency } = getSettings();

  const perMachine = machines.map(m => {
    const a = energy.get(m.id) ?? blank();
    const meanKw = a.samples > 0 ? a.powerSum / a.samples : 0;
    const units = unitsByMachine[m.id] ?? 0;

    // Deviation against the asset's own early-life signature, not a generic figure. A motor
    // drawing steadily more power for the same work is a classic early fault indicator.
    const deviationPct = a.baselineKw && a.baselineKw > 0
      ? ((meanKw - a.baselineKw) / a.baselineKw) * 100
      : null;

    return {
      machineId: m.id, name: m.name, location: m.location, status: m.status,
      kwh: a.kwh,
      cost: a.kwh * energyTariff,
      meanKw, peakKw: a.peakKw,
      baselineKw: a.baselineKw,
      deviationPct,
      // kWh per unit produced: the figure a plant actually tracks for energy efficiency.
      specificEnergy: units > 0 ? a.kwh / units : null,
      runHours: a.runHours,
      // Load factor against the asset's peak observed draw.
      loadFactor: a.peakKw > 0 ? meanKw / a.peakKw : 0
    };
  });

  const totalKwh = perMachine.reduce((s, m) => s + m.kwh, 0);
  return {
    tariff: energyTariff,
    currency: energyCurrency,
    totals: {
      kwh: totalKwh,
      cost: totalKwh * energyTariff,
      // Projected from the observed rate, clearly labelled as a projection in the UI.
      projectedDailyKwh: perMachine.reduce((s, m) => s + (m.runHours > 0 ? (m.kwh / m.runHours) * 24 : 0), 0)
    },
    machines: perMachine
  };
}

/** Every recorded signal for one asset, for the multi-signal chart. */
export function getSignals(machineId: string) {
  const m = machines.find(x => x.id === machineId);
  if (!m) return null;
  return {
    machineId: m.id, name: m.name, location: m.location,
    series: m.history.map(r => ({
      timestamp: r.timestamp,
      temperature: r.temperature, vibration: r.vibration,
      pressure: r.pressure, power: r.power, rpm: r.rpm, riskScore: r.riskScore
    })),
    // Ranges let the client scale each signal onto a shared axis without guessing.
    ranges: (['temperature','vibration','pressure','power','rpm'] as const).reduce((acc, key) => {
      const values = m.history.map(r => r[key]);
      acc[key] = { min: Math.min(...values), max: Math.max(...values) };
      return acc;
    }, {} as Record<string, {min:number;max:number}>)
  };
}

/**
 * Period-over-period comparison, read from stored readings.
 *
 * Returns nulls rather than zeros when a period has no data: "no readings yet for last week"
 * is a different statement from "last week averaged zero degrees", and a dashboard that
 * conflates them invents a trend that does not exist.
 */
export async function getComparison(days = 1) {
  const now = Date.now();
  const span = days * 86_400_000;
  const current = { from: new Date(now - span), to: new Date(now) };
  const previous = { from: new Date(now - span * 2), to: new Date(now - span) };

  if (!isDbReady()) {
    return { available: false, reason: 'No database connected; comparison needs stored history.', days };
  }

  const summarise = async (from: Date, to: Date) => {
    const rows = await ReadingModel.aggregate([
      { $match: { timestamp: { $gte: from, $lt: to } } },
      { $group: {
          _id: '$machineId',
          temperature: { $avg: '$temperature' }, vibration: { $avg: '$vibration' },
          power: { $avg: '$power' }, riskScore: { $avg: '$riskScore' }, samples: { $sum: 1 }
      } }
    ]);
    return new Map(rows.map(r => [r._id as string, r]));
  };

  const [cur, prev] = await Promise.all([summarise(current.from, current.to), summarise(previous.from, previous.to)]);

  const delta = (a?: number, b?: number) =>
    a === undefined || b === undefined || b === 0 ? null : ((a - b) / b) * 100;

  return {
    available: true,
    days,
    currentWindow: { from: current.from.toISOString(), to: current.to.toISOString() },
    previousWindow: { from: previous.from.toISOString(), to: previous.to.toISOString() },
    machines: machines.map(m => {
      const c = cur.get(m.id);
      const p = prev.get(m.id);
      return {
        machineId: m.id, name: m.name,
        current: c ? { temperature: c.temperature, vibration: c.vibration, power: c.power, riskScore: c.riskScore, samples: c.samples } : null,
        previous: p ? { temperature: p.temperature, vibration: p.vibration, power: p.power, riskScore: p.riskScore, samples: p.samples } : null,
        change: {
          temperature: delta(c?.temperature, p?.temperature),
          vibration: delta(c?.vibration, p?.vibration),
          power: delta(c?.power, p?.power),
          riskScore: delta(c?.riskScore, p?.riskScore)
        }
      };
    })
  };
}

export function resetEnergy(): void { energy.clear(); }
