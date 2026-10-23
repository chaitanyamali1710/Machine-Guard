import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Bot, Boxes, CheckCircle2, ChevronRight,
  ClipboardList, Factory, Gauge, LayoutDashboard, LogOut, Menu, Pause, PlayCircle, Plus,
  RotateCcw, Search, Settings, ShieldCheck, Sparkles, Thermometer, Wrench, X, Zap
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';
import api from './api';
import type { Account, AiDiagnosis, Alert, Comparison, CostReport, EnergyReport, Handover, SignalReport,
  SlaReport, WorkOrderDetail, WorkOrderMeta, WorkloadReport, DashboardData, Machine, Reliability, ReplayCatalogue, ReplayStep, SettingsEnvelope, SystemSettings, WorkOrder } from './types';

// 'settings' is plant-wide configuration reached from the sidebar; 'account' is the signed-in
// user's own profile and password, reached from either avatar.
type Page = 'overview' | 'machines' | 'alerts' | 'work-orders' | 'replay' | 'reliability' | 'performance' | 'operations' | 'assistant' | 'settings' | 'account';

const nav = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'machines', label: 'Machines', icon: Factory },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'work-orders', label: 'Work orders', icon: ClipboardList },
  { id: 'reliability', label: 'Reliability', icon: Gauge },
  { id: 'performance', label: 'Performance', icon: Zap },
  { id: 'operations', label: 'Operations', icon: ClipboardList },
  { id: 'replay', label: 'Fault replay', icon: PlayCircle },
  { id: 'assistant', label: 'AI copilot', icon: Bot },
  { id: 'settings', label: 'System', icon: Settings }
] as const;

const FAULT_LABELS: Record<string,string> = {
  normal: 'Healthy', inner_race: 'Inner race fault',
  ball: 'Ball fault', outer_race: 'Outer race fault'
};
const pretty = (label: string) => FAULT_LABELS[label] ?? label;

const ROLE_LABELS: Record<string,string> = {
  admin: 'System administrator', manager: 'Maintenance manager',
  technician: 'Technician', viewer: 'Read-only access'
};
const roleLabel = (role?: string) => (role ? ROLE_LABELS[role] ?? role : '');

/** The old greeting said "Good morning" at every hour of the day. */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** First letters of the first and last word, so a renamed account gets matching initials. */
function initials(name?: string) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

const fallback: DashboardData = {
  machines: [], alerts: [], workOrders: [],
  metrics: { totalMachines: 0, operational: 0, activeAlerts: 0, averageHealth: 0, avoidedDowntimeHours: 0 }
};

function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoCredentials, setDemoCredentials] = useState<{email:string;password:string}|null>(null);
  const [demoUnavailable, setDemoUnavailable] = useState(false);

  useEffect(()=>{
    let active=true;
    api.get<{enabled:boolean;email:string;password:string}>('/auth/demo-credentials')
      .then(({data})=>{
        if(!active||!data.enabled)return;
        const credentials={email:data.email,password:data.password};
        setDemoCredentials(credentials);
        setEmail(value=>value||credentials.email);
        setPassword(value=>value||credentials.password);
      })
      .catch(()=>{if(active)setDemoUnavailable(true);});
    return()=>{active=false;};
  },[]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('maintai_token', data.token);
      localStorage.setItem('maintai_user', JSON.stringify(data.user));
      onLogin();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to sign in. Is the API running?');
    } finally { setBusy(false); }
  }

  return <div className="login-shell">
    <div className="login-visual">
      <div className="grid-glow" />
      <div className="brand"><span className="brand-mark"><Activity size={22}/></span> MachineGuard</div>
      <div className="hero-copy">
        <span className="eyebrow"><Sparkles size={14}/> INDUSTRIAL INTELLIGENCE</span>
        <h1>See failures before they stop production.</h1>
        <p>One operations center for equipment health, AI-assisted diagnostics and evidence-backed maintenance decisions.</p>
        <div className="hero-stats">
          <div><strong>24/7</strong><span>Live monitoring</span></div>
          <div><strong>91%</strong><span>Demo prediction accuracy</span></div>
          <div><strong>&lt;2s</strong><span>Alert response</span></div>
        </div>
      </div>
      <div className="signal-card"><span className="signal-pulse"/><div><strong>Compressor C-12</strong><small>Anomaly detected 8 seconds ago</small></div><span className="risk-pill">82% risk</span></div>
    </div>
    <div className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="mobile-brand"><span className="brand-mark"><Activity size={20}/></span> MachineGuard</div>
        <span className="kicker">OPERATIONS PORTAL</span>
        <h2>Welcome back</h2><p>Sign in to monitor your industrial assets.</p>
        <label>Work email<input value={email} onChange={e => setEmail(e.target.value)} type="email" required/></label>
        <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" required/></label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-btn" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ChevronRight size={18}/></>}</button>
        {demoCredentials&&<div className="demo-note"><ShieldCheck size={16}/><div><strong>Public evaluator account · read-only</strong><span>Login ID: <code>{demoCredentials.email}</code></span><span>Password: <code>{demoCredentials.password}</code></span></div></div>}
        {demoUnavailable&&<div className="demo-note" role="status">Demo credentials are temporarily unavailable. Please refresh and try again.</div>}
      </form>
    </div>
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${status}`}><i/>{status.replace('-', ' ')}</span>;
}

function MetricCard({ icon: Icon, label, value, sub, tone }: any) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={20}/></div><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></article>;
}

function MachineTable({ machines, onSelect }: { machines: Machine[], onSelect: (m: Machine) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Status</th><th>Health</th><th>Temperature</th><th>Vibration</th><th>Risk</th><th/></tr></thead>
    <tbody>{machines.map(m => <tr key={m.id} onClick={() => onSelect(m)}><td><div className="asset-cell"><span className="asset-icon"><Boxes size={18}/></span><div><strong>{m.name}</strong><small>{m.id} · {m.location}</small></div></div></td><td><StatusBadge status={m.status}/></td><td><div className="health"><span>{m.health}%</span><div><i style={{width:`${m.health}%`}}/></div></div></td><td>{m.reading.temperature.toFixed(1)}°C</td><td>{m.reading.vibration.toFixed(1)} mm/s</td><td><strong className={m.reading.riskScore > 65 ? 'danger-text' : 'safe-text'}>{m.reading.riskScore}%</strong></td><td><ChevronRight size={16}/></td></tr>)}</tbody>
  </table>{!machines.length && <div className="empty">Waiting for machine data…</div>}</div>;
}

type DrawerTab = 'telemetry' | 'diagnosis' | 'maintenance';

function MachineDrawer({ machine, alerts, orders, close, onCreated, onOpenOrder, canManage }:
    { machine: Machine | null; alerts: Alert[]; orders: WorkOrder[];
      close: () => void; onCreated: () => void; onOpenOrder: (id: string) => void; canManage: boolean }) {
  const [tab, setTab] = useState<DrawerTab>('telemetry');
  const [diagnosis, setDiagnosis] = useState<AiDiagnosis|null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title:'', priority:'medium', assignedTo:'Maintenance Team' });
  const [error, setError] = useState('');

  // Reset per-asset state when a different machine is opened, otherwise the previous
  // machine's diagnosis would briefly appear under the new one's name.
  useEffect(()=>{ setTab('telemetry'); setDiagnosis(null); setCreating(false); setError('');
    if (machine) setForm({ title:`Inspect ${machine.name}`, priority: machine.status==='critical'?'high':machine.status==='warning'?'medium':'low', assignedTo:'Maintenance Team' });
  },[machine?.id]);

  useEffect(()=>{ const k=(e:KeyboardEvent)=>{ if(e.key==='Escape') close(); };
    window.addEventListener('keydown',k); return()=>window.removeEventListener('keydown',k); },[close]);

  if (!machine) return null;

  const myAlerts = alerts.filter(a=>a.machineId===machine.id);
  const myOrders = orders.filter(o=>o.machineId===machine.id);
  const openOrders = myOrders.filter(o=>o.status!=='completed');

  async function runDiagnosis() {
    setDiagBusy(true); setError('');
    try { const { data } = await api.post(`/ai/analyze/${machine!.id}`); setDiagnosis(data); }
    catch { setError('AI service unavailable — start FastAPI on port 8000.'); }
    finally { setDiagBusy(false); }
  }

  async function createOrder(e: FormEvent) {
    e.preventDefault(); setError('');
    try { await api.post('/work-orders', { ...form, machineId: machine!.id }); setCreating(false); onCreated(); setTab('maintenance'); }
    catch (err: any) { setError(err.response?.data?.message || 'Could not create the work order.'); }
  }

  return <div className="drawer-backdrop" onClick={close}>
    <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${machine.name} details`} onClick={e => e.stopPropagation()}>
    <button className="icon-btn drawer-close" onClick={close} aria-label="Close panel"><X size={20}/></button>
    <span className="kicker">ASSET DETAILS</span><h2>{machine.name}</h2><p>{machine.id} · {machine.type} · {machine.location}</p>
    <div className="drawer-health"><div><span>Health score</span><strong>{machine.health}%</strong></div><StatusBadge status={machine.status}/></div>

    <div className="drawer-tabs" role="tablist">
      {([['telemetry','Telemetry'],['diagnosis','AI diagnosis'],['maintenance',`Maintenance${openOrders.length?` (${openOrders.length})`:''}`]] as const).map(([id,label])=>
        <button key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}
    </div>

    {error && <div className="api-banner" role="alert"><AlertTriangle size={16}/>{error}</div>}

    {tab==='diagnosis' && <div className="drawer-pane">
      {!diagnosis && <>
        <p className="drawer-hint">Runs the current reading through the scoring service and returns the
          contributing signals with a recommended action.</p>
        <button className="primary-btn" onClick={runDiagnosis} disabled={diagBusy}>
          <Sparkles size={17}/> {diagBusy?'Analysing…':'Run diagnosis'}</button>
      </>}
      {diagnosis && <>
        <div className={`diag-verdict ${diagnosis.severity}`}>
          <strong>{diagnosis.severity}</strong>
          <span>risk {diagnosis.riskScore}%</span>
        </div>
        <h3>Contributing signals</h3>
        <ul className="diag-signals">{diagnosis.signals.map((s,i)=><li key={i}>{s}</li>)}</ul>
        <h3>Recommended action</h3>
        <p className="diag-action">{diagnosis.recommendedAction}</p>
        <p className="drawer-hint">Model: {diagnosis.model}. Decision support only — a qualified technician
          must confirm the cause before any physical work.</p>
        <button className="soft-btn" onClick={runDiagnosis} disabled={diagBusy}>Re-run</button>
      </>}
    </div>}

    {tab==='maintenance' && <div className="drawer-pane">
      {myAlerts.length>0 && <>
        <h3>Alerts</h3>
        <ul className="drawer-list">{myAlerts.map(a=>
          <li key={a.id} className={a.acknowledged?'muted':''}>
            <b className={`priority priority-${a.severity}`}>{a.severity}</b> {a.title}
            {a.acknowledged && <em> · acknowledged</em>}
          </li>)}</ul>
      </>}

      <h3>Work orders</h3>
      {myOrders.length===0
        ? <p className="drawer-hint">No work orders raised for this asset.</p>
        : <ul className="drawer-list">{myOrders.map(o=>
            <li key={o.id}>
              <button className="drawer-link" onClick={()=>{close();onOpenOrder(o.id);}}>
                {o.title}</button>
              <em> · {o.status} · {o.assignedTo}</em>
            </li>)}</ul>}

      {canManage&&!creating
        ? <button className="primary-btn" onClick={()=>setCreating(true)}><Wrench size={17}/> Create maintenance order</button>
        : canManage&&creating&&<form className="drawer-form" onSubmit={createOrder}>
            <label>Task<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} minLength={4} maxLength={160} required autoFocus/></label>
            <label>Priority<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
            <label>Assign to<input value={form.assignedTo} onChange={e=>setForm({...form,assignedTo:e.target.value})} minLength={2} maxLength={80} required/></label>
            <div className="drawer-actions">
              <button className="primary-btn">Create order</button>
              <button type="button" className="soft-btn" onClick={()=>setCreating(false)}>Cancel</button>
            </div>
            <p className="drawer-hint">Priority is pre-filled from the asset's current condition.</p>
          </form>}
    </div>}

    {tab==='telemetry' && <div className="drawer-pane">
    <div className="sensor-grid">
      <div><Thermometer/><span>Temperature</span><strong>{machine.reading.temperature.toFixed(1)} °C</strong></div>
      <div><Activity/><span>Vibration</span><strong>{machine.reading.vibration.toFixed(1)} mm/s</strong></div>
      <div><Gauge/><span>Pressure</span><strong>{machine.reading.pressure.toFixed(1)} bar</strong></div>
      <div><Zap/><span>Power</span><strong>{machine.reading.power.toFixed(1)} kW</strong></div>
      <div><Activity/><span>Speed</span><strong>{machine.reading.rpm} rpm</strong></div>
      <div><AlertTriangle/><span>Risk score</span><strong>{machine.reading.riskScore}%</strong></div>
    </div>
    <h3>Last readings</h3><div className="mini-chart"><ResponsiveContainer width="100%" height={190}><LineChart data={machine.history}><CartesianGrid stroke="#1c2a3d" vertical={false}/><XAxis dataKey="timestamp" tickFormatter={v => new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} stroke="#62718a" fontSize={11}/><YAxis stroke="#62718a" fontSize={11}/><Tooltip contentStyle={{background:'#101b2c',border:'1px solid #26354b',borderRadius:12}}/><Line type="monotone" dataKey="temperature" stroke="#4aa8f0" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="vibration" stroke="#e39a2b" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div>
    <p className="drawer-hint">Next maintenance due {new Date(machine.nextMaintenance).toLocaleDateString()}.</p>
    </div>}
  </aside></div>;
}

function AlertsView({ alerts, refresh, canAcknowledge }: { alerts: Alert[], refresh: () => void; canAcknowledge: boolean }) {
  async function acknowledge(id: string) { await api.patch(`/alerts/${id}/acknowledge`); refresh(); }
  return <section className="content-card"><div className="section-head"><div><span className="kicker">RISK CENTER</span><h2>Active alerts</h2></div><span className="count-badge">{alerts.filter(a=>!a.acknowledged).length} open</span></div>
    <div className="alert-list">{alerts.map(a => <article className={`alert-row severity-${a.severity}`} key={a.id}><span className="alert-icon"><AlertTriangle size={19}/></span><div><strong>{a.title}</strong><p>{a.message}</p><small>{a.machineName} · {new Date(a.createdAt).toLocaleString()}</small></div>{a.acknowledged ? <span className="ack"><CheckCircle2 size={16}/> Acknowledged</span> : canAcknowledge&&<button className="soft-btn" onClick={() => acknowledge(a.id)}>Acknowledge</button>}</article>)}</div>
  </section>;
}

function WorkOrdersView({ orders, refresh, onOpen, canManage }: { orders: WorkOrder[], refresh: () => void, onOpen: (id: string) => void; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ machineId:'VAC-104', title:'Inspect abnormal vibration', priority:'high', assignedTo:'Maintenance Team' });
  async function create(e: FormEvent) { e.preventDefault(); await api.post('/work-orders', form); setOpen(false); refresh(); }
  return <><section className="content-card"><div className="section-head"><div><span className="kicker">MAINTENANCE</span><h2>Work orders</h2></div>{canManage&&<button className="primary-small" onClick={()=>setOpen(true)}><Plus size={16}/> New order</button>}</div>
    <div className="order-grid">{orders.map(o => <article className="order-card order-card-open" key={o.id} role="button" tabIndex={0} aria-label={`Open work order ${o.title}`} onClick={()=>onOpen(o.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(o.id);}}}><div><span className={`priority priority-${o.priority}`}>{o.priority}</span><StatusBadge status={o.status}/></div><h3>{o.title}</h3><p>{o.machineName} · {o.machineId}</p><footer><span><Wrench size={15}/>{o.assignedTo}</span><small>Due {new Date(o.dueDate).toLocaleDateString()}</small></footer></article>)}</div></section>
    {open && <div className="modal-backdrop"><form className="modal" onSubmit={create}><div className="section-head"><h2>Create work order</h2><button type="button" className="icon-btn" onClick={()=>setOpen(false)}><X/></button></div><label>Machine ID<input value={form.machineId} onChange={e=>setForm({...form,machineId:e.target.value})}/></label><label>Task<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label>Priority<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option>low</option><option>medium</option><option>high</option></select></label><label>Assign to<input value={form.assignedTo} onChange={e=>setForm({...form,assignedTo:e.target.value})}/></label><button className="primary-btn">Create order</button></form></div>}</>;
}

function AssistantView({ machines }: { machines: Machine[] }) {
  const [question, setQuestion] = useState('What should I inspect when a vacuum pump has high temperature and vibration?');
  const [messages, setMessages] = useState<{role:string,text:string,sources?:string[]}[]>([{role:'ai',text:'I can combine machine readings, maintenance history and manual evidence. Ask me about an asset or failure symptom.'}]);
  const [busy, setBusy] = useState(false);
  async function ask(e: FormEvent) { e.preventDefault(); if (!question.trim()) return; const q=question; setMessages(v=>[...v,{role:'user',text:q}]); setQuestion(''); setBusy(true); try { const {data}=await api.post('/ai/ask',{question:q,machineId:machines[0]?.id}); setMessages(v=>[...v,{role:'ai',text:data.answer,sources:data.sources}]); } catch { setMessages(v=>[...v,{role:'ai',text:'The AI service is unavailable. Start FastAPI on port 8000 and try again.'}]); } finally {setBusy(false);} }
  return <section className="assistant-layout"><div className="assistant-main"><div className="assistant-title"><span className="ai-orb"><Bot/></span><div><span className="kicker">EVIDENCE COPILOT</span><h2>Maintenance assistant</h2></div><span className="online"><i/> Online</span></div><div className="messages">{messages.map((m,i)=><div className={`message ${m.role}`} key={i}>{m.role==='ai'&&<span><Bot size={18}/></span>}<div><p>{m.text}</p>{m.sources?.length ? <div className="sources">{m.sources.map(s=><small key={s}><ClipboardList size={13}/>{s}</small>)}</div>:null}</div></div>)}{busy&&<div className="typing"><i/><i/><i/></div>}</div><form className="ask-bar" onSubmit={ask}><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask about a machine, symptom or maintenance procedure…"/><button><Sparkles size={18}/></button></form></div><aside className="context-panel"><span className="kicker">LIVE CONTEXT</span><h3>Connected evidence</h3><div className="context-item"><Factory/><div><strong>{machines.length} machines</strong><small>Live telemetry available</small></div></div><div className="context-item"><ClipboardList/><div><strong>4 manual sections</strong><small>Indexed for retrieval</small></div></div><div className="context-item"><Activity/><div><strong>Sensor history</strong><small>Last 24-hour window</small></div></div></aside></section>;
}

function SystemSettingsView({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<SystemSettings|null>(null);
  const [limits, setLimits] = useState<SettingsEnvelope['limits']>({});
  const [defaults, setDefaults] = useState<SystemSettings|null>(null);
  const [note, setNote] = useState<{kind:'ok'|'bad',text:string}|null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(()=>{ api.get('/settings')
    .then(r=>{ setForm(r.data.settings); setLimits(r.data.limits); setDefaults(r.data.defaults); })
    .catch(()=>setNote({kind:'bad',text:'Could not load system settings.'})); },[]);

  function field(key: keyof SystemSettings, value: string) {
    setForm(f => f ? { ...f, [key]: key==='facilityName' ? value : Number(value) } : f);
  }

  async function save(e: FormEvent) {
    e.preventDefault(); if(!form) return;
    setNote(null); setBusy(true);
    try {
      const { data } = await api.patch('/settings', form);
      setForm(data.settings); onSaved();
      setNote({kind:'ok',text:'Settings saved and applied. No restart needed.'});
    } catch (err: any) {
      setNote({kind:'bad',text: err.response?.data?.message || 'Could not save settings.'});
    } finally { setBusy(false); }
  }

  const range = (k: string) => limits[k] ?? { min: 0, max: 999999 };

  return <section className="settings-page">
    <div className="page-title"><div><span className="kicker">SYSTEM</span><h1>Plant configuration</h1>
      <p>Settings that apply to the whole facility and every asset in it.</p></div></div>

    {note && <div className={note.kind==='ok'?'settings-ok':'api-banner'}>
      {note.kind==='ok'?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}{note.text}</div>}

    {!isAdmin && <div className="settings-warn"><AlertTriangle size={17}/>
      <div><strong>Read-only.</strong><p>Only an administrator can change plant configuration.</p></div></div>}

    {form ? <form onSubmit={save}><fieldset disabled={!isAdmin||busy} className="settings-fieldset">
      <div className="settings-grid">
        <section className="content-card">
          <div className="section-head"><div><span className="kicker">FACILITY</span><h2>Identity</h2></div></div>
          <label>Facility name<input value={form.facilityName} onChange={e=>field('facilityName',e.target.value)} minLength={2} maxLength={60} required/></label>
          <p className="settings-hint">Shown in the sidebar and on reports.</p>
        </section>

        <section className="content-card">
          <div className="section-head"><div><span className="kicker">ASSET HEALTH</span><h2>Alert thresholds</h2></div></div>
          <label>Warning at risk score ≥ <input type="number" value={form.warningRisk} onChange={e=>field('warningRisk',e.target.value)} min={range('warningRisk').min} max={range('warningRisk').max}/></label>
          <label>Critical at risk score ≥ <input type="number" value={form.criticalRisk} onChange={e=>field('criticalRisk',e.target.value)} min={range('criticalRisk').min} max={range('criticalRisk').max}/></label>
          <p className="settings-hint">Every asset is re-graded the moment you save. Warning must stay below critical.</p>
        </section>

        <section className="content-card">
          <div className="section-head"><div><span className="kicker">TELEMETRY</span><h2>Sampling and storage</h2></div></div>
          <label>Sensor update interval (ms)<input type="number" value={form.sensorIntervalMs} onChange={e=>field('sensorIntervalMs',e.target.value)} min={range('sensorIntervalMs').min} max={range('sensorIntervalMs').max} step={500}/></label>
          <label>Database write interval (ms)<input type="number" value={form.persistIntervalMs} onChange={e=>field('persistIntervalMs',e.target.value)} min={range('persistIntervalMs').min} max={range('persistIntervalMs').max} step={5000}/></label>
          <label>Keep readings for (days)<input type="number" value={form.readingRetentionDays} onChange={e=>field('readingRetentionDays',e.target.value)} min={range('readingRetentionDays').min} max={range('readingRetentionDays').max}/></label>
          <p className="settings-hint">Writing more often, or keeping readings longer, uses more database storage.
            At the current values this is roughly <b>{estimateStorageMb(form)} MB</b> of a 512 MB free cluster.</p>
        </section>

        <section className="content-card">
          <div className="section-head"><div><span className="kicker">REFERENCE</span><h2>Shipped defaults</h2></div></div>
          {defaults && <ul className="defaults-list">
            <li><span>Facility</span><b>{defaults.facilityName}</b></li>
            <li><span>Warning / critical</span><b>{defaults.warningRisk} / {defaults.criticalRisk}</b></li>
            <li><span>Sensor interval</span><b>{defaults.sensorIntervalMs} ms</b></li>
            <li><span>Write interval</span><b>{defaults.persistIntervalMs} ms</b></li>
            <li><span>Retention</span><b>{defaults.readingRetentionDays} days</b></li>
          </ul>}
          {isAdmin && defaults && <button type="button" className="soft-btn" onClick={()=>setForm({...defaults})}>Restore defaults</button>}
        </section>
      </div>
      {isAdmin && <button className="primary-btn settings-save" disabled={busy}>Save plant configuration</button>}
    </fieldset></form> : <div className="replay-idle"><Settings size={32}/><p>Loading settings…</p></div>}
  </section>;
}

/** Rough steady-state size: 6 assets written each interval, kept for the retention window. */
function estimateStorageMb(s: SystemSettings) {
  const writesPerDay = (24 * 60 * 60 * 1000) / s.persistIntervalMs;
  const docs = writesPerDay * 6 * s.readingRetentionDays;
  return Math.max(1, Math.round((docs * 280) / 1048576));
}

function AccountSettingsView({ onSignOut, onProfileChange }: { onSignOut: () => void; onProfileChange: () => void }) {
  const [account, setAccount] = useState<Account|null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profilePassword, setProfilePassword] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState<{kind:'ok'|'bad',text:string}|null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(()=>{ api.get('/account')
    .then(r=>{ setAccount(r.data); setName(r.data.name); setEmail(r.data.email); })
    .catch(()=>setNote({kind:'bad',text:'Could not load your account.'})); },[]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); setNote(null); setBusy(true);
    try {
      const { data } = await api.patch('/account/profile', { currentPassword: profilePassword, email, name });
      localStorage.setItem('maintai_token', data.token);   // the old token still held the previous email
      setAccount(a=>a?{...a, name:data.user.name, email:data.user.email}:a);
      setProfilePassword('');
      onProfileChange();   // refresh the sidebar and header straight away
      setNote({kind:'ok',text:'Profile updated. Your new email is now your sign-in ID.'});
    } catch (err: any) {
      setNote({kind:'bad',text: err.response?.data?.message || 'Could not update your profile.'});
    } finally { setBusy(false); }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault(); setNote(null);
    if (next !== confirm) { setNote({kind:'bad',text:'The two new passwords do not match.'}); return; }
    setBusy(true);
    try {
      await api.patch('/account/password', { currentPassword: current, newPassword: next });
      setNote({kind:'ok',text:'Password changed. Signing you out…'});
      // Sign out so the change applies everywhere rather than leaving this tab on an old session.
      setTimeout(onSignOut, 1200);
    } catch (err: any) {
      setNote({kind:'bad',text: err.response?.data?.message || 'Could not change your password.'});
    } finally { setBusy(false); }
  }

  return <section className="settings-page">
    <div className="page-title"><div><span className="kicker">SETTINGS</span><h1>Account and security</h1>
      <p>Your sign-in details. These are the credentials used every time you log in.</p></div></div>

    {note && <div className={note.kind==='ok'?'settings-ok':'api-banner'}>
      {note.kind==='ok'?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}{note.text}</div>}

    {account?.isDefaultPassword && <div className="settings-warn"><AlertTriangle size={17}/>
      <div><strong>You are still using the starter password.</strong>
        <p>Anyone who has seen this project knows it. Change it below before sharing the dashboard.</p></div></div>}

    {account && !account.persisted && <div className="settings-warn"><AlertTriangle size={17}/>
      <div><strong>No database connected.</strong>
        <p>Credential changes will be lost when the server restarts. Set MONGODB_URI to store them properly.</p></div></div>}

    {account?.isDemo&&<div className="settings-hint">This is a shared, read-only evaluator account. Its profile and password cannot be changed.</div>}

    <div className="settings-grid">
      <section className="content-card">
        <div className="section-head"><div><span className="kicker">SIGN-IN ID</span><h2>Profile</h2></div></div>
        {!account?.isDemo?<form onSubmit={saveProfile}>
          <label>Full name<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required/></label>
          <label>Email (this is your login ID)<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
          <label>Current password<input type="password" value={profilePassword} onChange={e=>setProfilePassword(e.target.value)} placeholder="Confirm it is you" required/></label>
          <button className="primary-btn" disabled={busy}>Save profile</button>
        </form>:<p className="settings-hint">The evaluator sign-in ID is shared with other visitors and cannot be edited.</p>}
        <p className="settings-hint">Your role is <b>{account?.role ?? '—'}</b>. Changing the email changes what you type at the login screen.</p>
      </section>

      <section className="content-card">
        <div className="section-head"><div><span className="kicker">SECURITY</span><h2>Change password</h2></div></div>
        {!account?.isDemo?<form onSubmit={savePassword}>
          <label>Current password<input type="password" value={current} onChange={e=>setCurrent(e.target.value)} required/></label>
          <label>New password<input type="password" value={next} onChange={e=>setNext(e.target.value)} minLength={8} maxLength={72} required/></label>
          <label>Repeat new password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} maxLength={72} required/></label>
          <button className="primary-btn" disabled={busy}>Change password</button>
        </form>:<p className="settings-hint">The shared evaluator password cannot be changed.</p>}
        <p className="settings-hint">At least 8 characters. You will be signed out afterwards and must sign in with the new password.</p>
      </section>
    </div>
  </section>;
}

function ReplayView() {
  const [catalogue, setCatalogue] = useState<ReplayCatalogue|null>(null);
  const [scenario, setScenario] = useState('degradation');
  const [step, setStep] = useState<ReplayStep|null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [history, setHistory] = useState<ReplayStep[]>([]);
  const [problem, setProblem] = useState('');
  const [speed, setSpeed] = useState(1);
  const [raised, setRaised] = useState(false);

  useEffect(()=>{ api.get('/replay/scenarios')
    .then(r=>{ setCatalogue(r.data); if(!r.data.available) setProblem('Replay needs a trained model. Run training/train.py then training/export_replay.py.'); })
    .catch(()=>setProblem('AI service unavailable — start FastAPI on port 8000.')); },[]);

  // Each tick asks the backend to classify the next recorded window. The model sees one
  // window at a time with no memory, exactly as it would on a live machine.
  useEffect(()=>{ if(!playing) return;
    const timer = setInterval(async()=>{
      try {
        const { data } = await api.post('/replay/step', { scenario, index });
        setStep(data); setHistory(h=>[...h.slice(-39), data]); setIndex(i=>i+1);
      } catch { setProblem('Replay step failed — is the AI service running?'); setPlaying(false); }
    }, 900 / speed);
    return ()=>clearInterval(timer);
  },[playing, scenario, index, speed]);

  function reset(next = scenario) {
    setScenario(next); setIndex(0); setStep(null); setHistory([]); setPlaying(false); setProblem('');
  }

  const active = catalogue?.scenarios.find(s=>s.id===scenario);
  const seen = history.length;
  const accuracy = seen ? Math.round(history.filter(h=>h.correct).length / seen * 100) : null;
  const trace = (step?.waveform ?? []).map((v,i)=>({ i, v }));

  // Confusion matrix accumulated across the run: rows are the true label, columns the call.
  const labels = ['normal','inner_race','ball','outer_race'];
  const matrix = labels.map(t => labels.map(p =>
    history.filter(h => h.trueLabel===t && h.predictedFault===p).length));
  const seenLabels = labels.filter((_,i) => matrix[i].some(v=>v>0));

  async function jump(to: number) {
    setPlaying(false);
    try {
      const { data } = await api.post('/replay/step', { scenario, index: to });
      setStep(data); setIndex(to+1);
    } catch { setProblem('Could not load that window.'); }
  }

  async function raiseOrder() {
    if (!step) return;
    try {
      await api.post('/work-orders', {
        machineId: 'PMP-089',
        title: `Investigate ${pretty(step.predictedFault).toLowerCase()} detected in replay`,
        priority: step.predictedFault==='normal' ? 'low' : 'high',
        assignedTo: 'Maintenance Team'
      });
      setProblem('');
      setRaised(true);
      setTimeout(()=>setRaised(false), 3500);
    } catch { setProblem('Could not raise a work order.'); }
  }

  function exportCsv() {
    const rows = [
      ['index','trueLabel','predicted','correct','confidence','rms','kurtosis','crestFactor'],
      ...history.map(h=>[h.index,h.trueLabel,h.predictedFault,h.correct,h.confidence,h.rmsAmplitude,h.kurtosis ?? '',h.crestFactor ?? ''])
    ];
    const blob = new Blob([rows.map(r=>r.join(',')).join('\n')], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `replay-${scenario}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return <section className="replay-layout">
    <div className="page-title"><div><span className="kicker">MODEL REPLAY</span><h1>Bearing fault replay</h1>
      <p>Real CWRU vibration recordings streamed through the trained classifier, one window at a time.</p></div></div>

    {problem && <div className="api-banner"><AlertTriangle size={17}/>{problem}</div>}

    <div className="replay-controls content-card">
      <div className="replay-scenarios">
        {catalogue?.scenarios.map(s=>
          <button key={s.id} className={s.id===scenario?'chip active':'chip'} onClick={()=>reset(s.id)}>
            {s.id==='degradation' ? 'Healthy → fault' : pretty(s.trueLabel)}
          </button>)}
      </div>
      <div className="replay-buttons">
        <button className="soft-btn" onClick={()=>jump(Math.max(0,(step?.index ?? 0)-1))}
          disabled={!catalogue?.available || (step?.index ?? 0)===0} aria-label="Previous window">◀</button>
        <button className="primary-small" onClick={()=>setPlaying(p=>!p)} disabled={!catalogue?.available}>
          {playing ? <><Pause size={16}/> Pause</> : <><PlayCircle size={16}/> Play</>}
        </button>
        <button className="soft-btn" onClick={()=>jump(((step?.index ?? -1)+1) % (step?.total ?? 1))}
          disabled={!catalogue?.available} aria-label="Next window">▶</button>
        <select className="chart-select speed" value={speed} onChange={e=>setSpeed(Number(e.target.value))} aria-label="Playback speed">
          <option value={0.5}>0.5×</option><option value={1}>1×</option>
          <option value={2}>2×</option><option value={4}>4×</option>
        </select>
        <button className="text-btn" onClick={()=>reset()}><RotateCcw size={15}/> Restart</button>
      </div>
    </div>

    {/* Scrubber: jump straight to the fault transition instead of waiting for playback. */}
    {step && <div className="replay-scrub">
      <input type="range" min={0} max={step.total-1} value={step.index}
        onChange={e=>jump(Number(e.target.value))} aria-label="Scrub to window"/>
      <span>{step.index+1} / {step.total}</span>
      {active?.faultStartsAt !== undefined &&
        <button className="text-btn" onClick={()=>jump(Math.max(0,active.faultStartsAt!-1))}>
          Jump to fault onset</button>}
    </div>}

    {catalogue && <p className="replay-note"><ShieldCheck size={15}/>
      {catalogue.note} Recorded at {catalogue.heldOutLoadHp} hp,
      {' '}{catalogue.windowSize} samples per window at {catalogue.samplingRate/1000} kHz.
    </p>}

    <div className="replay-grid">
      <section className="content-card chart-card">
        <div className="section-head"><div><span className="kicker">RAW VIBRATION</span>
          <h2>{active ? (active.id==='degradation' ? 'Healthy → fault run' : pretty(active.trueLabel)) : 'Waveform'}</h2></div>
          <span className="legend"><i/>Window {step ? step.index+1 : 0} of {step?.total ?? active?.windows ?? 0}</span></div>
        <div className="main-chart"><ResponsiveContainer width="100%" height={240}>
          <LineChart data={trace}><CartesianGrid stroke="#e8edf4" vertical={false}/>
            <XAxis dataKey="i" hide/><YAxis stroke="#8b97aa" fontSize={11} domain={['auto','auto']}/>
            <Line type="monotone" dataKey="v" stroke={step?.isFault?'#e05a42':'#1b6fc4'} strokeWidth={1.4} dot={false} isAnimationActive={false}/>
          </LineChart></ResponsiveContainer></div>
      </section>

      <section className="content-card replay-verdict">
        <div className="section-head"><div><span className="kicker">MODEL PREDICTION</span><h2>Diagnosis</h2></div>
          {step && <span className={step.correct?'verdict-ok':'verdict-bad'}>{step.correct?<CheckCircle2 size={15}/>:<X size={15}/>}{step.correct?'Agrees':'Disagrees'}</span>}</div>
        {step ? <>
          <div className={`replay-call ${step.isFault?'fault':'ok'}`}>
            <strong>{pretty(step.predictedFault)}</strong>
            <small>confidence {(step.confidence*100).toFixed(1)}%</small>
          </div>
          <div className="replay-truth">Ground truth: <b>{pretty(step.trueLabel)}</b></div>
          <div className="prob-bars">{Object.entries(step.probabilities).sort((a,b)=>b[1]-a[1]).map(([k,v])=>
            <div className="prob-row" key={k}><span>{pretty(k)}</span>
              <i><b style={{width:`${Math.max(2,v*100)}%`}}/></i><small>{(v*100).toFixed(0)}%</small></div>)}</div>
          <div className="replay-stats">
            <div><strong>{accuracy ?? '—'}%</strong><small>agreement over {seen} windows</small></div>
            <div><strong>{step.rmsAmplitude.toFixed(3)}</strong><small>RMS amplitude</small></div>
            {step.kurtosis !== undefined && <div><strong>{step.kurtosis.toFixed(2)}</strong><small>kurtosis</small></div>}
            {step.crestFactor !== undefined && <div><strong>{step.crestFactor.toFixed(2)}</strong><small>crest factor</small></div>}
          </div>

          {step.topFeatures && step.topFeatures.length>0 && <div className="replay-drivers">
            <h3>What drove this call</h3>
            {step.topFeatures.map(f=>
              <div className="driver-row" key={f.name}>
                <span>{f.name.replace(/_/g,' ')}</span>
                <i><b style={{width:`${Math.min(100,f.importance*100/0.15)}%`}}/></i>
                <small>{f.value}</small>
              </div>)}
            <p className="settings-hint">Model-wide feature importances with this window's values — not a
              per-prediction attribution, which would need SHAP.</p>
          </div>}

          <div className="replay-actions">
            <button className="soft-btn" onClick={raiseOrder}>
              <Wrench size={14}/> {raised ? 'Work order raised' : 'Raise work order'}</button>
            <button className="soft-btn" onClick={exportCsv} disabled={!seen}>
              <ClipboardList size={14}/> Export run ({seen})</button>
          </div>
        </> : <div className="replay-idle"><PlayCircle size={34}/><p>Press play to stream recorded windows through the model.</p></div>}
      </section>
    </div>

    {/* Live confusion matrix across the run so far. */}
    {seen > 0 && <section className="content-card">
      <div className="section-head"><div><span className="kicker">RUNNING EVALUATION</span><h2>Confusion matrix</h2></div>
        <span className="legend">{seen} windows · {accuracy}% agreement</span></div>
      <div className="table-wrap"><table className="confusion">
        <thead><tr><th>True \ Predicted</th>{seenLabels.map(l=><th key={l}>{pretty(l)}</th>)}</tr></thead>
        <tbody>{seenLabels.map(t=>
          <tr key={t}><th>{pretty(t)}</th>
            {seenLabels.map(p=>{
              const v = matrix[labels.indexOf(t)][labels.indexOf(p)];
              return <td key={p} className={v===0?'zero':t===p?'hit':'miss'}>{v}</td>;
            })}
          </tr>)}
        </tbody></table></div>
      <p className="settings-hint">Counts accumulate as the run plays. Values off the diagonal are
        misclassifications — on held-out data, so they are real errors rather than training noise.</p>
    </section>}
  </section>;
}

/**
 * Plant floor map.
 *
 * Assets are grouped into zones by their `location`, so the layout comes from real data rather
 * than hardcoded coordinates — registering an asset in a new location adds a zone by itself.
 * Status is carried by colour AND by the label underneath, because colour alone fails for
 * colour-blind operators and in a glare-heavy plant.
 */
function FloorMap({ machines, onSelect }: { machines: Machine[]; onSelect: (m: Machine) => void }) {
  const zones = useMemo(()=>{
    const grouped = new Map<string, Machine[]>();
    for (const m of machines) grouped.set(m.location, [...(grouped.get(m.location) ?? []), m]);
    return [...grouped.entries()];
  },[machines]);

  const COLS = 3;
  const ZONE_W = 260, ZONE_H = 190, GAP = 22;
  const rows = Math.ceil(zones.length / COLS);
  const width = COLS * ZONE_W + (COLS - 1) * GAP;
  const height = rows * ZONE_H + (rows - 1) * GAP;

  const tone = (status: string) =>
    status === 'critical' ? '#e05a42' : status === 'warning' ? '#e39a2b' : '#17a06f';

  return <section className="content-card">
    <div className="section-head">
      <div><span className="kicker">PLANT LAYOUT</span><h2>Floor map</h2></div>
      <div className="floor-legend">
        <span><i style={{background:'#17a06f'}}/>Healthy</span>
        <span><i style={{background:'#e39a2b'}}/>Warning</span>
        <span><i style={{background:'#e05a42'}}/>Critical</span>
      </div>
    </div>
    <div className="floor-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img"
           aria-label={`Plant floor map with ${machines.length} assets across ${zones.length} areas`}>
        {zones.map(([location, assets], zi)=>{
          const zx = (zi % COLS) * (ZONE_W + GAP);
          const zy = Math.floor(zi / COLS) * (ZONE_H + GAP);
          return <g key={location}>
            <rect className="floor-zone" x={zx} y={zy} width={ZONE_W} height={ZONE_H} rx={10}/>
            <text className="floor-zone-label" x={zx+14} y={zy+22}>{location.toUpperCase()}</text>
            {assets.map((m, ai)=>{
              // Lay assets out in a row inside their zone, wrapping after three.
              const perRow = Math.min(assets.length, 3);
              const cellW = ZONE_W / perRow;
              const cx = zx + cellW * (ai % perRow) + cellW / 2;
              const cy = zy + 72 + Math.floor(ai / perRow) * 76;
              const colour = tone(m.status);
              return <g className="floor-asset" key={m.id} tabIndex={0} role="button"
                        aria-label={`${m.name}, ${m.location}, ${m.status}, ${m.reading.temperature.toFixed(1)} degrees Celsius`}
                        onClick={()=>onSelect(m)}
                        onKeyDown={e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); onSelect(m); } }}>
                {m.status==='critical' && <circle className="pulse" cx={cx} cy={cy} r={18} fill={colour}/>}
                <circle className="node" cx={cx} cy={cy} r={18} fill={colour}/>
                <text className="code" x={cx} y={cy+4}>{m.id.split('-')[1]}</text>
                <text className="caption" x={cx} y={cy+34}>{m.id}</text>
                <text className="reading" x={cx} y={cy+47}>{m.reading.temperature.toFixed(0)}°C · {m.health}%</text>
              </g>;
            })}
          </g>;
        })}
      </svg>
    </div>
  </section>;
}

function RegisterAssetModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [types, setTypes] = useState<string[]>([]);
  const [form, setForm] = useState({ id:'', name:'', type:'', location:'' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(()=>{ api.get('/machine-types')
    .then(r=>{ setTypes(r.data.types); setForm(f=>({...f, type:r.data.types[0] ?? ''})); })
    .catch(()=>setError('Could not load asset types.')); },[]);

  // Escape closes the dialog, which is the behaviour a keyboard user expects.
  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => { if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  },[onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await api.post('/machines', form); onCreated(); onClose(); }
    catch (err: any) { setError(err.response?.data?.message || 'Could not register the asset.'); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="register-title" onClick={e=>e.stopPropagation()}>
      <div className="section-head">
        <div><span className="kicker">ASSET MANAGEMENT</span><h2 id="register-title">Register asset</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={17}/></button>
      </div>
      {error && <div className="api-banner" role="alert"><AlertTriangle size={16}/>{error}</div>}
      <form onSubmit={submit}>
        <label>Asset code<input value={form.id} onChange={e=>setForm({...form,id:e.target.value.toUpperCase()})}
          placeholder="PMP-090" pattern="[A-Za-z]{2,4}-\d{1,5}" required autoFocus
          aria-describedby="code-help"/></label>
        <small id="code-help" className="field-help">Two to four letters, a hyphen, then digits — e.g. CNC-208.</small>
        <label>Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}
          placeholder="Coolant Pump P-90" minLength={3} maxLength={60} required/></label>
        <label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} required>
          {types.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
        <label>Location<input value={form.location} onChange={e=>setForm({...form,location:e.target.value})}
          placeholder="Cooling" minLength={2} maxLength={40} required/></label>
        <button className="primary-btn" disabled={busy}>{busy?'Registering…':'Register asset'}</button>
      </form>
      <p className="settings-hint">The asset starts producing telemetry immediately using a baseline for its type.</p>
    </div>
  </div>;
}

/** Searches assets, alerts and work orders together, so the header box means what it implies. */
function GlobalSearch({ data, onSelectMachine, onNavigate }:
    { data: DashboardData; onSelectMachine: (m: Machine) => void; onNavigate: (p: Page) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const results = useMemo(()=>{
    const q = query.trim().toLowerCase();
    if (q.length < 2) return { machines: [], alerts: [], orders: [] };
    const hit = (...parts: string[]) => parts.join(' ').toLowerCase().includes(q);
    return {
      machines: data.machines.filter(m=>hit(m.name,m.id,m.location,m.type)).slice(0,4),
      alerts: data.alerts.filter(a=>hit(a.title,a.machineName,a.message)).slice(0,3),
      orders: data.workOrders.filter(o=>hit(o.title,o.machineName,o.assignedTo)).slice(0,3)
    };
  },[query,data]);

  const total = results.machines.length + results.alerts.length + results.orders.length;

  useEffect(()=>{
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey||e.metaKey) && e.key==='k') { e.preventDefault(); document.getElementById('global-search')?.focus(); }
      if (e.key==='Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  },[]);

  return <div className="search" onClick={e=>e.stopPropagation()}>
    <Search size={17} aria-hidden="true"/>
    <input id="global-search" value={query} role="combobox" aria-expanded={open&&query.length>1}
      aria-controls="search-results" aria-autocomplete="list"
      onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)}
      placeholder="Search assets, alerts or work orders…  Ctrl K"/>
    {open && query.trim().length>1 && <div className="search-results" id="search-results" role="listbox">
      {total===0 && <p className="search-none">No matches for “{query}”.</p>}
      {results.machines.length>0 && <div className="search-group"><span>Assets</span>
        {results.machines.map(m=><button role="option" aria-selected="false" key={m.id}
          onClick={()=>{onSelectMachine(m);setOpen(false);setQuery('');}}>
          <Factory size={14}/><b>{m.name}</b><small>{m.location}</small></button>)}</div>}
      {results.alerts.length>0 && <div className="search-group"><span>Alerts</span>
        {results.alerts.map(a=><button role="option" aria-selected="false" key={a.id}
          onClick={()=>{onNavigate('alerts');setOpen(false);setQuery('');}}>
          <Bell size={14}/><b>{a.title}</b><small>{a.machineName}</small></button>)}</div>}
      {results.orders.length>0 && <div className="search-group"><span>Work orders</span>
        {results.orders.map(o=><button role="option" aria-selected="false" key={o.id}
          onClick={()=>{onNavigate('work-orders');setOpen(false);setQuery('');}}>
          <ClipboardList size={14}/><b>{o.title}</b><small>{o.machineName}</small></button>)}</div>}
    </div>}
  </div>;
}

function OperationsView() {
  const [handover, setHandover] = useState<Handover|null>(null);
  const [sla, setSla] = useState<SlaReport|null>(null);
  const [workload, setWorkload] = useState<WorkloadReport|null>(null);
  const [cost, setCost] = useState<CostReport|null>(null);
  const [hours, setHours] = useState(8);

  useEffect(()=>{ api.get(`/ops/handover?hours=${hours}`).then(r=>setHandover(r.data)).catch(()=>{}); },[hours]);
  useEffect(()=>{ const go=()=>{
      api.get('/ops/sla').then(r=>setSla(r.data)).catch(()=>{});
      api.get('/ops/workload').then(r=>setWorkload(r.data)).catch(()=>{});
      api.get('/ops/cost').then(r=>setCost(r.data)).catch(()=>{});
    }; go(); const id=setInterval(go,8000); return()=>clearInterval(id); },[]);

  const money = (v: number) => `${cost?.currency==='INR'?'₹':''}${v.toLocaleString(undefined,{maximumFractionDigits:0})}`;
  const mins = (v: number|null) => v===null ? '—' : v < 90 ? `${v.toFixed(0)} min` : `${(v/60).toFixed(1)} h`;

  return <section>
    <div className="page-title">
      <div><span className="kicker">OPERATIONS</span><h1>Shift handover and performance</h1>
        <p>Response times, workload and maintenance cost, measured from recorded timestamps.</p></div>
      <select className="chart-select" value={hours} onChange={e=>setHours(Number(e.target.value))} aria-label="Handover window">
        <option value={8}>Last 8 hours (shift)</option>
        <option value={12}>Last 12 hours</option>
        <option value={24}>Last 24 hours</option>
      </select>
    </div>

    {/* ---- Shift handover ---- */}
    {handover && <section className="content-card handover">
      <div className="section-head"><div><span className="kicker">SHIFT HANDOVER</span><h2>Report for the oncoming shift</h2></div>
        <span className="legend">{new Date(handover.window.from).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} – {new Date(handover.window.to).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>

      <p className={`handover-headline ${handover.plant.critical.length?'bad':'ok'}`}>
        {handover.plant.critical.length ? <AlertTriangle size={17}/> : <CheckCircle2 size={17}/>}
        {handover.headline}
      </p>

      <div className="handover-grid">
        <div><h3>Needs attention now</h3>
          {handover.plant.critical.length===0 && handover.plant.warning.length===0
            ? <p className="handover-none">All assets within limits.</p>
            : <ul className="handover-list">
                {handover.plant.critical.map(m=><li key={m.id}><b className="danger-text">CRITICAL</b> {m.name} — {m.location}, health {m.health}%</li>)}
                {handover.plant.warning.map(m=><li key={m.id}><b className="warn-text">WARNING</b> {m.name} — {m.location}, health {m.health}%</li>)}
              </ul>}
        </div>
        <div><h3>Alerts awaiting acknowledgement</h3>
          {handover.alerts.outstanding.length===0
            ? <p className="handover-none">None outstanding.</p>
            : <ul className="handover-list">{handover.alerts.outstanding.map(a=>
                <li key={a.id}><b>{a.severity.toUpperCase()}</b> {a.title} — {a.machineName}</li>)}</ul>}
        </div>
        <div><h3>Work completed this window</h3>
          {handover.work.completed.length===0
            ? <p className="handover-none">No work orders closed.</p>
            : <ul className="handover-list">{handover.work.completed.map(o=>
                <li key={o.id}>{o.title} — {o.machineName} ({o.assignedTo}){o.failureCode?<em> · {o.failureCode}</em>:null}</li>)}</ul>}
        </div>
        <div><h3>Carried over</h3>
          <ul className="handover-list">
            <li>{handover.work.inProgress.length} in progress, {handover.work.open} open</li>
            {handover.work.overdue.map(o=><li key={o.id}><b className="danger-text">OVERDUE</b> {o.title} — {o.machineName}</li>)}
          </ul>
        </div>
      </div>
    </section>}

    {/* ---- SLA ---- */}
    {sla && <section className="content-card">
      <div className="section-head"><div><span className="kicker">RESPONSE TIME</span><h2>Alert SLA</h2></div></div>
      <div className="metrics">
        <MetricCard icon={Gauge} label="Compliance" value={sla.summary.compliancePct===null?'—':`${sla.summary.compliancePct.toFixed(0)}%`} sub={`${sla.summary.measured} of ${sla.summary.total} measurable`} tone="mint"/>
        <MetricCard icon={Activity} label="Mean response" value={mins(sla.summary.meanRespondMinutes)} sub="Raised to acknowledged" tone="blue"/>
        <MetricCard icon={AlertTriangle} label="Breaching now" value={sla.summary.breaching} sub="Open past target" tone="orange"/>
        <MetricCard icon={ClipboardList} label="Not measurable" value={sla.summary.unmeasured} sub="Acknowledged before timing existed" tone="purple"/>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Alert</th><th>Asset</th><th>Severity</th><th>Response</th><th>Target</th><th>Result</th></tr></thead>
        <tbody>{sla.alerts.map(a=>
          <tr key={a.id}>
            <td><strong>{a.title}</strong></td><td>{a.machineName}</td>
            <td><span className={`priority priority-${a.severity}`}>{a.severity}</span></td>
            <td>{a.respondMinutes===null?<span className="cmp-flat">unknown</span>:mins(a.respondMinutes)}</td>
            <td>{mins(a.targetMinutes)}</td>
            <td>{a.withinTarget===null?<span className="cmp-flat">—</span>
              : a.withinTarget ? <span className="verdict-ok"><CheckCircle2 size={13}/>Met</span>
              : <span className="verdict-bad"><X size={13}/>Breach</span>}</td>
          </tr>)}
        </tbody></table></div>
      <p className="settings-hint">“Unknown” means the alert was acknowledged before response timestamps were
        recorded. It is shown as unknown rather than counted as instant, which would flatter the figure.</p>
    </section>}

    <div className="ops-split">
      {/* ---- Workload ---- */}
      {workload && <section className="content-card">
        <div className="section-head"><div><span className="kicker">TEAM</span><h2>Technician workload</h2></div></div>
        {workload.summary.overloaded.length>0 && <div className="settings-warn"><AlertTriangle size={16}/>
          <div><strong>Uneven load.</strong><p>{workload.summary.overloaded.join(', ')} carrying more than twice the average.</p></div></div>}
        <div className="table-wrap"><table>
          <thead><tr><th>Technician</th><th>Open</th><th>In progress</th><th>Overdue</th><th>Hours</th></tr></thead>
          <tbody>{workload.technicians.map(t=>
            <tr key={t.name}>
              <td><strong>{t.name}</strong></td>
              <td><b>{t.open}</b></td><td>{t.inProgress}</td>
              <td className={t.overdue>0?'danger-text':''}>{t.overdue}</td>
              <td>{t.loggedHours.toFixed(1)}</td>
            </tr>)}
          </tbody></table></div>
      </section>}

      {/* ---- Cost ---- */}
      {cost && <section className="content-card">
        <div className="section-head"><div><span className="kicker">COST</span><h2>Maintenance spend</h2></div>
          <span className="legend">{money(cost.totals.cost)} total</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Asset</th><th>Orders</th><th>Labour</th><th>Parts</th><th>Total</th><th>Per failure</th></tr></thead>
          <tbody>{cost.machines.filter(m=>m.orders>0).map(m=>
            <tr key={m.machineId}>
              <td><strong>{m.name}</strong></td><td>{m.orders}</td>
              <td>{m.labourHours.toFixed(1)} h</td><td>{money(m.partsCost)}</td>
              <td><b>{money(m.totalCost)}</b></td>
              <td>{m.costPerFailure===null?<span className="cmp-flat">—</span>:money(m.costPerFailure)}</td>
            </tr>)}
          </tbody></table></div>
        {cost.totals.unloggedOrders>0 && <p className="settings-hint">
          {cost.totals.unloggedOrders} order(s) have no labour recorded, so these totals are a floor, not a full figure.</p>}
      </section>}
    </div>
  </section>;
}

function WorkOrderModal({ id, onClose, onChanged, canManage }: { id: string; onClose: () => void; onChanged: () => void; canManage: boolean }) {
  const [order, setOrder] = useState<WorkOrderDetail|null>(null);
  const [meta, setMeta] = useState<WorkOrderMeta|null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState('');
  const [cost, setCost] = useState({ labourHours:'', labourRate:'650', partsCost:'' });
  const [cause, setCause] = useState({ failureCode:'', whys:['','',''], notes:'' });

  const load = () => api.get(`/work-orders/${id}`).then(r=>{
    setOrder(r.data);
    setCost(c=>({ labourHours:String(r.data.labourHours ?? ''), labourRate:String(r.data.labourRate ?? 650), partsCost:String(r.data.partsCost ?? '') }));
    setCause(c=>({ failureCode:r.data.failureCode ?? '', whys:[...(r.data.rootCauseWhys ?? []), '', '', ''].slice(0,3), notes:r.data.rootCauseNotes ?? '' }));
  }).catch(()=>setError('Could not load the work order.'));

  useEffect(()=>{ load(); api.get('/work-orders/meta').then(r=>{setMeta(r.data);setTemplate(r.data.checklistTemplates[0]);}).catch(()=>{}); },[id]);
  useEffect(()=>{ const k=(e:KeyboardEvent)=>{ if(e.key==='Escape') onClose(); };
    window.addEventListener('keydown',k); return()=>window.removeEventListener('keydown',k); },[onClose]);

  async function call(fn: () => Promise<unknown>) {
    setError(''); setBusy(true);
    try { await fn(); await load(); onChanged(); }
    catch (err: any) { setError(err.response?.data?.message || 'That action failed.'); }
    finally { setBusy(false); }
  }

  if (!order) return null;
  const tasks = order.checklist ?? [];
  const doneCount = tasks.filter(t=>t.done).length;
  const total = (Number(cost.labourHours)||0)*(Number(cost.labourRate)||0) + (Number(cost.partsCost)||0);

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="wo-title" onClick={e=>e.stopPropagation()}>
      <div className="section-head">
        <div><span className="kicker">{order.id} · {order.machineName}</span><h2 id="wo-title">{order.title}</h2></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close dialog"><X size={17}/></button>
      </div>
      {error && <div className="api-banner" role="alert"><AlertTriangle size={16}/>{error}</div>}

      <div className="wo-status">
        {(['open','in-progress','completed'] as const).map(s=>
          <button key={s} className={order.status===s?'chip active':'chip'} disabled={!canManage||busy}
            onClick={()=>call(()=>api.patch(`/work-orders/${id}/status`,{status:s}))}>{s.replace('-',' ')}</button>)}
        <span className="wo-assignee">{order.assignedTo}</span>
      </div>

      <div className="wo-section">
        <h3>Checklist {tasks.length>0 && <small>{doneCount}/{tasks.length} complete</small>}</h3>
        {tasks.length===0
          ? <div className="wo-attach">
              <select value={template} disabled={!canManage} onChange={e=>setTemplate(e.target.value)} aria-label="Checklist template">
                {meta?.checklistTemplates.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              {canManage&&<button className="soft-btn" disabled={busy} onClick={()=>call(()=>api.post(`/work-orders/${id}/checklist`,{template}))}>Attach checklist</button>}
            </div>
          : <ul className="wo-checklist">{tasks.map(t=>
              <li key={t.id}>
                <label>
                  <input type="checkbox" checked={t.done} disabled={!canManage||busy}
                    onChange={e=>call(()=>api.patch(`/work-orders/${id}/checklist`,{taskId:t.id,done:e.target.checked}))}/>
                  <span className={t.done?'done':''}>{t.text}</span>
                </label>
              </li>)}
            </ul>}
      </div>

      <div className="wo-section">
        <h3>Cost</h3>
        <div className="wo-cost">
          <label>Labour hours<input type="number" step="0.25" min="0" value={cost.labourHours} readOnly={!canManage} onChange={e=>setCost({...cost,labourHours:e.target.value})}/></label>
          <label>Rate / hour<input type="number" step="10" min="0" value={cost.labourRate} readOnly={!canManage} onChange={e=>setCost({...cost,labourRate:e.target.value})}/></label>
          <label>Parts cost<input type="number" step="10" min="0" value={cost.partsCost} readOnly={!canManage} onChange={e=>setCost({...cost,partsCost:e.target.value})}/></label>
          <div className="wo-total"><span>Total</span><b>₹{total.toLocaleString()}</b></div>
        </div>
        {canManage&&<button className="soft-btn" disabled={busy} onClick={()=>call(()=>api.patch(`/work-orders/${id}/cost`,{labourHours:Number(cost.labourHours)||0,labourRate:Number(cost.labourRate)||0,partsCost:Number(cost.partsCost)||0}))}>Save cost</button>}
      </div>

      <div className="wo-section">
        <h3>Root cause</h3>
        <label>Failure code
        <select value={cause.failureCode} disabled={!canManage} onChange={e=>setCause({...cause,failureCode:e.target.value})}>
            <option value="">Select a cause…</option>
            {meta?.failureCodes.map(f=><option key={f.code} value={f.code}>{f.group} — {f.label}</option>)}
          </select></label>
        {cause.whys.map((w,i)=>
          <label key={i}>Why {i+1}?<input value={w} readOnly={!canManage} placeholder={i===0?'Why did it fail?':'And why was that?'}
            onChange={e=>{const next=[...cause.whys];next[i]=e.target.value;setCause({...cause,whys:next});}}/></label>)}
        <label>Notes<input value={cause.notes} readOnly={!canManage} onChange={e=>setCause({...cause,notes:e.target.value})} placeholder="Action to prevent recurrence"/></label>
        {canManage&&<button className="soft-btn" disabled={busy||!cause.failureCode}
          onClick={()=>call(()=>api.patch(`/work-orders/${id}/cause`,{failureCode:cause.failureCode,whys:cause.whys,notes:cause.notes}))}>Save cause</button>
        }
        <p className="settings-hint">A failure code is required before an order can be completed — free text cannot be
          counted, and counted causes are what turn maintenance history into training data.</p>
      </div>
    </div>
  </div>;
}

const SIGNALS = [
  { key:'temperature', label:'Temperature', unit:'°C', colour:'#1b6fc4' },
  { key:'vibration',   label:'Vibration',   unit:'mm/s', colour:'#8a63d2' },
  { key:'pressure',    label:'Pressure',    unit:'bar', colour:'#17a06f' },
  { key:'power',       label:'Power',       unit:'kW',  colour:'#e39a2b' }
] as const;

function PerformanceView({ machines }: { machines: Machine[] }) {
  const [energy, setEnergy] = useState<EnergyReport|null>(null);
  const [signals, setSignals] = useState<SignalReport|null>(null);
  const [comparison, setComparison] = useState<Comparison|null>(null);
  const [assetId, setAssetId] = useState('');
  const [days, setDays] = useState(1);
  const [active, setActive] = useState<string[]>(['temperature','vibration']);

  const selected = assetId || machines[0]?.id || '';

  useEffect(()=>{ const go=()=>{ api.get('/analytics/energy').then(r=>setEnergy(r.data)).catch(()=>{}); };
    go(); const id=setInterval(go,5000); return()=>clearInterval(id); },[]);
  useEffect(()=>{ if(!selected) return;
    const go=()=>api.get(`/analytics/signals/${selected}`).then(r=>setSignals(r.data)).catch(()=>{});
    go(); const id=setInterval(go,5000); return()=>clearInterval(id); },[selected]);
  useEffect(()=>{ api.get(`/analytics/comparison?days=${days}`).then(r=>setComparison(r.data)).catch(()=>{}); },[days]);

  const money = (v: number) => `${energy?.currency==='INR'?'₹':''}${v.toFixed(2)}`;
  const toggle = (k: string) => setActive(a => a.includes(k) ? a.filter(x=>x!==k) : [...a,k]);
  const arrow = (v: number|null, goodDown = true) => {
    if (v === null) return <span className="cmp-flat">— no data</span>;
    if (Math.abs(v) < 1) return <span className="cmp-flat">▬ {v.toFixed(1)}%</span>;
    const bad = goodDown ? v > 0 : v < 0;
    return <span className={bad?'cmp-up':'cmp-down'}>{v>0?'▲':'▼'} {Math.abs(v).toFixed(1)}%</span>;
  };

  return <section>
    <div className="page-title"><div><span className="kicker">PERFORMANCE</span><h1>Energy and signal analytics</h1>
      <p>Derived from power, vibration, pressure and speed already recorded on every reading.</p></div></div>

    {/* ---- Energy ---- */}
    {energy && <>
      <div className="metrics">
        <MetricCard icon={Zap} label="Energy used" value={`${energy.totals.kwh.toFixed(2)} kWh`} sub="Across all assets" tone="orange"/>
        <MetricCard icon={Gauge} label="Energy cost" value={money(energy.totals.cost)} sub={`At ${money(energy.tariff)}/kWh`} tone="mint"/>
        <MetricCard icon={Activity} label="Projected daily" value={`${energy.totals.projectedDailyKwh.toFixed(0)} kWh`} sub="At the current rate" tone="blue"/>
        <MetricCard icon={Thermometer} label="Assets drawing high" value={energy.machines.filter(m=>(m.deviationPct??0)>10).length} sub="Over 10% above baseline" tone="purple"/>
      </div>

      <section className="content-card">
        <div className="section-head"><div><span className="kicker">ENERGY BY ASSET</span><h2>Consumption and deviation</h2></div></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Asset</th><th>Energy</th><th>Cost</th><th>Mean kW</th><th>Baseline</th><th>Deviation</th><th>kWh / unit</th><th>Load factor</th></tr></thead>
          <tbody>{energy.machines.map(m=>
            <tr key={m.machineId}>
              <td><div className="asset-cell"><div><strong>{m.name}</strong><small>{m.location}</small></div></div></td>
              <td>{m.kwh.toFixed(2)} kWh</td>
              <td>{money(m.cost)}</td>
              <td>{m.meanKw.toFixed(1)}</td>
              <td>{m.baselineKw===null?<span className="cmp-flat">learning…</span>:`${m.baselineKw.toFixed(1)} kW`}</td>
              <td>{m.deviationPct===null?<span className="cmp-flat">—</span>:arrow(m.deviationPct)}</td>
              <td>{m.specificEnergy===null?<span className="cmp-flat">—</span>:m.specificEnergy.toFixed(3)}</td>
              <td>{(m.loadFactor*100).toFixed(0)}%</td>
            </tr>)}
          </tbody></table></div>
        <p className="settings-hint">Baseline is each asset's own mean power over its first minutes of operation.
          A motor drawing steadily more for the same work is an early fault signal, which is why deviation is
          measured per asset rather than against a generic figure.</p>
      </section>
    </>}

    {/* ---- Multi-signal trends ---- */}
    <section className="content-card chart-card">
      <div className="section-head">
        <div><span className="kicker">ALL SIGNALS</span><h2>Multi-signal trend</h2></div>
        <select className="chart-select" value={selected} onChange={e=>setAssetId(e.target.value)} aria-label="Choose asset">
          {machines.map(m=><option key={m.id} value={m.id}>{m.name} — {m.location}</option>)}
        </select>
      </div>
      <div className="signal-toggles">
        {SIGNALS.map(s=>
          <button key={s.key} className={active.includes(s.key)?'chip active':'chip'}
            aria-pressed={active.includes(s.key)} onClick={()=>toggle(s.key)}>
            <i style={{background:s.colour}}/>{s.label} <small>{s.unit}</small>
          </button>)}
      </div>
      <div className="main-chart"><ResponsiveContainer width="100%" height={280}>
        <LineChart data={signals?.series ?? []}>
          <CartesianGrid stroke="#e8edf4" vertical={false}/>
          <XAxis dataKey="timestamp" tickFormatter={v=>new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} stroke="#8b97aa" fontSize={11}/>
          {/* Signals have very different magnitudes, so each gets its own hidden axis rather
              than being squashed onto one scale where vibration would be invisible. */}
          {SIGNALS.filter(s=>active.includes(s.key)).map(s=>
            <YAxis key={s.key} yAxisId={s.key} hide domain={['auto','auto']}/>)}
          <Tooltip labelFormatter={(l)=>new Date(l as string).toLocaleTimeString()}/>
          {SIGNALS.filter(s=>active.includes(s.key)).map(s=>
            <Line key={s.key} yAxisId={s.key} type="monotone" dataKey={s.key} name={`${s.label} (${s.unit})`}
                  stroke={s.colour} strokeWidth={2} dot={false} isAnimationActive={false}/>)}
        </LineChart></ResponsiveContainer></div>
      <p className="settings-hint">Each signal keeps its own scale — vibration in mm/s and power in kW cannot
        share one axis without one of them becoming a flat line.</p>
    </section>

    {/* ---- Period comparison ---- */}
    <section className="content-card">
      <div className="section-head">
        <div><span className="kicker">TREND OVER TREND</span><h2>Period comparison</h2></div>
        <select className="chart-select" value={days} onChange={e=>setDays(Number(e.target.value))} aria-label="Comparison period">
          <option value={1}>Last 24 h vs previous 24 h</option>
          <option value={3}>Last 3 days vs previous 3</option>
          <option value={7}>Last 7 days vs previous 7</option>
        </select>
      </div>
      {comparison?.available === false
        ? <div className="settings-warn"><AlertTriangle size={17}/><div><strong>Comparison unavailable.</strong><p>{comparison.reason}</p></div></div>
        : <div className="table-wrap"><table>
            <thead><tr><th>Asset</th><th>Temperature</th><th>Vibration</th><th>Power</th><th>Risk</th><th>Samples</th></tr></thead>
            <tbody>{comparison?.machines?.map(m=>
              <tr key={m.machineId}>
                <td><strong>{m.name}</strong></td>
                <td>{arrow(m.change.temperature)}</td>
                <td>{arrow(m.change.vibration)}</td>
                <td>{arrow(m.change.power)}</td>
                <td>{arrow(m.change.riskScore)}</td>
                <td>{m.current?.samples ?? 0} / {m.previous?.samples ?? 0}</td>
              </tr>)}
            </tbody></table></div>}
      <p className="settings-hint">A period with no stored readings shows “no data” rather than 0%, because
        an absent measurement is not the same as an unchanged one.</p>
    </section>
  </section>;
}

/** World-class OEE is ~85%; these bands are the usual industry reading of the number. */
function oeeBand(v: number) {
  if (v >= 0.85) return { label: 'World class', tone: 'ok' };
  if (v >= 0.60) return { label: 'Typical', tone: 'warn' };
  if (v >= 0.40) return { label: 'Low', tone: 'warn' };
  return { label: 'Critical', tone: 'bad' };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const hrs = (v: number | null) => v === null ? '—' : v >= 1 ? `${v.toFixed(1)} h` : `${Math.round(v * 60)} min`;

function ReliabilityView() {
  const [data, setData] = useState<Reliability|null>(null);
  const [error, setError] = useState('');

  async function load() {
    try { const r = await api.get('/reliability'); setData(r.data); setError(''); }
    catch { setError('Could not load reliability metrics.'); }
  }
  useEffect(()=>{ load(); const id=setInterval(load,5000); return()=>clearInterval(id); },[]);

  if (error) return <div className="api-banner"><AlertTriangle size={17}/>{error}</div>;
  if (!data) return <div className="replay-idle"><Gauge size={32}/><p>Measuring…</p></div>;

  const p = data.plant;
  const band = oeeBand(p.oee);

  return <section>
    <div className="page-title"><div><span className="kicker">RELIABILITY</span><h1>OEE and equipment reliability</h1>
      <p>Measured over {p.observedHours < 1 ? `${Math.round(p.observedHours*60)} minutes` : `${p.observedHours.toFixed(1)} hours`} since {new Date(p.since).toLocaleTimeString()}.</p></div></div>

    <div className="oee-hero content-card">
      <div className="oee-score">
        <span className="kicker">PLANT OEE</span>
        <strong>{pct(p.oee)}</strong>
        <span className={`oee-band ${band.tone}`}>{band.label}</span>
      </div>
      <div className="oee-breakdown">
        {([['Availability',p.availability],['Performance',p.performance],['Quality',p.quality]] as const).map(([label,v])=>
          <div className="oee-factor" key={label}>
            <span>{label}</span>
            <b>{pct(v)}</b>
            <i><span style={{width:`${Math.min(100,v*100)}%`}}/></i>
          </div>)}
        <p className="oee-formula">OEE = Availability × Performance × Quality</p>
      </div>
    </div>

    <div className="metrics">
      <MetricCard icon={Activity} label="MTBF" value={hrs(p.mtbfHours)} sub="Mean time between failures" tone="mint"/>
      <MetricCard icon={Wrench} label="MTTR" value={hrs(p.mttrHours)} sub="Mean time to repair" tone="blue"/>
      <MetricCard icon={AlertTriangle} label="Failures" value={p.failures} sub="Recorded in this window" tone="orange"/>
      <MetricCard icon={Boxes} label="Good units" value={p.goodUnits.toLocaleString()} sub={`${p.rejectUnits.toLocaleString()} rejected`} tone="purple"/>
    </div>

    <section className="content-card">
      <div className="section-head"><div><span className="kicker">BY ASSET</span><h2>Per-machine reliability</h2></div></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Asset</th><th>Status</th><th>OEE</th><th>Avail.</th><th>Perf.</th><th>Quality</th><th>MTBF</th><th>MTTR</th><th>Failures</th></tr></thead>
        <tbody>{data.machines.map(m=>
          <tr key={m.machineId}>
            <td><div className="asset-cell"><div><strong>{m.name}</strong><small>{m.location}</small></div></div></td>
            <td><StatusBadge status={m.status}/></td>
            <td><b className={oeeBand(m.oee).tone==='ok'?'safe-text':oeeBand(m.oee).tone==='bad'?'danger-text':''}>{pct(m.oee)}</b></td>
            <td>{pct(m.availability)}</td><td>{pct(m.performance)}</td><td>{pct(m.quality)}</td>
            <td>{hrs(m.mtbfHours)}</td><td>{hrs(m.mttrHours)}</td><td>{m.failures}</td>
          </tr>)}
        </tbody></table></div>
    </section>

    <div className="settings-warn"><AlertTriangle size={17}/>
      <div><strong>How these numbers are produced.</strong>
        <p>Availability, MTBF and MTTR are measured from recorded downtime events. Performance and
        Quality use production and reject counts from the simulator, because no sensor in this
        project reports them — the arithmetic is the standard OEE calculation, the inputs are synthetic.</p></div></div>
  </section>;
}

function NotificationBell({ alerts, onOpenAlerts, onAcknowledge, canAcknowledge }:
    { alerts: Alert[]; onOpenAlerts: () => void; onAcknowledge: (id: string) => void; canAcknowledge: boolean }) {
  const [open, setOpen] = useState(false);
  const unread = alerts.filter(a => !a.acknowledged);

  // Clicking anywhere else closes the panel, which is what people expect from a bell menu.
  useEffect(()=>{
    if(!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  },[open]);

  const ago = (iso: string) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime())/60000));
    return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins/60)} h ago`;
  };

  return <div className="bell-wrap" onClick={e=>e.stopPropagation()}>
    <button className="icon-btn" onClick={()=>setOpen(o=>!o)} title={`${unread.length} unacknowledged alert${unread.length===1?'':'s'}`}>
      <Bell size={18}/>{unread.length>0 && <b/>}
    </button>
    {open && <div className="bell-panel">
      <div className="bell-head"><strong>Notifications</strong>
        <span>{unread.length} unacknowledged</span></div>
      {unread.length===0
        ? <div className="bell-empty"><CheckCircle2 size={22}/><p>Nothing needs attention.</p></div>
        : <div className="bell-list">{unread.slice(0,6).map(a=>
            <div className={`bell-item severity-${a.severity}`} key={a.id}>
              <span className="bell-dot"/>
              <div>
                <strong>{a.title}</strong>
                <small>{a.machineName} · {ago(a.createdAt)}</small>
                <p>{a.message}</p>
              </div>
              {canAcknowledge&&<button className="soft-btn" onClick={()=>onAcknowledge(a.id)} title="Acknowledge">
                <CheckCircle2 size={14}/>
              </button>}
            </div>)}
          </div>}
      <button className="bell-foot" onClick={()=>{setOpen(false);onOpenAlerts();}}>
        View all alerts <ChevronRight size={14}/>
      </button>
    </div>}
  </div>;
}

function TemperatureCard({ machines }: { machines: Machine[] }) {
  const [selectedId, setSelectedId] = useState<string>('');
  // Default to the first asset, but keep the user's choice once they pick one.
  const machine = machines.find(m => m.id === selectedId) ?? machines[0];
  const current = machine?.reading.temperature;
  const history = machine?.history ?? [];
  // Compare against the start of the visible window so the arrow reflects the trend on screen.
  const delta = history.length > 1 ? current! - history[0].temperature : 0;

  return <section className="content-card chart-card">
    <div className="section-head">
      <div><span className="kicker">LIVE TELEMETRY</span><h2>Temperature trend</h2></div>
      <select className="chart-select" value={machine?.id ?? ''} onChange={e=>setSelectedId(e.target.value)}>
        {machines.map(m=><option key={m.id} value={m.id}>{m.name} — {m.location}</option>)}
      </select>
    </div>

    {machine && <div className="temp-readout">
      <div className="temp-now">
        <Thermometer size={20}/>
        <strong>{current!.toFixed(1)}<span>°C</span></strong>
      </div>
      <div className="temp-meta">
        <span className="temp-where">{machine.location}</span>
        <span className={`temp-delta ${delta>0.2?'up':delta<-0.2?'down':''}`}>
          {delta>0.2?'▲':delta<-0.2?'▼':'▬'} {Math.abs(delta).toFixed(1)}°C this window
        </span>
      </div>
      <StatusBadge status={machine.status}/>
    </div>}

    <div className="main-chart"><ResponsiveContainer width="100%" height={236}>
      <AreaChart data={history}>
        <defs><linearGradient id="temp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4aa8f0" stopOpacity={.35}/>
          <stop offset="100%" stopColor="#4aa8f0" stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid stroke="#e8edf4" vertical={false}/>
        <XAxis dataKey="timestamp" tickFormatter={v=>new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} stroke="#8b97aa" fontSize={11}/>
        <YAxis stroke="#8b97aa" fontSize={11} unit="°C" width={52}/>
        <Tooltip formatter={(value)=>[`${Number(value).toFixed(1)} °C`,'Temperature'] as [string,string]}
                 labelFormatter={(label)=>new Date(label as string).toLocaleTimeString()}/>
        <Area type="monotone" dataKey="temperature" stroke="#1b6fc4" fill="url(#temp)" strokeWidth={2.5}/>
      </AreaChart></ResponsiveContainer></div>
  </section>;
}

function AppFooter() {
  return <footer className="app-footer">
    <div className="footer-main">
      <div className="footer-brand">
        <span className="brand-mark small"><Activity size={15}/></span>
        <div>
          <strong>MachineGuard</strong>
          <small>Predictive maintenance for industrial plant</small>
        </div>
      </div>
      <dl className="footer-specs">
        <div><dt>Version</dt><dd>1.0.0</dd></div>
        <div><dt>Model</dt><dd>bearing-rf-v1</dd></div>
        <div><dt>Dataset</dt><dd>CWRU 12k drive-end</dd></div>
        <div><dt>Support</dt><dd>support@machineguard.io</dd></div>
      </dl>
    </div>
    <div className="footer-legal">
      <span>© 2026 MachineGuard Inc. Developed by Chaitanya Mali. All rights reserved.</span>
    </div>
  </footer>;
}

function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(localStorage.getItem('maintai_token')));
  const [page, setPage] = useState<Page>('overview');
  const [data, setData] = useState<DashboardData>(fallback);
  const [selected, setSelected] = useState<Machine|null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [account, setAccount] = useState<Account|null>(null);
  const [settings, setSettings] = useState<SystemSettings|null>(null);
  const [registering, setRegistering] = useState(false);
  const [openOrder, setOpenOrder] = useState<string|null>(null);

  async function load() { try { const res=await api.get('/dashboard'); setData(res.data); setError(''); } catch (e:any) { if(e.response?.status===401){localStorage.clear();setAuthenticated(false);} else setError('Live API unavailable — start the backend on port 5000.'); } }
  // Kept in App rather than only in Settings so the sidebar, header and greeting all show the
  // signed-in user, and update immediately when the profile is edited.
  async function loadAccount() { try { const res=await api.get('/account'); setAccount(res.data); } catch { /* header falls back to placeholders */ } }
  // The facility name lives in plant settings, so the sidebar reads it from there.
  async function loadSettings() { try { const res=await api.get('/settings'); setSettings(res.data.settings); } catch { /* sidebar falls back */ } }
  useEffect(()=>{ if(!authenticated)return; load(); loadAccount(); loadSettings(); const id=setInterval(load,5000); return()=>clearInterval(id); },[authenticated]);
  // Tables show every asset; narrowing now happens through the global search instead.
  const filtered = data.machines;
  const canWrite = ['admin','manager','technician'].includes(account?.role ?? '');
  const canManageAssets = ['admin','manager'].includes(account?.role ?? '');
  if(!authenticated) return <Login onLogin={()=>setAuthenticated(true)}/>;

  function logout(){localStorage.clear();setAuthenticated(false);}
  // Acknowledging from the bell refreshes the dashboard so the badge and list stay in step.
  async function acknowledge(id: string){ try{ await api.patch(`/alerts/${id}/acknowledge`); await load(); }catch{ setError('Could not acknowledge that alert.'); } }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside className={`sidebar ${sidebar?'sidebar-open':''}`}><div className="brand"><span className="brand-mark"><Activity size={21}/></span> MachineGuard</div><div className="facility"><span>FACILITY</span><strong>{settings?.facilityName ?? 'Loading…'}</strong><small><i/> Connected</small></div><nav>{nav.map(item=><button className={page===item.id?'active':''} key={item.id} onClick={()=>{setPage(item.id);setSidebar(false)}}><item.icon size={18}/>{item.label}{item.id==='alerts'&&data.metrics.activeAlerts>0?<b>{data.metrics.activeAlerts}</b>:null}</button>)}</nav><div className="sidebar-foot"><button className="profile-chip" onClick={()=>{setPage('account');setSidebar(false)}} title="Open your account settings"><span className="user-avatar">{initials(account?.name)}</span><span><strong>{account?.name ?? 'Loading…'}</strong><small>{roleLabel(account?.role) || 'Account'}</small></span></button><button className="signout-btn" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17}/></button></div></aside>
    <main><header><button className="menu-btn" onClick={()=>setSidebar(!sidebar)} aria-label="Toggle navigation"><Menu/></button><GlobalSearch data={data} onSelectMachine={setSelected} onNavigate={setPage}/><div className="header-actions"><span className="live"><i aria-hidden="true"/> LIVE</span><NotificationBell alerts={data.alerts} onOpenAlerts={()=>setPage('alerts')} onAcknowledge={acknowledge} canAcknowledge={canWrite}/><button className="avatar avatar-btn" onClick={()=>setPage('account')} title={account?`${account.name} — open account settings`:'Account settings'}>{initials(account?.name)}</button></div></header>
      <div className="page-content" id="main-content">{error&&<div className="api-banner" role="alert"><AlertTriangle size={17}/>{error}</div>}<p className="sr-only" aria-live="polite">{data.metrics.activeAlerts} active alert{data.metrics.activeAlerts===1?"":"s"} across {data.metrics.totalMachines} assets</p>
      {page==='overview'&&<><div className="page-title"><div><span className="kicker">PLANT OVERVIEW</span><h1>{greeting()}{account?`, ${account.name.split(' ')[0]}`:''}</h1><p>Here is what is happening across your operation.</p></div><div className="updated"><i/>Updated {new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div></div>
        <div className="metrics"><MetricCard icon={Factory} label="Total assets" value={data.metrics.totalMachines} sub={`${data.metrics.operational} operating normally`} tone="mint"/><MetricCard icon={Activity} label="Average health" value={`${data.metrics.averageHealth}%`} sub="Across monitored equipment" tone="blue"/><MetricCard icon={AlertTriangle} label="Active alerts" value={data.metrics.activeAlerts} sub="Requires attention" tone="orange"/><MetricCard icon={ShieldCheck} label="Avoided downtime" value={`${data.metrics.avoidedDowntimeHours}h`} sub="Estimated this month" tone="purple"/></div>
        <div className="guardrail"><ShieldCheck size={16}/><div><strong>Decision support only</strong><p>All recommendations require verification by a qualified technician.</p></div></div>
        <div className="dashboard-grid"><TemperatureCard machines={data.machines}/><section className="content-card risk-panel"><div className="section-head"><div><span className="kicker">AI RISK WATCH</span><h2>Priority assets</h2></div><Sparkles size={18}/></div>{[...data.machines].sort((a,b)=>b.reading.riskScore-a.reading.riskScore).slice(0,3).map(m=><button className="risk-machine" key={m.id} onClick={()=>setSelected(m)}><span className={`risk-ring ${m.reading.riskScore>65?'high':''}`}>{m.reading.riskScore}</span><div><strong>{m.name}</strong><small>{m.reading.riskScore>65?'Inspection recommended':'Within normal range'}</small></div><ChevronRight size={16}/></button>)}<div className="ai-summary"><Bot/><p><strong>AI summary</strong> Compressor C-12 shows a rising vibration pattern. Check bearing lubrication within 8 hours.</p></div></section></div>
        <FloorMap machines={data.machines} onSelect={setSelected}/><section className="content-card"><div className="section-head"><div><span className="kicker">ASSET FLEET</span><h2>Machine health</h2></div><button className="text-btn" onClick={()=>setPage('machines')}>View all <ChevronRight size={15}/></button></div><MachineTable machines={filtered.slice(0,5)} onSelect={setSelected}/></section></>}
      {page==='machines'&&<section className="content-card"><div className="section-head"><div><span className="kicker">ASSET MANAGEMENT</span><h2>All machines</h2></div>{canManageAssets&&<button className="primary-small" onClick={()=>setRegistering(true)}><Plus size={16}/> Register asset</button>}</div><MachineTable machines={filtered} onSelect={setSelected}/></section>}
      {page==='alerts'&&<AlertsView alerts={data.alerts} refresh={load} canAcknowledge={canWrite}/>} {page==='work-orders'&&<WorkOrdersView orders={data.workOrders} refresh={load} onOpen={setOpenOrder} canManage={canWrite}/>} {page==='replay'&&<ReplayView/>} {page==='reliability'&&<ReliabilityView/>} {page==='performance'&&<PerformanceView machines={data.machines}/>} {page==='operations'&&<OperationsView/>} {page==='assistant'&&<AssistantView machines={data.machines}/>} {page==='settings'&&<SystemSettingsView isAdmin={account?.role==='admin'} onSaved={loadSettings}/>}
      {page==='account'&&<AccountSettingsView onSignOut={logout} onProfileChange={loadAccount}/>}
      </div>{page==='overview'&&<AppFooter/>}</main><MachineDrawer machine={selected} alerts={data.alerts} orders={data.workOrders} close={()=>setSelected(null)} onCreated={load} onOpenOrder={setOpenOrder} canManage={canWrite}/>{registering&&<RegisterAssetModal onClose={()=>setRegistering(false)} onCreated={load}/>}{openOrder&&<WorkOrderModal id={openOrder} onClose={()=>setOpenOrder(null)} onChanged={load} canManage={canWrite}/>}</div>;
}

export default App;
