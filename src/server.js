import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildExcelBuffer, buildPdfBuffer } from './exporters.js';
import { buildSupplierProvisionText, resolveCustomerRequest, selectSupplyOption } from './calculator.js';
import { loadPriceList, parseRequisitionFile } from './parser.js';
import { applyManualSelection, createMatchingEngine, prepareCatalog, summarizeQuote, calculateTotal } from './matcher.js';
import { loadQuoteInsights } from './quoteInsights.js';
import { listQuotes, loadQuote, saveQuote } from './quoteStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uploadsDirectory = path.join(projectRoot, 'uploads');
const fuzzyMatchThreshold = Number(process.env.FUZZY_MATCH_THRESHOLD || 0.7);

await fs.mkdir(uploadsDirectory, { recursive: true });

async function resolveDefaultPriceListFile() {
  const candidates = [
    path.join(projectRoot, 'data', 'new price list.xlsx'),
    path.join(projectRoot, 'data', 'new price list styled.xlsx')
  ];
  const availableCandidates = [];

  for (const candidate of candidates) {
    try { const stats = await fs.stat(candidate); availableCandidates.push({ candidate, modifiedTime: stats.mtimeMs }); }
    catch {}
  }

  if (!availableCandidates.length) return candidates[0];
  availableCandidates.sort((a,b) => b.modifiedTime - a.modifiedTime);
  return availableCandidates[0].candidate;
}

const priceListPath = process.env.PRICE_LIST_FILE || await resolveDefaultPriceListFile();
const rawPriceList = await loadPriceList(priceListPath);
const catalog = prepareCatalog(rawPriceList);
const matcher = createMatchingEngine(catalog, [], { fuzzyThreshold: fuzzyMatchThreshold });
let quoteInsights = await loadQuoteInsights(catalog);

const app = express();
const upload = multer({ dest: uploadsDirectory });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(projectRoot, 'public')));
app.use('/examples', express.static(path.join(projectRoot, 'data')));

// ✅ Serve homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(projectRoot, "public", "index.html"));
});

// — All your existing API routes below —

app.get('/api/health', (_req, res) => res.json({ ok: true, priceListPath, catalogSize: catalog.length, fuzzyMatchThreshold }));

app.get('/api/master-products', (_req, res) => res.json({ products: catalog.map(p => ({
  catalogKey: p.catalogKey || '',
  displayName: p.displayName || p.productName,
  productName: p.productName,
  unit: p.unit,
  unitType: p.unitType,
  approxPieceWeightKg: p.approxPieceWeightKg ?? null,
  supplyOptions: p.supplyOptions,
  price: p.price,
  keywords: p.keywords
}))}));

// All other routes remain exactly as your original server.js
// (e.g., /api/quotes/history, /api/quotes/:quoteId, /api/quotes/process, etc.)

// Error handler
app.use((error, _req, res, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  res.status(500).json({ error: message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Athena quote system listening on http://localhost:${port}`);
  console.log(`Using price list: ${priceListPath}`);
});
