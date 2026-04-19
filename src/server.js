import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildExcelBuffer, buildPdfBuffer } from './exporters.js';
import { loadPriceList, parseRequisitionFile } from './parser.js';
import { applyManualSelection, createMatchingEngine, prepareCatalog, summarizeQuote } from './matcher.js';
import { loadQuoteInsights } from './quoteInsights.js';
import { listQuotes, loadQuote, saveQuote } from './quoteStore.js';
import { listR2QuoteFiles } from './r2ListFiles.js';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uploadsDirectory = path.join(projectRoot, 'uploads');

await fs.mkdir(uploadsDirectory, { recursive: true });

/* ================= R2 CONFIG ================= */

const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/* ================= LOAD DATA ================= */

const priceListPath = path.join(projectRoot, 'data', 'new price list.xlsx');
const rawPriceList = await loadPriceList(priceListPath);
const catalog = prepareCatalog(rawPriceList);
const matcher = createMatchingEngine(catalog);
let quoteInsights = await loadQuoteInsights(catalog);

/* ================= EXPRESS ================= */

const app = express();
const upload = multer({ dest: uploadsDirectory });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(projectRoot, 'public')));

/* ================= HEALTH ================= */

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

/* ================= PROCESS QUOTE ================= */

app.post('/api/quotes/process', upload.single('file'), async (req, res) => {
  try {
    const items = await parseRequisitionFile(req.file.path);
    const matched = items.map(i => matcher.matchItem(i));
    const summary = summarizeQuote(matched);

    const quote = await saveQuote({
      items: matched,
      summary
    });

    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= FINAL EXPORT (FIXED) ================= */

app.post('/api/quotes/export-final', async (req, res) => {
  try {
    const { quoteData, fileType, quoteNumber } = req.body;

    if (!quoteData || !fileType || !quoteNumber) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const quote = typeof quoteData === 'string'
      ? JSON.parse(quoteData)
      : quoteData;

    quote.quoteNumber = quoteNumber;

    let buffer;
    let contentType;

    if (fileType === 'pdf') {
      buffer = await buildPdfBuffer(quote);
      contentType = 'application/pdf';
    } else {
      buffer = await buildExcelBuffer(quote);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${quoteNumber}.${fileType}"`);
    res.send(Buffer.from(buffer));

  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

/* ================= NEXT QUOTE NUMBER ================= */

function extractSeq(key) {
  const m = key.match(/ATH(\d{2})-M(\d{5})/);
  return m ? parseInt(m[2]) : 0;
}

app.get('/api/quotes/next-number', async (req, res) => {
  try {
    const year = String(new Date().getFullYear()).slice(-2);
    const files = await listR2QuoteFiles();

    let max = 0;
    for (const f of files) {
      const seq = extractSeq(f);
      if (seq > max) max = seq;
    }

    const next = max + 1;
    const quoteNumber = `ATH${year}-M${String(next).padStart(5, '0')}`;

    res.json({ quoteNumber });

  } catch {
    res.status(500).json({ error: 'Failed to get quote number' });
  }
});

/* ================= R2 UPLOAD ================= */

app.post('/api/quotes/upload-final', async (req, res) => {
  const formidable = (await import('formidable')).default;
  const form = formidable();

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Parse error' });

    try {
      const file = files.file;
      const { quoteNumber, fileType } = fields;

      const buffer = await fs.readFile(file.filepath);

      await r2Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: `${quoteNumber}.${fileType}`,
        Body: buffer
      }));

      res.json({ ok: true });

    } catch {
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

/* ================= HISTORY ================= */

app.get('/api/quotes/history', async (req, res) => {
  const quotes = await listQuotes();
  res.json({ quotes });
});

/* ================= ERROR HANDLER ================= */

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

/* ================= START ================= */

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});
