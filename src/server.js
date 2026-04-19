import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import multer from 'multer';

import { getR2File } from './r2GetFile.js';
import { uploadToR2 } from './r2Upload.js';

import { buildExcelBuffer, buildPdfBuffer } from './exporters.js';
import { loadPriceList, parseRequisitionFile } from './parser.js';
import { applyManualSelection, createMatchingEngine, prepareCatalog, summarizeQuote } from './matcher.js';
import { loadQuoteInsights } from './quoteInsights.js';
import { listQuotes, loadQuote, saveQuote } from './quoteStore.js';

// =====================
// PATH SETUP
// =====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uploadsDirectory = path.join(projectRoot, 'uploads');

// =====================
// INIT APP (MUST BE FIRST)
// =====================
const app = express();
const upload = multer({ dest: uploadsDirectory });

// =====================
// MIDDLEWARE
// =====================
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(projectRoot, 'public')));
app.use('/examples', express.static(path.join(projectRoot, 'data')));

// ensure uploads folder exists
await fs.mkdir(uploadsDirectory, { recursive: true });

// =====================
// LOAD DATA / STATE
// =====================
const priceListPath = process.env.PRICE_LIST_FILE || path.join(projectRoot, 'data', 'new price list.xlsx');
const rawPriceList = await loadPriceList(priceListPath);

const catalog = prepareCatalog(rawPriceList);
const matcher = createMatchingEngine(catalog, [], {
  fuzzyThreshold: Number(process.env.FUZZY_MATCH_THRESHOLD || 0.7)
});

let quoteInsights = await loadQuoteInsights(catalog);

// =====================
// HELPERS
// =====================
function buildResponse(quote) {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    quoteDate: quote.quoteDate,
    expiryDate: quote.expiryDate,
    clientName: quote.clientName,
    vesselName: quote.vesselName,
    imoNumber: quote.imoNumber,
    port: quote.port,
    scheduledArrival: quote.scheduledArrival,
    contactEmail: quote.contactEmail,
    agentName: quote.agentName,
    items: quote.items,
    summary: quote.summary,
    quoteStatus: quote.quoteStatus,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt
  };
}

// =====================
// ROUTES
// =====================

// HEALTH
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// MASTER PRODUCTS
app.get('/api/master-products', (req, res) => {
  res.json({ products: catalog });
});

// QUOTE HISTORY
app.get('/api/quotes/history', async (req, res, next) => {
  try {
    const quotes = await listQuotes();
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

// LOAD QUOTE
app.get('/api/quotes/:id', async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id);
    res.json(buildResponse(quote));
  } catch (err) {
    next(err);
  }
});

// PROCESS QUOTE
// Responsibility: parse file, run matching, save draft locally. NO R2 upload.
app.post('/api/quotes/process', upload.single('requisitionFile'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File required' });
    }

    const items = await parseRequisitionFile(req.file.path);

    const matchedItems = items.map(item =>
      matcher.matchItem ? matcher.matchItem(item) : item
    );

    const summary = summarizeQuote(matchedItems);

    // Save draft locally only — no R2 upload at this stage
    const quote = await saveQuote({
      clientName: req.body.clientName || '',
      vesselName: req.body.vesselName || '',
      imoNumber: req.body.imoNumber || '',
      port: req.body.port || '',
      scheduledArrival: req.body.scheduledArrival || '',
      contactEmail: req.body.contactEmail || '',
      agentName: req.body.agentName || '',
      originalFileName: req.file.originalname,
      items: matchedItems,
      summary
    });

    quoteInsights = await loadQuoteInsights(catalog);

    res.json(buildResponse(quote));
  } catch (err) {
    next(err);
  }
});

// SAVE REVIEW (Draft save — local only, no R2 upload)
// Responsibility: persist user edits to the local quote store. Nothing else.
app.put('/api/quotes/:id', async (req, res, next) => {
  try {
    const existing = await loadQuote(req.params.id);
    const incomingItems = Array.isArray(req.body.items) ? req.body.items : existing.items;
    const summary = summarizeQuote(incomingItems);

    const updated = await saveQuote({
      ...existing,
      items: incomingItems,
      summary
    });

    quoteInsights = await loadQuoteInsights(catalog);

    res.json(buildResponse(updated));
  } catch (err) {
    next(err);
  }
});

// EXPORT XLSX
// Responsibility: finalise the current saved quote state, generate one buffer,
// send it to the client AND upload that exact same buffer to R2.
app.get('/api/quotes/:id/export.xlsx', async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id);

    // Generate a single buffer — this is the canonical final version
    const buffer = Buffer.from(await buildExcelBuffer(quote));

    // Upload the exact same bytes to R2
    if (quote.quoteNumber) {
      await uploadToR2(
        `${quote.quoteNumber}.xlsx`,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${quote.quoteNumber || quote.id}.xlsx"`
    );

    // Send the same buffer to the client
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// EXPORT PDF
// Responsibility: finalise the current saved quote state, generate one buffer,
// send it to the client AND upload that exact same buffer to R2.
app.get('/api/quotes/:id/export.pdf', async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id);

    // Generate a single buffer — this is the canonical final version
    const buffer = await buildPdfBuffer(quote);

    // Upload the exact same bytes to R2
    if (quote.quoteNumber) {
      await uploadToR2(
        `${quote.quoteNumber}.pdf`,
        buffer,
        'application/pdf'
      );
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${quote.quoteNumber || quote.id}.pdf"`
    );

    // Send the same buffer to the client
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// R2 DOWNLOAD (for fetching previously uploaded files directly from R2)
app.get('/r2/:key.xlsx', async (req, res) => {
  try {
    const key = `${req.params.key}.xlsx`;
    const buffer = await getR2File(key);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${req.params.key}.xlsx"`
    );

    res.send(Buffer.from(buffer));
  } catch {
    res.status(404).send('File not found in R2 bucket.');
  }
});

// =====================
// ERROR HANDLER
// =====================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    error: err instanceof Error ? err.message : 'Server error'
  });
});

// =====================
// START SERVER
// =====================
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Price list: ${priceListPath}`);
});