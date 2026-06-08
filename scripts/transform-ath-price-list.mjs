import path from "node:path";
import xlsx from "xlsx";

const inputPath = path.resolve("./ATH PRICE LIST.xlsx");

function getOutputPath() {
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  if (!outArg) {
    return path.resolve("./ATH PRICE LIST - transformed.xlsx");
  }

  const value = outArg.slice("--out=".length).trim();
  return value ? path.resolve(value) : path.resolve("./ATH PRICE LIST - transformed.xlsx");
}

const SHEET_ORDER = [
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
  "FRESH FRUIT",
  "HYGIENE"
];

const CATEGORY_CODES = {
  "DRINKS": "DRK",
  "JUICES": "JCE",
  "MILK": "MLK",
  "COFFEE": "COF",
  "CANNED VEGETABLES": "VEG",
  "CANNED TOMATOES": "TOM",
  "CANNED FISH": "FSH",
  "CANNED MEAT": "MET",
  "CANNED FRUIT": "FRT",
  "SAUCES": "SAU",
  "COOKING SAUCES": "CKS",
  "SOUP POWDER": "SUP",
  "PASTA": "PAS",
  "RICE": "RIC",
  "FLOUR": "FLR",
  "JAMS": "JAM",
  "CEREALS": "CER",
  "SUGAR": "SUG",
  "OILS": "OIL",
  "HERBS & SPICES": "HRB",
  "CRISPS": "CRP",
  "BISCUITS": "BIS",
  "BAKING": "BAK",
  "FROZEN VEGETABLES": "FVE",
  "FROZEN POTATO": "FPO",
  "FROZEN FISH": "FFI",
  "FROZEN POULTRY": "FPL",
  "FROZEN BEEF": "BFF",
  "FROZEN PORK": "PRK",
  "FROZEN LAMB": "LMB",
  "ICE CREAM": "ICE",
  "FROZEN BREAD": "BRD",
  "FRESH MILK": "FMK",
  "FRESH YOGHURT": "FYG",
  "FRESH BUTTER": "FBT",
  "FRESH CHEESE": "FCH",
  "FRESH EGGS": "FEG",
  "FRESH COLD CUTS": "FCC",
  "FRESH VEGETABLES": "FVG",
  "FRESH FRUIT": "FFR",
  "HYGIENE": "HYG"
};

const FOOD_SECTION_NUMBER_TO_CATEGORY = {
  1: "DRINKS",
  2: "JUICES",
  3: "MILK",
  4: "COFFEE",
  5: "CANNED VEGETABLES",
  6: "CANNED TOMATOES",
  7: "CANNED FISH",
  8: "CANNED MEAT",
  9: "CANNED FRUIT",
  10: "SAUCES",
  11: "COOKING SAUCES",
  12: "SOUP POWDER",
  13: "PASTA",
  14: "RICE",
  15: "FLOUR",
  16: "JAMS",
  17: "CEREALS",
  18: "SUGAR",
  19: "OILS",
  20: "HERBS & SPICES",
  21: "CRISPS",
  22: "BISCUITS",
  23: "BAKING",
  24: "FROZEN VEGETABLES",
  25: "FROZEN POTATO",
  26: "FROZEN FISH",
  27: "FROZEN POULTRY",
  28: "FROZEN BEEF",
  29: "FROZEN PORK",
  30: "FROZEN LAMB",
  31: "ICE CREAM",
  32: "FROZEN BREAD",
  33: "FRESH MILK",
  34: "FRESH YOGHURT",
  35: "FRESH BUTTER",
  36: "FRESH CHEESE",
  37: "FRESH EGGS",
  38: "FRESH COLD CUTS",
  39: "FRESH VEGETABLES",
  40: "FRESH FRUIT"
};

const OUTPUT_HEADERS = [
  "ITEM CODE",
  "PRODUCT NAME",
  "SUPPLIER",
  "ORDER QUANTITY",
  "REMARKS",
  "COST PRICE",
  "SALE PRICE",
  "TOTAL"
];

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function findHeaderRow(rows, requiredHeaders) {
  return rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return requiredHeaders.every((required) => normalized.includes(required));
  });
}

function buildHeaderMap(headerRow) {
  return Object.fromEntries(headerRow.map((cell, index) => [normalizeHeader(cell), index]));
}

function addItem(recordsByCategory, category, record) {
  if (!recordsByCategory.has(category)) {
    recordsByCategory.set(category, []);
  }

  recordsByCategory.get(category).push(record);
}

function parseFoodSheet(recordsByCategory, workbook) {
  const ws = workbook.Sheets["FOOD"];
  if (!ws) {
    throw new Error("Sheet FOOD not found in input workbook.");
  }

  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const headerRowIndex = findHeaderRow(rows, ["description", "description2", "packaging per ctn", "cost price"]);
  if (headerRowIndex < 0) {
    throw new Error("Could not find FOOD header row.");
  }

  const headerMap = buildHeaderMap(rows[headerRowIndex]);
  let currentCategory = "DRINKS";

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];

    const markerRaw = String(row[0] ?? "").trim();
    const markerMatch = markerRaw.match(/^(\d+)\./);
    if (markerMatch) {
      const sectionNumber = Number(markerMatch[1]);
      if (FOOD_SECTION_NUMBER_TO_CATEGORY[sectionNumber]) {
        currentCategory = FOOD_SECTION_NUMBER_TO_CATEGORY[sectionNumber];
      }
      continue;
    }

    const description = String(row[headerMap["description"]] ?? "").trim();
    const description2 = String(row[headerMap["description2"]] ?? "").trim();
    const baseDescription = description || description2;
    const packaging = String(row[headerMap["packaging per ctn"]] ?? "").trim();
    const costRaw = row[headerMap["cost price"]];
    const hasUsefulData = description || description2 || packaging || String(costRaw ?? "").trim();

    if (!hasUsefulData) {
      continue;
    }

    const productName = [baseDescription, packaging].filter((part) => part.length > 0).join(" ").trim();
    const costNumber = toNumber(costRaw);
    const salePrice = costNumber === null ? "" : round2(costNumber * 1.4);
    const costPrice = String(costRaw ?? "").trim() === "" ? "" : costRaw;

    addItem(recordsByCategory, currentCategory, {
      productName,
      costPrice,
      salePrice
    });
  }
}

function parseNonFoodSheet(recordsByCategory, workbook) {
  const ws = workbook.Sheets["NON FOOD"];
  if (!ws) {
    throw new Error("Sheet NON FOOD not found in input workbook.");
  }

  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const headerRowIndex = findHeaderRow(rows, ["description", "size", "order qty"]);
  if (headerRowIndex < 0) {
    throw new Error("Could not find NON FOOD header row.");
  }

  const headerMap = buildHeaderMap(rows[headerRowIndex]);

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const marker = String(row[0] ?? "").trim().toLowerCase();
    if (marker.startsWith("extra list")) {
      break;
    }

    const description = String(row[headerMap["description"]] ?? "").trim();
    const packaging = String(row[headerMap["size"]] ?? "").trim();

    if (!description && !packaging) {
      continue;
    }

    const productName = [description, packaging].filter((part) => part.length > 0).join(" ").trim();
    addItem(recordsByCategory, "HYGIENE", {
      productName,
      costPrice: "",
      salePrice: ""
    });
  }
}

function createOutputWorkbook(recordsByCategory) {
  const workbook = xlsx.utils.book_new();

  for (const category of SHEET_ORDER) {
    const codePrefix = CATEGORY_CODES[category];
    const records = recordsByCategory.get(category) || [];
    const rows = [OUTPUT_HEADERS];

    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const itemCode = `ATH-${codePrefix}${String(i + 1).padStart(3, "0")}`;
      rows.push([
        itemCode,
        record.productName,
        "",
        "",
        "",
        record.costPrice,
        record.salePrice,
        ""
      ]);
    }

    const ws = xlsx.utils.aoa_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, ws, category);
  }

  return workbook;
}

function main() {
  const outputPath = getOutputPath();
  const inputWorkbook = xlsx.readFile(inputPath);
  const recordsByCategory = new Map();

  for (const category of SHEET_ORDER) {
    recordsByCategory.set(category, []);
  }

  parseFoodSheet(recordsByCategory, inputWorkbook);
  parseNonFoodSheet(recordsByCategory, inputWorkbook);

  const outputWorkbook = createOutputWorkbook(recordsByCategory);
  xlsx.writeFile(outputWorkbook, outputPath);

  let totalItems = 0;
  for (const category of SHEET_ORDER) {
    const count = (recordsByCategory.get(category) || []).length;
    totalItems += count;
    console.log(`${category}: ${count}`);
  }
  console.log(`TOTAL ITEMS: ${totalItems}`);
  console.log(`OUTPUT: ${outputPath}`);
}

main();
