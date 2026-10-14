import { isDbReady } from './db.js';
import { DowntimeModel } from './models.js';
import { machines } from './store.js';

/**
 * Reliability and OEE metrics.
 *
 * Every figure here is computed from recorded events, not assumed. Two things are worth being
 * explicit about:
 *
 *  - Availability, MTBF and MTTR come from a real downtime log. A machine entering `critical`
 *    opens a downtime event; leaving it closes one. Nothing is estimated.
 *  - Performance and Quality need production and reject counts, which no sensor in this
 *    project provides. The simulator therefore *records* them per tick the same way it records
 *    temperature. The inputs are synthetic, like all the telemetry, but the arithmetic is the
 *    standard OEE calculation rather than a made-up number.
 */

export interface DowntimeEvent {
  machineId: string;
  startedAt: number;
  endedAt?: number;
  reason: string;
}

interface Production {
  /** Milliseconds the asset has been observed at all. */
  plannedMs: number;
  /** Milliseconds not in a downtime state. */
  runMs: number;
  goodUnits: number;
  rejectUnits: number;
  /** Units the asset would have made over runMs at its nameplate rate. */
  idealUnits: number;
}

// Nameplate output per hour. A real deployment reads this from the asset master record.
const IDEAL_UNITS_PER_HOUR: Record<string, number> = {
  'VAC-104': 240, 'CMP-012': 180, 'CNC-207': 60,
  'CNV-033': 600, 'PMP-089': 300, 'GEN-005': 120
};

// How each condition affects throughput and scrap. Degraded equipment runs slower and rejects
// more, which is what makes Performance and Quality move rather than sit at a constant.
const CONDITION = {
  healthy:  { rate: 0.97, reject: 0.004 },
  warning:  { rate: 0.82, reject: 0.021 },
  critical: { rate: 0.00, reject: 0.000 }
} as const;

const production = new Map<string, Production>();
const openDowntime = new Map<string, DowntimeEvent>();
const closedDowntime: DowntimeEvent[] = [];
let startedAt = Date.now();

const blank = (): Production => ({ plannedMs: 0, runMs: 0, goodUnits: 0, rejectUnits: 0, idealUnits: 0 });

/** Called once per simulator tick with the elapsed interval. */
export function recordTick(elapsedMs: number): void {
  const now = Date.now();
  for (const m of machines) {
    const p = production.get(m.id) ?? blank();
    const condition = CONDITION[m.status as keyof typeof CONDITION] ?? CONDITION.healthy;
    const down = m.status === 'critical';

    p.plannedMs += elapsedMs;
    if (!down) {
      p.runMs += elapsedMs;
      const hours = elapsedMs / 3_600_000;
      const ideal = (IDEAL_UNITS_PER_HOUR[m.id] ?? 120) * hours;
      const actual = ideal * condition.rate;
      p.idealUnits += ideal;
      p.rejectUnits += actual * condition.reject;
      p.goodUnits += actual * (1 - condition.reject);
    }
    production.set(m.id, p);

    // Downtime transitions. Only the edges are recorded, so MTBF and MTTR count real
    // failures rather than every tick spent in a bad state.
    const open = openDowntime.get(m.id);
    if (down && !open) {
      openDowntime.set(m.id, { machineId: m.id, startedAt: now, reason: 'Critical condition' });
    } else if (!down && open) {
      open.endedAt = now;
      closedDowntime.push(open);
      openDowntime.delete(m.id);
      if (isDbReady()) {
        DowntimeModel.create(open).catch(err => console.warn('Downtime not persisted:', err.message));
      }
    }
  }
}

function metricsFor(machineId: string) {
  const p = production.get(machineId) ?? blank();
  const open = openDowntime.get(machineId);
  const now = Date.now();

  const closed = closedDowntime.filter(d => d.machineId === machineId);
  const downMsClosed = closed.reduce((sum, d) => sum + ((d.endedAt ?? now) - d.startedAt), 0);
  const downMsOpen = open ? now - open.startedAt : 0;
  const downMs = downMsClosed + downMsOpen;

  // A failure is counted once it has started, so an ongoing outage still affects MTBF.
  const failures = closed.length + (open ? 1 : 0);

  const availability = p.plannedMs > 0 ? p.runMs / p.plannedMs : 1;
  const performance = p.idealUnits > 0 ? (p.goodUnits + p.rejectUnits) / p.idealUnits : 0;
  const total = p.goodUnits + p.rejectUnits;
  const quality = total > 0 ? p.goodUnits / total : 1;

  return {
    machineId,
    availability, performance, quality,
    oee: availability * performance * quality,
    goodUnits: Math.round(p.goodUnits),
    rejectUnits: Math.round(p.rejectUnits),
    failures,
    // Null rather than Infinity when nothing has failed yet: "no failures observed" is not
    // the same claim as "infinite time between failures".
    mtbfHours: failures > 0 ? (p.runMs / failures) / 3_600_000 : null,
    mttrHours: failures > 0 ? (downMs / failures) / 3_600_000 : null,
    downtimeHours: downMs / 3_600_000,
    observedHours: p.plannedMs / 3_600_000,
    currentlyDown: Boolean(open)
  };
}

export function getReliability() {
  const perMachine = machines.map(m => ({ ...metricsFor(m.id), name: m.name, location: m.location, status: m.status }));

  // Plant figures are rolled up from raw totals, not averaged from per-machine percentages.
  // Averaging percentages would make the plant OEE disagree with its own A x P x Q factors,
  // because each asset contributes a different amount of production.
  const totals = machines.reduce((acc, m) => {
    const p = production.get(m.id) ?? blank();
    acc.plannedMs += p.plannedMs; acc.runMs += p.runMs;
    acc.good += p.goodUnits; acc.reject += p.rejectUnits; acc.ideal += p.idealUnits;
    return acc;
  }, { plannedMs: 0, runMs: 0, good: 0, reject: 0, ideal: 0 });

  const failures = perMachine.reduce((s, m) => s + m.failures, 0);
  const downHours = perMachine.reduce((s, m) => s + m.downtimeHours, 0);

  const availability = totals.plannedMs > 0 ? totals.runMs / totals.plannedMs : 1;
  const actual = totals.good + totals.reject;
  const performance = totals.ideal > 0 ? actual / totals.ideal : 0;
  const quality = actual > 0 ? totals.good / actual : 1;

  return {
    plant: {
      availability, performance, quality,
      // Equals total good units over what the plant could have made in the planned time,
      // which is the rolled-up definition of OEE.
      oee: availability * performance * quality,
      failures,
      mtbfHours: failures > 0 ? (totals.runMs / failures) / 3_600_000 : null,
      mttrHours: failures > 0 ? downHours / failures : null,
      goodUnits: Math.round(totals.good),
      rejectUnits: Math.round(totals.reject),
      observedHours: (totals.plannedMs / machines.length) / 3_600_000,
      since: new Date(startedAt).toISOString()
    },
    machines: perMachine,
    // Stated in the payload so the dashboard can label what the numbers are built from.
    basis: {
      availability: 'measured from recorded downtime events',
      performance: 'simulated production counts against nameplate rate',
      quality: 'simulated reject counts',
      note: 'Production and reject counts come from the simulator; no sensor supplies them.'
    }
  };
}

/** Clears the window so an operator can measure a fresh shift. */
export function resetReliability(): void {
  production.clear();
  openDowntime.clear();
  closedDowntime.length = 0;
  startedAt = Date.now();
}
