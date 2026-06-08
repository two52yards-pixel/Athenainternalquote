import path from "node:path";
import ExcelJS from "exceljs";

const inputPath = path.resolve("./ATH PRICE LIST - main + hygiene.xlsx");
const outputPath = path.resolve("./ATH PRICE LIST - main + hygiene themed.xlsx");

const HEADER_BG = "FF003459";
const HEADER_TEXT = "FFFFFFFF";
const SHEET_BG = "FFF2F2F2";
const CATEGORY_BG = "FFD9E7F2";
const CATEGORY_TEXT = "FF0E3650";
const ROW_ODD_BG = "FFFFFFFF";
const ROW_EVEN_BG = "FFF7FBFF";
const BORDER_COLOR = "FFD7E2EA";
const BODY_TEXT = "FF003459";

const HEADERS = [
  "ITEM CODE",
  "PRODUCT NAME",
  "SUPPLIER",
  "ORDER QUANTITY",
  "REMARKS",
  "COST PRICE",
  "SALE PRICE",
  "TOTAL"
];

function isHeaderRow(row) {
  return String(row.getCell(1).value ?? "").trim() === "ITEM CODE";
}

function isCategoryRow(row) {
  const first = String(row.getCell(1).value ?? "").trim();
  const second = String(row.getCell(2).value ?? "").trim();
  return !!first && !second;
}

function styleHeaderRow(row) {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Open Sans", size: 11, bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } }
    };
  });
}

function styleCategoryRow(row) {
  row.height = 21;
  for (let col = 1; col <= HEADERS.length; col += 1) {
    const cell = row.getCell(col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_BG } };
    cell.font = {
      name: "Open Sans",
      size: 10,
      bold: col === 1,
      color: { argb: CATEGORY_TEXT }
    };
    cell.alignment = { vertical: "middle", horizontal: col === 1 ? "left" : "center" };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } }
    };
  }
}

function styleDataRow(row, dataIndex) {
  row.height = 20;
  const fillColor = dataIndex % 2 === 0 ? ROW_EVEN_BG : ROW_ODD_BG;

  for (let col = 1; col <= HEADERS.length; col += 1) {
    const cell = row.getCell(col);
    cell.font = { name: "Open Sans", size: 10, color: { argb: BODY_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
    cell.alignment = {
      vertical: "middle",
      horizontal: col >= 6 ? "right" : "left",
      wrapText: col === 2 || col === 5
    };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } }
    };

    if (col >= 6 && col <= 8 && typeof cell.value === "number") {
      cell.numFmt = "0.00";
    }
  }
}

function setSheetLayout(ws) {
  ws.properties.defaultRowHeight = 20;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns = [
    { width: 16 },
    { width: 48 },
    { width: 16 },
    { width: 18 },
    { width: 20 },
    { width: 14 },
    { width: 14 },
    { width: 14 }
  ];

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SHEET_BG } };
    });
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: HEADERS.length }
  };
}

function styleSheet(ws, hasCategoryRows) {
  setSheetLayout(ws);

  let dataRowCounter = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || isHeaderRow(row)) {
      styleHeaderRow(row);
      return;
    }

    if (hasCategoryRows && isCategoryRow(row)) {
      styleCategoryRow(row);
      return;
    }

    dataRowCounter += 1;
    styleDataRow(row, dataRowCounter);
  });
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  const dryStore = wb.getWorksheet("DRY STORE");
  const hygiene = wb.getWorksheet("HYGIENE");

  if (!dryStore || !hygiene) {
    throw new Error("Expected DRY STORE and HYGIENE sheets in input workbook.");
  }

  styleSheet(dryStore, true);
  styleSheet(hygiene, false);

  await wb.xlsx.writeFile(outputPath);
  console.log(`OUTPUT: ${outputPath}`);
}

main();
