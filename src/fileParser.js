import fs from 'node:fs/promises';
import path from 'node:path';
import xlsx from 'xlsx';
import { convertToBaseUnit, detectUnitType, parseSupplyOptions } from './calculator.js';

// Requisition sheets arrive from hundreds of different agents/vessels, so each column
// is matched by a scored rule set instead of a fixed alias list:
//   exact   -> the whole header cell equals a well-known label (strongest signal)
//   generic -> the whole header cell equals a short/ambiguous label
//   phrases -> a known label appears as a whole word sequence inside a longer header
//   weak    -> a keyword appears anywhere in the header (last resort)
//   reject  -> the header belongs to a different column (e.g. "UNIT PRICE" is not a unit)
const REQUISITION_COLUMN_RULES = {
  description: {
    exact: [
      'description', 'descriptions', 'description of item', 'description of items',
      'description of goods', 'description of the goods', 'description of product',
      'description of products', 'description of material', 'description of materials',
      'item description', 'items description', 'item descriptions', 'goods description',
      'product description', 'products description', 'material description',
      'article description', 'commodity description', 'merchandise description',
      'full description', 'short description', 'long description', 'english description',
      'description english', 'item name', 'items name', 'item names', 'name of item',
      'name of items', 'product name', 'products name', 'product names',
      'name of product', 'name of the product', 'name of products', 'product title',
      'material name', 'name of material', 'article name', 'commodity name',
      'goods name', 'name of goods', 'name of the goods', 'stock item', 'stock items',
      'stock name', 'stock description', 'item particulars', 'particulars of item',
      'particulars of goods', 'item details', 'item detail', 'details of item',
      'product details', 'item specification', 'item specifications',
      'specification', 'specifications', 'nomenclature', 'designation',
      'requested item', 'requested items', 'item requested', 'items requested',
      'required item', 'required items', 'item required', 'items required',
      'food item', 'food items', 'provision item', 'provision items',
      'store item', 'store items', 'ships store', 'ship store', 'item name description',
      'description item', 'description product', 'item product', 'product item',
      'descripcion', 'descripcion del producto', 'nombre del producto', 'producto',
      'descricao', 'descricao do produto', 'produto', 'artikel', 'bezeichnung',
      'articulo', 'article', 'articles', 'designation article', 'libelle',
      'produit', 'nom du produit', 'merchandise', 'prodotto', 'descrizione'
    ],
    generic: [
      'item', 'items', 'product', 'products', 'goods', 'good', 'material', 'materials',
      'commodity', 'commodities', 'particulars', 'particular', 'details', 'detail',
      'name', 'names', 'title', 'subject', 'supply', 'supplies', 'requirement',
      'requirements', 'spec', 'specs', 'desc', 'descr', 'part', 'parts',
      'part name', 'part description', 'ingredient', 'ingredients', 'provision',
      'provisions', 'stores', 'store', 'stock', 'articles required'
    ],
    phrases: [
      'description', 'item name', 'product name', 'item description',
      'product description', 'material description', 'goods description',
      'nomenclature', 'particulars', 'descripcion', 'descricao', 'bezeichnung',
      'name of', 'item', 'product'
    ],
    weak: [
      /(^|\s)(item|items|product|products|goods|material|materials|article|articles|commodity|provision|provisions|stock|merchandise|desc|description|name)(\s|$)/
    ],
    reject: [
      /(^|\s)(qty|qtys|quantity|quantities|uom|unit|units|price|prices|cost|costs|rate|rates|amount|value|total|subtotal|usd|eur|gbp|aed|sar|sgd|currency|vat|tax|discount|date|code|codes|sku|barcode|ref|reference|serial|number|numbers|num|no|nos|s n|sr|slno|sl|id|remark|remarks|comment|comments|note|notes|status|delivery|port|vessel|imo)(\s|$)/
    ]
  },
  quantity: {
    exact: [
      'quantity', 'quantities', 'qty', 'qtys', 'qty s', 'quantity required',
      'required quantity', 'qty required', 'required qty', 'reqd qty',
      'reqd quantity', 'qty reqd', 'requested quantity', 'quantity requested',
      'qty requested', 'requested qty', 'order quantity', 'quantity ordered',
      'ordered quantity', 'order qty', 'qty ordered', 'ordering qty',
      'qty to order', 'quantity to order', 'total quantity', 'total qty',
      'net quantity', 'net qty', 'gross quantity', 'gross qty',
      'requisition qty', 'requisition quantity', 'indent qty', 'indent quantity',
      'demand qty', 'demand quantity', 'supply qty', 'supply quantity',
      'quantity to supply', 'delivery qty', 'delivery quantity', 'qty to deliver',
      'ship qty', 'shipped qty', 'shipping qty', 'r f q', 'rfq', 'rfq qty',
      'rfq quantity', 'quantity rfq', 'qty rfq', 'r f q qty', 'r f q quantity',
      'no of units', 'number of units', 'no of pcs', 'no of pieces',
      'number of pieces', 'no of packs', 'no of cartons', 'nos required',
      'qty in kg', 'qty kg', 'qty kgs', 'quantity in kg', 'qty in pcs',
      'qty pcs', 'quantity in pcs', 'qty in units', 'order', 'ordered',
      'cantidad', 'quantite', 'quantidade', 'menge', 'anzahl', 'aantal',
      'quantita', 'kwantiteit'
    ],
    generic: [
      'qnty', 'qnt', 'q ty', 'req', 'reqd', 'required', 'requirement', 'request',
      'requested', 'nos', 'no s', 'count', 'pcs', 'pieces', 'volume', 'vol',
      'units required', 'needed', 'need'
    ],
    phrases: [
      'quantity', 'qty', 'rfq', 'r f q', 'required', 'requested', 'ordered',
      'quantite', 'cantidad', 'quantidade', 'menge', 'no of'
    ],
    weak: [
      /(^|\s)(qty|qnty|qnt|quantit|rfq|req|reqd|required|nos|count|pcs|pieces)(\s|$)/,
      /(^|\s)r f q(\s|$)/
    ],
    reject: [
      /(^|\s)(price|prices|pricing|cost|costs|rate|rates|value|amount|usd|eur|gbp|aed|sar|sgd|currency|discount|vat|tax|remark|remarks|comment|comments|note|notes|date|code|codes|sku|barcode|ref|reference|supplier|vendor|brand|origin|status|balance|stock on board|rob)(\s|$)/,
      /(^|\s)(pack size|packing size|packaging|packing)(\s|$)/,
      /(^|\s)per\s+(unit|units|uom|pack|packet|carton|cartons|ctn|box|case|kg|kgs|g|gr|ltr|lt|l|ml|pc|pcs|piece|pieces)(\s|$)/
    ]
  },
  unit: {
    exact: [
      'unit of measure', 'units of measure', 'unit of measures',
      'unit of measurement', 'units of measurement', 'unit of issue',
      'unit measure', 'unit measurement', 'measurement unit', 'measure unit',
      'uom', 'u o m', 'u m', 'u of m', 'unit uom', 'uom unit', 'uom code',
      'base unit', 'base uom', 'order unit', 'ordering unit', 'purchase unit',
      'sales unit', 'selling unit', 'supply unit', 'issue unit', 'stock unit',
      'packing unit', 'pack unit', 'unit pack', 'unit type', 'type of unit',
      'unit size', 'size unit', 'pack size', 'packing size', 'package size',
      'packing', 'packaging', 'package', 'pack type', 'packing type',
      'qty unit', 'quantity unit', 'unit of qty', 'unit of quantity',
      'measure', 'measurement', 'unidad', 'unidad de medida', 'unidade',
      'einheit', 'mengeneinheit', 'unite', 'unite de mesure', 'medida',
      'misura', 'unita'
    ],
    generic: [
      'unit', 'units', 'meas', 'size', 'pack', 'packs', 'packet', 'packets',
      'per', 'in', 'uom s'
    ],
    phrases: [
      'unit of measure', 'unit of', 'uom', 'unit', 'units', 'measure',
      'measurement', 'packing', 'packaging', 'pack size', 'unidad', 'einheit'
    ],
    weak: [
      /(^|\s)(uom|unit|units|u m|measure|measurement|packing|packaging|pack|size)(\s|$)/
    ],
    reject: [
      /(^|\s)(price|prices|pricing|cost|costs|rate|rates|value|amount|total|subtotal|usd|eur|gbp|aed|sar|sgd|currency|discount|vat|tax|date|code|remark|remarks|comment|comments|note|notes)(\s|$)/
    ]
  }
};

const REQUISITION_ROLE_PRIORITY = { description: 0, quantity: 1, unit: 2 };
const REQUISITION_HEADER_SCAN_ROWS = 60;

const ATHENA_PRICE_LIST_HEADERS = {
  product: ['standard product name', 'product name', 'description2', 'description'],
  supplierQuantity: ['supplier quantity', 'supplier qantity'],
  supplierUnit: ['supplier unit', 'supplier'],
  unit: ['packaging per ctn', 'order quantity'],
  remarks: ['remarks', 'comments', 'note', 'notes'],
  price: ['sale price'],
  itemCode: ['item code']
};

const STANDARD_PRICE_LIST_HEADERS = {
  product: ['product name', 'product_name'],
  keywords: ['keywords'],
  unit: ['unit'],
  price: ['price'],
  packSize: ['pack size', 'pack_size'],
  unitType: ['unit type', 'unit_type']
};

const CATALOG_UNIT_OVERRIDES = {
  EGG011: {
    unit: 'Box of 180 pcs',
    supplyOptions: [{
      label: 'Box of 180 pcs',
      unitQuantity: 180,
      unitType: 'pcs',
      orderUnitType: 'pack',
      descriptor: 'box',
      isFallback: false
    }],
    unitType: 'pcs'
  },
  EGG008: {
    unit: 'Box of 60 pcs',
    supplyOptions: [{
      label: 'Box of 60 pcs',
      unitQuantity: 60,
      unitType: 'pcs',
      orderUnitType: 'pack',
      descriptor: 'box',
      isFallback: false
    }],
    unitType: 'pcs'
  },
  DAI113: {
    unit: 'Box of 20 pcs',
    supplyOptions: [{
      label: 'Box of 20 pcs',
      unitQuantity: 20,
      unitType: 'pcs',
      orderUnitType: 'pack',
      descriptor: 'box',
      isFallback: false
    }],
    unitType: 'pcs'
  },
  DAI114: {
    unit: 'Box of 20 pcs',
    supplyOptions: [{
      label: 'Box of 20 pcs',
      unitQuantity: 20,
      unitType: 'pcs',
      orderUnitType: 'pack',
      descriptor: 'box',
      isFallback: false
    }],
    unitType: 'pcs'
  }
};

const APPROXIMATE_PIECE_WEIGHT_OVERRIDES = {
  FRU020: 1,
  FRU021: 1,
  FRU024: 1
};

function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toStrictUnitLabel(value) {
  const normalized = normalizeHeader(value);
  if (!normalized) {
    return '';
  }

  if (/(^|\s)(kg|kgs|kilogram|kilograms)(\s|$)/.test(normalized)) {
    return 'KG';
  }

  if (/(^|\s)(g|gram|grams)(\s|$)/.test(normalized)) {
    return 'G';
  }

  if (/(^|\s)(l|lt|ltr|liter|liters|litre|litres)(\s|$)/.test(normalized)) {
    return 'LTR';
  }

  if (/(^|\s)(ml)(\s|$)/.test(normalized)) {
    return 'ML';
  }

  if (/(^|\s)(pc|pcs|piece|pieces|ea|each|unit|units)(\s|$)/.test(normalized)) {
    return 'PCS';
  }

  if (/(^|\s)(pack|packs|packet|packets|carton|cartons|case|cases|box|boxes|tray|trays|bag|bags|bottle|bottles|roll|rolls|tin|tins|jar|jars)(\s|$)/.test(normalized)) {
    return 'PACK';
  }

  const lettersOnly = normalized.replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!lettersOnly) {
    return '';
  }

  return lettersOnly.toUpperCase().split(' ')[0];
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value ?? '')
    .trim()
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUnitValue(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function buildStructuredUnitLabel(quantity, rawUnit) {
  const normalizedUnit = String(rawUnit ?? '').trim();
  const unitType = detectUnitType(normalizedUnit);
  const formattedQuantity = formatUnitValue(quantity);

  if (!formattedQuantity || !normalizedUnit) {
    return '';
  }

  if (unitType === 'kg' || unitType === 'liter') {
    return `${formattedQuantity}${normalizedUnit.toLowerCase()}`;
  }

  if (unitType === 'pcs') {
    return `${formattedQuantity} pcs`;
  }

  return `${formattedQuantity} ${normalizedUnit}`.trim();
}

function parseStructuredQuantityParts(value) {
  const rawValue = String(value ?? '').trim();
  const multipliedMatch = rawValue.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/);
  if (multipliedMatch) {
    return {
      outerQuantity: Number(multipliedMatch[1]),
      innerQuantity: Number(multipliedMatch[2])
    };
  }

  const numericValue = parseNumber(value);
  if (numericValue === null) {
    return null;
  }

  return {
    outerQuantity: 1,
    innerQuantity: numericValue
  };
}

// FIX: removed reference to undeclared `numericQuantity`; use `baseQuantity` with a safe fallback of 1.
function buildStructuredSupplyMetadata(quantityValue, rawUnit) {
  const quantityParts = parseStructuredQuantityParts(quantityValue);
  const trimmedUnit = String(rawUnit ?? '').trim();

  if (!quantityParts || quantityParts.outerQuantity <= 0 || quantityParts.innerQuantity <= 0 || !trimmedUnit) {
    return null;
  }

  const unitType = detectUnitType(trimmedUnit) || 'pack';
  const totalQuantity = quantityParts.outerQuantity * quantityParts.innerQuantity;
  const baseQuantity = convertToBaseUnit(totalQuantity, trimmedUnit);
  const resolvedUnitQuantity = baseQuantity ?? totalQuantity; // FIX: was referencing undefined `numericQuantity`
  let label = '';

  if (unitType === 'pcs' && quantityParts.outerQuantity === 1) {
    label = `Box of ${formatUnitValue(quantityParts.innerQuantity)} pcs`;
  } else if (quantityParts.outerQuantity === 1) {
    label = buildStructuredUnitLabel(quantityParts.innerQuantity, trimmedUnit) || `${formatUnitValue(quantityParts.innerQuantity)} ${trimmedUnit}`.trim();
  } else {
    label = `${formatUnitValue(quantityParts.outerQuantity)} x ${buildStructuredUnitLabel(quantityParts.innerQuantity, trimmedUnit) || `${formatUnitValue(quantityParts.innerQuantity)} ${trimmedUnit}`.trim()}`;
  }

  return {
    unit: label,
    supplyOptions: [{
      label,
      unitQuantity: resolvedUnitQuantity,
      unitType,
      orderUnitType: 'pack',
      descriptor: unitType === 'pcs' ? 'box' : '',
      isFallback: false
    }],
    unitType
  };
}

function buildSupplyUnitMetadata(unitValue) {
  const supplyOptions = parseSupplyOptions(unitValue);
  const primaryOption = supplyOptions[0] || null;

  return {
    supplyOptions,
    unitType: primaryOption?.unitType || detectUnitType(unitValue) || 'pack'
  };
}

function buildFallbackSupplyMetadata() {
  return {
    unit: '1 unit',
    supplyOptions: [{
      label: '1 unit',
      unitQuantity: 1,
      unitType: 'pack',
      orderUnitType: 'pack',
      descriptor: '',
      isFallback: true
    }],
    unitType: 'pack'
  };
}

function extractTrailingSupplyText(productName) {
  const normalizedName = String(productName ?? '').replace(/\s+/g, ' ').trim();
  if (!normalizedName) {
    return '';
  }

  const patterns = [
    /(box|boxes|tray|trays|carton|cartons|case|cases|bag|bags|pack|packs|packet|packets|bottle|bottles|roll|rolls|tin|tins|jar|jars)\s*(?:of)?\s*\d+(?:\.\d+)?(?:\s*(?:kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units))?$/i,
    /\d+(?:\.\d+)?\s*[xX]\s*\d+(?:\.\d+)?\s*(?:kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)$/i,
    /\d+(?:\.\d+)?\s*(?:kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)$/i
  ];

  for (const pattern of patterns) {
    const match = normalizedName.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }

  return '';
}

function deriveSupplyMetadataFromProductName(productName) {
  const embeddedUnit = extractTrailingSupplyText(productName);
  if (!embeddedUnit) {
    return null;
  }

  const multipliedMatch = embeddedUnit.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)$/i);
  if (multipliedMatch) {
    return buildStructuredSupplyMetadata(
      `${multipliedMatch[1]} x ${multipliedMatch[2]}`,
      multipliedMatch[3]
    );
  }

  const singleMatch = embeddedUnit.match(/^(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams|l|lt|ltr|liter|litre|liters|litres|ml|pcs|pc|pieces|piece|ea|each|unit|units)$/i);
  if (singleMatch) {
    return buildStructuredSupplyMetadata(singleMatch[1], singleMatch[2]);
  }

  const supplyUnitMetadata = buildSupplyUnitMetadata(embeddedUnit);
  const primaryOption = supplyUnitMetadata.supplyOptions[0] || null;

  return {
    unit: primaryOption?.label || embeddedUnit,
    supplyOptions: supplyUnitMetadata.supplyOptions,
    unitType: supplyUnitMetadata.unitType
  };
}

function findAthenaHeaderRow(rows, maxScanRows = 20) {
  return rows.findIndex((row, index) => {
    if (index >= maxScanRows) {
      return false;
    }

    const normalized = row.map(normalizeHeader);
    const hasProduct = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.product.includes(cell));
    const hasPrice = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.price.includes(cell));
    const hasLegacyUnit = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.unit.includes(cell));
    const hasStructuredUnit = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.supplierQuantity.includes(cell))
      && normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.supplierUnit.includes(cell));

    return hasProduct && hasPrice && (hasLegacyUnit || hasStructuredUnit);
  });
}

function buildCatalogIdentity(productName, unit, itemCode, category, index) {
  return {
    catalogKey: itemCode || `${category}-${index + 1}`,
    displayName: unit ? `${productName} [${unit}]` : productName
  };
}

function applyCatalogUnitOverride(itemCode, metadata) {
  const override = CATALOG_UNIT_OVERRIDES[itemCode];
  if (!override) {
    return metadata;
  }

  const hasStructuredUnit = String(metadata.unit || '').trim();
  if (hasStructuredUnit) {
    return metadata;
  }

  return override;
}

function applyApproximatePieceWeight(itemCode, product) {
  const approxPieceWeightKg = APPROXIMATE_PIECE_WEIGHT_OVERRIDES[itemCode];
  if (!Number.isFinite(approxPieceWeightKg)) {
    return product;
  }

  return {
    ...product,
    approxPieceWeightKg
  };
}

function parseRemarkApproxPieceWeightKg(remarks) {
  const normalized = String(remarks ?? '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  const parseMassToKg = (value, unit) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }

    return /^g/.test(unit) ? numeric / 1000 : numeric;
  };

  let match = normalized.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams)\s*(?:per|\/)?\s*(?:each|ea|pc|pcs|piece|pieces)\b/);
  if (match) {
    return parseMassToKg(match[1], match[2]);
  }

  match = normalized.match(/(?:each|ea|pc|pcs|piece|pieces)\s*(?:=|is|~|about|approx(?:\.)?)?\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|gram|grams)\b/);
  if (match) {
    return parseMassToKg(match[1], match[2]);
  }

  match = normalized.match(/(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|each)\s*(?:per|\/)\s*(\d+(?:\.\d+)?)\s*(kg|kgs)\b/);
  if (match) {
    const pieceCount = Number(match[1]);
    const totalKg = Number(match[2]);
    if (Number.isFinite(pieceCount) && pieceCount > 0 && Number.isFinite(totalKg) && totalKg > 0) {
      return totalKg / pieceCount;
    }
  }

  match = normalized.match(/(\d+(?:\.\d+)?)\s*(kg|kgs)\s*(?:for|\/)\s*(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|each)\b/);
  if (match) {
    const totalKg = Number(match[1]);
    const pieceCount = Number(match[3]);
    if (Number.isFinite(pieceCount) && pieceCount > 0 && Number.isFinite(totalKg) && totalKg > 0) {
      return totalKg / pieceCount;
    }
  }

  return null;
}

function parseRemarkUnitKgEquivalent(remarks) {
  const normalized = String(remarks ?? '')
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  // Treat a plain mass note like "24.3 KG" as KG equivalent per selling unit.
  const match = normalized.match(/(?:^|\b)(\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms)\b/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getCategoryCodeFromItemCode(itemCode) {
  const match = String(itemCode ?? '').trim().toUpperCase().match(/^ATH-([A-Z]{3})/);
  return match ? match[1] : '';
}

function isFreshProduceItem(itemCode, categoryName = '') {
  const categoryCode = getCategoryCodeFromItemCode(itemCode);
  if (categoryCode === 'FVG' || categoryCode === 'FFR') {
    return true;
  }

  const normalizedCategory = normalizeHeader(categoryName);
  return normalizedCategory.includes('fresh vegetables') || normalizedCategory.includes('fresh fruit');
}

function applyRemarkApproximatePieceWeight({ itemCode, categoryName, remarks, product }) {
  if (!isFreshProduceItem(itemCode, categoryName)) {
    return product;
  }

  const approxFromRemarks = parseRemarkApproxPieceWeightKg(remarks);
  if (!Number.isFinite(approxFromRemarks) || approxFromRemarks <= 0) {
    return product;
  }

  return {
    ...product,
    approxPieceWeightKg: approxFromRemarks
  };
}

function getHeaderIndex(headerRow, aliases) {
  return headerRow.findIndex((cell) => aliases.includes(normalizeHeader(cell)));
}

// Score how strongly a single normalized header cell matches one column role.
// Higher is a more confident match; 0 means "no signal"; negative means the
// cell clearly belongs to a different column and must not be picked for this role.
function scoreHeaderCellForRole(normalizedCell, role) {
  const cell = String(normalizedCell || '').trim();
  if (!cell) {
    return 0;
  }

  const rules = REQUISITION_COLUMN_RULES[role];
  if (!rules) {
    return 0;
  }

  if (Array.isArray(rules.reject) && rules.reject.some((pattern) => pattern.test(cell))) {
    return -100;
  }

  if (Array.isArray(rules.exact) && rules.exact.includes(cell)) {
    return 100;
  }

  if (Array.isArray(rules.generic) && rules.generic.includes(cell)) {
    return 70;
  }

  if (Array.isArray(rules.phrases)) {
    for (const phrase of rules.phrases) {
      const pattern = new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
      if (pattern.test(cell)) {
        return 45;
      }
    }
  }

  if (Array.isArray(rules.weak) && rules.weak.some((pattern) => pattern.test(cell))) {
    return 20;
  }

  return 0;
}

// Assign header columns to the description/quantity/unit roles for a single row.
// Each cell is scored for every role, then roles claim their best-scoring column
// greedily (description first) so a shared word like "unit" can't be stolen from
// the column that matches it more specifically. Returns the resolved indexes plus
// a confidence score, or null when the row isn't a usable header.
function resolveRequisitionColumns(row) {
  const normalized = row.map(normalizeHeader);
  const roles = Object.keys(REQUISITION_ROLE_PRIORITY)
    .sort((a, b) => REQUISITION_ROLE_PRIORITY[a] - REQUISITION_ROLE_PRIORITY[b]);

  const candidates = {};
  for (const role of roles) {
    candidates[role] = normalized
      .map((cell, index) => ({ index, score: scoreHeaderCellForRole(cell, role) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  const assigned = {};
  const usedIndexes = new Set();
  for (const role of roles) {
    const pick = candidates[role].find((entry) => !usedIndexes.has(entry.index));
    if (pick) {
      assigned[role] = pick;
      usedIndexes.add(pick.index);
    }
  }

  if (assigned.description == null || assigned.quantity == null || assigned.unit == null) {
    return null;
  }

  return {
    descriptionIndex: assigned.description.index,
    quantityIndex: assigned.quantity.index,
    unitIndex: assigned.unit.index,
    score: assigned.description.score + assigned.quantity.score + assigned.unit.score
  };
}

// Scan the first rows and keep the highest-confidence header row. Scanning past the
// first match lets a strong real header win over an early weak/decoy row (titles,
// vessel info, "R.F.Q." banners) that happens to contain a stray keyword.
function findRequisitionHeader(rows, maxScanRows = REQUISITION_HEADER_SCAN_ROWS) {
  let best = null;

  const scanLimit = Math.min(rows.length, maxScanRows);
  for (let index = 0; index < scanLimit; index += 1) {
    const resolved = resolveRequisitionColumns(rows[index]);
    if (!resolved) {
      continue;
    }

    if (!best || resolved.score > best.score) {
      best = { index, ...resolved };
    }
  }

  return best;
}

function findRequisitionHeaderRow(rows) {
  const header = findRequisitionHeader(rows);
  return header ? header.index : -1;
}

function isSubtotalOrTotalDescription(description) {
  const normalized = normalizeHeader(description);
  if (!normalized) {
    return false;
  }

  return /(^|\s)(sub\s*total|subtotal|grand\s*total|total)(\s|$)/.test(normalized);
}

function readWorkbook(filePath, content) {
  const extension = path.extname(filePath).toLowerCase();
  return xlsx.read(content, {
    type: extension === '.csv' ? 'string' : 'buffer',
    cellDates: false,
    raw: false
  });
}

function parseRowsFromSheet(sheet) {
  return xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function hasRowContent(rows) {
  return rows.some((row) => row.some((cell) => String(cell ?? '').trim()));
}

function parseRowsFromFirstNonEmptySheet(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = parseRowsFromSheet(sheet);
    if (hasRowContent(rows)) {
      return rows;
    }
  }

  return [];
}

function findPriceListHeaderRow(rows, aliasesByColumn, maxScanRows = 20) {
  return rows.findIndex((row, index) => {
    if (index >= maxScanRows) {
      return false;
    }

    const normalized = row.map(normalizeHeader);
    return Object.values(aliasesByColumn).every((aliases) =>
      normalized.some((cell) => aliases.includes(cell))
    );
  });
}

function getColumnIndexes(headerRow, aliasesByColumn) {
  const normalizedHeader = headerRow.map(normalizeHeader);

  return Object.fromEntries(
    Object.entries(aliasesByColumn).map(([key, aliases]) => [
      key,
      normalizedHeader.findIndex((cell) => aliases.includes(cell))
    ])
  );
}

function getPreferredHeaderIndex(headerRow, aliasesInPriorityOrder) {
  const normalizedHeader = headerRow.map(normalizeHeader);
  for (const alias of aliasesInPriorityOrder) {
    const index = normalizedHeader.findIndex((cell) => cell === alias);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function parseStandardPriceList(rows) {
  if (rows.length < 2) {
    return null;
  }

  const indexes = getColumnIndexes(rows[0], STANDARD_PRICE_LIST_HEADERS);

  if (indexes.product < 0 || indexes.keywords < 0 || indexes.unit < 0 || indexes.price < 0) {
    return null;
  }

  return rows.slice(1)
    .filter((row) => String(row[indexes.product] ?? '').trim())
    .map((row, index) => {
      const unit = String(row[indexes.unit] ?? '').trim();
      const supplyUnitMetadata = buildSupplyUnitMetadata(unit);

      return {
        id: index + 1,
        productName: String(row[indexes.product] ?? '').trim(),
        keywords: String(row[indexes.keywords] ?? '').trim(),
        unit,
        supplyOptions: supplyUnitMetadata.supplyOptions,
        unitType: String(row[indexes.unitType] ?? '').trim() || supplyUnitMetadata.unitType,
        price: parseNumber(row[indexes.price]) ?? 0
      };
    });
}

function parseAthenaWorkbook(workbook, options = {}) {
  const preferSupplierUnitColumnC = options.preferSupplierUnitColumnC === true;
  const products = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = parseRowsFromSheet(sheet);
    const headerRowIndex = findAthenaHeaderRow(rows);

    if (headerRowIndex < 0) {
      continue;
    }

    const indexes = getColumnIndexes(rows[headerRowIndex], ATHENA_PRICE_LIST_HEADERS);
    const preferredProductIndex = getPreferredHeaderIndex(rows[headerRowIndex], ATHENA_PRICE_LIST_HEADERS.product);
    if (preferredProductIndex >= 0) {
      indexes.product = preferredProductIndex;
    }
    const supplierUnitIndex = preferSupplierUnitColumnC
      ? 2
      : (indexes.supplierUnit >= 0 ? indexes.supplierUnit : -1);
    const dataRows = rows.slice(headerRowIndex + 1);

    for (const [rowOffset, row] of dataRows.entries()) {
      const productName = String(row[indexes.product] ?? '').trim();
      const price = parseNumber(row[indexes.price]);
      const itemCode = String(row[indexes.itemCode] ?? '').trim();
      const remarks = indexes.remarks >= 0 ? String(row[indexes.remarks] ?? '').trim() : '';
      const sourceRowNumber = headerRowIndex + 2 + rowOffset;
      const unitKgEquivalent = parseRemarkUnitKgEquivalent(remarks);
      const forceKgConversion = sourceRowNumber >= 521
        && sourceRowNumber <= 615
        && Number.isFinite(unitKgEquivalent)
        && unitKgEquivalent > 0;
      const rawSupplierUnit = supplierUnitIndex >= 0 ? String(row[supplierUnitIndex] ?? '').trim() : '';
      const strictSupplierUnit = toStrictUnitLabel(rawSupplierUnit);
      const exactSupplierUnit = rawSupplierUnit;
      const structuredSupplyMetadata = buildStructuredSupplyMetadata(
        indexes.supplierQuantity >= 0 ? row[indexes.supplierQuantity] : null,
        supplierUnitIndex >= 0 ? row[supplierUnitIndex] : ''
      );
      const legacyUnit = indexes.unit >= 0
        ? String(row[indexes.unit] ?? '').trim()
        : (supplierUnitIndex >= 0 ? String(row[supplierUnitIndex] ?? '').trim() : '');
      const derivedSupplyMetadata = !structuredSupplyMetadata && !legacyUnit
        ? deriveSupplyMetadataFromProductName(productName)
        : null;
      const baseSupplyMetadata = structuredSupplyMetadata
        || (legacyUnit
          ? {
            unit: legacyUnit,
            ...buildSupplyUnitMetadata(legacyUnit)
          }
          : derivedSupplyMetadata || buildFallbackSupplyMetadata());
      const supplyUnitMetadata = applyCatalogUnitOverride(itemCode, baseSupplyMetadata);
      const unit = supplyUnitMetadata.unit
        || legacyUnit
        || supplyUnitMetadata.supplyOptions?.[0]?.label
        || '1 unit';

      if (!productName || price === null || price <= 0) {
        continue;
      }

      const identity = buildCatalogIdentity(productName, unit, itemCode, sheetName, products.length);

      const baseProduct = {
        id: products.length + 1,
        itemCode,
        catalogKey: identity.catalogKey,
        displayName: identity.displayName,
        category: sheetName,
        productName,
        keywords: '',
        unit,
        supplierUnit: preferSupplierUnitColumnC
          ? exactSupplierUnit
          : (strictSupplierUnit || toStrictUnitLabel(unit)),
        supplyOptions: supplyUnitMetadata.supplyOptions,
        unitType: supplyUnitMetadata.unitType,
        sourceRowNumber,
        unitKgEquivalent,
        forceKgConversion,
        price
      };

      const productWithOverrides = applyApproximatePieceWeight(itemCode, baseProduct);
      products.push(applyRemarkApproximatePieceWeight({
        itemCode,
        categoryName: sheetName,
        remarks,
        product: productWithOverrides
      }));
    }
  }

  return products;
}

export async function parseRequisitionFile(filePath, originalFileName = '') {
  const extensionSource = String(originalFileName || filePath || '');
  const extension = path.extname(extensionSource).toLowerCase();
  const rawContent = extension === '.csv'
    ? await fs.readFile(filePath, 'utf8')
    : await fs.readFile(filePath);
  const workbook = readWorkbook(filePath, rawContent);
  const rows = parseRowsFromFirstNonEmptySheet(workbook);

  if (!rows.length) {
    throw new Error('The uploaded requisition file is empty.');
  }

  const header = findRequisitionHeader(rows);
  if (!header) {
    throw new Error('No item header row found in file. Expected an item/description column (e.g. DESCRIPTION, ITEM, PRODUCT NAME), a quantity column (e.g. QTY, QUANTITY, R.F.Q.), and a unit column (e.g. UNIT, UOM, PACKING).');
  }

  const { descriptionIndex, quantityIndex, unitIndex } = header;
  const dataRows = rows.slice(header.index + 1);

  const items = [];
  for (const row of dataRows) {
    if (!row.some((cell) => String(cell ?? '').trim())) {
      continue;
    }

    const originalItem = String(row[descriptionIndex] ?? '').trim();

    if (!originalItem || isSubtotalOrTotalDescription(originalItem)) {
      continue;
    }

    const quantity = parseNumber(row[quantityIndex]);
    if (quantity === null || quantity <= 0) {
      continue;
    }

    const requestedUnit = String(row[unitIndex] ?? '').trim();

    items.push({
      lineNumber: items.length + 1,
      originalItem,
      quantity,
      requestedUnit
    });
  }

  return items;
}

export async function loadPriceList(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const rawContent = extension === '.csv'
    ? await fs.readFile(filePath, 'utf8')
    : await fs.readFile(filePath);
  const workbook = readWorkbook(filePath, rawContent);
  const firstSheetRows = parseRowsFromSheet(workbook.Sheets[workbook.SheetNames[0]]);
  const standardPriceList = parseStandardPriceList(firstSheetRows);

  if (standardPriceList) {
    return standardPriceList;
  }

  const athenaPriceList = parseAthenaWorkbook(workbook, {
    preferSupplierUnitColumnC: /ath\s*(?:price|product)\s*list\s*-\s*main\.xlsx$/i.test(path.basename(filePath || ''))
  });
  if (athenaPriceList.length > 0) {
    return athenaPriceList;
  }

  throw new Error('The price list must contain either product_name, keywords, unit, and price columns or the Athena workbook columns Product Name or Standard product name, Supplier Quantity and Supplier unit or Packaging per CTN, and Sale Price.');
}