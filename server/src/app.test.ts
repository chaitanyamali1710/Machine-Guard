import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

describe('MaintAI API',()=>{
  it('reports health',async()=>{const res=await request(app).get('/api/health');expect(res.status).toBe(200);expect(res.body.status).toBe('ok');});
  it('does not advertise demo credentials in production',async()=>{const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{const res=await request(app).get('/api/auth/default-credentials');expect(res.status).toBe(200);expect(res.body.usingDefaults).toBe(false);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}});
  it('authenticates the demo administrator',async()=>{const res=await request(app).post('/api/auth/login').send({email:'admin@maintai.dev',password:'Admin@123'});expect(res.status).toBe(200);expect(res.body.token).toBeTruthy();});
  it('protects dashboard data',async()=>{const res=await request(app).get('/api/dashboard');expect(res.status).toBe(401);});
});
