import type { Request } from 'express';

export type Role = 'admin' | 'manager' | 'technician' | 'viewer';
export interface AuthUser { id: string; name: string; email: string; role: Role; }
export interface AuthedRequest extends Request { user?: AuthUser; }
export interface Reading {
  machineId: string; temperature: number; vibration: number; pressure: number;
  power: number; rpm: number; riskScore: number; timestamp: string;
}
export interface Machine {
  id: string; name: string; type: string; location: string; status: string;
  health: number; nextMaintenance: string; reading: Reading; history: Reading[];
}
