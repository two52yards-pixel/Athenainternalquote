import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

const CLIENTS_FILE = path.join(dataDir, 'clients.json');
const TOKENS_FILE  = path.join(dataDir, 'reset-tokens.json');

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
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
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
