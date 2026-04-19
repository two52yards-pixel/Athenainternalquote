import ExcelJS from 'exceljs';
import path from 'node:path';
import { listQuotes } from './quoteStore.js';
import { uploadToR2 } from './r2Upload.js';

export async function exportQuotesToExcel() {
  const quotes = await listQuotes();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Quotes');

  // Define columns
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 32 },
    { header: 'Quote Number', key: 'quoteNumber', width: 20 },
    { header: 'Quote Date', key: 'quoteDate', width: 20 },
    { header: 'Expiry Date', key: 'expiryDate', width: 20 },
    { header: 'Client Name', key: 'clientName', width: 20 },
    { header: 'Vessel Name', key: 'vesselName', width: 20 },
    { header: 'Port', key: 'port', width: 20 },
    { header: 'IMO Number', key: 'imoNumber', width: 15 },
    { header: 'Scheduled Arrival', key: 'scheduledArrival', width: 20 },
    { header: 'Contact Email', key: 'contactEmail', width: 25 },
    { header: 'Agent Name', key: 'agentName', width: 20 },
    { header: 'Created At', key: 'createdAt', width: 20 },
    { header: 'Updated At', key: 'updatedAt', width: 20 },
    { header: 'Quote Status', key: 'quoteStatus', width: 15 },
    { header: 'Closed At', key: 'closedAt', width: 20 },
    { header: 'Summary', key: 'summary', width: 40 },
  ];

  // Add rows
  quotes.forEach(q => worksheet.addRow(q));

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();

  // Upload to R2
  await uploadToR2('quotes-export.xlsx', buffer);
  return { r2Key: 'quotes-export.xlsx' };
}
