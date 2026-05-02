import fs from 'node:fs/promises';
import path from 'node:path';
import xlsx from 'xlsx';
import { convertToBaseUnit, detectUnitType, parseSupplyOptions } from './calculator.js';

const HEADER_ALIASES = {
  description: ['description', 'item', 'item name', 'product', 'product name', 'product description', 'name', 'goods', 'article'],
  quantity: ['quantity', 'qty', 'requested qty', 'order qty', 'amount'],
  unit: ['unit', 'uom', 'measure', 'pack', 'packing unit']
};

const DESCRIPTION_HEADER_PREFERENCE = [
  ['description', 'product description', 'product name', 'item name', 'name', 'goods', 'article', 'product'],
  ['item']
];

const ATHENA_PRICE_LIST_HEADERS = {
  product: ['standard product name', 'product name'],
  supplierQuantity: ['supplier quantity', 'supplier qantity'],
  supplierUnit: ['supplier unit'],
  unit: ['packaging per ctn', 'order quantity'],
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
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    const hasItemCode = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.itemCode.includes(cell));
    const hasLegacyUnit = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.unit.includes(cell));
    const hasStructuredUnit = normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.supplierQuantity.includes(cell))
      && normalized.some((cell) => ATHENA_PRICE_LIST_HEADERS.supplierUnit.includes(cell));

    return hasProduct && hasPrice && hasItemCode && (hasLegacyUnit || hasStructuredUnit);
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

function getHeaderIndex(headerRow, aliases) {
  return headerRow.findIndex((cell) => aliases.includes(normalizeHeader(cell)));
}

function getDescriptionHeaderIndex(headerRow) {
  for (const aliasGroup of DESCRIPTION_HEADER_PREFERENCE) {
    const index = getHeaderIndex(headerRow, aliasGroup);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function looksLikeItemCode(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return false;
  }

  return /^[a-z]{2,}[\-\s]?[0-9]{2,}$/i.test(normalized)
    || /^[a-z0-9]{2,}[\-_/]?[a-z0-9]{2,}$/i.test(normalized) && !/\s/.test(normalized);
}

function inferDescription(row) {
  const textCells = row
    .map((cell) => String(cell ?? '').trim())
    .filter((cell) => cell && Number.isNaN(Number(cell)))
    .filter((cell) => !looksLikeItemCode(cell));

  if (!textCells.length) {
    return '';
  }

  return textCells.sort((left, right) => {
    const leftWords = left.split(/\s+/).length;
    const rightWords = right.split(/\s+/).length;

    if (rightWords !== leftWords) {
      return rightWords - leftWords;
    }

    return right.length - left.length;
  })[0];
}

function inferQuantity(row) {
  for (const cell of row) {
    const parsed = parseNumber(cell);
    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }

  return null;
}

function inferHeaderRow(rows) {
  return rows.findIndex((row, index) => {
    if (index > 10) {
      return false;
    }

    const normalized = row.map(normalizeHeader);
    return normalized.some((cell) => HEADER_ALIASES.description.includes(cell));
  });
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

function parseAthenaWorkbook(workbook) {
  const products = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = parseRowsFromSheet(sheet);
    const headerRowIndex = findAthenaHeaderRow(rows);

    if (headerRowIndex < 0) {
      continue;
    }

    const indexes = getColumnIndexes(rows[headerRowIndex], ATHENA_PRICE_LIST_HEADERS);
    const dataRows = rows.slice(headerRowIndex + 1);

    for (const row of dataRows) {
      const productName = String(row[indexes.product] ?? '').trim();
      const price = parseNumber(row[indexes.price]);
      const itemCode = String(row[indexes.itemCode] ?? '').trim();
      const structuredSupplyMetadata = buildStructuredSupplyMetadata(
        indexes.supplierQuantity >= 0 ? row[indexes.supplierQuantity] : null,
        indexes.supplierUnit >= 0 ? row[indexes.supplierUnit] : ''
      );
      const legacyUnit = indexes.unit >= 0 ? String(row[indexes.unit] ?? '').trim() : '';
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

      products.push(applyApproximatePieceWeight(itemCode, {
        id: products.length + 1,
        itemCode,
        catalogKey: identity.catalogKey,
        displayName: identity.displayName,
        category: sheetName,
        productName,
        keywords: '',
        unit,
        supplyOptions: supplyUnitMetadata.supplyOptions,
        unitType: supplyUnitMetadata.unitType,
        price
      }));
    }
  }

  return products;
}

export async function parseRequisitionFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const rawContent = extension === '.csv'
    ? await fs.readFile(filePath, 'utf8')
    : await fs.readFile(filePath);
  const workbook = readWorkbook(filePath, rawContent);
  const rows = parseRowsFromSheet(workbook.Sheets[workbook.SheetNames[0]]);

  if (!rows.length) {
    throw new Error('The uploaded requisition file is empty.');
  }

  const headerRowIndex = inferHeaderRow(rows);
  const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
  const descriptionIndex = getDescriptionHeaderIndex(headerRow);
  const quantityIndex = getHeaderIndex(headerRow, HEADER_ALIASES.quantity);
  const unitIndex = getHeaderIndex(headerRow, HEADER_ALIASES.unit);
  const dataRows = rows.slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 0);

  const items = [];
  for (const row of dataRows) {
    if (!row.some((cell) => String(cell ?? '').trim())) {
      continue;
    }

    const originalItem = descriptionIndex >= 0
      ? String(row[descriptionIndex] ?? '').trim()
      : inferDescription(row);

    if (!originalItem) {
      continue;
    }

    const quantity = quantityIndex >= 0 ? parseNumber(row[quantityIndex]) : inferQuantity(row);
    const requestedUnit = unitIndex >= 0 ? String(row[unitIndex] ?? '').trim() : '';

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

  const athenaPriceList = parseAthenaWorkbook(workbook);
  if (athenaPriceList.length > 0) {
    return athenaPriceList;
  }

  throw new Error('The price list must contain either product_name, keywords, unit, and price columns or the Athena workbook columns Product Name or Standard product name, Supplier Quantity and Supplier unit or Packaging per CTN, and Sale Price.');
}