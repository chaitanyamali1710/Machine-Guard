import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

describe('MaintAI API',()=>{
  it('reports health',async()=>{const res=await request(app).get('/api/health');expect(res.status).toBe(200);expect(res.body.status).toBe('ok');});
  it('authenticates the demo administrator',async()=>{const res=await request(app).post('/api/auth/login').send({email:'admin@maintai.dev',password:'Admin@123'});expect(res.status).toBe(200);expect(res.body.token).toBeTruthy();});
  it('protects dashboard data',async()=>{const res=await request(app).get('/api/dashboard');expect(res.status).toBe(401);});
});
