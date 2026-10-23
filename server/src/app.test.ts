import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from './accounts.js';

describe('MaintAI API',()=>{
  it('reports health',async()=>{const res=await request(app).get('/api/health');expect(res.status).toBe(200);expect(res.body.status).toBe('ok');});
  it('does not advertise demo credentials in production',async()=>{const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';try{const res=await request(app).get('/api/auth/default-credentials');expect(res.status).toBe(200);expect(res.body.usingDefaults).toBe(false);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}});
  it('publishes the separate evaluator credentials',async()=>{const res=await request(app).get('/api/auth/demo-credentials');expect(res.status).toBe(200);expect(res.body).toEqual({enabled:true,email:DEMO_EMAIL,password:DEMO_PASSWORD});});
  it('can disable evaluator login and credential display',async()=>{const previous=process.env.DEMO_LOGIN_ENABLED;process.env.DEMO_LOGIN_ENABLED='false';try{const credentials=await request(app).get('/api/auth/demo-credentials');expect(credentials.body.enabled).toBe(false);const login=await request(app).post('/api/auth/login').send({email:DEMO_EMAIL,password:DEMO_PASSWORD});expect(login.status).toBe(401);}finally{if(previous===undefined)delete process.env.DEMO_LOGIN_ENABLED;else process.env.DEMO_LOGIN_ENABLED=previous;}});
  it('authenticates the local administrator separately from the evaluator account',async()=>{const res=await request(app).post('/api/auth/login').send({email:'admin@maintai.dev',password:'Admin@123'});expect(res.status).toBe(200);expect(res.body.token).toBeTruthy();});
  it('gives evaluators read-only access without allowing changes to the shared account',async()=>{
    const login=await request(app).post('/api/auth/login').send({email:DEMO_EMAIL,password:DEMO_PASSWORD});
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('viewer');
    const auth={Authorization:`Bearer ${login.body.token}`};
    expect((await request(app).get('/api/dashboard').set(auth)).status).toBe(200);
    expect((await request(app).patch('/api/alerts/test-alert/acknowledge').set(auth)).status).toBe(403);
    expect((await request(app).post('/api/work-orders').set(auth).send({machineId:'VAC-104',title:'Test order',priority:'low',assignedTo:'Evaluator'})).status).toBe(403);
    expect((await request(app).patch('/api/account/password').set(auth).send({currentPassword:DEMO_PASSWORD,newPassword:'ChangedPass123'})).status).toBe(403);
    expect((await request(app).patch('/api/account/profile').set(auth).send({currentPassword:DEMO_PASSWORD,email:'changed@example.com',name:'Changed'})).status).toBe(403);
  });
  it('protects dashboard data',async()=>{const res=await request(app).get('/api/dashboard');expect(res.status).toBe(401);});
});
