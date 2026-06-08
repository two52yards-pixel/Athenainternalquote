const ExcelJS = require('exceljs');
const fs = require('fs');

async function extractYogurt() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('data/new price list.xlsx');
    const results = [];

    // Keywords to search for
    const keywords = ['yogurt', 'yoghurt'];

    workbook.eachSheet((worksheet, sheetId) => {
        worksheet.eachRow((row, rowNumber) => {
            const rowValues = row.values;
            // Join all cell values to search for keywords
            const rowString = rowValues.join(' ').toLowerCase();
            
            if (keywords.some(kw => rowString.includes(kw))) {
                results.push({
                    sheet: worksheet.name,
                    row: rowNumber,
                    data: rowValues
                });
            }
        });
    });

    console.log(JSON.stringify(results, null, 2));
}

extractYogurt().catch(err => {
    console.error(err);
    process.exit(1);
});
