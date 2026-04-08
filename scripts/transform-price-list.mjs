import path from 'node:path';
import ExcelJS from 'exceljs';
import xlsx from 'xlsx';

const sourcePath = path.resolve('./data/AMS PRL.xlsx');
const outputPath = path.resolve('./data/new price list.xlsx');
const referencePath = path.resolve('../ordertemp/Order.xlsx');
const sheetNames = ['DRY STORES', 'FRESH FOODS'];
const targetHeaders = [
  'Item code',
  'Product Name',
  'Supplier Quantity',
  'Supplier unit',
  'Order quantity',
  'Comments',
  'Cost price',
  'Sale Price',
  'Total'
];
const inspectTerms = ['tetley', 'bean', 'cheese slice', 'egg', 'water', 'tea'];
const currencyColumns = new Set([7, 8, 9]);
const numericColumns = new Set([5, 7, 8, 9]);
const minWidths = [14, 30, 18, 14, 14, 24, 14, 14, 16];
const currencyNumberFormat = '£#,##0.00';
const quantityNumberFormat = '0.###';
const APPROX_ONE_KG_EACH_PRODUCTS = new Map([
  ['FRU020', 'Approx 1kg each'],
  ['FRU021', 'Approx 1kg each'],
  ['FRU024', 'Approx 1kg each']
]);

function getSelectedSheetNames(availableSheetNames) {
  const sheetFlagIndex = process.argv.findIndex((arg) => arg === '--sheet');
  const inlineSheetArg = process.argv.find((arg) => arg.startsWith('--sheet='));

  if (inlineSheetArg) {
    const sheetName = inlineSheetArg.slice('--sheet='.length).trim();
    return sheetName ? [sheetName] : availableSheetNames;
  }

  if (sheetFlagIndex >= 0 && process.argv[sheetFlagIndex + 1]) {
    return [process.argv[sheetFlagIndex + 1].trim()];
  }

  return availableSheetNames;
}

function cloneStyle(style) {
  return JSON.parse(JSON.stringify(style || {}));
}

async function loadReferenceStyles() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(referencePath);
  const sheet = workbook.worksheets[0];

  return {
    title: {
      style: cloneStyle(sheet.getCell('C1').style),
      height: sheet.getRow(1).height || 42
    },
    section: {
      style: cloneStyle(sheet.getCell('E7').style),
      height: sheet.getRow(7).height || 18
    },
    header: {
      left: cloneStyle(sheet.getCell('A16').style),
      middle: cloneStyle(sheet.getCell('D16').style),
      center: cloneStyle(sheet.getCell('G16').style),
      right: cloneStyle(sheet.getCell('H16').style),
      height: sheet.getRow(16).height || 16
    },
    data: {
      left: cloneStyle(sheet.getCell('A17').style),
      middle: cloneStyle(sheet.getCell('D17').style),
      center: cloneStyle(sheet.getCell('G17').style),
      right: cloneStyle(sheet.getCell('H17').style),
      height: sheet.getRow(17).height || 18
    }
  };
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findHeaderRow(rows) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.includes('item code') && normalized.includes('standard product name');
  });
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  const cleaned = text.replace(/,/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value, decimals = 3) {
  if (!Number.isFinite(value)) {
    return '';
  }

  const fixed = Number(value.toFixed(decimals));
  return Number.isInteger(fixed) ? String(fixed) : String(fixed);
}

function normalizeUnitLabel(unit) {
  const normalized = String(unit ?? '').trim().toUpperCase();

  if (!normalized) {
    return '';
  }

  if (['G', 'GRAM', 'GRAMS'].includes(normalized)) {
    return 'KG';
  }

  if (['KG', 'KGS', 'KILO', 'KILOS'].includes(normalized)) {
    return 'KG';
  }

  if (['ML', 'MLS'].includes(normalized)) {
    return 'ML';
  }

  if (['L', 'LTR', 'LTRS', 'LT', 'LITRE', 'LITRES'].includes(normalized)) {
    return 'L';
  }

  if (['PC', 'PCS', 'PIECE', 'PIECES'].includes(normalized)) {
    return 'PCS';
  }

  if (['BG', 'BAG', 'BAGS'].includes(normalized)) {
    return 'BAGS';
  }

  if (['SLICE', 'SLICES'].includes(normalized)) {
    return 'SLICES';
  }

  return normalized;
}

function convertAmountForUnit(amount, unit) {
  const normalizedUnit = normalizeUnitLabel(unit);
  const numericAmount = toNumber(amount);

  if (numericAmount === null) {
    return { amountText: '', unit: normalizedUnit };
  }

  if (normalizedUnit === 'KG' && ['G', 'GRAM', 'GRAMS'].includes(String(unit ?? '').trim().toUpperCase())) {
    return {
      amountText: formatNumber(numericAmount / 1000),
      unit: 'KG'
    };
  }

  return {
    amountText: formatNumber(numericAmount),
    unit: normalizedUnit
  };
}

function inferCountUnit(text, productName) {
  const normalizedText = String(text ?? '').toLowerCase();
  const normalizedProduct = String(productName ?? '').toLowerCase();

  if (/slice/.test(normalizedText) || /slice/.test(normalizedProduct)) {
    return 'SLICES';
  }

  if (/bag/.test(normalizedText) || /tea/.test(normalizedProduct)) {
    return 'BAGS';
  }

  if (/egg/.test(normalizedProduct)) {
    return 'PCS';
  }

  if (/piece|pcs/.test(normalizedText)) {
    return 'PCS';
  }

  return '';
}

function parseLegacyPackaging(packaging, productName) {
  const text = String(packaging ?? '').trim();
  if (!text) {
    return { quantity: '', unit: '' };
  }

  const compact = text.replace(/\s+/g, ' ').trim();
  let match = compact.match(/^(?:case|box|pkt|pack|tray)?\s*of\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/i);
  if (match) {
    const converted = convertAmountForUnit(match[2], match[3]);
    const outerQuantity = Number(match[1]);
    return {
      quantity: outerQuantity === 1 ? converted.amountText : `${formatNumber(outerQuantity)} x ${converted.amountText}`,
      unit: converted.unit
    };
  }

  match = compact.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/i);
  if (match) {
    const converted = convertAmountForUnit(match[2], match[3]);
    const outerQuantity = Number(match[1]);
    return {
      quantity: outerQuantity === 1 ? converted.amountText : `${formatNumber(outerQuantity)} x ${converted.amountText}`,
      unit: converted.unit
    };
  }

  match = compact.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/i);
  if (match) {
    const outerQuantity = Number(match[1]);
    return {
      quantity: outerQuantity === 1 ? formatNumber(Number(match[2])) : `${formatNumber(outerQuantity)} x ${formatNumber(Number(match[2]))}`,
      unit: inferCountUnit(compact, productName)
    };
  }

  match = compact.match(/^(?:case|box|pkt|pack|tray)?\s*of\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/i);
  if (match) {
    const inferredUnit = normalizeUnitLabel(match[2]) || inferCountUnit(compact, productName);
    return {
      quantity: formatNumber(Number(match[1])),
      unit: inferredUnit
    };
  }

  match = compact.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/i);
  if (match) {
    const converted = convertAmountForUnit(match[1], match[2]);
    return {
      quantity: converted.amountText,
      unit: converted.unit
    };
  }

  match = compact.match(/^(\d+(?:\.\d+)?)$/);
  if (match) {
    return {
      quantity: formatNumber(Number(match[1])),
      unit: inferCountUnit(compact, productName)
    };
  }

  return {
    quantity: compact,
    unit: inferCountUnit(compact, productName)
  };
}

function normalizeStructuredQuantity(quantity, unit, productName) {
  const quantityText = String(quantity ?? '').trim();
  const unitText = String(unit ?? '').trim();
  if (!quantityText && !unitText) {
    return { quantity: '', unit: '' };
  }

  const multipliedMatch = quantityText.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/i);
  if (multipliedMatch) {
    const converted = convertAmountForUnit(multipliedMatch[2], unitText);
    const outerQuantity = Number(multipliedMatch[1]);
    return {
      quantity: outerQuantity === 1 ? converted.amountText : `${formatNumber(outerQuantity)} x ${converted.amountText}`,
      unit: converted.unit || inferCountUnit(quantityText, productName)
    };
  }

  const converted = convertAmountForUnit(quantityText, unitText);
  return {
    quantity: converted.amountText || quantityText,
    unit: converted.unit || inferCountUnit(`${quantityText} ${unitText}`, productName)
  };
}

function buildHeaderMap(headerRow) {
  return Object.fromEntries(headerRow.map((cell, index) => [normalizeHeader(cell), index]));
}

function isEmptyRow(row) {
  return row.every((cell) => String(cell ?? '').trim() === '');
}

function buildSectionRow(row) {
  const sectionText = row.find((cell) => String(cell ?? '').trim()) ?? '';
  return {
    type: 'section',
    title: String(sectionText).trim()
  };
}

function applyApproximateWeightNormalization(itemCode, supplierFields, comments) {
  if (!APPROX_ONE_KG_EACH_PRODUCTS.has(itemCode)) {
    return { supplierFields, comments };
  }

  const note = APPROX_ONE_KG_EACH_PRODUCTS.get(itemCode);
  const normalizedComments = String(comments || '').trim();

  return {
    supplierFields: {
      quantity: '1',
      unit: 'KG'
    },
    comments: normalizedComments ? `${normalizedComments}; ${note}` : note
  };
}

function transformSheet(workbook, sheetName) {
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  const headerRowIndex = findHeaderRow(rows);

  if (headerRowIndex === -1) {
    throw new Error(`Header row not found for ${sheetName}`);
  }

  const headerMap = buildHeaderMap(rows[headerRowIndex]);
  const transformedRows = [];

  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (isEmptyRow(row)) {
      continue;
    }

    const itemCode = String(row[headerMap['item code']] ?? '').trim();
    const productName = String(row[headerMap['standard product name']] ?? '').trim();

    if (!itemCode && productName && row.filter((cell) => String(cell ?? '').trim()).length === 1) {
      transformedRows.push(buildSectionRow(row));
      continue;
    }

    if (!itemCode && !productName) {
      continue;
    }

    const hasLegacyPackaging = headerMap['packaging per ctn'] !== undefined;
    const supplierFields = hasLegacyPackaging
      ? parseLegacyPackaging(row[headerMap['packaging per ctn']], productName)
      : normalizeStructuredQuantity(
          row[headerMap['supplier qantity'] ?? headerMap['supplier quantity']],
          row[headerMap['supplier unit']],
          productName
        );

    const orderQuantity = toNumber(row[headerMap['order quantity'] ?? headerMap['order qty']]);
    const costPrice = toNumber(row[headerMap['cost price']]);
    const salePrice = toNumber(row[headerMap['sale price']]);
    const comments = String(row[headerMap['comments']] ?? '').trim();
    const normalizedApproximation = applyApproximateWeightNormalization(itemCode, supplierFields, comments);
    transformedRows.push({
      type: 'data',
      values: [
        itemCode,
        productName,
        normalizedApproximation.supplierFields.quantity,
        normalizedApproximation.supplierFields.unit,
        orderQuantity,
        normalizedApproximation.comments,
        costPrice,
        salePrice
      ]
    });
  }

  return transformedRows;
}

function createCellStyle(referenceStyles, columnNumber, isHeader = false) {
  if (columnNumber === 1) {
    return cloneStyle(isHeader ? referenceStyles.header.left : referenceStyles.data.left);
  }

  if (columnNumber === targetHeaders.length) {
    return cloneStyle(isHeader ? referenceStyles.header.right : referenceStyles.data.right);
  }

  if (numericColumns.has(columnNumber)) {
    return cloneStyle(isHeader ? referenceStyles.header.center : referenceStyles.data.center);
  }

  return cloneStyle(isHeader ? referenceStyles.header.middle : referenceStyles.data.middle);
}

function valueLength(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  return String(value).length;
}

function applyCellNumberFormat(cell, columnNumber) {
  if (currencyColumns.has(columnNumber)) {
    cell.numFmt = currencyNumberFormat;
    return;
  }

  if (columnNumber === 5) {
    cell.numFmt = quantityNumberFormat;
  }
}

function autoFitColumns(worksheet, rowEntries) {
  const widths = targetHeaders.map((header, index) => Math.max(minWidths[index], valueLength(header) + 2));

  for (const entry of rowEntries) {
    if (entry.type !== 'data') {
      continue;
    }

    for (let index = 0; index < entry.values.length; index += 1) {
      widths[index] = Math.max(widths[index], Math.min(valueLength(entry.values[index]) + 3, 60));
    }
  }

  worksheet.columns = widths.map((width) => ({ width }));
}

function applyWorksheetStyles(worksheet, sheetName, rowEntries, referenceStyles) {
  worksheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  autoFitColumns(worksheet, rowEntries);

  worksheet.mergeCells(1, 1, 1, targetHeaders.length);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = 'ATHENA MARINE SUPPLIES LTD';
  titleCell.style = cloneStyle(referenceStyles.title.style);
  worksheet.getRow(1).height = referenceStyles.title.height;

  worksheet.mergeCells(2, 1, 2, targetHeaders.length);
  const sheetLabelCell = worksheet.getCell(2, 1);
  sheetLabelCell.value = sheetName;
  sheetLabelCell.style = cloneStyle(referenceStyles.section.style);
  sheetLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
  worksheet.getRow(2).height = referenceStyles.section.height;

  const headerRow = worksheet.getRow(3);
  targetHeaders.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = header;
    cell.style = createCellStyle(referenceStyles, index + 1, true);
  });
  headerRow.height = referenceStyles.header.height;
  worksheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: targetHeaders.length }
  };

  let currentRowNumber = 4;

  for (const entry of rowEntries) {
    const row = worksheet.getRow(currentRowNumber);

    if (entry.type === 'section') {
      worksheet.mergeCells(currentRowNumber, 1, currentRowNumber, targetHeaders.length);
      const cell = row.getCell(1);
      cell.value = entry.title;
      cell.style = cloneStyle(referenceStyles.section.style);
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      row.height = referenceStyles.section.height;
      currentRowNumber += 1;
      continue;
    }

    entry.values.forEach((value, index) => {
      const columnNumber = index + 1;
      const cell = row.getCell(columnNumber);
      cell.value = value ?? '';
      cell.style = createCellStyle(referenceStyles, columnNumber, false);

      if (numericColumns.has(columnNumber)) {
        cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
      }

      applyCellNumberFormat(cell, columnNumber);
    });

    const totalCell = row.getCell(9);
    totalCell.value = { formula: `E${currentRowNumber}*H${currentRowNumber}` };
    totalCell.style = createCellStyle(referenceStyles, 9, false);
    totalCell.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
    applyCellNumberFormat(totalCell, 9);

    row.height = referenceStyles.data.height;
    currentRowNumber += 1;
  }
}

async function writeWorkbook(sheetEntries) {
  const referenceStyles = await loadReferenceStyles();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GitHub Copilot';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  for (const [sheetName, rowEntries] of sheetEntries) {
    const worksheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 3, showGridLines: false }]
    });
    applyWorksheetStyles(worksheet, sheetName, rowEntries, referenceStyles);
  }

  try {
    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  } catch (error) {
    if (error?.code !== 'EBUSY') {
      throw error;
    }

    const fallbackPath = path.resolve('./data/new price list styled.xlsx');
    await workbook.xlsx.writeFile(fallbackPath);
    return fallbackPath;
  }
}

function inspectWorkbook() {
  const workbook = xlsx.readFile(outputPath, { cellFormula: true });

  for (const sheetName of workbook.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    console.log(`SHEET=${sheetName}`);

    for (const row of rows.slice(0, 12)) {
      console.log(JSON.stringify(row));
    }

    console.log('MATCHES');
    for (const row of rows.filter((row, index) => index > 0 && inspectTerms.some((term) => String(row[1] ?? '').toLowerCase().includes(term))).slice(0, 20)) {
      console.log(JSON.stringify(row));
    }
  }
}

async function main() {
  if (process.argv.includes('--inspect')) {
    inspectWorkbook();
    return;
  }

  const sourceWorkbook = xlsx.readFile(sourcePath, { cellDates: false });
  const sheetEntries = [];
  const selectedSheetNames = getSelectedSheetNames(sourceWorkbook.SheetNames);

  for (const sheetName of selectedSheetNames) {
    sheetEntries.push([sheetName, transformSheet(sourceWorkbook, sheetName)]);
  }

  const writtenPath = await writeWorkbook(sheetEntries);
  console.log(`Created ${writtenPath}`);
}

await main();