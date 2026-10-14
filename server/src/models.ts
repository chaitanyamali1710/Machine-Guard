import mongoose, { Schema } from 'mongoose';

// Readings are simulated telemetry, so they are disposable history rather than records of
// record. A TTL index keeps the Atlas free tier (512 MB) from filling up over time.
const READING_TTL_DAYS = Number(process.env.READING_TTL_DAYS || 7);

// isDefaultPassword lets the login screen stop advertising the shipped demo credentials once
// the administrator has set a real password.
const userSchema = new Schema({ name:String, email:{type:String,unique:true,index:true}, passwordHash:String, role:{type:String,default:'viewer'}, isDefaultPassword:{type:Boolean,default:false} }, {timestamps:true});
const machineSchema = new Schema({ id:{type:String,unique:true,index:true}, name:String, type:String, location:String, status:String, health:Number, nextMaintenance:Date, reading:{type:Schema.Types.Mixed} }, {timestamps:true});
// No field-level `index: true` here. Declaring one on `timestamp` as well as the TTL index
// below makes Mongoose treat them as duplicates and silently drop `expireAfterSeconds`, so
// readings would never expire. machineId is covered by the compound index.
const readingSchema = new Schema({ machineId:String, temperature:Number, vibration:Number, pressure:Number, power:Number, rpm:Number, riskScore:Number, timestamp:Date });
const alertSchema = new Schema({ id:{type:String,unique:true}, machineId:String, machineName:String, severity:String, title:String, message:String, acknowledged:{type:Boolean,default:false}, acknowledgedAt:Date, createdAt:Date });
const workOrderSchema = new Schema({
  id:{type:String,unique:true}, machineId:String, machineName:String, title:String,
  priority:String, status:String, assignedTo:String, dueDate:Date,
  startedAt:Date, completedAt:Date,
  labourHours:Number, labourRate:Number, partsCost:Number,
  checklist:[{id:String,text:String,done:Boolean,doneAt:String}],
  failureCode:String, rootCauseWhys:[String], rootCauseNotes:String
}, {timestamps:true});

// Serving a chart means "newest 48 for one machine", so index that access pattern directly.
readingSchema.index({ machineId:1, timestamp:-1 });
// Changing READING_TTL_DAYS later needs the old index dropped; Mongoose will not alter it in place.
readingSchema.index({ timestamp:1 }, { expireAfterSeconds: READING_TTL_DAYS*24*60*60 });

// A single document holds plant-wide configuration, keyed so there can only ever be one.
const settingsSchema = new Schema({
  key:{type:String,unique:true,default:'system'},
  facilityName:String, sensorIntervalMs:Number, persistIntervalMs:Number,
  warningRisk:Number, criticalRisk:Number, readingRetentionDays:Number,
  energyTariff:Number, energyCurrency:String
}, {timestamps:true});

// One row per completed outage, which is what MTBF and MTTR are counted from.
const downtimeSchema = new Schema({ machineId:{type:String,index:true}, startedAt:Number, endedAt:Number, reason:String });

export const DowntimeModel = mongoose.model('Downtime', downtimeSchema);
export const SettingsModel = mongoose.model('Settings', settingsSchema);
export const UserModel = mongoose.model('User', userSchema);
export const MachineModel = mongoose.model('Machine', machineSchema);
export const ReadingModel = mongoose.model('Reading', readingSchema);
export const AlertModel = mongoose.model('Alert', alertSchema);
export const WorkOrderModel = mongoose.model('WorkOrder', workOrderSchema);
