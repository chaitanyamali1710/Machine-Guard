import { getAlerts } from './repository.js';
import { getSettings } from './settings.js';
import { machines } from './store.js';
import { listOrders, orderCost, type WorkOrderDetail } from './workorders.js';

/**
 * Operational reporting: SLA timing, technician workload, cost rollups and the shift handover.
 *
 * All of it is derived from timestamps and fields the system already records. Where a value
 * has never been captured -- an alert that was never acknowledged, an order with no labour
 * logged -- it is reported as missing rather than as zero, so an unfilled field cannot be
 * mistaken for a fast response or a free repair.
 */

const MINUTES = 60_000;

/** Minimum open orders before someone can be called overloaded, so the flag means something. */
const OVERLOAD_FLOOR = 4;

/** Response and resolution targets per severity, in minutes. */
export const SLA_TARGETS: Record<string, { respond: number; resolve: number }> = {
  high:   { respond: 15,  resolve: 240 },
  medium: { respond: 60,  resolve: 1440 },
  low:    { respond: 480, resolve: 10080 }
};

export async function getSlaReport() {
  const alerts = await getAlerts();
  const now = Date.now();

  const rows = alerts.map(a => {
    const raised = new Date(a.createdAt).getTime();
    const ackIso = (a as { acknowledgedAt?: string }).acknowledgedAt;
    const target = SLA_TARGETS[a.severity] ?? SLA_TARGETS.medium;

    // An unacknowledged alert is still accruing time, so the clock runs to "now" rather than
    // the row being treated as having no response time at all.
    const respondedMs = ackIso ? new Date(ackIso).getTime() - raised : (a.acknowledged ? null : now - raised);
    const respondMins = respondedMs === null ? null : respondedMs / MINUTES;

    return {
      id: a.id, machineName: a.machineName, title: a.title, severity: a.severity,
      acknowledged: a.acknowledged,
      createdAt: a.createdAt,
      respondMinutes: respondMins,
      targetMinutes: target.respond,
      // Null means we genuinely do not know, because this alert was acknowledged before
      // acknowledgement timestamps were recorded.
      withinTarget: respondMins === null ? null : respondMins <= target.respond,
      stillOpen: !a.acknowledged
    };
  });

  const measured = rows.filter(r => r.respondMinutes !== null);
  const met = measured.filter(r => r.withinTarget);

  return {
    targets: SLA_TARGETS,
    alerts: rows,
    summary: {
      total: rows.length,
      measured: measured.length,
      unmeasured: rows.length - measured.length,
      metTarget: met.length,
      compliancePct: measured.length ? (met.length / measured.length) * 100 : null,
      meanRespondMinutes: measured.length
        ? measured.reduce((s, r) => s + (r.respondMinutes ?? 0), 0) / measured.length
        : null,
      breaching: rows.filter(r => r.stillOpen && (r.respondMinutes ?? 0) > r.targetMinutes).length
    }
  };
}

export async function getWorkload() {
  const orders = await listOrders();
  const byTech = new Map<string, WorkOrderDetail[]>();
  for (const o of orders) byTech.set(o.assignedTo, [...(byTech.get(o.assignedTo) ?? []), o]);

  const now = Date.now();
  const technicians = [...byTech.entries()].map(([name, list]) => {
    const open = list.filter(o => o.status !== 'completed');
    return {
      name,
      total: list.length,
      open: open.length,
      inProgress: list.filter(o => o.status === 'in-progress').length,
      completed: list.filter(o => o.status === 'completed').length,
      overdue: open.filter(o => new Date(o.dueDate).getTime() < now).length,
      highPriority: open.filter(o => o.priority === 'high').length,
      loggedHours: list.reduce((s, o) => s + (o.labourHours ?? 0), 0)
    };
  }).sort((a, b) => b.open - a.open);

  const openTotal = technicians.reduce((s, t) => s + t.open, 0);
  return {
    technicians,
    summary: {
      people: technicians.length,
      openTotal,
      meanOpenPerPerson: technicians.length ? openTotal / technicians.length : 0,
      // More than double the average AND at least a few orders in hand. Without the floor,
      // one person holding a single order while everyone else has none reads as "overloaded",
      // which trains people to ignore the flag.
      overloaded: technicians
        .filter(t => technicians.length > 1 && t.open >= OVERLOAD_FLOOR && t.open > (openTotal / technicians.length) * 2)
        .map(t => t.name)
    }
  };
}

export async function getCostReport() {
  const orders = await listOrders();
  const { energyCurrency } = getSettings();

  const byMachine = machines.map(m => {
    const list = orders.filter(o => o.machineId === m.id);
    const completed = list.filter(o => o.status === 'completed');
    const total = list.reduce((s, o) => s + orderCost(o), 0);
    return {
      machineId: m.id, name: m.name, location: m.location,
      orders: list.length,
      completed: completed.length,
      labourHours: list.reduce((s, o) => s + (o.labourHours ?? 0), 0),
      partsCost: list.reduce((s, o) => s + (o.partsCost ?? 0), 0),
      totalCost: total,
      costPerFailure: completed.length ? total / completed.length : null,
      // Orders with no labour logged, so the figures above can be read with the right caution.
      unlogged: list.filter(o => o.labourHours === undefined || o.labourHours === null).length
    };
  }).sort((a, b) => b.totalCost - a.totalCost);

  return {
    currency: energyCurrency,
    machines: byMachine,
    totals: {
      cost: byMachine.reduce((s, m) => s + m.totalCost, 0),
      labourHours: byMachine.reduce((s, m) => s + m.labourHours, 0),
      partsCost: byMachine.reduce((s, m) => s + m.partsCost, 0),
      unloggedOrders: byMachine.reduce((s, m) => s + m.unlogged, 0)
    }
  };
}

/**
 * Shift handover report.
 *
 * Deliberately covers a fixed window and states it, because a handover that silently changes
 * period is worse than none: the oncoming shift cannot tell what has already been passed on.
 */
export async function getHandover(hours = 8) {
  const since = Date.now() - hours * 3_600_000;
  const [alerts, orders] = await Promise.all([getAlerts(), listOrders()]);

  const inWindow = (iso?: string) => Boolean(iso && new Date(iso).getTime() >= since);

  const raised = alerts.filter(a => inWindow(a.createdAt));
  const outstanding = alerts.filter(a => !a.acknowledged);
  const completed = orders.filter(o => o.status === 'completed' && inWindow(o.completedAt));
  const started = orders.filter(o => o.status === 'in-progress');
  const open = orders.filter(o => o.status === 'open');
  const overdue = orders.filter(o => o.status !== 'completed' && new Date(o.dueDate).getTime() < Date.now());

  const critical = machines.filter(m => m.status === 'critical');
  const warning = machines.filter(m => m.status === 'warning');

  return {
    window: { hours, from: new Date(since).toISOString(), to: new Date().toISOString() },
    plant: {
      assets: machines.length,
      critical: critical.map(m => ({ id: m.id, name: m.name, location: m.location, health: m.health, risk: m.reading.riskScore })),
      warning: warning.map(m => ({ id: m.id, name: m.name, location: m.location, health: m.health, risk: m.reading.riskScore }))
    },
    alerts: {
      raised: raised.length,
      outstanding: outstanding.map(a => ({ id: a.id, title: a.title, machineName: a.machineName, severity: a.severity, createdAt: a.createdAt }))
    },
    work: {
      completed: completed.map(o => ({ id: o.id, title: o.title, machineName: o.machineName, assignedTo: o.assignedTo, failureCode: o.failureCode, cost: orderCost(o) })),
      inProgress: started.map(o => ({ id: o.id, title: o.title, machineName: o.machineName, assignedTo: o.assignedTo })),
      open: open.length,
      overdue: overdue.map(o => ({ id: o.id, title: o.title, machineName: o.machineName, dueDate: o.dueDate }))
    },
    // The one line a supervisor reads first.
    headline: critical.length
      ? `${critical.length} asset${critical.length === 1 ? '' : 's'} critical — ${critical.map(m => m.name).join(', ')}`
      : outstanding.length
        ? `No critical assets. ${outstanding.length} alert${outstanding.length === 1 ? '' : 's'} awaiting acknowledgement.`
        : 'No critical assets and no outstanding alerts.'
  };
}
