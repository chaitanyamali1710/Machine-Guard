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

export const DEFAULT_EMAIL = 'admin@maintai.dev';
export const DEFAULT_PASSWORD = 'Admin@123';

interface StoredUser { id:string; name:string; email:string; passwordHash:string; role:Role; isDefaultPassword:boolean; }

// Mirrors the seeded administrator when MongoDB is unavailable.
let memoryUser: StoredUser | null = null;

async function seedMemory(): Promise<StoredUser> {
  memoryUser ??= {
    id: 'USR-001', name: 'Chaitanya Mali', email: DEFAULT_EMAIL,
    passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS),
    role: 'admin', isDefaultPassword: true
  };
  return memoryUser;
}

/** Creates the administrator on first run. Never overwrites an existing one. */
export async function seedAdmin(): Promise<void> {
  if (!isDbReady()) { await seedMemory(); return; }
  if (await UserModel.countDocuments() > 0) return;
  await UserModel.create({
    name: 'Chaitanya Mali', email: DEFAULT_EMAIL,
    passwordHash: await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS),
    role: 'admin', isDefaultPassword: true
  });
  console.log(`Seeded administrator ${DEFAULT_EMAIL} with the default password.`);
}

async function findByEmail(email: string): Promise<StoredUser | null> {
  const wanted = email.trim().toLowerCase();
  if (!isDbReady()) {
    const u = await seedMemory();
    return u.email === wanted ? u : null;
  }
  const doc = await UserModel.findOne({ email: wanted }).lean();
  if (!doc) return null;
  return { id:String(doc._id), name:doc.name ?? '', email:doc.email ?? '', passwordHash:doc.passwordHash ?? '',
           role:(doc.role ?? 'viewer') as Role, isDefaultPassword:Boolean((doc as {isDefaultPassword?:boolean}).isDefaultPassword) };
}

async function findById(id: string): Promise<StoredUser | null> {
  if (!isDbReady()) {
    const u = await seedMemory();
    return u.id === id ? u : null;
  }
  const doc = await UserModel.findById(id).lean().catch(() => null);
  if (!doc) return null;
  return { id:String(doc._id), name:doc.name ?? '', email:doc.email ?? '', passwordHash:doc.passwordHash ?? '',
           role:(doc.role ?? 'viewer') as Role, isDefaultPassword:Boolean((doc as {isDefaultPassword?:boolean}).isDefaultPassword) };
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
  return { ...publicUser(user), isDefaultPassword: user.isDefaultPassword, persisted: isDbReady() };
}

/** True while the administrator still has the shipped password, so the UI can stop
 *  advertising the demo credentials once they have been changed. */
export async function usingDefaultCredentials(): Promise<boolean> {
  const user = await findByEmail(DEFAULT_EMAIL);
  return Boolean(user?.isDefaultPassword);
}

type UpdateResult = { ok:true; user:AuthUser } | { ok:false; reason:'wrong-password'|'not-found'|'email-taken' };

export async function changePassword(id: string, currentPassword: string, newPassword: string): Promise<UpdateResult> {
  const user = await findById(id);
  if (!user) return { ok:false, reason:'not-found' };
  if (!await bcrypt.compare(currentPassword, user.passwordHash)) return { ok:false, reason:'wrong-password' };
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  if (isDbReady()) await UserModel.findByIdAndUpdate(id, { passwordHash, isDefaultPassword:false });
  else if (memoryUser) { memoryUser.passwordHash = passwordHash; memoryUser.isDefaultPassword = false; }
  return { ok:true, user:publicUser(user) };
}

export async function changeProfile(id: string, currentPassword: string, email: string, name: string): Promise<UpdateResult> {
  const user = await findById(id);
  if (!user) return { ok:false, reason:'not-found' };
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
