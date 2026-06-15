import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

const CLIENTS_FILE = path.join(dataDir, 'clients.json');
const TOKENS_FILE  = path.join(dataDir, 'reset-tokens.json');

// =====================
// R2 SYNC FOR clients.json
// =====================
const R2_CLIENTS_KEY = 'system/clients.json';

function getR2Client() {
  if (!process.env.R2_ENDPOINT || !process.env.R2_BUCKET) return null;
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function backupClientsToR2(data) {
  try {
    const s3 = getR2Client();
    if (!s3) return;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: R2_CLIENTS_KEY,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
    }));
  } catch (err) {
    console.warn('[userStore] R2 backup failed:', err.message);
  }
}

async function restoreClientsFromR2() {
  try {
    const s3 = getR2Client();
    if (!s3) return;
    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: R2_CLIENTS_KEY,
    }));
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    const json = Buffer.concat(chunks).toString('utf8');
    const data = JSON.parse(json);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(CLIENTS_FILE, json, 'utf8');
    console.log(`[userStore] Restored ${data.length} client(s) from R2.`);
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      console.warn('[userStore] R2 restore failed:', err.message);
    }
  }
}

// Called once at server startup — ensures local file exists before any reads
export async function initClientStore() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(CLIENTS_FILE);
  } catch {
    // File missing (fresh deploy) — try restoring from R2
    await restoreClientsFromR2();
  }
}

// =====================
// HELPERS
// =====================
async function readJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeJson(file, data) {
  await fs.mkdir(dataDir, { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
  // Keep R2 in sync for the clients file so accounts survive re-deploys
  if (file === CLIENTS_FILE) {
    await backupClientsToR2(data);
  }
}

// =====================
// CLIENTS
// =====================
export async function findClientByEmail(email) {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(c => c.email === email.trim().toLowerCase()) || null;
}

export async function findClientById(id) {
  const clients = await readJson(CLIENTS_FILE);
  return clients.find(c => c.id === id) || null;
}

export async function createClient({ fullName, email, passwordHash, companyName, role = 'client' }) {
  const clients = await readJson(CLIENTS_FILE);
  const normalizedEmail = email.trim().toLowerCase();

  if (clients.some(c => c.email === normalizedEmail)) {
    throw new Error('DUPLICATE_EMAIL');
  }

  const client = {
    id: crypto.randomUUID(),
    fullName: fullName.trim(),
    email: normalizedEmail,
    passwordHash,
    companyName: companyName?.trim() || null,
    role,
    createdAt: new Date().toISOString()
  };

  clients.push(client);
  await writeJson(CLIENTS_FILE, clients);
  return client;
}

export async function listAllClients() {
  const clients = await readJson(CLIENTS_FILE);
  // Never expose password hashes
  return clients.map(({ passwordHash: _pw, ...safe }) => safe);
}

export async function blockClient(clientId) {
  const clients = await readJson(CLIENTS_FILE);
  const idx = clients.findIndex(c => c.id === clientId);
  if (idx === -1) throw new Error('Client not found');
  if (clients[idx].role === 'admin') throw new Error('Cannot block an admin account');
  clients[idx].blocked = true;
  clients[idx].blockedAt = new Date().toISOString();
  await writeJson(CLIENTS_FILE, clients);
}

export async function unblockClient(clientId) {
  const clients = await readJson(CLIENTS_FILE);
  const idx = clients.findIndex(c => c.id === clientId);
  if (idx === -1) throw new Error('Client not found');
  clients[idx].blocked = false;
  clients[idx].blockedAt = null;
  await writeJson(CLIENTS_FILE, clients);
}

export async function deleteClient(clientId) {
  const clients = await readJson(CLIENTS_FILE);
  const target = clients.find(c => c.id === clientId);
  if (!target) throw new Error('Client not found');
  if (target.role === 'admin') throw new Error('Cannot delete an admin account');
  const filtered = clients.filter(c => c.id !== clientId);
  await writeJson(CLIENTS_FILE, filtered);
}

// =====================
// ADMIN SEEDING
// Runs once on first boot only. Never overwrites existing admin.
// =====================
export async function seedAdminIfNeeded() {
  const { default: bcrypt } = await import('bcryptjs');

  const clients = await readJson(CLIENTS_FILE);
  if (clients.some(c => c.role === 'admin')) {
    return; // Admin already exists — do nothing
  }

  const email    = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME?.trim() || 'Admin';

  if (!email || !password) {
    console.warn('[auth] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = {
    id: crypto.randomUUID(),
    fullName,
    email,
    passwordHash,
    companyName: null,
    role: 'admin',
    createdAt: new Date().toISOString()
  };

  // Ensure data dir exists
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(path.dirname(CLIENTS_FILE), { recursive: true });

  clients.push(admin);
  await writeJson(CLIENTS_FILE, clients);
  console.log('[auth] Admin account initialised.');
}

export async function updateClientPassword(clientId, newPasswordHash) {
  const clients = await readJson(CLIENTS_FILE);
  const idx = clients.findIndex(c => c.id === clientId);
  if (idx === -1) throw new Error('Client not found');
  clients[idx].passwordHash = newPasswordHash;
  await writeJson(CLIENTS_FILE, clients);
}

// =====================
// RESET TOKENS
// =====================
export async function createResetToken(clientId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  const tokens = await readJson(TOKENS_FILE);
  tokens.push({
    id: crypto.randomUUID(),
    clientId,
    tokenHash,
    expiresAt,
    usedAt: null,
    createdAt: new Date().toISOString()
  });

  await writeJson(TOKENS_FILE, tokens);
  return rawToken;
}

export async function findResetToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(String(rawToken)).digest('hex');
  const tokens = await readJson(TOKENS_FILE);
  return tokens.find(t => t.tokenHash === tokenHash) || null;
}

export async function markResetTokenUsed(tokenId) {
  const tokens = await readJson(TOKENS_FILE);
  const idx = tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    tokens[idx].usedAt = new Date().toISOString();
    await writeJson(TOKENS_FILE, tokens);
  }
}
