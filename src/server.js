import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import multer from 'multer';
import cookieParser from 'cookie-parser';

import authRouter, { requireAuth, requireAdmin, meHandler } from './auth/authRoutes.js';
import { initClientStore, seedAdminIfNeeded, listAllClients, blockClient, unblockClient, deleteClient } from './auth/userStore.js';

import { getR2File } from './r2GetFile.js';
import { uploadToR2 } from './r2Upload.js';

import { buildExcelBuffer, buildPdfBuffer } from './exporters.js';
import { loadPriceList, parseRequisitionFile } from './parser.js';
import { applyManualSelection, createMatchingEngine, prepareCatalog, summarizeQuote } from './matcher.js';
import { loadQuoteInsights } from './quoteInsights.js';
import { listQuotes, loadQuote, saveQuote, listAllQuotes, restoreAllQuotesFromR2, deleteQuote } from './quoteStore.js';
import { loadMatchingPolicy, saveMatchingPolicy } from './matchingPolicyStore.js';

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
// Trust the first proxy (required on Render, Railway, Heroku, etc.)
// so express-rate-limit can read the real client IP from X-Forwarded-For
app.set('trust proxy', 1);
const upload = multer({ dest: uploadsDirectory });

// =====================
// MIDDLEWARE
// =====================
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Auth routes (public — no JWT required)
app.use('/api/auth', authRouter);

// JWT guard — all other /api/* routes require authentication
app.use('/api', requireAuth);

// WHO AM I — returns logged-in client info (role included)
app.get('/api/auth/me', requireAuth, meHandler);

// Guard the main app page — admin gets redirected to admin panel
app.get(['/', '/index.html'], requireAuth, (req, res) => {
  if (req.client.role === 'admin') {
    return res.redirect('/admin.html');
  }
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

// Guard admin panel — regular clients are redirected back to /
app.get('/admin.html', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'admin.html'));
});

app.use(express.static(path.join(projectRoot, 'public')));
app.use('/examples', express.static(path.join(projectRoot, 'data')));

// ensure uploads folder exists
await fs.mkdir(uploadsDirectory, { recursive: true });

// =====================
// LOAD DATA / STATE
// =====================
async function resolvePriceListPath() {
  const fallbackPaths = [
    process.env.PRICE_LIST_FILE ? path.resolve(projectRoot, process.env.PRICE_LIST_FILE) : '',
    path.join(projectRoot, 'data', 'ATH PRICE LIST - MAIN.xlsx'),
    path.join(projectRoot, 'data', 'ATH PRODUCT LIST - MAIN.xlsx')
  ];

  for (const candidate of fallbackPaths) {
    if (!candidate) {
      continue;
    }

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('No price list file found. Expected PRICE_LIST_FILE or a workbook in data/.');
}

const priceListPath = await resolvePriceListPath();
const rawPriceList = await loadPriceList(priceListPath);

const catalog = prepareCatalog(rawPriceList);
let matchingPolicy = await loadMatchingPolicy();

function createMatcherFromPolicy() {
  return createMatchingEngine(catalog, [], {
    fuzzyThreshold: Number(process.env.FUZZY_MATCH_THRESHOLD || 0.7),
    minAutoMatchConfidence: matchingPolicy.minAutoMatchConfidence,
    enableBusinessRules: matchingPolicy.enableBusinessRules
  });
}

let matcher = createMatcherFromPolicy();

let quoteInsights = await loadQuoteInsights(catalog);

const catalogByKey = new Map();
const catalogByName = new Map();
for (const product of catalog) {
  const key = String(product.catalogKey || '').trim();
  const name = String(product.productName || '').trim();
  if (key) {
    catalogByKey.set(key, product);
  }
  if (name) {
    catalogByName.set(name, product);
  }
}

function resolveCatalogProduct(item = {}) {
  const matchedKey = String(item.matchedProductKey || '').trim();
  if (matchedKey && catalogByKey.has(matchedKey)) {
    return catalogByKey.get(matchedKey);
  }

  const matchedName = String(item.matchedProduct || item.matchedProductDisplay || '').trim();
  if (matchedName && catalogByName.has(matchedName)) {
    return catalogByName.get(matchedName);
  }

  return null;
}

function deriveSupplierUnitLabel(value) {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }

  const match = text.match(/\b(box|bag|carton|case|tray|pack|packet|bottle|roll|tin|jar|bunch|kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|piece|pieces|ea|each|unit|units)\b/i);
  if (match) {
    return match[1];
  }

  const firstToken = text.replace(/[^a-z0-9\/\s]/gi, ' ').replace(/\s+/g, ' ').trim().split(' ')[0];
  return firstToken || '';
}

function hydrateQuoteItems(items = []) {
  return items.map((item) => {
    const product = resolveCatalogProduct(item);
    const supplierUnit = String(
      product?.supplierUnit
      || item?.supplierUnit
      || deriveSupplierUnitLabel(product?.unit)
      || deriveSupplierUnitLabel(item?.unit)
      || ''
    ).trim();
    const matchedProductName = String(product?.productName || item?.matchedProduct || '').trim();

    return {
      ...item,
      supplierUnit,
      matchedProduct: matchedProductName,
      matchedProductDisplay: matchedProductName
    };
  });
}

function getQuoteScopeKey(req) {
  // Use the authenticated client's ID as the scope key.
  // This ensures each client only ever accesses their own quotes.
  return req.client?.id || '';
}

// =====================
// HELPERS
// =====================
function parseWholeBudgetValue(value) {
  const raw = String(value ?? '');
  const integerPart = raw.split(/[.,]/)[0].replace(/[^\d]/g, '');
  const parsed = Number(integerPart);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildResponse(quote) {
  const hydratedItems = hydrateQuoteItems(Array.isArray(quote.items) ? quote.items : []);
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
    budget: quote.budget ?? null,
    budgetCurrency: quote.budgetCurrency || 'GBP',
    items: hydratedItems,
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
    const quotes = await listQuotes(getQuoteScopeKey(req));
    res.json({ quotes });
  } catch (err) {
    next(err);
  }
});

// LOAD QUOTE
app.get('/api/quotes/:id', async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id, getQuoteScopeKey(req));
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

    const hydratedItems = hydrateQuoteItems(matchedItems);
    const summary = summarizeQuote(hydratedItems);

    // Save draft locally only — no R2 upload at this stage
    const budgetValue = parseWholeBudgetValue(req.body.budget);
    const hasBudget = budgetValue !== null;

    const quote = await saveQuote({
      scopeKey: getQuoteScopeKey(req),
      clientName: req.body.clientName || '',
      vesselName: req.body.vesselName || '',
      imoNumber: req.body.imoNumber || '',
      port: req.body.port || '',
      scheduledArrival: req.body.scheduledArrival || '',
      contactEmail: req.body.contactEmail || '',
      agentName: req.body.agentName || '',
      budget: hasBudget ? budgetValue : null,
      budgetCurrency: hasBudget ? (req.body.budgetCurrency || 'GBP').toUpperCase() : 'GBP',
      originalFileName: req.file.originalname,
      items: hydratedItems,
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
    const scopeKey = getQuoteScopeKey(req);
    const existing = await loadQuote(req.params.id, scopeKey);
    const incomingItems = Array.isArray(req.body.items) ? req.body.items : existing.items;
    const hydratedItems = hydrateQuoteItems(incomingItems);
    const summary = summarizeQuote(hydratedItems);

    const incomingBudget = parseWholeBudgetValue(req.body.budget ?? existing.budget ?? '');
    const hasBudget = incomingBudget !== null;

    const updated = await saveQuote({
      ...existing,
      scopeKey,
      items: hydratedItems,
      budget: hasBudget ? incomingBudget : null,
      budgetCurrency: hasBudget ? (req.body.budgetCurrency || existing.budgetCurrency || 'GBP').toUpperCase() : 'GBP',
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
    const quote = await loadQuote(req.params.id, getQuoteScopeKey(req));
    const hydratedQuote = {
      ...quote,
      items: hydrateQuoteItems(Array.isArray(quote.items) ? quote.items : [])
    };

    // Generate a single buffer — this is the canonical final version
    const buffer = Buffer.from(await buildExcelBuffer(hydratedQuote));

    // Upload the exact same bytes to R2
    if (hydratedQuote.quoteNumber) {
      await uploadToR2(
        `${hydratedQuote.quoteNumber}.xlsx`,
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
      `attachment; filename="${hydratedQuote.quoteNumber || hydratedQuote.id}.xlsx"`
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
    const quote = await loadQuote(req.params.id, getQuoteScopeKey(req));
    const hydratedQuote = {
      ...quote,
      items: hydrateQuoteItems(Array.isArray(quote.items) ? quote.items : [])
    };

    // Generate a single buffer — this is the canonical final version
    const buffer = await buildPdfBuffer(hydratedQuote);

    // Upload the exact same bytes to R2
    if (hydratedQuote.quoteNumber) {
      await uploadToR2(
        `${hydratedQuote.quoteNumber}.pdf`,
        buffer,
        'application/pdf'
      );
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${hydratedQuote.quoteNumber || hydratedQuote.id}.pdf"`
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
// ADMIN ROUTES — admin role only
// =====================

// GET /api/admin/quotes — all quotes across all clients, grouped by client
app.get('/api/admin/quotes', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [allQuotes, allClients] = await Promise.all([listAllQuotes(), listAllClients()]);

    // Build a lookup map: clientId -> client record
    const clientMap = {};
    for (const c of allClients) {
      clientMap[c.id] = c;
    }

    // Tag each quote with client display info
    // Quotes whose clientId doesn't match any known user are "orphaned"
    const tagged = allQuotes.map(q => ({
      ...q,
      clientDisplayName: clientMap[q.clientId]?.fullName || null,
      clientEmail: clientMap[q.clientId]?.email || null,
      isOrphaned: !clientMap[q.clientId]
    }));

    res.json({ quotes: tagged, clients: allClients });
  } catch (err) {
    next(err);
  }
});

// ADMIN — LIST CLIENTS
app.get('/api/admin/clients', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json({ clients: await listAllClients() });
  } catch (err) { next(err); }
});

// ADMIN — BLOCK CLIENT
app.post('/api/admin/clients/:id/block', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await blockClient(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN — UNBLOCK CLIENT
app.post('/api/admin/clients/:id/unblock', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await unblockClient(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN — DELETE CLIENT
app.delete('/api/admin/clients/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await deleteClient(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ADMIN EXPORT XLSX — load by clientId (scopeKey) + quoteId
app.get('/api/admin/quotes/:clientId/:id/export.xlsx', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id, req.params.clientId);
    const buffer = Buffer.from(await buildExcelBuffer(quote));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNumber || quote.id}.xlsx"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// ADMIN EXPORT PDF — load by clientId (scopeKey) + quoteId
app.get('/api/admin/quotes/:clientId/:id/export.pdf', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const quote = await loadQuote(req.params.id, req.params.clientId);
    const buffer = await buildPdfBuffer(quote);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quote.quoteNumber || quote.id}.pdf"`);
    res.send(buffer);
  } catch (err) { next(err); }
});

// ADMIN DELETE QUOTE — enables orphaned quote cleanup from admin panel.
app.delete('/api/admin/quotes/:clientId/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await deleteQuote(req.params.clientId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
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

app.listen(port, async () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Price list: ${priceListPath}`);
  // Restore clients.json from R2 if missing (fresh Render deploy)
  await initClientStore().catch(err => console.error('[auth] Client store init error:', err.message));
  // Restore all quote files from R2 if missing (fresh Render deploy)
  await restoreAllQuotesFromR2().catch(err => console.error('[quotes] R2 restore error:', err.message));
  // Seed admin account on first boot — safe no-op on subsequent starts
  await seedAdminIfNeeded().catch(err => console.error('[auth] Admin seed error:', err.message));
});

// ADMIN — MATCHING POLICY (admin-only controls, never exposed to client panel)
app.get('/api/admin/matching-policy', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    res.json({ policy: matchingPolicy });
  } catch (err) {
    next(err);
  }
});

app.put('/api/admin/matching-policy', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const nextPolicy = {
      enableBusinessRules: req.body?.enableBusinessRules,
      minAutoMatchConfidence: req.body?.minAutoMatchConfidence
    };

    matchingPolicy = await saveMatchingPolicy(nextPolicy);
    matcher = createMatcherFromPolicy();

    res.json({ ok: true, policy: matchingPolicy });
  } catch (err) {
    next(err);
  }
});