import 'dotenv/config';
import { seedAdmin } from './accounts.js';
import { app } from './app.js';
import { connectDb } from './db.js';
import { ReadingModel } from './models.js';
import { recordEnergy } from './analytics.js';
import { recordTick } from './reliability.js';
import { persistReadings, seed } from './repository.js';
import { getSettings, loadSettings, onSettingsChange } from './settings.js';
import { restatus, tick } from './store.js';

const port=Number(process.env.PORT||5000);

if(process.env.NODE_ENV==='production'&&!process.env.JWT_SECRET){
  console.error('JWT_SECRET must be set in production. Refusing to start with the development fallback.');
  process.exit(1);
}

await connectDb();
await seed();
await seedAdmin();
await loadSettings();

// The simulator runs fast so the dashboard feels live; persistence is slower to stay inside
// the Atlas free tier. Both are rescheduled when an administrator changes the interval, so a
// settings change takes effect without a restart.
let sensorTimer:NodeJS.Timeout|undefined;
let persistTimer:NodeJS.Timeout|undefined;

function schedule(){
  const {sensorIntervalMs,persistIntervalMs}=getSettings();
  clearInterval(sensorTimer);
  clearInterval(persistTimer);
  sensorTimer=setInterval(()=>{tick();recordTick(sensorIntervalMs);recordEnergy(sensorIntervalMs);},sensorIntervalMs);
  persistTimer=setInterval(()=>{void persistReadings();},persistIntervalMs);
  sensorTimer.unref();
  persistTimer.unref();
}

/** MongoDB cannot alter expireAfterSeconds in place, so the TTL index is dropped and rebuilt. */
async function applyRetention(days:number){
  try{
    const collection=ReadingModel.collection;
    const existing=(await collection.indexes()).find(i=>JSON.stringify(i.key)==='{"timestamp":1}');
    if(existing?.expireAfterSeconds===days*86400) return;
    if(existing) await collection.dropIndex(existing.name!);
    await collection.createIndex({timestamp:1},{expireAfterSeconds:days*86400});
    console.log(`Reading retention set to ${days} days.`);
  }catch(err){
    console.warn('Could not update the reading retention index:',(err as Error).message);
  }
}

schedule();
onSettingsChange((settings,changed)=>{
  if(changed.has('sensorIntervalMs')||changed.has('persistIntervalMs')) schedule();
  if(changed.has('warningRisk')||changed.has('criticalRisk')) restatus();
  if(changed.has('readingRetentionDays')) void applyRetention(settings.readingRetentionDays);
});

app.listen(port,()=>console.log(`MaintAI API listening on http://localhost:${port}`));
