import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import 'dotenv/config';

const quotesRootDirectory = path.resolve(process.cwd(), 'logs', 'quotes');
const quoteSequenceStatePath = path.join(quotesRootDirectory, 'quote-sequence.json');
const quoteSequenceLockPath = path.join(quotesRootDirectory, '.quote-sequence.lock');
const DEFAULT_SEQUENCE_FLOOR = Number(process.env.QUOTE_SEQUENCE_FLOOR || 2217);

// =====================
// R2 SYNC
// =====================
const R2_QUOTES_PREFIX = 'quotes';

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

async function backupQuoteToR2(scopeKey, quoteId, content) {
  try {
    const s3 = getR2Client();
    if (!s3) return;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: `${R2_QUOTES_PREFIX}/${scopeKey}/${quoteId}.json`,
      Body: content,
      ContentType: 'application/json',
    }));
  } catch (err) {
    console.warn('[quoteStore] R2 backup failed:', err.message);
  }
}

async function fetchQuoteFromR2(scopeKey, quoteId) {
  try {
    const s3 = getR2Client();
    if (!s3) return null;
    const result = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: `${R2_QUOTES_PREFIX}/${scopeKey}/${quoteId}.json`,
    }));
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      console.warn('[quoteStore] R2 fetch failed:', err.message);
    }
    return null;
  }
}

// Called at server startup — restores any quote files that are missing locally.
export async function restoreAllQuotesFromR2() {
  try {
    const s3 = getR2Client();
    if (!s3) return;
    let continuationToken;
    let restored = 0;
    do {
      const result = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: R2_QUOTES_PREFIX + '/',
        ContinuationToken: continuationToken,
      }));
      for (const obj of (result.Contents || [])) {
        const parts = obj.Key.split('/');
        // Expect exactly: quotes / scopeKey / quoteId.json
        if (parts.length !== 3 || !parts[2].endsWith('.json')) continue;
        const [, scopeKey, fileName] = parts;
        const localPath = path.join(quotesRootDirectory, scopeKey, fileName);
        try { await fs.access(localPath); continue; } catch { /* missing — restore */ }
        const content = await fetchQuoteFromR2(scopeKey, fileName.replace('.json', ''));
        if (content) {
          await fs.mkdir(path.join(quotesRootDirectory, scopeKey), { recursive: true });
          await fs.writeFile(localPath, content, 'utf8');
          restored++;
        }
      }
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
    if (restored > 0) console.log(`[quoteStore] Restored ${restored} quote(s) from R2.`);
  } catch (err) {
    console.warn('[quoteStore] R2 restore-all failed:', err.message);
  }
}

function sanitizeScopeKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const safe = normalized.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 64);
  return safe || 'default';
}

function getQuotesDirectory(scopeKey) {
  return path.join(quotesRootDirectory, sanitizeScopeKey(scopeKey));
}

function toDate(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatQuoteNumber(date, sequence) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const paddedSequence = String(sequence).padStart(4, '0');
  return `ATH${year} - ${month} - ${paddedSequence}`;
}

async function ensureQuotesDirectory(scopeKey) {
  await fs.mkdir(getQuotesDirectory(scopeKey), { recursive: true });
}

function getQuotePath(scopeKey, quoteId) {
  return path.join(getQuotesDirectory(scopeKey), `${quoteId}.json`);
}

function createNotFoundError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function extractQuoteSequence(quoteNumber) {
  const normalized = String(quoteNumber || '').trim();
  const formatMatch = normalized.match(/^ATH\d{2}\s*-\s*\d{2}\s*-\s*(\d{4})$/i);
  if (!formatMatch) {
    return null;
  }

  const sequence = Number(formatMatch[1]);
  if (!Number.isInteger(sequence) || sequence <= 0) {
    return null;
  }

  return sequence;
}

function sequenceFloor() {
  return Number.isInteger(DEFAULT_SEQUENCE_FLOOR) && DEFAULT_SEQUENCE_FLOOR > 0
    ? DEFAULT_SEQUENCE_FLOOR
    : 1;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withQuoteSequenceLock(task) {
  await fs.mkdir(quotesRootDirectory, { recursive: true });
  const startedAt = Date.now();

  while (true) {
    let handle = null;

    try {
      handle = await fs.open(quoteSequenceLockPath, 'wx');
      const result = await task();
      await handle.close();
      await fs.unlink(quoteSequenceLockPath).catch(() => {});
      return result;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }

      if (error?.code !== 'EEXIST') {
        await fs.unlink(quoteSequenceLockPath).catch(() => {});
        throw error;
      }

      if (Date.now() - startedAt > 8000) {
        throw new Error('Unable to allocate quote number. Please retry.');
      }

      await delay(40);
    }
  }
}

async function readStoredSequenceState() {
  try {
    const raw = await fs.readFile(quoteSequenceStatePath, 'utf8');
    const parsed = JSON.parse(raw);
    const lastSequence = Number(parsed?.lastSequence);
    return Number.isInteger(lastSequence) && lastSequence > 0 ? lastSequence : null;
  } catch {
    return null;
  }
}

async function scanHighestExistingSequence() {
  await fs.mkdir(quotesRootDirectory, { recursive: true });
  const entries = await fs.readdir(quotesRootDirectory, { withFileTypes: true });
  let highest = null;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const scopeDirectory = path.join(quotesRootDirectory, entry.name);
    const files = await fs.readdir(scopeDirectory);

    for (const fileName of files) {
      if (!fileName.endsWith('.json')) {
        continue;
      }

      try {
        const quote = JSON.parse(await fs.readFile(path.join(scopeDirectory, fileName), 'utf8'));
        const sequence = extractQuoteSequence(quote?.quoteNumber);
        if (Number.isInteger(sequence)) {
          highest = highest === null ? sequence : Math.max(highest, sequence);
        }
      } catch {
        continue;
      }
    }
  }

  return highest;
}

async function allocateNextQuoteNumber(quoteDate) {
  return withQuoteSequenceLock(async () => {
    const storedSequence = await readStoredSequenceState();
    const scannedSequence = await scanHighestExistingSequence();
    const highestKnown = Math.max(
      sequenceFloor(),
      Number.isInteger(storedSequence) ? storedSequence : 0,
      Number.isInteger(scannedSequence) ? scannedSequence : 0
    );
    const nextSequence = highestKnown + 1;

    await fs.writeFile(
      quoteSequenceStatePath,
      JSON.stringify({ lastSequence: nextSequence, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );

    return formatQuoteNumber(quoteDate, nextSequence);
  });
}

async function enrichQuoteMetadata(record) {
  const quoteDate = toDate(record.quoteDate || record.createdAt || record.updatedAt);
  const quoteNumber = record.quoteNumber || await allocateNextQuoteNumber(quoteDate);

  return {
    ...record,
    quoteDate: quoteDate.toISOString(),
    expiryDate: record.expiryDate || addDays(quoteDate, 14).toISOString(),
    quoteNumber
  };
}

export async function saveQuote(quote) {
  const scopeKey = sanitizeScopeKey(quote.scopeKey);
  await ensureQuotesDirectory(scopeKey);

  const quoteId = quote.id || `quote-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const baseRecord = {
    ...quote,
    id: quoteId,
    scopeKey,
    quoteStatus: quote.quoteStatus || 'OPEN',
    updatedAt: new Date().toISOString()
  };

  if (!baseRecord.createdAt) {
    baseRecord.createdAt = baseRecord.updatedAt;
  }

  const record = await enrichQuoteMetadata(baseRecord);

  const content = JSON.stringify(record, null, 2);
  await fs.writeFile(getQuotePath(scopeKey, quoteId), content, 'utf8');
  // Persist to R2 so quotes survive Render re-deploys
  await backupQuoteToR2(scopeKey, quoteId, content);
  return record;
}

export async function loadQuote(quoteId, scopeKey) {
  try {
    const content = await fs.readFile(getQuotePath(scopeKey, quoteId), 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      // Local file missing — try restoring from R2 (e.g. after a Render re-deploy)
      const r2Content = await fetchQuoteFromR2(sanitizeScopeKey(scopeKey), quoteId);
      if (r2Content) {
        await ensureQuotesDirectory(scopeKey);
        await fs.writeFile(getQuotePath(scopeKey, quoteId), r2Content, 'utf8');
        return JSON.parse(r2Content);
      }
      throw createNotFoundError('Quote not found. It may have been removed.');
    }
    throw error;
  }
}

export async function listQuotes(scopeKey) {
  const quotesDirectory = getQuotesDirectory(scopeKey);
  await ensureQuotesDirectory(scopeKey);

  const files = await fs.readdir(quotesDirectory);
  const quotes = [];

  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    let quote = null;
    try {
      quote = JSON.parse(await fs.readFile(path.join(quotesDirectory, fileName), 'utf8'));
    } catch {
      continue;
    }

    if (!quote || !quote.id) {
      continue;
    }

    quotes.push({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      quoteDate: quote.quoteDate || quote.createdAt,
      expiryDate: quote.expiryDate || null,
      clientName: quote.clientName,
      vesselName: quote.vesselName,
      port: quote.port,
      imoNumber: quote.imoNumber || '',
      scheduledArrival: quote.scheduledArrival || '',
      contactEmail: quote.contactEmail || '',
      agentName: quote.agentName || '',
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
      quoteStatus: quote.quoteStatus || 'OPEN',
      closedAt: quote.closedAt || null,
      summary: quote.summary
    });
  }

  return quotes.sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
}

// =====================
// LIST ALL QUOTES — admin only
// Scans every scope directory and returns all quotes tagged with their clientId.
// Quotes in directories that don't match any known client ID are "orphaned".
// =====================
export async function listAllQuotes() {
  await fs.mkdir(quotesRootDirectory, { recursive: true });

  let entries;
  try {
    entries = await fs.readdir(quotesRootDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const all = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const clientId = entry.name; // folder name = client UUID (or legacy browser scope)
    const dir = path.join(quotesRootDirectory, clientId);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const fileName of files.filter(f => f.endsWith('.json'))) {
      let quote = null;
      try {
        quote = JSON.parse(await fs.readFile(path.join(dir, fileName), 'utf8'));
      } catch {
        continue;
      }
      if (!quote || !quote.id) continue;

      all.push({
        clientId,
        id: quote.id,
        quoteNumber: quote.quoteNumber,
        quoteDate: quote.quoteDate || quote.createdAt,
        expiryDate: quote.expiryDate || null,
        clientName: quote.clientName,
        vesselName: quote.vesselName,
        port: quote.port,
        imoNumber: quote.imoNumber || '',
        scheduledArrival: quote.scheduledArrival || '',
        contactEmail: quote.contactEmail || '',
        agentName: quote.agentName || '',
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt,
        quoteStatus: quote.quoteStatus || 'OPEN',
        summary: quote.summary
      });
    }
  }

  return all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}