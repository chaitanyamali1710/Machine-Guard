import { isDbReady } from './db.js';
import { AlertModel, MachineModel, ReadingModel, WorkOrderModel } from './models.js';
import { alerts, machines, workOrders } from './store.js';
import type { Machine, Reading } from './types.js';

const HISTORY_LIMIT = 48;

const iso = (v: unknown) => new Date(v as string).toISOString();
const toReading = (d: any): Reading => ({ machineId:d.machineId, temperature:d.temperature, vibration:d.vibration, pressure:d.pressure, power:d.power, rpm:d.rpm, riskScore:d.riskScore, timestamp:iso(d.timestamp) });
const toAlert = (d: any) => ({ id:d.id, machineId:d.machineId, machineName:d.machineName, severity:d.severity, title:d.title, message:d.message, acknowledged:d.acknowledged, acknowledgedAt:d.acknowledgedAt?iso(d.acknowledgedAt):undefined, createdAt:iso(d.createdAt) });
const toWorkOrder = (d: any) => ({ id:d.id, machineId:d.machineId, machineName:d.machineName, title:d.title, priority:d.priority, status:d.status, assignedTo:d.assignedTo, dueDate:iso(d.dueDate) });

/** Writes the starting assets, alerts and work orders once, so a fresh cluster is not empty. */
export async function seed(){
  if(!isDbReady()) return;
  if(await MachineModel.estimatedDocumentCount()===0){
    await MachineModel.insertMany(machines.map(m=>({id:m.id,name:m.name,type:m.type,location:m.location,status:m.status,health:m.health,nextMaintenance:m.nextMaintenance,reading:m.reading})));
    await ReadingModel.insertMany(machines.flatMap(m=>m.history.map(r=>({...r}))));
    console.log('Seeded machines and starting history.');
  }
  if(await AlertModel.estimatedDocumentCount()===0) await AlertModel.insertMany(alerts);
  if(await WorkOrderModel.estimatedDocumentCount()===0) await WorkOrderModel.insertMany(workOrders);
}

/**
 * Current readings come from the live simulator so the dashboard stays responsive between
 * persists; history comes from MongoDB so charts survive a restart.
 */
export async function getMachines(): Promise<Machine[]>{
  if(!isDbReady()) return machines;
  const histories = await Promise.all(machines.map(m=>ReadingModel.find({machineId:m.id}).sort({timestamp:-1}).limit(HISTORY_LIMIT).lean()));
  return machines.map((m,i)=>({...m,history:histories[i].map(toReading).reverse()}));
}

export async function getMachine(id: string){
  const list = await getMachines();
  return list.find(m=>m.id===id) || null;
}

export async function getAlerts(){
  if(!isDbReady()) return alerts;
  return (await AlertModel.find().sort({createdAt:-1}).lean()).map(toAlert);
}

export async function getWorkOrders(){
  if(!isDbReady()) return workOrders;
  return (await WorkOrderModel.find().sort({createdAt:-1}).lean()).map(toWorkOrder);
}

export async function acknowledgeAlert(id: string){
  if(!isDbReady()){
    const a = alerts.find(x=>x.id===id) as (typeof alerts[number] & {acknowledgedAt?:string}) | undefined;
    if(a){ a.acknowledged = true; a.acknowledgedAt = new Date().toISOString(); }
    return a || null;
  }
  const doc = await AlertModel.findOneAndUpdate({id},{acknowledged:true,acknowledgedAt:new Date()},{new:true}).lean();
  return doc ? toAlert(doc) : null;
}

export async function createWorkOrder(order: ReturnType<typeof toWorkOrder>){
  if(!isDbReady()){ workOrders.unshift(order as never); return order; }
  await WorkOrderModel.create(order);
  return order;
}

/** Persists a newly registered asset and its seeded history. */
export async function saveMachine(m: Machine){
  if(!isDbReady()) return;
  await MachineModel.updateOne({id:m.id},{$set:{id:m.id,name:m.name,type:m.type,location:m.location,status:m.status,health:m.health,nextMaintenance:m.nextMaintenance,reading:m.reading}},{upsert:true});
  if(m.history.length) await ReadingModel.insertMany(m.history.map(r=>({...r})),{ordered:false});
}

/** Appends the latest simulated reading per machine and refreshes each asset's status. */
export async function persistReadings(){
  if(!isDbReady()) return;
  try{
    await ReadingModel.insertMany(machines.map(m=>({...m.reading})),{ordered:false});
    await MachineModel.bulkWrite(machines.map(m=>({updateOne:{filter:{id:m.id},update:{$set:{status:m.status,health:m.health,reading:m.reading}}}})));
  }catch(err){
    console.warn('Reading persistence skipped:',(err as Error).message);
  }
}
