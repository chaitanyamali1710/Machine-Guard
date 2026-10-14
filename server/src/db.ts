import mongoose from 'mongoose';

let ready = false;
export const isDbReady = () => ready;

mongoose.connection.on('connected', () => { ready = true; });
mongoose.connection.on('disconnected', () => { ready = false; console.warn('MongoDB disconnected; serving the in-memory store until it returns.'); });

/** Connects if a URI is configured. Returns false instead of throwing so the demo still runs offline. */
export async function connectDb(uri = process.env.MONGODB_URI){
  if(!uri){ console.log('MONGODB_URI not set; running with the in-memory demo store.'); return false; }
  try{
    await mongoose.connect(uri,{serverSelectionTimeoutMS:15000});
    ready = true;
    console.log('MongoDB connected');
    return true;
  }catch(err){
    console.warn('MongoDB connection failed; demo store remains active:',(err as Error).message);
    return false;
  }
}
