import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { z } from 'zod';
import { allow, requireAuth, sign } from './auth.js';
import { authenticate, changePassword, changeProfile, DEMO_EMAIL, DEMO_PASSWORD, getAccount, isDemoLoginEnabled, usingDefaultCredentials } from './accounts.js';
import { acknowledgeAlert, createWorkOrder, getMachine, getMachines, getAlerts, getWorkOrders, saveMachine } from './repository.js';
import { MACHINE_TYPES, addMachine, machineExists } from './store.js';
import { getComparison, getEnergy, getSignals } from './analytics.js';
import { getCostReport, getHandover, getSlaReport, getWorkload } from './operations.js';
import { CHECKLIST_TEMPLATES, FAILURE_CODES, attachChecklist, getOrder, recordCause, recordCost, toggleTask, transition } from './workorders.js';
import { getReliability, resetReliability } from './reliability.js';
import { DEFAULTS, LIMITS, getSettings, updateSettings } from './settings.js';
import type { AuthedRequest } from './types.js';

export const app=express();
const defaultAllowedOrigins=[
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
];
const allowedOrigins=(process.env.CLIENT_URL||defaultAllowedOrigins.join(',')).split(',').map(o=>o.trim()).filter(Boolean);
const isAllowedOrigin=(origin:string)=>allowedOrigins.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
app.disable('x-powered-by');
app.use(helmet({crossOriginResourcePolicy:false}));
app.use(cors({
  origin:(origin,callback)=>{
    if(!origin || isAllowedOrigin(origin)) return callback(null,true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials:true,
  methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders:['Content-Type','Authorization']
}));
app.use(express.json({limit:'250kb'}));
app.use(morgan(process.env.NODE_ENV==='test'?'tiny':'combined'));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:true,legacyHeaders:false}));

const loginSchema=z.object({email:z.string().email(),password:z.string().min(8).max(72)});
app.post('/api/auth/login',async(req,res,next)=>{const parsed=loginSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Enter a valid email and password'});try{const user=await authenticate(parsed.data.email,parsed.data.password);if(!user)return res.status(401).json({message:'Incorrect email or password'});res.json({token:sign(user),user});}catch(err){next(err);}});
app.get('/api/health',(_req,res)=>res.json({status:'ok',service:'machineguard-api',timestamp:new Date().toISOString()}));
// Local-only status for the starter admin; never returns the private admin credentials.
app.get('/api/auth/default-credentials',async(_req,res,next)=>{try{res.json({usingDefaults:process.env.NODE_ENV!=='production'&&await usingDefaultCredentials()});}catch(err){next(err);}});
app.get('/api/auth/demo-credentials',(_req,res)=>{if(!isDemoLoginEnabled())return res.json({enabled:false});res.json({enabled:true,email:DEMO_EMAIL,password:DEMO_PASSWORD});});

app.use('/api',requireAuth);

app.get('/api/account',async(req:AuthedRequest,res,next)=>{try{const a=await getAccount(req.user!.id);return a?res.json(a):res.status(404).json({message:'Account not found'});}catch(err){next(err);}});

// Plant-wide configuration. Readable by anyone signed in (the dashboard needs the facility
// name and thresholds); only an administrator may change it.
app.get('/api/settings',(_req,res)=>res.json({settings:getSettings(),limits:LIMITS,defaults:DEFAULTS}));
const settingsSchema=z.object({
  facilityName:z.string().min(2).max(60),
  sensorIntervalMs:z.number().int(),
  persistIntervalMs:z.number().int(),
  warningRisk:z.number().int(),
  criticalRisk:z.number().int(),
  readingRetentionDays:z.number().int()
}).partial();
app.patch('/api/settings',allow('admin'),async(req,res,next)=>{const parsed=settingsSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid settings payload'});try{const r=await updateSettings(parsed.data);if(!r.ok)return res.status(400).json({message:r.error.message,field:r.error.field});res.json({settings:r.settings});}catch(err){next(err);}});

// A new password must differ from the current one and is capped at 72 bytes, which is the
// most bcrypt actually hashes; anything beyond that is silently ignored by the algorithm.
const passwordSchema=z.object({currentPassword:z.string().min(1).max(72),newPassword:z.string().min(8,'Use at least 8 characters').max(72)}).refine(d=>d.currentPassword!==d.newPassword,{message:'The new password must be different',path:['newPassword']});
app.patch('/api/account/password',async(req:AuthedRequest,res,next)=>{const parsed=passwordSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0]?.message||'Invalid password'});try{const r=await changePassword(req.user!.id,parsed.data.currentPassword,parsed.data.newPassword);if(!r.ok){const status=r.reason==='wrong-password'?401:r.reason==='demo-account'?403:404;return res.status(status).json({message:r.reason==='wrong-password'?'Current password is incorrect':r.reason==='demo-account'?'The shared evaluator account cannot change its password':'Account not found'});}
// No fresh token is issued: the client signs out so the password change takes effect everywhere.
res.json({message:'Password updated. Please sign in again.'});}catch(err){next(err);}});

const profileSchema=z.object({currentPassword:z.string().min(1).max(72),email:z.string().email(),name:z.string().min(2).max(80)});
app.patch('/api/account/profile',async(req:AuthedRequest,res,next)=>{const parsed=profileSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Enter a valid name and email'});try{const r=await changeProfile(req.user!.id,parsed.data.currentPassword,parsed.data.email,parsed.data.name);if(!r.ok){const status=r.reason==='wrong-password'?401:r.reason==='email-taken'?409:r.reason==='demo-account'?403:404;return res.status(status).json({message:r.reason==='wrong-password'?'Current password is incorrect':r.reason==='email-taken'?'That email is already in use':r.reason==='demo-account'?'The shared evaluator account cannot change its profile':'Account not found'});}
// The token embeds the old email, so re-issue it to keep the session consistent.
res.json({message:'Profile updated',user:r.user,token:sign(r.user)});}catch(err){next(err);}});
app.get('/api/dashboard',async(_req,res,next)=>{try{const [machines,alerts,workOrders]=await Promise.all([getMachines(),getAlerts(),getWorkOrders()]);const activeAlerts=alerts.filter(a=>!a.acknowledged).length;res.json({machines,alerts,workOrders,metrics:{totalMachines:machines.length,operational:machines.filter(m=>m.status==='healthy').length,activeAlerts,averageHealth:Math.round(machines.reduce((s,m)=>s+m.health,0)/machines.length),avoidedDowntimeHours:37}});}catch(err){next(err);}});
app.get('/api/machines',async(_req,res,next)=>{try{res.json(await getMachines());}catch(err){next(err);}});
// Asset registration. IDs follow the AAA-123 convention used by the seeded fleet.
const assetSchema=z.object({
  id:z.string().trim().min(3).max(20).regex(/^[A-Za-z]{2,4}-\d{1,5}$/,'Use a code like PMP-090'),
  name:z.string().trim().min(3).max(60),
  type:z.enum(MACHINE_TYPES as [string,...string[]]),
  location:z.string().trim().min(2).max(40)
});
app.get('/api/machine-types',(_req,res)=>res.json({types:MACHINE_TYPES}));
app.post('/api/machines',allow('admin','manager'),async(req,res,next)=>{
  const parsed=assetSchema.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({message:parsed.error.issues[0]?.message||'Invalid asset'});
  if(machineExists(parsed.data.id))return res.status(409).json({message:'An asset with that code already exists'});
  try{const m=addMachine(parsed.data);await saveMachine(m);res.status(201).json(m);}catch(err){next(err);}
});

// OEE, MTBF and MTTR over the current observation window.
app.get('/api/reliability',(_req,res)=>res.json(getReliability()));

// Energy cost is reported per unit produced, so the unit counts come from the same window
// the reliability metrics are measured over.
app.get('/api/analytics/energy',(_req,res)=>{
  const units=Object.fromEntries(getReliability().machines.map(m=>[m.machineId,m.goodUnits]));
  res.json(getEnergy(units));
});
app.get('/api/analytics/signals/:machineId',(req,res)=>{const s=getSignals(req.params.machineId);return s?res.json(s):res.status(404).json({message:'Machine not found'});});

// ---- Operational reporting ----
app.get('/api/ops/sla',async(_req,res,next)=>{try{res.json(await getSlaReport());}catch(err){next(err);}});
app.get('/api/ops/workload',async(_req,res,next)=>{try{res.json(await getWorkload());}catch(err){next(err);}});
app.get('/api/ops/cost',async(_req,res,next)=>{try{res.json(await getCostReport());}catch(err){next(err);}});
app.get('/api/ops/handover',async(req,res,next)=>{const hours=Math.min(24,Math.max(1,Number(req.query.hours)||8));try{res.json(await getHandover(hours));}catch(err){next(err);}});

// ---- Work order detail: checklist, cost, root cause, lifecycle ----
app.get('/api/work-orders/meta',(_req,res)=>res.json({failureCodes:FAILURE_CODES,checklistTemplates:Object.keys(CHECKLIST_TEMPLATES)}));
app.get('/api/work-orders/:id',async(req,res,next)=>{try{const o=await getOrder(String(req.params.id));return o?res.json(o):res.status(404).json({message:'Work order not found'});}catch(err){next(err);}});

const send=(res:express.Response,r:{ok:true;order:unknown}|{ok:false;reason:string})=>r.ok?res.json(r.order):res.status(400).json({message:r.reason});
const crew=allow('admin','manager','technician');

app.patch('/api/work-orders/:id/status',crew,async(req,res,next)=>{const p=z.object({status:z.enum(['open','in-progress','completed'])}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid status'});try{send(res,await transition(String(req.params.id),p.data.status));}catch(err){next(err);}});
app.patch('/api/work-orders/:id/checklist',crew,async(req,res,next)=>{const p=z.object({taskId:z.string(),done:z.boolean()}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid task'});try{send(res,await toggleTask(String(req.params.id),p.data.taskId,p.data.done));}catch(err){next(err);}});
app.post('/api/work-orders/:id/checklist',crew,async(req,res,next)=>{const p=z.object({template:z.string()}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid template'});try{send(res,await attachChecklist(String(req.params.id),p.data.template));}catch(err){next(err);}});
app.patch('/api/work-orders/:id/cost',crew,async(req,res,next)=>{const p=z.object({labourHours:z.number().min(0).max(999),labourRate:z.number().min(0).max(100000),partsCost:z.number().min(0).max(10_000_000)}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Hours, rate and parts cost must be positive numbers'});try{send(res,await recordCost(String(req.params.id),p.data.labourHours,p.data.labourRate,p.data.partsCost));}catch(err){next(err);}});
app.patch('/api/work-orders/:id/cause',crew,async(req,res,next)=>{const p=z.object({failureCode:z.string(),whys:z.array(z.string().max(300)).max(5),notes:z.string().max(1000)}).safeParse(req.body);if(!p.success)return res.status(400).json({message:'Invalid root cause'});try{send(res,await recordCause(String(req.params.id),p.data.failureCode,p.data.whys,p.data.notes));}catch(err){next(err);}});
app.get('/api/analytics/comparison',async(req,res,next)=>{const days=Math.min(7,Math.max(1,Number(req.query.days)||1));try{res.json(await getComparison(days));}catch(err){next(err);}});
app.post('/api/reliability/reset',allow('admin','manager'),(_req,res)=>{resetReliability();res.json({message:'Measurement window restarted'});});
app.get('/api/machines/:id',async(req,res,next)=>{try{const m=await getMachine(String(req.params.id));return m?res.json(m):res.status(404).json({message:'Machine not found'});}catch(err){next(err);}});
app.patch('/api/alerts/:id/acknowledge',allow('admin','manager','technician'),async(req,res,next)=>{try{const a=await acknowledgeAlert(String(req.params.id));return a?res.json(a):res.status(404).json({message:'Alert not found'});}catch(err){next(err);}});
const orderSchema=z.object({machineId:z.string().min(2).max(30),title:z.string().min(4).max(160),priority:z.enum(['low','medium','high']),assignedTo:z.string().min(2).max(80)});
app.post('/api/work-orders',allow('admin','manager','technician'),async(req,res,next)=>{const parsed=orderSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid work order',issues:parsed.error.flatten()});try{const m=await getMachine(parsed.data.machineId);const order={id:`WO-${Date.now().toString().slice(-5)}`,machineId:parsed.data.machineId,machineName:m?.name||parsed.data.machineId,title:parsed.data.title,priority:parsed.data.priority,status:'open',assignedTo:parsed.data.assignedTo,dueDate:new Date(Date.now()+2*86400000).toISOString()};await createWorkOrder(order);res.status(201).json(order);}catch(err){next(err);}});
const aiHeaders=()=>process.env.AI_SERVICE_TOKEN?{'x-machineguard-service-token':process.env.AI_SERVICE_TOKEN}:undefined;
app.post('/api/ai/analyze/:machineId',async(req,res)=>{const m=await getMachine(req.params.machineId);if(!m)return res.status(404).json({message:'Machine not found'});try{const {data}=await axios.post(`${aiUrl()}/analyze`,m.reading,{timeout:90000,headers:aiHeaders()});res.json(data);}catch{res.status(503).json({message:'AI service unavailable'});}});
// Render's `fromService ... property: host` supplies a bare hostname with no scheme, which
// axios cannot request. Add https:// when the scheme is missing so the blueprint works
// whether the value is a full URL or just a host.
const aiUrl=()=>{const v=process.env.AI_SERVICE_URL||'http://localhost:8000';return /^https?:\/\//.test(v)?v:`https://${v}`;};
app.get('/api/replay/scenarios',async(_req,res)=>{try{const {data}=await axios.get(`${aiUrl()}/replay/scenarios`,{timeout:90000,headers:aiHeaders()});res.json(data);}catch{res.status(503).json({message:'AI service unavailable'});}});
const replaySchema=z.object({scenario:z.string().min(2).max(40),index:z.number().int().min(0)});
app.post('/api/replay/step',async(req,res)=>{const parsed=replaySchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Invalid replay step'});try{const {data}=await axios.post(`${aiUrl()}/replay/step`,parsed.data,{timeout:90000,headers:aiHeaders()});res.json(data);}catch(err){const status=axios.isAxiosError(err)&&err.response?.status===404?404:503;res.status(status).json({message:status===404?'Unknown replay scenario':'AI service unavailable'});}});
app.get('/api/model',async(_req,res)=>{try{const {data}=await axios.get(`${aiUrl()}/model`,{timeout:90000,headers:aiHeaders()});res.json(data);}catch{res.status(503).json({message:'AI service unavailable'});}});

const askSchema=z.object({question:z.string().min(4).max(1000),machineId:z.string().optional()});
app.post('/api/ai/ask',async(req,res)=>{const parsed=askSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Enter a valid question'});const all=await getMachines();const machine=all.find(m=>m.id===parsed.data.machineId)||all[0];try{const {data}=await axios.post(`${aiUrl()}/ask`,{...parsed.data,telemetry:machine?.reading},{timeout:90000,headers:aiHeaders()});res.json(data);}catch{res.status(503).json({message:'AI service unavailable'});}});
app.use((_req,res)=>res.status(404).json({message:'Route not found'}));
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{console.error(err);res.status(500).json({message:process.env.NODE_ENV==='production'?'Unexpected server error':err.message});});
