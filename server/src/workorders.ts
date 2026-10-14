import { isDbReady } from './db.js';
import { WorkOrderModel } from './models.js';
import { workOrders } from './store.js';

/**
 * Work order lifecycle, checklists, cost and root cause.
 *
 * The flat `status` string the demo shipped with cannot answer "how long did this take" or
 * "what did it cost", so orders now carry timestamps, labour and parts, a checklist, and a
 * structured cause recorded on completion.
 *
 * The failure codes follow the spirit of ISO 14224: a fixed vocabulary rather than free text,
 * because free text cannot be counted, and counted causes are what turn maintenance history
 * into training labels.
 */

export const FAILURE_CODES = [
  { code: 'BRG-WEAR',  label: 'Bearing wear',            group: 'Mechanical' },
  { code: 'BRG-LUB',   label: 'Inadequate lubrication',  group: 'Mechanical' },
  { code: 'MIS-ALIGN', label: 'Shaft misalignment',      group: 'Mechanical' },
  { code: 'IMBALANCE', label: 'Rotor imbalance',         group: 'Mechanical' },
  { code: 'SEAL-LEAK', label: 'Seal or gasket leak',     group: 'Mechanical' },
  { code: 'BLOCKAGE',  label: 'Blockage or restriction', group: 'Process' },
  { code: 'CAVITATE',  label: 'Cavitation',              group: 'Process' },
  { code: 'OVERHEAT',  label: 'Overheating',             group: 'Thermal' },
  { code: 'ELEC-FLT',  label: 'Electrical fault',        group: 'Electrical' },
  { code: 'CTRL-FLT',  label: 'Control or sensor fault', group: 'Instrumentation' },
  { code: 'NO-FAULT',  label: 'No fault found',          group: 'Other' },
  { code: 'OTHER',     label: 'Other',                   group: 'Other' }
] as const;

/** Standard task lists by work type. A plant uses these so inspections are repeatable and
 *  auditable rather than depending on who happened to do the job. */
export const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  'Bearing inspection': [
    'Isolate equipment and apply lockout-tagout',
    'Verify zero energy state',
    'Inspect bearing housing for heat discolouration',
    'Check lubrication level and condition',
    'Listen for bearing noise on slow rotation',
    'Measure shaft end float',
    'Record findings and reinstate guards'
  ],
  'Pump service': [
    'Isolate and lock out, release stored pressure',
    'Inspect mechanical seal for leakage',
    'Check coupling alignment',
    'Verify suction strainer is clear',
    'Inspect impeller for wear or damage',
    'Confirm correct rotation on restart'
  ],
  'Electrical check': [
    'Isolate supply and prove dead',
    'Inspect terminations for discolouration',
    'Measure insulation resistance',
    'Check cable glands and earthing',
    'Verify overload settings against nameplate',
    'Restore supply and confirm normal running current'
  ],
  'General inspection': [
    'Visual inspection for leaks or damage',
    'Check mounting bolts are secure',
    'Verify guards and safety devices',
    'Record operating readings',
    'Note any follow-up work required'
  ]
};

export interface ChecklistItem { id: string; text: string; done: boolean; doneAt?: string; }

export interface WorkOrderDetail {
  id: string; machineId: string; machineName: string; title: string;
  priority: string; status: string; assignedTo: string; dueDate: string;
  createdAt?: string; startedAt?: string; completedAt?: string;
  labourHours?: number; labourRate?: number; partsCost?: number;
  checklist?: ChecklistItem[];
  failureCode?: string;
  /** Successive "why" answers, shortest useful root-cause method. */
  rootCauseWhys?: string[];
  rootCauseNotes?: string;
}

const memory = workOrders as unknown as WorkOrderDetail[];

export function buildChecklist(template: string): ChecklistItem[] {
  const items = CHECKLIST_TEMPLATES[template] ?? CHECKLIST_TEMPLATES['General inspection'];
  return items.map((text, i) => ({ id: `T${i + 1}`, text, done: false }));
}

export async function listOrders(): Promise<WorkOrderDetail[]> {
  if (!isDbReady()) return memory;
  const docs = await WorkOrderModel.find().sort({ createdAt: -1 }).lean();
  return docs.map(d => ({
    id: d.id ?? '', machineId: d.machineId ?? '', machineName: d.machineName ?? '',
    title: d.title ?? '', priority: d.priority ?? 'medium', status: d.status ?? 'open',
    assignedTo: d.assignedTo ?? '', dueDate: new Date(d.dueDate ?? Date.now()).toISOString(),
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : undefined,
    startedAt: d.startedAt ? new Date(d.startedAt).toISOString() : undefined,
    completedAt: d.completedAt ? new Date(d.completedAt).toISOString() : undefined,
    labourHours: d.labourHours ?? undefined, labourRate: d.labourRate ?? undefined,
    partsCost: d.partsCost ?? undefined,
    checklist: (d.checklist ?? []) as ChecklistItem[],
    failureCode: d.failureCode ?? undefined,
    rootCauseWhys: d.rootCauseWhys ?? [],
    rootCauseNotes: d.rootCauseNotes ?? undefined
  }));
}

export async function getOrder(id: string): Promise<WorkOrderDetail | null> {
  return (await listOrders()).find(o => o.id === id) ?? null;
}

async function persist(id: string, patch: Record<string, unknown>) {
  if (isDbReady()) await WorkOrderModel.updateOne({ id }, { $set: patch });
  const local = memory.find(o => o.id === id);
  if (local) Object.assign(local, patch);
}

type Result = { ok: true; order: WorkOrderDetail } | { ok: false; reason: string };

/** Moves an order through open -> in-progress -> completed, stamping the timestamps that
 *  make duration and cost measurable. */
export async function transition(id: string, next: 'open'|'in-progress'|'completed'): Promise<Result> {
  const order = await getOrder(id);
  if (!order) return { ok: false, reason: 'Work order not found' };

  if (next === 'completed') {
    const unfinished = (order.checklist ?? []).filter(i => !i.done);
    if (unfinished.length) return { ok: false, reason: `${unfinished.length} checklist task(s) still outstanding` };
    // A cause is required on completion. Without it the maintenance history cannot be
    // analysed later, and this is the field that eventually becomes a training label.
    if (!order.failureCode) return { ok: false, reason: 'Record a failure code before completing' };
  }

  const patch: Record<string, unknown> = { status: next };
  if (next === 'in-progress' && !order.startedAt) patch.startedAt = new Date();
  if (next === 'completed') patch.completedAt = new Date();
  await persist(id, patch);
  return { ok: true, order: (await getOrder(id))! };
}

export async function toggleTask(id: string, taskId: string, done: boolean): Promise<Result> {
  const order = await getOrder(id);
  if (!order) return { ok: false, reason: 'Work order not found' };
  const checklist = (order.checklist ?? []).map(i =>
    i.id === taskId ? { ...i, done, doneAt: done ? new Date().toISOString() : undefined } : i);
  await persist(id, { checklist });
  return { ok: true, order: (await getOrder(id))! };
}

export async function recordCost(id: string, labourHours: number, labourRate: number, partsCost: number): Promise<Result> {
  const order = await getOrder(id);
  if (!order) return { ok: false, reason: 'Work order not found' };
  await persist(id, { labourHours, labourRate, partsCost });
  return { ok: true, order: (await getOrder(id))! };
}

export async function recordCause(id: string, failureCode: string, whys: string[], notes: string): Promise<Result> {
  const order = await getOrder(id);
  if (!order) return { ok: false, reason: 'Work order not found' };
  if (!FAILURE_CODES.some(f => f.code === failureCode)) return { ok: false, reason: 'Unknown failure code' };
  await persist(id, { failureCode, rootCauseWhys: whys.filter(w => w.trim()), rootCauseNotes: notes });
  return { ok: true, order: (await getOrder(id))! };
}

export async function attachChecklist(id: string, template: string): Promise<Result> {
  const order = await getOrder(id);
  if (!order) return { ok: false, reason: 'Work order not found' };
  await persist(id, { checklist: buildChecklist(template) });
  return { ok: true, order: (await getOrder(id))! };
}

export const orderCost = (o: WorkOrderDetail) =>
  (o.labourHours ?? 0) * (o.labourRate ?? 0) + (o.partsCost ?? 0);
