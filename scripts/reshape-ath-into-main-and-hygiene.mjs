import path from "node:path";
import ExcelJS from "exceljs";

const inputPath = path.resolve("./ATH PRICE LIST - transformed v2.xlsx");
const outputPath = path.resolve("./ATH PRICE LIST - main + hygiene.xlsx");

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

const CATEGORY_ORDER = [
  "DRINKS",
  "JUICES",
  "MILK",
  "COFFEE",
  "CANNED VEGETABLES",
  "CANNED TOMATOES",
  "CANNED FISH",
  "CANNED MEAT",
  "CANNED FRUIT",
  "SAUCES",
  "COOKING SAUCES",
  "SOUP POWDER",
  "PASTA",
  "RICE",
  "FLOUR",
  "JAMS",
  "CEREALS",
  "SUGAR",
  "OILS",
  "HERBS & SPICES",
  "CRISPS",
  "BISCUITS",
  "BAKING",
  "FROZEN VEGETABLES",
  "FROZEN POTATO",
  "FROZEN FISH",
  "FROZEN POULTRY",
  "FROZEN BEEF",
  "FROZEN PORK",
  "FROZEN LAMB",
  "ICE CREAM",
  "FROZEN BREAD",
  "FRESH MILK",
  "FRESH YOGHURT",
  "FRESH BUTTER",
  "FRESH CHEESE",
  "FRESH EGGS",
  "FRESH COLD CUTS",
  "FRESH VEGETABLES",
  "FRESH FRUIT"
];

function rowToFixedValues(row) {
  const values = [];
  for (let col = 1; col <= 8; col += 1) {
    const cell = row.getCell(col).value;
    values.push(cell == null ? "" : cell);
  }
  return values;
}

function setCommonLayout(ws) {
  ws.columns = [
    { width: 16 },
    { width: 44 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 12 }
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

async function main() {
  const source = new ExcelJS.Workbook();
  await source.xlsx.readFile(inputPath);

  const output = new ExcelJS.Workbook();
  const mainSheet = output.addWorksheet("DRY STORE");
  const hygieneSheet = output.addWorksheet("HYGIENE");

  mainSheet.addRow(HEADERS);
  hygieneSheet.addRow(HEADERS);
  setCommonLayout(mainSheet);
  setCommonLayout(hygieneSheet);

  for (const category of CATEGORY_ORDER) {
    const ws = source.getWorksheet(category);
    if (!ws) {
      continue;
    }

    const headingRow = mainSheet.addRow([category, "", "", "", "", "", "", ""]);
    headingRow.font = { bold: true };

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      mainSheet.addRow(rowToFixedValues(row));
    });
  }

  const hygieneSource = source.getWorksheet("HYGIENE");
  if (hygieneSource) {
    hygieneSource.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }
      hygieneSheet.addRow(rowToFixedValues(row));
    });
  }

  await output.xlsx.writeFile(outputPath);
  console.log(`OUTPUT: ${outputPath}`);
}

main();
