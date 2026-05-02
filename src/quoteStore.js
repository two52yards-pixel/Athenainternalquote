import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const quotesRootDirectory = path.resolve(process.cwd(), 'logs', 'quotes');

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

function isSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function formatQuoteNumber(date, monthlySequence) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1);
  const sequence = String(monthlySequence).padStart(5, '0');
  return `ATH${year} - ${month}${sequence}`;
}

async function ensureQuotesDirectory(scopeKey) {
  await fs.mkdir(getQuotesDirectory(scopeKey), { recursive: true });
}

function getQuotePath(scopeKey, quoteId) {
  return path.join(getQuotesDirectory(scopeKey), `${quoteId}.json`);
}

async function getNextMonthlyQuoteSequence(scopeKey, targetDate, currentQuoteId) {
  const quotesDirectory = getQuotesDirectory(scopeKey);
  await ensureQuotesDirectory(scopeKey);
  const files = await fs.readdir(quotesDirectory);
  let count = 0;

  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    const existingQuote = JSON.parse(await fs.readFile(path.join(quotesDirectory, fileName), 'utf8'));

    if (existingQuote.id === currentQuoteId) {
      continue;
    }

    const existingDate = toDate(existingQuote.quoteDate || existingQuote.createdAt || existingQuote.updatedAt);
    if (isSameMonth(existingDate, targetDate)) {
      count += 1;
    }
  }

  return count + 1;
}

async function enrichQuoteMetadata(record) {
  const quoteDate = toDate(record.quoteDate || record.createdAt || record.updatedAt);
  const monthlySequence = record.quoteNumber
    ? null
    : await getNextMonthlyQuoteSequence(record.scopeKey, quoteDate, record.id);

  return {
    ...record,
    quoteDate: quoteDate.toISOString(),
    expiryDate: record.expiryDate || addDays(quoteDate, 14).toISOString(),
    quoteNumber: record.quoteNumber || formatQuoteNumber(quoteDate, monthlySequence)
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

  await fs.writeFile(getQuotePath(scopeKey, quoteId), JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export async function loadQuote(quoteId, scopeKey) {
  const content = await fs.readFile(getQuotePath(scopeKey, quoteId), 'utf8');
  return JSON.parse(content);
}

export async function listQuotes(scopeKey) {
  const quotesDirectory = getQuotesDirectory(scopeKey);
  await ensureQuotesDirectory(scopeKey);

  const files = await fs.readdir(quotesDirectory);
  const quotes = [];

  for (const fileName of files.filter((file) => file.endsWith('.json'))) {
    const quote = JSON.parse(await fs.readFile(path.join(quotesDirectory, fileName), 'utf8'));
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