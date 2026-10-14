export type Status = 'healthy' | 'warning' | 'critical' | 'offline';

export interface Reading {
  machineId: string;
  temperature: number;
  vibration: number;
  pressure: number;
  power: number;
  rpm: number;
  riskScore: number;
  timestamp: string;
}

export interface Machine {
  id: string;
  name: string;
  type: string;
  location: string;
  status: Status;
  health: number;
  nextMaintenance: string;
  reading: Reading;
  history: Reading[];
}

export interface Alert {
  id: string;
  machineId: string;
  machineName: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface WorkOrder {
  id: string;
  machineId: string;
  machineName: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in-progress' | 'completed';
  assignedTo: string;
  dueDate: string;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  role: string;
  /** True while the shipped starter password is still in use. */
  isDefaultPassword: boolean;
  /** False when no database is connected, so changes will not survive a restart. */
  persisted: boolean;
}

export interface AiDiagnosis {
  machineId: string;
  riskScore: number;
  severity: string;
  signals: string[];
  recommendedAction: string;
  model: string;
}

export interface ChecklistItem { id: string; text: string; done: boolean; doneAt?: string; }

export interface WorkOrderDetail extends WorkOrder {
  startedAt?: string; completedAt?: string;
  labourHours?: number; labourRate?: number; partsCost?: number;
  checklist?: ChecklistItem[];
  failureCode?: string;
  rootCauseWhys?: string[];
  rootCauseNotes?: string;
}

export interface WorkOrderMeta {
  failureCodes: { code: string; label: string; group: string }[];
  checklistTemplates: string[];
}

export interface SlaReport {
  targets: Record<string, { respond: number; resolve: number }>;
  alerts: {
    id: string; machineName: string; title: string; severity: string;
    acknowledged: boolean; createdAt: string;
    /** Null when the alert was acknowledged before timestamps were recorded. */
    respondMinutes: number | null;
    targetMinutes: number;
    withinTarget: boolean | null;
    stillOpen: boolean;
  }[];
  summary: {
    total: number; measured: number; unmeasured: number; metTarget: number;
    compliancePct: number | null; meanRespondMinutes: number | null; breaching: number;
  };
}

export interface WorkloadReport {
  technicians: {
    name: string; total: number; open: number; inProgress: number;
    completed: number; overdue: number; highPriority: number; loggedHours: number;
  }[];
  summary: { people: number; openTotal: number; meanOpenPerPerson: number; overloaded: string[] };
}

export interface CostReport {
  currency: string;
  machines: {
    machineId: string; name: string; location: string; orders: number; completed: number;
    labourHours: number; partsCost: number; totalCost: number;
    costPerFailure: number | null; unlogged: number;
  }[];
  totals: { cost: number; labourHours: number; partsCost: number; unloggedOrders: number };
}

export interface Handover {
  window: { hours: number; from: string; to: string };
  plant: {
    assets: number;
    critical: { id: string; name: string; location: string; health: number; risk: number }[];
    warning: { id: string; name: string; location: string; health: number; risk: number }[];
  };
  alerts: { raised: number; outstanding: { id: string; title: string; machineName: string; severity: string; createdAt: string }[] };
  work: {
    completed: { id: string; title: string; machineName: string; assignedTo: string; failureCode?: string; cost: number }[];
    inProgress: { id: string; title: string; machineName: string; assignedTo: string }[];
    open: number;
    overdue: { id: string; title: string; machineName: string; dueDate: string }[];
  };
  headline: string;
}

export interface MachineEnergy {
  machineId: string; name: string; location: string; status: Status;
  kwh: number; cost: number; meanKw: number; peakKw: number;
  /** Null until enough samples have been seen to establish a reference. */
  baselineKw: number | null;
  deviationPct: number | null;
  /** kWh per unit produced; null when nothing has been produced. */
  specificEnergy: number | null;
  runHours: number; loadFactor: number;
}

export interface EnergyReport {
  tariff: number; currency: string;
  totals: { kwh: number; cost: number; projectedDailyKwh: number };
  machines: MachineEnergy[];
}

export interface SignalPoint {
  timestamp: string; temperature: number; vibration: number;
  pressure: number; power: number; rpm: number; riskScore: number;
}

export interface SignalReport {
  machineId: string; name: string; location: string;
  series: SignalPoint[];
  ranges: Record<string, { min: number; max: number }>;
}

export interface ComparisonRow {
  machineId: string; name: string;
  current: { temperature: number; vibration: number; power: number; riskScore: number; samples: number } | null;
  previous: { temperature: number; vibration: number; power: number; riskScore: number; samples: number } | null;
  change: { temperature: number | null; vibration: number | null; power: number | null; riskScore: number | null };
}

export interface Comparison {
  available: boolean; reason?: string; days: number;
  currentWindow?: { from: string; to: string };
  previousWindow?: { from: string; to: string };
  machines?: ComparisonRow[];
}

export interface MachineReliability {
  machineId: string;
  name: string;
  location: string;
  status: Status;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  goodUnits: number;
  rejectUnits: number;
  failures: number;
  /** Null when nothing has failed yet — not the same as an infinite interval. */
  mtbfHours: number | null;
  mttrHours: number | null;
  downtimeHours: number;
  observedHours: number;
  currentlyDown: boolean;
}

export interface Reliability {
  plant: {
    availability: number; performance: number; quality: number; oee: number;
    failures: number; mtbfHours: number | null; mttrHours: number | null;
    goodUnits: number; rejectUnits: number; observedHours: number; since: string;
  };
  machines: MachineReliability[];
  basis: Record<string, string>;
}

export interface SystemSettings {
  facilityName: string;
  sensorIntervalMs: number;
  persistIntervalMs: number;
  warningRisk: number;
  criticalRisk: number;
  readingRetentionDays: number;
}

export interface SettingsEnvelope {
  settings: SystemSettings;
  limits: Record<string, { min: number; max: number }>;
  defaults: SystemSettings;
}

export interface ReplayScenario {
  id: string;
  windows: number;
  trueLabel: string;
  recording: string;
  defectSizeIn: number;
  faultStartsAt?: number;
}

export interface ReplayCatalogue {
  available: boolean;
  samplingRate: number;
  windowSize: number;
  heldOutLoadHp: number;
  note: string;
  scenarios: ReplayScenario[];
}

export interface ReplayStep {
  scenario: string;
  index: number;
  total: number;
  predictedFault: string;
  trueLabel: string;
  correct: boolean;
  confidence: number;
  probabilities: Record<string, number>;
  isFault: boolean;
  waveform: number[];
  rmsAmplitude: number;
  kurtosis?: number;
  crestFactor?: number;
  /** Model-wide importances paired with this window values, not per-prediction attribution. */
  topFeatures?: { name: string; value: number; importance: number }[];
}

export interface DashboardData {
  machines: Machine[];
  alerts: Alert[];
  workOrders: WorkOrder[];
  metrics: {
    totalMachines: number;
    operational: number;
    activeAlerts: number;
    averageHealth: number;
    avoidedDowntimeHours: number;
  };
}
