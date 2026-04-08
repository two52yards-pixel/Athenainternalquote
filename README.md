# Athena Marine Internal Quote System

Internal web-based quoting prototype for Athena Marine Supplies. Staff can upload a requisition file, review the matches against a master price list, and export the draft quote to Excel or PDF.

## Features

- Upload requisitions in `.xlsx`, `.xls`, or `.csv`
- Extract line items and normalize text before matching
- Modular two-step engine: product matching first, then customer-unit to supplier-unit conversion and pricing
- Review screen for correcting matches before export
- Export reviewed quotes as Excel or PDF
- Local JSON quote history for audit and future learning workflows

## Project Structure

```text
internal-quote-system/
  data/
    AMS PRL.xlsx
    new price list.xlsx
    sample-price-list.xlsx
    sample-price-list1.csv
    sample-requisition.csv
  logs/quotes/
  public/
    app.js
    index.html
    styles.css
  src/
    calculator.js
    exporters.js
    fileParser.js
    parser.js
    matcher.js
    quoteStore.js
    server.js
```

## Run Locally

1. Open a terminal in `internal-quote-system`
2. Install dependencies:

   ```powershell
   npm.cmd install
   ```

3. Start the app:

   ```powershell
   npm.cmd start
   ```

4. Open `http://localhost:3000`

## Default Data Files

- Master price list: `data/new price list.xlsx`
- Example requisition: `data/sample-requisition.csv`
- Example master price list formats: `data/sample-price-list.xlsx`, `data/sample-price-list1.csv`

You can point the app to another price list with an environment variable:

```powershell
$env:PRICE_LIST_FILE = "C:\path\to\your\master-price-list.xlsx"
npm.cmd start
```

Expected price list columns:

- `product_name`
- `keywords`
- `unit`
- `price`

The loader supports the Athena multi-sheet workbook format, and the app now defaults to the transformed workbook at `data/new price list.xlsx` for catalog loading and fuzzy matching.

Supported Athena columns now include either the older layout with `PACKAGING PER CTN`, or the updated structured supplier layout with:

- `Standard product name`
- `SUPPLIER QANTITY`
- `SUPPLIER UNIT`
- `Sale Price`

When the updated layout is present, the app reads the supplier quantity and supplier unit directly and keeps each workbook row as a distinct catalog option, so duplicate product names with different units or prices stay separate.

Recommended requisition columns:

- `description`
- `quantity`
- `unit`

The parser also tries common alternatives such as `item`, `product`, `qty`, and `uom`.

## Matching And Quantity Logic

- Product matching cleans input text, removes numbers and symbols, and scores products by shared keywords/name tokens.
- Keyword matching runs first and selects the product with the highest keyword hit count.
- If keyword matching fails, Fuse.js fuzzy matching compares the cleaned input against `product_name` and `keywords` and accepts the best result only when similarity is at least `0.7`.
- The fuzzy threshold is configurable with `FUZZY_MATCH_THRESHOLD`.
- Athena supplier units are parsed into one or more selectable unit options from packaging values such as `1 x 5kg`, `24 x 500ml`, or `Box of 12 / 5kg`.
- The engine reads the customer quantity and unit, picks the closest supplier unit option available for that product, and calculates the supplier quantity needed. Example: `120 kg` against `1 x 5kg` becomes `24 x 5kg`.
- If a supplier unit field contains multiple options, the matching step prefers the option that fits the customer unit best. Example: `Box of 12 / 5kg` will choose `5kg` for kilogram requests and `Box of 12` for piece or box requests.
- Quote totals use `supplier_quantity * sale price`.
- If quantity or unit information is missing or incompatible, the system defaults to 1 supplier unit and flags the line for review.

## Notes

- Quote history is written to `logs/quotes/` as JSON files.
- Uploaded requisitions are kept in `uploads/` for traceability during internal use.
- The UI is intentionally lightweight so it can be embedded later inside the existing Athena Marine site or an internal portal.