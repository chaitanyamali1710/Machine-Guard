import { isDbReady } from './db.js';
import { SettingsModel } from './models.js';

/**
 * Plant-wide configuration, as opposed to per-user account settings.
 *
 * Values are cached in memory because the simulator reads the thresholds on every tick; the
 * database is only touched when an administrator saves. Environment variables supply the
 * initial defaults, so an untouched deployment behaves exactly as it did before.
 */
export interface SystemSettings {
  facilityName: string;
  sensorIntervalMs: number;
  persistIntervalMs: number;
  /** Risk score at or above which an asset is shown as warning. */
  warningRisk: number;
  /** Risk score at or above which an asset is shown as critical. */
  criticalRisk: number;
  readingRetentionDays: number;
  /** Cost per kWh, used for energy cost reporting. */
  energyTariff: number;
  energyCurrency: string;
}

export const DEFAULTS: SystemSettings = {
  facilityName: process.env.FACILITY_NAME || 'Pune Plant 01',
  sensorIntervalMs: Number(process.env.SENSOR_INTERVAL_MS || 4000),
  persistIntervalMs: Number(process.env.PERSIST_INTERVAL_MS || 30000),
  warningRisk: 45,
  criticalRisk: 70,
  readingRetentionDays: Number(process.env.READING_TTL_DAYS || 7),
  energyTariff: Number(process.env.ENERGY_TARIFF || 8.5),
  energyCurrency: process.env.ENERGY_CURRENCY || 'INR'
};

/**
 * Bounds exist to protect the Atlas free tier as much as to catch typos: a one-second
 * persist interval would write ~500k documents a day and fill a 512 MB cluster within days.
 */
export const LIMITS = {
  sensorIntervalMs: { min: 1000, max: 60000 },
  persistIntervalMs: { min: 10000, max: 600000 },
  warningRisk: { min: 5, max: 95 },
  criticalRisk: { min: 10, max: 99 },
  readingRetentionDays: { min: 1, max: 90 },
  energyTariff: { min: 0.1, max: 1000 }
} as const;

let cache: SystemSettings = { ...DEFAULTS };
type Listener = (s: SystemSettings, changed: Set<keyof SystemSettings>) => void;
const listeners: Listener[] = [];

/** Registers a callback so timers and indexes can be rebuilt when their values change. */
export function onSettingsChange(fn: Listener) { listeners.push(fn); }

export const getSettings = (): SystemSettings => cache;

export async function loadSettings(): Promise<SystemSettings> {
  if (!isDbReady()) return cache;
  const doc = await SettingsModel.findOne({ key: 'system' }).lean();
  if (!doc) {
    await SettingsModel.create({ key: 'system', ...DEFAULTS });
    return cache;
  }
  cache = {
    facilityName: doc.facilityName ?? DEFAULTS.facilityName,
    sensorIntervalMs: doc.sensorIntervalMs ?? DEFAULTS.sensorIntervalMs,
    persistIntervalMs: doc.persistIntervalMs ?? DEFAULTS.persistIntervalMs,
    warningRisk: doc.warningRisk ?? DEFAULTS.warningRisk,
    criticalRisk: doc.criticalRisk ?? DEFAULTS.criticalRisk,
    readingRetentionDays: doc.readingRetentionDays ?? DEFAULTS.readingRetentionDays,
    energyTariff: doc.energyTariff ?? DEFAULTS.energyTariff,
    energyCurrency: doc.energyCurrency ?? DEFAULTS.energyCurrency
  };
  return cache;
}

export type SettingsError = { field: string; message: string };

function validate(next: SystemSettings): SettingsError | null {
  for (const [field, range] of Object.entries(LIMITS) as [keyof typeof LIMITS, {min:number;max:number}][]) {
    const value = next[field] as number;
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      return { field, message: `Must be between ${range.min} and ${range.max}` };
    }
  }
  // A warning threshold at or above critical would make the warning state unreachable.
  if (next.warningRisk >= next.criticalRisk) {
    return { field: 'warningRisk', message: 'Warning threshold must be below the critical threshold' };
  }
  if (!next.facilityName.trim()) return { field: 'facilityName', message: 'Facility name is required' };
  if (!next.energyCurrency.trim()) return { field: 'energyCurrency', message: 'Currency is required' };
  return null;
}

export async function updateSettings(patch: Partial<SystemSettings>):
    Promise<{ ok: true; settings: SystemSettings } | { ok: false; error: SettingsError }> {
  const next: SystemSettings = { ...cache, ...patch, facilityName: (patch.facilityName ?? cache.facilityName).trim() };
  const error = validate(next);
  if (error) return { ok: false, error };

  const changed = new Set<keyof SystemSettings>(
    (Object.keys(next) as (keyof SystemSettings)[]).filter(k => next[k] !== cache[k])
  );
  cache = next;
  if (isDbReady()) await SettingsModel.updateOne({ key: 'system' }, { $set: next }, { upsert: true });
  for (const fn of listeners) {
    try { fn(cache, changed); } catch (err) { console.warn('Settings listener failed:', (err as Error).message); }
  }
  return { ok: true, settings: cache };
}

/** Maps a risk score to a status using the configured thresholds. */
export function statusForRisk(risk: number): 'healthy' | 'warning' | 'critical' {
  if (risk >= cache.criticalRisk) return 'critical';
  if (risk >= cache.warningRisk) return 'warning';
  return 'healthy';
}
