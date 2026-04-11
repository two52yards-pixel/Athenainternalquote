// Load a single quote by ID
export async function loadQuote(quoteId) {
  await ensureQuotesDirectory();
  const filePath = getQuotePath(quoteId);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    // If not found, return null
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
// Google Drive integration
import { uploadToR2 } from './r2Upload.js';
import { buildExcelBuffer } from './exporters.js';
import { listR2QuoteFiles } from './r2ListFiles.js';
import { getR2File } from './r2GetFile.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const quotesDirectory = path.resolve(process.cwd(), 'logs', 'quotes');

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

async function ensureQuotesDirectory() {
  await fs.mkdir(quotesDirectory, { recursive: true });
}

function getQuotePath(quoteId) {
  return path.join(quotesDirectory, `${quoteId}.json`);
}

async function getNextMonthlyQuoteSequence(targetDate, currentQuoteId) {
  await ensureQuotesDirectory();
  const files = await fs.readdir(quotesDirectory);
  let maxSequence = 0;

  // Helper to extract sequence from quote number
  function extractSequence(quoteNumber, year, month) {
    // Example: ATH26 - 400015
    const regex = new RegExp(`ATH${year} - ${month}(\\d{5})`);
    const match = quoteNumber && quoteNumber.match(regex);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null;
  }

  const year = String(targetDate.getFullYear()).slice(-2);
  const month = String(targetDate.getMonth() + 1);

  // Check local files (.json and .xlsx)
  for (const fileName of files) {
    if (fileName.endsWith('.json')) {
      try {
        const existingQuote = JSON.parse(await fs.readFile(path.join(quotesDirectory, fileName), 'utf8'));
        if (existingQuote.id === currentQuoteId) {
          continue;
        }
        const seq = extractSequence(existingQuote.quoteNumber, year, month);
        if (seq && seq > maxSequence) {
          maxSequence = seq;
        }
      } catch {}
    } else if (fileName.endsWith('.xlsx')) {
      // Use filename (remove extension)
      const baseName = fileName.replace(/\.xlsx$/, '');
      const seq = extractSequence(baseName, year, month);
      if (seq && seq > maxSequence) {
        maxSequence = seq;
      }
    }
  }

  // Check R2 files for the highest sequence (.json and .xlsx)
  try {
    const r2Files = await listR2QuoteFiles();
    for (const file of r2Files) {
      if (file.endsWith('.json')) {
        try {
          const fileContent = await getR2File(file);
          const fileJson = JSON.parse(fileContent);
          const seq = extractSequence(fileJson.quoteNumber, year, month);
          if (seq && seq > maxSequence) {
            maxSequence = seq;
          }
        } catch {}
      } else if (file.endsWith('.xlsx')) {
        const baseName = file.replace(/\.xlsx$/, '');
        const seq = extractSequence(baseName, year, month);
        if (seq && seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }
  } catch {}

  return maxSequence + 1;
}

async function enrichQuoteMetadata(record) {
  const quoteDate = toDate(record.quoteDate || record.createdAt || record.updatedAt);
  const monthlySequence = record.quoteNumber
    ? null
    : await getNextMonthlyQuoteSequence(quoteDate, record.id);

  return {
    ...record,
    quoteDate: quoteDate.toISOString(),
    expiryDate: record.expiryDate || addDays(quoteDate, 14).toISOString(),
    quoteNumber: record.quoteNumber || formatQuoteNumber(quoteDate, monthlySequence)
  };
}


export async function saveQuote(quote) {
  await ensureQuotesDirectory();

  const quoteId = quote.id || `quote-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const baseRecord = {
    ...quote,
    id: quoteId,
    quoteStatus: quote.quoteStatus || 'OPEN',
    updatedAt: new Date().toISOString()
  };

  if (!baseRecord.createdAt) {
    baseRecord.createdAt = baseRecord.updatedAt;
  }

  // Ensure unique quote number (check both local and R2 for conflicts)
  let record = await enrichQuoteMetadata(baseRecord);
  let quoteNumber = record.quoteNumber;
  let quoteNumberSet = new Set();


  // Collect all quote numbers from local files (.json and .xlsx)
  const localFiles = await fs.readdir(quotesDirectory);
  for (const fileName of localFiles) {
    // Check .json for quoteNumber inside, .xlsx by filename
    if (fileName.endsWith('.json')) {
      try {
        const fileContent = await fs.readFile(path.join(quotesDirectory, fileName), 'utf8');
        const fileJson = JSON.parse(fileContent);
        if (fileJson.quoteNumber) {
          quoteNumberSet.add(fileJson.quoteNumber);
        }
      } catch {}
    } else if (fileName.endsWith('.xlsx')) {
      // Use filename (remove extension)
      const baseName = fileName.replace(/\.xlsx$/, '');
      quoteNumberSet.add(baseName);
    }
  }

  // Collect all quote numbers from R2 files (.json and .xlsx)
  try {
    let r2Files = await listR2QuoteFiles();
    for (const file of r2Files) {
      if (file.endsWith('.json')) {
        try {
          const fileContent = await getR2File(file);
          const fileJson = JSON.parse(fileContent);
          if (fileJson.quoteNumber) {
            quoteNumberSet.add(fileJson.quoteNumber);
          }
        } catch {}
      } else if (file.endsWith('.xlsx')) {
        // Use filename (remove extension)
        const baseName = file.replace(/\.xlsx$/, '');
        quoteNumberSet.add(baseName);
      }
    }
  } catch {}

  let seq = 1;
  const origQuoteNumber = quoteNumber;
  while (quoteNumberSet.has(quoteNumber)) {
    // If conflict, append -1, -2, etc. to quote number
    quoteNumber = `${origQuoteNumber}-${seq}`;
    seq++;
  }
  if (quoteNumber !== record.quoteNumber) {
    record.quoteNumber = quoteNumber;
  }

  // Save locally (for app logic)
  try {
    await fs.writeFile(getQuotePath(quoteId), JSON.stringify(record, null, 2), 'utf8');
  } catch (err) {
    // Ignore if not writeable (e.g., on Render)
  }

  // Only generate and upload Excel file for this quote
  try {
    const excelBuffer = await buildExcelBuffer(record);
    const excelFilename = `${record.quoteNumber}.xlsx`;
    await uploadToR2(excelFilename, excelBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  } catch (err) {
    console.error('Failed to upload quote Excel to Cloudflare R2:', err.message);
  }

  return record;
}

export async function listQuotes() {
  await ensureQuotesDirectory();

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
