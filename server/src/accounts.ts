import bcrypt from 'bcryptjs';
import { isDbReady } from './db.js';
import { UserModel } from './models.js';
import type { AuthUser, Role } from './types.js';

/**
 * Account storage. Credentials live in MongoDB so a changed password survives a restart;
 * when no database is configured the same account is held in memory so the demo still runs,
 * but changes there are lost on restart and the caller is told so.
 */

const BCRYPT_ROUNDS = 10;

export const DEFAULT_EMAIL = (process.env.ADMIN_EMAIL || 'admin@maintai.dev').trim().toLowerCase();
export const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const DEFAULT_NAME = process.env.ADMIN_NAME || 'Chaitanya Mali';
export const DEMO_EMAIL = (process.env.DEMO_EMAIL || 'demo@maintai.dev').trim().toLowerCase();
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@12345';
const DEMO_NAME = 'MachineGuard Evaluator';
export const isDemoLoginEnabled = () => process.env.DEMO_LOGIN_ENABLED?.toLowerCase() !== 'false';

interface StoredUser { id:string; name:string; email:string; passwordHash:string; role:Role; isDefaultPassword:boolean; isDemo:boolean; }

// Mirrors the seeded administrator when MongoDB is unavailable.
let memoryUser: StoredUser | null = null;
let memoryDemoUser: StoredUser | null = null;

async function seedMemory(): Promise<StoredUser> {
  memoryUser ??= {
    id: 'USR-001', name: DEFAULT_NAME, email: DEFAULT_EMAIL,
    passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS),
    role: 'admin', isDefaultPassword: true, isDemo: false
  };
  return memoryUser;
}

async function seedDemoMemory(): Promise<StoredUser> {
  memoryDemoUser ??= {
    id: 'USR-DEMO', name: DEMO_NAME, email: DEMO_EMAIL,
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS),
    role: 'viewer', isDefaultPassword: false, isDemo: true
  };
  return memoryDemoUser;
}

/** Creates the administrator on first run. Never overwrites an existing one. */
export async function seedAdmin(): Promise<void> {
  if (!isDbReady()) { await seedMemory(); return; }
  if (await UserModel.countDocuments() > 0) return;
  await UserModel.create({
    name: DEFAULT_NAME, email: DEFAULT_EMAIL,
    passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS),
    role: 'admin', isDefaultPassword: true
  });
  console.log(`Seeded administrator ${DEFAULT_EMAIL} with the default password.`);
}

/** Creates or refreshes the shared, read-only evaluator account. */
export async function seedDemoAccount(): Promise<void> {
  if (!isDemoLoginEnabled()) return;
  if (DEMO_EMAIL === DEFAULT_EMAIL) {
    throw new Error('DEMO_EMAIL must be different from ADMIN_EMAIL.');
  }
  if (!isDbReady()) { await seedDemoMemory(); return; }

  const existing = await UserModel.findOne({ email:DEMO_EMAIL }).lean();
  if (existing && !(existing as {isDemo?:boolean}).isDemo) {
    throw new Error(`DEMO_EMAIL ${DEMO_EMAIL} is already used by a non-demo account.`);
  }

  const values = {
    name:DEMO_NAME,
    email:DEMO_EMAIL,
    passwordHash:await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS),
    role:'viewer',
    isDefaultPassword:false,
    isDemo:true
  };
  if (existing) await UserModel.findByIdAndUpdate(existing._id, values);
  else await UserModel.create(values);
}

async function findByEmail(email: string): Promise<StoredUser | null> {
  const wanted = email.trim().toLowerCase();
  if (!isDbReady()) {
    if (wanted === DEMO_EMAIL) {
      if (!isDemoLoginEnabled() || DEMO_EMAIL === DEFAULT_EMAIL) return null;
      return seedDemoMemory();
    }
    const u = await seedMemory();
    return u.email === wanted ? u : null;
  }
  if (wanted === DEMO_EMAIL && !isDemoLoginEnabled()) return null;
  const doc = await UserModel.findOne({ email: wanted }).lean();
  if (!doc) return null;
  return { id:String(doc._id), name:doc.name ?? '', email:doc.email ?? '', passwordHash:doc.passwordHash ?? '',
           role:(doc.role ?? 'viewer') as Role, isDefaultPassword:Boolean((doc as {isDefaultPassword?:boolean}).isDefaultPassword),
           isDemo:Boolean((doc as {isDemo?:boolean}).isDemo) };
}

async function findById(id: string): Promise<StoredUser | null> {
  if (!isDbReady()) {
    if (memoryDemoUser?.id === id) return memoryDemoUser;
    const u = await seedMemory();
    return u.id === id ? u : null;
  }
  const doc = await UserModel.findById(id).lean().catch(() => null);
  if (!doc) return null;
  return { id:String(doc._id), name:doc.name ?? '', email:doc.email ?? '', passwordHash:doc.passwordHash ?? '',
           role:(doc.role ?? 'viewer') as Role, isDefaultPassword:Boolean((doc as {isDefaultPassword?:boolean}).isDefaultPassword),
           isDemo:Boolean((doc as {isDemo?:boolean}).isDemo) };
}

const publicUser = (u: StoredUser): AuthUser => ({ id:u.id, name:u.name, email:u.email, role:u.role });

/** Verifies credentials. Returns null for both unknown email and wrong password, so the
 *  response cannot be used to discover which accounts exist. */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
  const user = await findByEmail(email);
  if (!user) {
    // Compare against a dummy hash anyway, so a missing account does not answer faster
    // than a wrong password and reveal itself by timing.
    await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV123456');
    return null;
  }
  return await bcrypt.compare(password, user.passwordHash) ? publicUser(user) : null;
}

export async function getAccount(id: string) {
  const user = await findById(id);
  if (!user) return null;
  return { ...publicUser(user), isDefaultPassword: user.isDefaultPassword, isDemo:user.isDemo, persisted: isDbReady() };
}

/** True while the administrator still has the shipped local-development password. */
export async function usingDefaultCredentials(): Promise<boolean> {
  const user = await findByEmail(DEFAULT_EMAIL);
  return Boolean(user?.isDefaultPassword);
}

type UpdateResult = { ok:true; user:AuthUser } | { ok:false; reason:'wrong-password'|'not-found'|'email-taken'|'demo-account' };

export async function changePassword(id: string, currentPassword: string, newPassword: string): Promise<UpdateResult> {
  const user = await findById(id);
  if (!user) return { ok:false, reason:'not-found' };
  if (user.isDemo) return { ok:false, reason:'demo-account' };
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) return { ok:false, reason:'wrong-password' };
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  if (isDbReady()) await UserModel.findByIdAndUpdate(id, { passwordHash, isDefaultPassword:false });
  else if (memoryUser) { memoryUser.passwordHash = passwordHash; memoryUser.isDefaultPassword = false; }
  return { ok:true, user:publicUser(user) };
}

export async function changeProfile(id: string, currentPassword: string, email: string, name: string): Promise<UpdateResult> {
  const user = await findById(id);
  if (!user) return { ok:false, reason:'not-found' };
  if (user.isDemo) return { ok:false, reason:'demo-account' };
  // The current password is required even for an email change, because the email is the
  // login identifier: without it, a stolen token could lock the real owner out.
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) return { ok:false, reason:'wrong-password' };
  const wanted = email.trim().toLowerCase();
  if (wanted !== user.email) {
    const clash = await findByEmail(wanted);
    if (clash && clash.id !== id) return { ok:false, reason:'email-taken' };
  }
  if (isDbReady()) await UserModel.findByIdAndUpdate(id, { email:wanted, name });
  else if (memoryUser) { memoryUser.email = wanted; memoryUser.name = name; }
  return { ok:true, user:{ ...publicUser(user), email:wanted, name } };
}
