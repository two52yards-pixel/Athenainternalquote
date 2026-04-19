import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const orderTemplatePath = path.resolve(__dirname, '..', 'Order.xlsx');

const COMPANY_NAME = 'Athena Marine Supplies Ltd';
const COMPANY_LINES = [
  '52 Guild Street',
  'Aberdeen, AB11 6NB',
  'www.athenamarine.co.uk',
  'info@athenamarine.co.uk'
];

const EXCEL_COLORS = {
  navy: 'FF14324A',
  navyDeep: 'FF0D2438',
  navySoft: 'FFEAF1F7',
  slate: 'FF5E7184',
  ink: 'FF1A2733',
  panel: 'FFF7F9FB',
  white: 'FFFFFFFF',
  border: 'FFD6DEE6',
  unavailable: 'FFFCE9E9',
  unavailableBorder: 'FFD67272'
};

const PDF_COLORS = {
  navy: '#14324a',
  navyDeep: '#0d2438',
  navySoft: '#eaf1f7',
  panel: '#f7f9fb',
  border: '#d6dee6',
  text: '#1a2733',
  muted: '#5e7184',
  zebra: '#fbfcfd',
  unavailable: '#fce9e9',
  unavailableBorder: '#d67272'
};

function toDate(value) {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatCurrency(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

function formatDate(value) {
  return toDate(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatQuantity(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '';
  }

  return Number.isInteger(numericValue) ? String(numericValue) : String(Number(numericValue.toFixed(3)));
}

function cloneStyle(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function copyCellFormatting(sourceCell, targetCell) {
  targetCell.style = cloneStyle(sourceCell.style) || {};
  targetCell.font = cloneStyle(sourceCell.font);
  targetCell.alignment = cloneStyle(sourceCell.alignment);
  targetCell.border = cloneStyle(sourceCell.border);
  targetCell.fill = cloneStyle(sourceCell.fill);
  targetCell.numFmt = sourceCell.numFmt;
  targetCell.protection = cloneStyle(sourceCell.protection);
}

function copyRowFormatting(worksheet, sourceRowNumber, targetRowNumber, maxColumn = 11) {
  const sourceRow = worksheet.getRow(sourceRowNumber);
  const targetRow = worksheet.getRow(targetRowNumber);
  targetRow.height = sourceRow.height;

  for (let column = 1; column <= maxColumn; column += 1) {
    copyCellFormatting(worksheet.getCell(sourceRowNumber, column), worksheet.getCell(targetRowNumber, column));
  }
}

function applyCellStyle(cell, style = {}) {
  if (style.font) {
    cell.font = { ...(cell.font || {}), ...style.font };
  }

  if (style.alignment) {
    cell.alignment = { ...(cell.alignment || {}), ...style.alignment };
  }

  if (style.fill) {
    cell.fill = style.fill;
  }

  if (style.border) {
    cell.border = style.border;
  }

  if (style.numFmt) {
    cell.numFmt = style.numFmt;
  }
}

function setRangeStyle(worksheet, cells, style) {
  for (const address of cells) {
    applyCellStyle(worksheet.getCell(address), style);
  }
}

function clearWorksheetRange(worksheet, startRow, endRow, startColumn = 1, endColumn = 11) {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    for (let columnNumber = startColumn; columnNumber <= endColumn; columnNumber += 1) {
      worksheet.getCell(rowNumber, columnNumber).value = null;
    }
  }
}

function standardBorder(color = EXCEL_COLORS.border) {
  return {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } }
  };
}

function estimateExcelRowHeight(item) {
  const longestText = Math.max(
    String(item.originalItem || '').length,
    String(buildSpecificationText(item)).length
  );

  if (longestText > 65) {
    return 30;
  }

  if (longestText > 40) {
    return 24;
  }

  return 21;
}

function ensureMergedRange(worksheet, range) {
  try {
    worksheet.mergeCells(range);
  } catch {
    // Ignore already-merged ranges.
  }
}

function setMergedCellValue(worksheet, range, value) {
  ensureMergedRange(worksheet, range);
  const masterCell = worksheet.getCell(range.split(':')[0]);
  masterCell.value = value;
}

function buildSpecificationText(item) {
  if (item.status === 'UNAVAILABLE') {
    return 'Unavailable';
  }

  if (!item.matchedProduct) {
    return 'Review required';
  }

  const baseText = item.matchedProductDisplay || item.matchedProduct;
  if (item.status !== 'MATCHED') {
    return `${baseText} (${item.status})`;
  }

  return baseText;
}

function styleWorkbookShell(worksheet) {
  worksheet.views = [];
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.35,
      bottom: 0.35,
      header: 0.2,
      footer: 0.2
    }
  };

  worksheet.properties.defaultRowHeight = 18;
  worksheet.columns = [
    { width: 13 },
    { width: 24 },
    { width: 24 },
    { width: 34 },
    { width: 10 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 }
  ];

  worksheet.getRow(1).height = 34;
  setRangeStyle(worksheet, ['C1', 'D1', 'E1', 'F1', 'G1', 'H1'], {
    font: { name: 'Cambria', size: 18, bold: true, color: { argb: EXCEL_COLORS.white } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navy } }
  });

  for (const rowNumber of [8, 9, 10, 11]) {
    worksheet.getRow(rowNumber).height = 20;
    applyCellStyle(worksheet.getCell(`A${rowNumber}`), {
      font: { name: 'Aptos', size: 10, color: { argb: EXCEL_COLORS.navyDeep }, italic: rowNumber === 11 },
      alignment: { vertical: 'middle' }
    });
  }

  worksheet.getRow(7).height = 21;
  applyCellStyle(worksheet.getCell('E7'), {
    font: { name: 'Aptos', size: 11, bold: true, color: { argb: EXCEL_COLORS.navy } },
    alignment: { vertical: 'middle', horizontal: 'left' }
  });
}

function styleQuoteHeader(worksheet) {
  for (const rowNumber of [8, 9, 10, 11, 12, 13]) {
    worksheet.getRow(rowNumber).height = 22;
    applyCellStyle(worksheet.getCell(`E${rowNumber}`), {
      font: { name: 'Aptos', size: 9, bold: true, color: { argb: EXCEL_COLORS.slate } },
      alignment: { vertical: 'middle' }
    });

    applyCellStyle(worksheet.getCell(`F${rowNumber}`), {
      font: { name: 'Cambria', size: 11, bold: rowNumber <= 10, color: { argb: EXCEL_COLORS.ink } },
      alignment: { vertical: 'middle', horizontal: 'left' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navySoft } },
      border: standardBorder()
    });

    applyCellStyle(worksheet.getCell(`G${rowNumber}`), {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navySoft } },
      border: standardBorder()
    });
  }

  for (const rowNumber of [8, 9, 10]) {
    applyCellStyle(worksheet.getCell(`H${rowNumber}`), {
      font: { name: 'Aptos', size: 9, bold: true, color: { argb: EXCEL_COLORS.slate } },
      alignment: { vertical: 'middle' }
    });

    applyCellStyle(worksheet.getCell(`I${rowNumber}`), {
      font: { name: 'Cambria', size: rowNumber === 10 ? 11 : 10.5, bold: true, color: { argb: EXCEL_COLORS.navyDeep } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navySoft } },
      border: standardBorder()
    });
  }
}

function styleItemHeaderRow(worksheet, rowNumber) {
  worksheet.getRow(rowNumber).height = 24;

  for (let column = 1; column <= 8; column += 1) {
    applyCellStyle(worksheet.getCell(rowNumber, column), {
      font: { name: 'Aptos', size: 9, bold: true, color: { argb: EXCEL_COLORS.white } },
      alignment: { vertical: 'middle', horizontal: column >= 5 ? 'center' : 'left' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navyDeep } },
      border: standardBorder(EXCEL_COLORS.navyDeep)
    });
  }
}

function styleItemRow(worksheet, rowNumber, item) {
  const fillColor = item.status === 'UNAVAILABLE'
    ? EXCEL_COLORS.unavailable
    : EXCEL_COLORS.white;
  const borderColor = item.status === 'UNAVAILABLE'
    ? EXCEL_COLORS.unavailableBorder
    : EXCEL_COLORS.border;

  worksheet.getRow(rowNumber).height = estimateExcelRowHeight(item);

  for (let column = 1; column <= 8; column += 1) {
    applyCellStyle(worksheet.getCell(rowNumber, column), {
      font: {
        name: column === 4 ? 'Cambria' : 'Aptos',
        size: 10,
        color: { argb: EXCEL_COLORS.ink },
        italic: item.status === 'UNAVAILABLE'
      },
      alignment: {
        vertical: 'middle',
        horizontal: column >= 5 ? 'center' : 'left',
        wrapText: column === 2 || column === 4 || column === 6
      },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } },
      border: standardBorder(borderColor)
    });
  }

  applyCellStyle(worksheet.getCell(`G${rowNumber}`), {
    alignment: { horizontal: 'right', vertical: 'middle' },
    font: { name: 'Aptos', size: 10, color: { argb: EXCEL_COLORS.ink } },
    numFmt: '£#,##0.00'
  });

  applyCellStyle(worksheet.getCell(`H${rowNumber}`), {
    alignment: { horizontal: 'right', vertical: 'middle' },
    font: { name: 'Aptos', size: 10, bold: true, color: { argb: EXCEL_COLORS.navyDeep } },
    numFmt: '£#,##0.00'
  });
}

function writeCompactFooter(worksheet, totalRow) {
  const footerStartRow = totalRow + 2;

  for (let rowNumber = footerStartRow; rowNumber <= footerStartRow + 4; rowNumber += 1) {
    for (let column = 1; column <= 11; column += 1) {
      worksheet.getCell(rowNumber, column).value = null;
      applyCellStyle(worksheet.getCell(rowNumber, column), {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.white } }
      });
    }
    worksheet.getRow(rowNumber).height = rowNumber === footerStartRow ? 16 : 18;
  }

  setMergedCellValue(worksheet, `A${footerStartRow}:H${footerStartRow}`, 'NOTES');
  applyCellStyle(worksheet.getCell(`A${footerStartRow}`), {
    font: { name: 'Aptos', size: 9, bold: true, color: { argb: EXCEL_COLORS.slate } }
  });
  setMergedCellValue(worksheet, `A${footerStartRow + 1}:H${footerStartRow + 1}`, 'Payment terms: payment is due on placing the order. Pricing covers product supply only unless stated otherwise.');
  setMergedCellValue(worksheet, `A${footerStartRow + 2}:H${footerStartRow + 2}`, 'This quotation remains valid for 14 days from the quote date. Delivery and customs costs, where applicable, are shown separately.');
  setMergedCellValue(worksheet, `A${footerStartRow + 4}:H${footerStartRow + 4}`, 'If you require any further assistance, please contact Athena Marine Supplies.');

  for (const rowNumber of [footerStartRow + 1, footerStartRow + 2, footerStartRow + 4]) {
    applyCellStyle(worksheet.getCell(`A${rowNumber}`), {
      font: { name: 'Aptos', size: 9.5, color: { argb: EXCEL_COLORS.slate } },
      alignment: { wrapText: true, vertical: 'middle' }
    });
  }
}

function populateTemplateHeader(worksheet, quote) {
  worksheet.getCell('E7').value = 'CUSTOMER DETAILS';

  const detailRows = [
    { row: 8, label: 'Client Name :', value: quote.clientName },
    { row: 9, label: 'Vessel Name :', value: quote.vesselName },
    { row: 10, label: 'IMO Number :', value: quote.imoNumber },
    { row: 11, label: 'Scheduled Arrival :', value: formatDate(quote.scheduledArrival) },
    { row: 12, label: 'Contact Email :', value: quote.contactEmail },
    { row: 13, label: 'Agent Name :', value: quote.agentName }
  ];

  for (const detail of detailRows) {
    worksheet.getCell(`E${detail.row}`).value = detail.label;
    setMergedCellValue(worksheet, `F${detail.row}:G${detail.row}`, detail.value || '');
  }

  worksheet.getCell('H8').value = 'QUOTE DATE';
  worksheet.getCell('H9').value = 'EXPIRY DATE';
  worksheet.getCell('H10').value = 'QUOTE NUMBER';
  setMergedCellValue(worksheet, 'I8:K8', toDate(quote.quoteDate || quote.createdAt));
  setMergedCellValue(worksheet, 'I9:K9', toDate(quote.expiryDate));
  setMergedCellValue(worksheet, 'I10:K10', quote.quoteNumber || quote.id);
  worksheet.getCell('I8').numFmt = 'dd/mm/yyyy';
  worksheet.getCell('I9').numFmt = 'dd/mm/yyyy';
}

export async function buildExcelBuffer(quote) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(orderTemplatePath);

  const worksheet = workbook.getWorksheet('Quote 1') || workbook.worksheets[0];
  styleWorkbookShell(worksheet);
  worksheet.insertRow(13, []);
  copyRowFormatting(worksheet, 12, 13, 11);
  populateTemplateHeader(worksheet, quote);
  styleQuoteHeader(worksheet);

  const itemStartRow = 18;
  const templateItemRow = itemStartRow;
  const items = quote.items.length ? quote.items : [{
    matchedProductKey: '',
    originalItem: '',
    matchedProduct: '',
    matchedProductDisplay: '',
    supplyQuantity: '',
    unit: '',
    price: 0,
    total: 0,
    status: 'MATCHED'
  }];
  const extraItemRows = Math.max(0, items.length - 1);

  if (extraItemRows > 0) {
    worksheet.insertRows(itemStartRow + 1, Array.from({ length: extraItemRows }, () => []));
    for (let index = 0; index < extraItemRows; index += 1) {
      const rowNumber = itemStartRow + 1 + index;
      copyRowFormatting(worksheet, templateItemRow, rowNumber, 11);
    }
  }

  styleItemHeaderRow(worksheet, 17);

  for (let index = 0; index < items.length; index += 1) {
    const rowNumber = itemStartRow + index;
    const item = items[index];

    if (rowNumber !== templateItemRow) {
      ensureMergedRange(worksheet, `B${rowNumber}:C${rowNumber}`);
    }

    worksheet.getCell(`A${rowNumber}`).value = item.matchedProductKey || '';
    worksheet.getCell(`B${rowNumber}`).value = item.originalItem || '';
    worksheet.getCell(`D${rowNumber}`).value = buildSpecificationText(item);
    worksheet.getCell(`E${rowNumber}`).value = item.supplyQuantity ?? '';
    worksheet.getCell(`F${rowNumber}`).value = item.unit || '';
    worksheet.getCell(`G${rowNumber}`).value = Number(item.price || 0);
    worksheet.getCell(`H${rowNumber}`).value = Number(item.total || 0);
    // Always restyle the first product line to match the rest
    styleItemRow(worksheet, rowNumber, item);
  }

  const itemEndRow = itemStartRow + items.length - 1;
  const subtotalRow = itemEndRow + 1;
  const vatRow = subtotalRow + 1;
  const deliveryRow = subtotalRow + 2;
  const totalRow = subtotalRow + 4;

  clearWorksheetRange(worksheet, subtotalRow, totalRow + 8);

  worksheet.getCell(`H${subtotalRow}`).value = 'Subtotal';
  worksheet.getCell(`I${subtotalRow}`).value = { formula: `SUM(H${itemStartRow}:H${itemEndRow})` };
  worksheet.getCell(`H${vatRow}`).value = 'VAT';
  worksheet.getCell(`I${vatRow}`).value = 0;
  worksheet.getCell(`H${deliveryRow}`).value = 'Delivery & custom expenses';
  worksheet.getCell(`I${deliveryRow}`).value = 0;
  worksheet.getCell(`H${totalRow}`).value = 'TOTAL';
  worksheet.getCell(`I${totalRow}`).value = { formula: `I${subtotalRow}+I${vatRow}+I${deliveryRow}` };

  for (const rowNumber of [subtotalRow, vatRow, deliveryRow, totalRow]) {
    worksheet.getRow(rowNumber).height = rowNumber === totalRow ? 24 : 20;
    applyCellStyle(worksheet.getCell(`H${rowNumber}`), {
      font: { name: 'Aptos', size: rowNumber === totalRow ? 10.5 : 9.5, bold: true, color: { argb: EXCEL_COLORS.navyDeep } },
      alignment: { horizontal: 'right', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navySoft } },
      border: standardBorder()
    });
    applyCellStyle(worksheet.getCell(`I${rowNumber}`), {
      font: { name: 'Cambria', size: rowNumber === totalRow ? 11.5 : 10, bold: true, color: { argb: EXCEL_COLORS.navyDeep } },
      alignment: { horizontal: 'right', vertical: 'middle' },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.navySoft } },
      border: standardBorder(),
      numFmt: '£#,##0.00'
    });
  }

  writeCompactFooter(worksheet, totalRow);

  return workbook.xlsx.writeBuffer();
}

function drawLabelValue(document, label, value, x, y, width, options = {}) {
  document.font(options.labelFont || 'Helvetica-Bold').fontSize(options.labelSize || 8.5).fillColor(options.labelColor || PDF_COLORS.muted);
  document.text(label, x, y, { width, continued: false });
  document.font(options.valueFont || 'Times-Roman').fontSize(options.valueSize || 10.5).fillColor(options.valueColor || PDF_COLORS.text);
  document.text(value || '-', x, y + 12, { width });
}

function rowStatusText(item) {
  if (item.status === 'UNAVAILABLE') {
    return 'Unavailable';
  }

  if (!item.matchedProduct) {
    return 'Review required';
  }

  return item.matchedProductDisplay || item.matchedProduct;
}

function drawTableHeader(document, startX, startY, columnWidths) {
  const headers = ['#', 'Requested Item', 'Quoted Item', 'Qty', 'Unit', 'Unit Price', 'Total'];
  let cursorX = startX;

  document.save();
  document.roundedRect(startX, startY, columnWidths.reduce((sum, width) => sum + width, 0), 26, 6).fill(PDF_COLORS.navyDeep);
  document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);

  headers.forEach((header, index) => {
    document.text(header, cursorX + 7, startY + 8, { width: columnWidths[index] - 14, align: index >= 3 ? 'right' : 'left' });
    cursorX += columnWidths[index];
  });
  document.restore();
}

function getTableRowValues(item, rowNumber) {
  return [
    String(item.lineNumber || rowNumber + 1),
    item.originalItem || '',
    rowStatusText(item),
    formatQuantity(item.supplyQuantity),
    item.unit || '',
    formatCurrency(item.price),
    formatCurrency(item.total)
  ];
}

function measureTableRowHeight(document, values, columnWidths) {
  const cellHeights = values.map((value, index) => document.heightOfString(String(value || '-'), {
    width: columnWidths[index] - 12,
    align: index >= 3 ? 'right' : 'left'
  }));

  return Math.max(24, ...cellHeights.map((height) => height + 10));
}

function drawTableRow(document, item, rowNumber, startX, startY, columnWidths) {
  const columns = getTableRowValues(item, rowNumber);
  const rowHeight = measureTableRowHeight(document, columns, columnWidths);
  const rowFill = item.status === 'UNAVAILABLE'
    ? PDF_COLORS.unavailable
    : (rowNumber % 2 === 0 ? PDF_COLORS.zebra : '#ffffff');
  const strokeColor = item.status === 'UNAVAILABLE' ? PDF_COLORS.unavailableBorder : PDF_COLORS.border;

  let cursorX = startX;
  document.save();
  document.rect(startX, startY, columnWidths.reduce((sum, width) => sum + width, 0), rowHeight).fillAndStroke(rowFill, strokeColor);
  document.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.text);

  columns.forEach((value, index) => {
    document.text(String(value || '-'), cursorX + 6, startY + 6, {
      width: columnWidths[index] - 12,
      align: index >= 3 ? 'right' : 'left'
    });
    if (index < columns.length - 1) {
      document.moveTo(cursorX + columnWidths[index], startY)
        .lineTo(cursorX + columnWidths[index], startY + rowHeight)
        .stroke(strokeColor);
    }
    cursorX += columnWidths[index];
  });
  document.restore();

  return rowHeight;
}

export function buildPdfBuffer(quote) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    const startX = 40;
    const pageWidth = document.page.width - 80;
    const columnWidths = [24, 126, 164, 38, 64, 56, 52];
    let cursorY = 40;

    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const drawPageHeader = () => {
      document.save();
      document.roundedRect(startX, 40, pageWidth, 82, 14).fill(PDF_COLORS.navy);
      document.fillColor('#ffffff').font('Times-Bold').fontSize(23).text(COMPANY_NAME, startX + 18, 58, { width: 290 });
      document.font('Helvetica').fontSize(9.25).text(COMPANY_LINES.join('  |  '), startX + 18, 89, { width: 320 });
      document.font('Times-Bold').fontSize(18).fillColor('#ffffff').text('QUOTATION', startX + 356, 64, { width: 140, align: 'right' });
      document.font('Helvetica').fontSize(8.5).fillColor('#e8edf2').text('Marine supply quotation', startX + 360, 90, { width: 136, align: 'right' });
      document.restore();
      cursorY = 140;
    };

    const ensurePageSpace = (height, includeTableHeader = false) => {
      if (cursorY + height <= document.page.height - 48) {
        return;
      }

      document.addPage();
      drawPageHeader();
      if (includeTableHeader) {
        drawTableHeader(document, startX, cursorY, columnWidths);
        cursorY += 28;
      }
    };

    drawPageHeader();

    document.save();
    document.roundedRect(startX, cursorY, 248, 160, 12).fillAndStroke(PDF_COLORS.navySoft, PDF_COLORS.border);
    document.roundedRect(startX + 275, cursorY, 248, 160, 12).fillAndStroke(PDF_COLORS.navySoft, PDF_COLORS.border);
    document.roundedRect(startX, cursorY, 248, 26, 12).fill(PDF_COLORS.navySoft);
    document.roundedRect(startX + 275, cursorY, 248, 26, 12).fill(PDF_COLORS.navySoft);
    document.restore();

    document.fillColor(PDF_COLORS.navyDeep).font('Helvetica-Bold').fontSize(10.5).text('CLIENT DETAILS', startX + 14, cursorY + 8);
    drawLabelValue(document, 'Client Name', quote.clientName, startX + 14, cursorY + 36, 220);
    drawLabelValue(document, 'Vessel Name', quote.vesselName, startX + 14, cursorY + 66, 220);
    drawLabelValue(document, 'IMO Number', quote.imoNumber, startX + 14, cursorY + 96, 100);
    drawLabelValue(document, 'Scheduled Arrival', formatDate(quote.scheduledArrival), startX + 120, cursorY + 96, 114);

    document.fillColor(PDF_COLORS.navyDeep).font('Helvetica-Bold').fontSize(10.5).text('QUOTE DETAILS', startX + 289, cursorY + 8);
    drawLabelValue(document, 'Quote Number', quote.quoteNumber || quote.id, startX + 289, cursorY + 36, 220);
    drawLabelValue(document, 'Quote Date', formatDate(quote.quoteDate || quote.createdAt), startX + 289, cursorY + 66, 100);
    drawLabelValue(document, 'Expiry Date', formatDate(quote.expiryDate), startX + 403, cursorY + 66, 106);
    drawLabelValue(document, 'Contact Email', quote.contactEmail, startX + 289, cursorY + 96, 220);
    drawLabelValue(document, 'Agent Name', quote.agentName, startX + 289, cursorY + 126, 220);
    if (quote.port) {
      drawLabelValue(document, 'Port', quote.port, startX + 14, cursorY + 126, 220);
    }

    cursorY += 192;
    drawTableHeader(document, startX, cursorY, columnWidths);
    cursorY += 28;

    for (let index = 0; index < quote.items.length; index += 1) {
      const previewValues = getTableRowValues(quote.items[index], index);
      ensurePageSpace(measureTableRowHeight(document, previewValues, columnWidths), true);
      const rowHeight = drawTableRow(document, quote.items[index], index, startX, cursorY, columnWidths);
      cursorY += rowHeight;
    }

    cursorY += 18;
    ensurePageSpace(120);

    const totalsX = startX + 320;
    document.save();
    document.roundedRect(totalsX, cursorY, 203, 92, 12).fillAndStroke(PDF_COLORS.navySoft, PDF_COLORS.border);
    document.roundedRect(totalsX, cursorY, 203, 24, 12).fill(PDF_COLORS.navySoft);
    document.restore();
    document.font('Helvetica-Bold').fontSize(10).fillColor(PDF_COLORS.navyDeep).text('QUOTE TOTALS', totalsX + 14, cursorY + 7, { width: 175, align: 'left' });
    drawLabelValue(document, 'Subtotal', formatCurrency(quote.summary.totalValue), totalsX + 14, cursorY + 30, 175, { valueSize: 10 });
    drawLabelValue(document, 'VAT', formatCurrency(0), totalsX + 14, cursorY + 54, 175, { valueSize: 10 });
    document.font('Helvetica-Bold').fontSize(11).fillColor(PDF_COLORS.navyDeep).text('Total', totalsX + 14, cursorY + 76, { width: 80 });
    document.font('Times-Bold').fontSize(14).fillColor(PDF_COLORS.navy).text(formatCurrency(quote.summary.totalValue), totalsX + 90, cursorY + 74, { width: 99, align: 'right' });

    cursorY += 122;
    ensurePageSpace(70);

    document.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_COLORS.muted).text('NOTES', startX, cursorY, { width: 80 });
    document.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.muted);
    document.text('Payment terms: payment is due on placing the order.', startX, cursorY + 14, { width: 300 });
    document.text('This quotation is valid for 14 days from the quote date and covers product supply only unless otherwise stated.', startX, cursorY + 30, { width: 360 });
    document.text('If you require any further assistance, please contact Athena Marine Supplies.', startX, cursorY + 52, { width: 360 });

    document.end();
  });
}
