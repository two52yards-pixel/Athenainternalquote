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
import { listR2QuoteFiles } from './r2ListFiles.js';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import formidable from "formidable";
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uploadsDirectory = path.join(projectRoot, 'uploads');
const fuzzyMatchThreshold = Number(process.env.FUZZY_MATCH_THRESHOLD || 0.7);

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

const r2Client = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function resolveDefaultPriceListFile() {
  const candidates = [
    path.join(projectRoot, 'data', 'new price list.xlsx'),
    path.join(projectRoot, 'data', 'new price list styled.xlsx')
  ];

  const availableCandidates = [];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate);
      availableCandidates.push({ candidate, modifiedTime: stats.mtimeMs });
    } catch {
      // Ignore missing candidate files and fall back to the ones that exist.
    }
  }

  if (!availableCandidates.length) {
    return candidates[0];
  }

  availableCandidates.sort((left, right) => right.modifiedTime - left.modifiedTime);
  return availableCandidates[0].candidate;
}

await fs.mkdir(uploadsDirectory, { recursive: true });

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

function serializeCatalogItem(product) {
  return {
    catalogKey: product.catalogKey || '',
    displayName: product.displayName || product.productName,
    productName: product.productName,
    unit: product.unit,
    unitType: product.unitType,
    approxPieceWeightKg: product.approxPieceWeightKg ?? null,
    supplyOptions: product.supplyOptions,
    price: product.price,
    keywords: product.keywords
  };
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function computeDeliveredQuantityForSupplyQuantity(item, supplyQuantity) {
  const numericSupplyQuantity = parsePositiveNumber(supplyQuantity);
  const recalculatedSupplyQuantity = parsePositiveNumber(item.supplyQuantity);
  const recalculatedDeliveredQuantity = Number(item.deliveredQuantity);

  if (!numericSupplyQuantity) {
    return null;
  }

  if (item.deliveredUnitType === 'pack') {
    return numericSupplyQuantity;
  }

  if (!recalculatedSupplyQuantity || !Number.isFinite(recalculatedDeliveredQuantity)) {
    return null;
  }

  const deliveredPerSupplierUnit = recalculatedDeliveredQuantity / recalculatedSupplyQuantity;
  return Number((numericSupplyQuantity * deliveredPerSupplierUnit).toFixed(3));
}

function buildUnavailableQuoteItem(sourceItem, normalizedItem = null) {
  const baseItem = normalizedItem || sourceItem;
  const quantity = sourceItem.quantity === '' || sourceItem.quantity === null || sourceItem.quantity === undefined
    ? null
    : Number(sourceItem.quantity);

  return {
    ...baseItem,
    lineNumber: sourceItem.lineNumber || baseItem.lineNumber,
    quantity: Number.isFinite(quantity) ? quantity : null,
    requestedUnit: sourceItem.requestedUnit || baseItem.requestedUnit || '',
    price: Number(sourceItem.price || baseItem.price || 0),
    supplyQuantity: 0,
    supplierQuantityOverride: null,
    deliveredQuantity: null,
    deliveredUnitType: '',
    total: 0,
    status: 'UNAVAILABLE',
    supplierProvision: 'Unavailable',
    isUnavailable: true,
    matchReason: 'marked unavailable'
  };
}

function calculateDeliveredQuantityFromSelection(item, product, supplyQuantity) {
  const request = resolveCustomerRequest(item);
  const selectedOption = selectSupplyOption(request, product);
  const numericSupplyQuantity = parsePositiveNumber(supplyQuantity);

  if (!selectedOption || !numericSupplyQuantity || !selectedOption.exactUnitMatch) {
    return {
      deliveredQuantity: null,
      deliveredUnitType: ''
    };
  }

  if (request.customerUnitType === 'pack') {
    return {
      deliveredQuantity: numericSupplyQuantity,
      deliveredUnitType: 'pack'
    };
  }

  if (Number(selectedOption.option.unitQuantity) <= 0) {
    return {
      deliveredQuantity: null,
      deliveredUnitType: ''
    };
  }

  return {
    deliveredQuantity: Number((numericSupplyQuantity * Number(selectedOption.option.unitQuantity)).toFixed(3)),
    deliveredUnitType: selectedOption.deliveredUnitType || selectedOption.option.unitType || ''
  };
}

function applyQuoteInsight(item, matchedItem) {
  const insight = quoteInsights.find(item);
  if (!insight) {
    return matchedItem;
  }

  let learnedItem = matchedItem;

  if (insight.matchedProductKey && insight.matchedProductKey !== matchedItem.matchedProductKey) {
    learnedItem = applyManualSelection(item, catalog, insight.matchedProductKey);
  }

  if (!learnedItem.matchedProductKey) {
    return learnedItem;
  }

  const shouldApplyQuantityCalibration = learnedItem.matchedProductKey === insight.matchedProductKey
    && Number.isFinite(Number(learnedItem.quantity))
    && Number(learnedItem.quantity) > 0
    && Number.isFinite(Number(insight.quantityRatio))
    && Number(insight.quantityRatio) > 0
    && (insight.hasSupplierQuantityOverride || learnedItem.status !== 'MATCHED');

  if (!shouldApplyQuantityCalibration && learnedItem === matchedItem) {
    return matchedItem;
  }

  const product = catalog.find((catalogItem) => (catalogItem.catalogKey || catalogItem.productName) === learnedItem.matchedProductKey);
  const reasonBits = [];
  const nextItem = {
    ...learnedItem,
    confidence: learnedItem.confidence === 'manual' ? 'manual' : 'learned'
  };

  if (learnedItem !== matchedItem) {
    reasonBits.push(`learned product match from ${insight.sourceQuoteId}`);
  }

  if (shouldApplyQuantityCalibration) {
    const learnedSupplyQuantity = Math.max(1, Math.ceil(Number(learnedItem.quantity) * Number(insight.quantityRatio)));
    const delivered = product
      ? calculateDeliveredQuantityFromSelection(learnedItem, product, learnedSupplyQuantity)
      : { deliveredQuantity: null, deliveredUnitType: '' };

    nextItem.supplyQuantity = learnedSupplyQuantity;
    nextItem.supplierQuantityOverride = learnedSupplyQuantity;
    nextItem.deliveredQuantity = delivered.deliveredQuantity;
    nextItem.deliveredUnitType = delivered.deliveredUnitType;
    nextItem.total = calculateTotal(learnedSupplyQuantity, Number(nextItem.price || 0));
    nextItem.supplierProvision = buildSupplierProvisionText({
      matchedProduct: nextItem.matchedProduct,
      supplyQuantity: learnedSupplyQuantity,
      unit: nextItem.unit,
      deliveredQuantity: delivered.deliveredQuantity,
      deliveredUnitType: delivered.deliveredUnitType
    });
    reasonBits.push(`learned quantity ratio from ${insight.sourceQuoteId}`);
  }

  if (insight.hasManualPriceOverride && Number.isFinite(insight.learnedPrice) && insight.learnedPrice > 0) {
    nextItem.price = insight.learnedPrice;
    nextItem.total = calculateTotal(Number(nextItem.supplyQuantity || 0), insight.learnedPrice);
    reasonBits.push(`learned price from ${insight.sourceQuoteId}`);
  }

  if (insight.hasManualUnitOverride && insight.learnedUnit) {
    nextItem.unit = insight.learnedUnit;
    nextItem.supplierProvision = buildSupplierProvisionText({
      matchedProduct: nextItem.matchedProduct,
      supplyQuantity: nextItem.supplyQuantity,
      unit: nextItem.unit,
      deliveredQuantity: nextItem.deliveredQuantity,
      deliveredUnitType: nextItem.deliveredUnitType
    });
  }

  if (reasonBits.length) {
    nextItem.matchReason = [nextItem.matchReason, ...reasonBits].filter(Boolean).join('; ');
  }

  return nextItem;
}

function mergeQuoteItemOverrides(sourceItem, recalculatedItem) {
  const recalculatedSupplyQuantity = parsePositiveNumber(recalculatedItem.supplyQuantity) || 1;
  const supplierQuantityOverride = parsePositiveNumber(sourceItem.supplierQuantityOverride);
  const effectiveSupplyQuantity = supplierQuantityOverride || recalculatedSupplyQuantity;
  const effectivePrice = Number(sourceItem.price || 0) > 0 ? Number(sourceItem.price) : Number(recalculatedItem.price || 0);
  const effectiveUnit = String(sourceItem.unit || '').trim() || recalculatedItem.unit || '';
  const effectiveDeliveredQuantity = supplierQuantityOverride
    ? computeDeliveredQuantityForSupplyQuantity(recalculatedItem, effectiveSupplyQuantity)
    : recalculatedItem.deliveredQuantity;
  const overrideReasons = [];

  if (supplierQuantityOverride) {
    overrideReasons.push('manual supplier quantity');
  }

  if (effectiveUnit && effectiveUnit !== recalculatedItem.unit) {
    overrideReasons.push('manual unit override');
  }

  if (effectivePrice !== Number(recalculatedItem.price || 0)) {
    overrideReasons.push('manual price override');
  }

  const overrideReasonText = overrideReasons.length ? overrideReasons.join('; ') : recalculatedItem.matchReason;

  return {
    ...recalculatedItem,
    unit: effectiveUnit,
    price: effectivePrice,
    supplyQuantity: effectiveSupplyQuantity,
    supplierQuantityOverride,
    deliveredQuantity: effectiveDeliveredQuantity,
    deliveredUnitType: recalculatedItem.deliveredUnitType,
    total: calculateTotal(effectiveSupplyQuantity, effectivePrice),
    supplierProvision: buildSupplierProvisionText({
      matchedProduct: recalculatedItem.matchedProduct,
      supplyQuantity: effectiveSupplyQuantity,
      unit: effectiveUnit,
      deliveredQuantity: effectiveDeliveredQuantity,
      deliveredUnitType: recalculatedItem.deliveredUnitType
    }),
    overrideReasonText
  };
}

function buildQuoteResponse(quote) {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    quoteDate: quote.quoteDate || quote.createdAt,
    expiryDate: quote.expiryDate || null,
    clientName: quote.clientName,
    vesselName: quote.vesselName,
    port: quote.port || '',
    imoNumber: quote.imoNumber || '',
    scheduledArrival: quote.scheduledArrival || '',
    contactEmail: quote.contactEmail || '',
    agentName: quote.agentName || '',
    originalFileName: quote.originalFileName,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
    quoteStatus: quote.quoteStatus || 'OPEN',
    closedAt: quote.closedAt || null,
    processingMs: quote.processingMs,
    items: quote.items,
    summary: quote.summary
  };
}

function normalizeQuoteItems(items = []) {
  return items.map((item, index) => {
    const quantity = item.quantity === '' || item.quantity === null || item.quantity === undefined
      ? null
      : Number(item.quantity);
    const safeQuantity = Number.isFinite(quantity) ? quantity : null;
    const selectedProductKey = String(item.matchedProductKey || item.matchedProduct || '').trim();

    if (!selectedProductKey) {
      if (item.isUnavailable) {
        return buildUnavailableQuoteItem(item);
      }

      return {
        ...item,
        lineNumber: index + 1,
        quantity: safeQuantity,
        supplyQuantity: Number(item.supplyQuantity || 1),
        supplierQuantityOverride: parsePositiveNumber(item.supplierQuantityOverride),
        deliveredQuantity: Number.isFinite(Number(item.deliveredQuantity)) ? Number(item.deliveredQuantity) : null,
        deliveredUnitType: item.deliveredUnitType || '',
        supplierProvision: item.supplierProvision || ''
      };
    }

    const recalculatedItem = applyManualSelection({
      ...item,
      lineNumber: index + 1,
      quantity: safeQuantity,
      requestedUnit: item.requestedUnit || ''
    }, catalog, selectedProductKey);

    if (item.isUnavailable) {
      return buildUnavailableQuoteItem(item, recalculatedItem);
    }

    const mergedItem = mergeQuoteItemOverrides(item, recalculatedItem);

    return {
      ...mergedItem,
      confidence: selectedProductKey ? 'manual' : recalculatedItem.confidence,
      matchReason: selectedProductKey
        ? mergedItem.overrideReasonText
        : recalculatedItem.matchReason
    };
  });
}

async function loadNormalizedQuote(quoteId) {
  const quote = await loadQuote(quoteId);
  const normalizedItems = normalizeQuoteItems(quote.items);
  const normalizedSummary = summarizeQuote(normalizedItems);
  const metadataNeedsUpdate = !quote.quoteNumber || !quote.quoteDate || !quote.expiryDate;

  const needsUpdate = JSON.stringify(quote.items) !== JSON.stringify(normalizedItems)
    || JSON.stringify(quote.summary) !== JSON.stringify(normalizedSummary)
    || metadataNeedsUpdate;

  if (!needsUpdate) {
    return quote;
  }

  return saveQuote({
    ...quote,
    items: normalizedItems,
    summary: normalizedSummary
  });
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, priceListPath, catalogSize: catalog.length, fuzzyMatchThreshold });
});

app.get('/api/master-products', (_request, response) => {
  response.json({ products: catalog.map(serializeCatalogItem) });
});

app.get('/api/quotes/history', async (_request, response, next) => {
  try {
    const quotes = await listQuotes();
    response.json({ quotes });
  } catch (error) {
    next(error);
  }
});

app.get('/api/quotes/:quoteId', async (request, response, next) => {
  try {
    const quote = await loadNormalizedQuote(request.params.quoteId);
    response.json(buildQuoteResponse(quote));
  } catch (error) {
    next(error);
  }
});

app.post('/api/quotes/process', upload.single('requisitionFile'), async (request, response, next) => {
  const startedAt = Date.now();

  try {
    if (!request.file) {
      response.status(400).json({ error: 'A requisition file is required.' });
      return;
    }

    const {
      clientName,
      vesselName,
      port,
      imoNumber,
      scheduledArrival,
      contactEmail,
      agentName
    } = request.body;

    if (!clientName || !vesselName || !imoNumber || !scheduledArrival || !contactEmail || !agentName) {
      response.status(400).json({ error: 'Client Name, Vessel Name, IMO Number, Scheduled Arrival, Contact Email, and Agent Name are required.' });
      return;
    }

    const requisitionItems = await parseRequisitionFile(request.file.path);
    const matchedItems = requisitionItems.map((item) => applyQuoteInsight(item, matcher.matchItem(item)));
    const summary = summarizeQuote(matchedItems);

    const quote = await saveQuote({
      clientName,
      vesselName,
      port: port || '',
      imoNumber,
      scheduledArrival,
      contactEmail,
      agentName,
      originalFileName: request.file.originalname,
      uploadedFilePath: request.file.path,
      processingMs: Date.now() - startedAt,
      quoteStatus: 'OPEN',
      items: matchedItems,
      summary
    });

    quoteInsights = await loadQuoteInsights(catalog);
    response.json(buildQuoteResponse(quote));
  } catch (error) {
    next(error);
  }
});

app.put('/api/quotes/:quoteId', async (request, response, next) => {
  try {
    const existingQuote = await loadNormalizedQuote(request.params.quoteId);
    const incomingItems = Array.isArray(request.body.items) ? request.body.items : null;

    if (!incomingItems) {
      response.status(400).json({ error: 'Updated quote items are required.' });
      return;
    }

    if ((existingQuote.quoteStatus || 'OPEN') === 'CLOSED') {
      response.status(400).json({ error: 'Closed quotations cannot be edited.' });
      return;
    }

    const updatedItems = incomingItems.map((item, index) => {
      const existingItem = existingQuote.items[index] || {};
      const quantity = item.quantity === '' || item.quantity === null || item.quantity === undefined
        ? null
        : Number(item.quantity);
      const safeQuantity = Number.isFinite(quantity) ? quantity : null;
      const incomingPrice = Number(item.price || 0);
      const incomingUnit = String(item.unit || '').trim();
      const incomingMatchedProductKey = String(item.matchedProductKey || item.matchedProduct || '').trim();

      const draftItem = {
        ...item,
        lineNumber: index + 1,
        quantity: safeQuantity,
        requestedUnit: item.requestedUnit || existingItem.requestedUnit || ''
      };

      if (item.isUnavailable) {
        const unavailableBase = incomingMatchedProductKey
          ? applyManualSelection(draftItem, catalog, incomingMatchedProductKey)
          : draftItem;
        return buildUnavailableQuoteItem(item, unavailableBase);
      }

      const recalculatedItem = applyManualSelection(draftItem, catalog, incomingMatchedProductKey);
      const mergedItem = mergeQuoteItemOverrides({
        ...item,
        unit: incomingUnit || item.unit || draftItem.requestedUnit || ''
      }, recalculatedItem);

      return {
        ...mergedItem,
        confidence: incomingMatchedProductKey ? 'manual' : recalculatedItem.confidence,
        matchReason: incomingMatchedProductKey
          ? mergedItem.overrideReasonText
          : recalculatedItem.matchReason
      };
    });

    const updatedQuote = await saveQuote({
      ...existingQuote,
      items: updatedItems,
      summary: summarizeQuote(updatedItems)
    });

    quoteInsights = await loadQuoteInsights(catalog);
    response.json(buildQuoteResponse(updatedQuote));
  } catch (error) {
    next(error);
  }
});

app.post('/api/quotes/:quoteId/close', async (request, response, next) => {
  try {
    const existingQuote = await loadNormalizedQuote(request.params.quoteId);

    if ((existingQuote.quoteStatus || 'OPEN') === 'CLOSED') {
      response.json(buildQuoteResponse(existingQuote));
      return;
    }

    const closedQuote = await saveQuote({
      ...existingQuote,
      quoteStatus: 'CLOSED',
      closedAt: new Date().toISOString()
    });

    response.json(buildQuoteResponse(closedQuote));
  } catch (error) {
    next(error);
  }
});

app.get('/api/quotes/:quoteId/export.xlsx', async (request, response, next) => {
  try {
    const quote = await loadNormalizedQuote(request.params.quoteId);
    const buffer = await buildExcelBuffer(quote);
    const exportFileName = String(quote.quoteNumber || quote.id).replace(/\s+/g, '-');
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${exportFileName}.xlsx"`);
    response.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.get('/api/quotes/:quoteId/export.pdf', async (request, response, next) => {
  try {
    const quote = await loadNormalizedQuote(request.params.quoteId);
    const buffer = await buildPdfBuffer(quote);
    const exportFileName = String(quote.quoteNumber || quote.id).replace(/\s+/g, '-');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="${exportFileName}.pdf"`);
    response.send(buffer);
  } catch (error) {
    next(error);
  }
});

// --- R2 quote number assignment endpoint ---
function extractQuoteSequence(key) {
  // Accepts ATHYY-M00001, ATHYY-M00002, etc.
  const match = key.match(/ATH(\d{2})-M(\d{5})/i);
  if (!match) return null;
  return { year: match[1], seq: parseInt(match[2], 10) };
}

app.get('/api/quotes/next-number', async (req, res) => {
  try {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2);
    const prefix = `ATH${year}-M`;
    const files = await listR2QuoteFiles();
    let maxSeq = 0;
    for (const key of files) {
      const found = extractQuoteSequence(key);
      if (found && found.year === year && found.seq > maxSeq) {
        maxSeq = found.seq;
      }
    }
    const nextSeq = maxSeq + 1;
    const nextNumber = `${prefix}${String(nextSeq).padStart(5, '0')}`;
    res.json({ quoteNumber: nextNumber });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get next quote number' });
  }
});

// --- R2 upload endpoint for final export ---
app.post('/api/quotes/upload-final', async (req, res) => {
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(400).json({ error: 'Failed to parse form data' });
      return;
    }
    try {
      const { quoteNumber, fileType, timestamp } = fields;
      const file = files.file;
      if (!file || !quoteNumber || !fileType) {
        res.status(400).json({ error: 'Missing file, quoteNumber, or fileType' });
        return;
      }
      const fileBuffer = await fs.readFile(file.filepath);
      const r2Key = `${quoteNumber}.${fileType}`;
      await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: fileBuffer,
        ContentType: fileType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      // Optionally, store metadata (quoteNumber, fileType, timestamp, r2Key) in a DB or log
      res.json({ ok: true, r2Key });
    } catch (e) {
      res.status(500).json({ error: 'Failed to upload to R2' });
    }
  });
});

app.use((error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  response.status(500).json({ error: message });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Athena quote system listening on http://localhost:${port}`);
  console.log(`Using price list: ${priceListPath}`);
});
