import { statusForRisk } from './settings.js';
import type { Machine, Reading } from './types.js';

const now = Date.now();

/** id, name, type, location, temperature, vibration, pressure, power, rpm */
type Baseline = [string,string,string,string,number,number,number,number,number];

// Mutable so assets registered at runtime can be simulated too; `tick` looks each machine up
// here, and a machine without a baseline would otherwise throw.
const base: Baseline[] = [
  ['VAC-104','Vacuum Pump VP-104','Vacuum pump','Line A',52,2.1,5.5,12.4,1450],
  ['CMP-012','Compressor C-12','Air compressor','Utility Bay',78,6.9,4.3,28.2,1670],
  ['CNC-207','CNC Mill M-207','CNC machine','Machining',47,1.7,6.1,18.8,1320],
  ['CNV-033','Conveyor CV-33','Conveyor','Assembly',55,2.8,5.2,8.5,980],
  ['PMP-089','Coolant Pump P-89','Centrifugal pump','Cooling',63,4.4,4.8,10.1,1510],
  ['GEN-005','Generator G-05','Generator','Power House',58,3.1,5.6,42.5,1500]
];

// Starting values for a newly registered asset, so it produces plausible telemetry straight
// away instead of sitting at zero.
const TYPE_BASELINES: Record<string,[number,number,number,number,number]> = {
  'Vacuum pump':      [52,2.1,5.5,12.4,1450],
  'Air compressor':   [60,3.2,4.3,24.0,1670],
  'CNC machine':      [47,1.7,6.1,18.8,1320],
  'Conveyor':         [55,2.8,5.2,8.5,980],
  'Centrifugal pump': [58,2.6,4.8,10.1,1510],
  'Generator':        [58,3.1,5.6,42.5,1500]
};
export const MACHINE_TYPES = Object.keys(TYPE_BASELINES);

function risk(temp:number,vib:number,pressure:number){return Math.round(Math.min(98,Math.max(4,(temp-45)*1.25+(vib-1.5)*8+Math.abs(5.5-pressure)*5)));}
function reading(row:Baseline,offset=0):Reading { const drift=row[0]==='CMP-012'?offset*.24:Math.sin(offset/3)*.6; const temperature=row[4]+drift+(Math.random()-.5)*1.5; const vibration=row[5]+(row[0]==='CMP-012'?offset*.045:0)+(Math.random()-.5)*.25; const pressure=row[6]+(Math.random()-.5)*.12; return {machineId:row[0],temperature:+temperature.toFixed(2),vibration:+vibration.toFixed(2),pressure:+pressure.toFixed(2),power:+(row[7]+(Math.random()-.5)*.7).toFixed(2),rpm:Math.round(row[8]+(Math.random()-.5)*18),riskScore:risk(temperature,vibration,pressure),timestamp:new Date(now-(23-offset)*5*60_000).toISOString()}; }

export const machines:Machine[]=base.map(row=>{const history=Array.from({length:24},(_,i)=>reading(row,i));const latest=history.at(-1)!;return{id:row[0],name:row[1],type:row[2],location:row[3],status:statusForRisk(latest.riskScore),health:Math.max(18,100-latest.riskScore),nextMaintenance:new Date(Date.now()+7*86400000).toISOString(),reading:latest,history};});

export const alerts=[
  {id:'ALT-1001',machineId:'CMP-012',machineName:'Compressor C-12',severity:'high',title:'Abnormal vibration escalation',message:'Vibration exceeded 6.5 mm/s and continues to rise.',acknowledged:false,createdAt:new Date(Date.now()-8*60000).toISOString()},
  {id:'ALT-1002',machineId:'PMP-089',machineName:'Coolant Pump P-89',severity:'medium',title:'Temperature approaching limit',message:'Temperature remained above 62°C for 12 minutes.',acknowledged:false,createdAt:new Date(Date.now()-23*60000).toISOString()},
  {id:'ALT-1003',machineId:'VAC-104',machineName:'Vacuum Pump VP-104',severity:'low',title:'Maintenance window approaching',message:'Preventive inspection is due in seven days.',acknowledged:true,createdAt:new Date(Date.now()-3*3600000).toISOString()}
];

export const workOrders=[
  {id:'WO-2410',machineId:'CMP-012',machineName:'Compressor C-12',title:'Inspect drive-end bearing',priority:'high',status:'in-progress',assignedTo:'A. Patil',dueDate:new Date(Date.now()+86400000).toISOString()},
  {id:'WO-2408',machineId:'PMP-089',machineName:'Coolant Pump P-89',title:'Check coolant and seal condition',priority:'medium',status:'open',assignedTo:'Maintenance Team',dueDate:new Date(Date.now()+2*86400000).toISOString()},
  {id:'WO-2399',machineId:'CNC-207',machineName:'CNC Mill M-207',title:'Monthly calibration',priority:'low',status:'completed',assignedTo:'S. Jadhav',dueDate:new Date(Date.now()-86400000).toISOString()}
];

export function machineExists(id:string){return machines.some(m=>m.id===id.trim().toUpperCase());}

/** Registers an asset at runtime: adds its simulator baseline and seeds a short history so
 *  the charts are not empty the moment it appears. */
export function addMachine(spec:{id:string;name:string;type:string;location:string}):Machine{
  const id=spec.id.trim().toUpperCase();
  const defaults=TYPE_BASELINES[spec.type]??[55,2.5,5.2,15,1400];
  const row:Baseline=[id,spec.name.trim(),spec.type,spec.location.trim(),...defaults];
  base.push(row);
  const history=Array.from({length:12},(_,i)=>reading(row,i));
  const latest=history.at(-1)!;
  const machine:Machine={id,name:row[1],type:row[2],location:row[3],status:statusForRisk(latest.riskScore),health:Math.max(18,100-latest.riskScore),nextMaintenance:new Date(Date.now()+7*86400000).toISOString(),reading:latest,history};
  machines.push(machine);
  return machine;
}

export function tick(){for(const m of machines){const row=base.find(x=>x[0]===m.id);if(!row)continue;const r=reading(row,m.history.length);r.timestamp=new Date().toISOString();m.reading=r;m.history=[...m.history.slice(-47),r];m.health=Math.max(12,100-r.riskScore);m.status=statusForRisk(r.riskScore);}}

/** Re-grades every asset against the current thresholds, so a settings change shows up
 *  immediately instead of waiting for the next simulator tick. */
export function restatus(){for(const m of machines)m.status=statusForRisk(m.reading.riskScore);}
