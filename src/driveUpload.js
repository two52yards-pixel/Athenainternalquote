import { google } from 'googleapis';
import path from 'path';

// Path to your service account JSON
const KEYFILEPATH = path.join('src', 'athena-quote-system-ae5d9409816a.json');
// Your Google Drive folder ID
const FOLDER_ID = '18bQAihUexD2aKO6wbgRfLCX8OfPRDJ0m';

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

export async function uploadQuoteLog(filename, content) {
  const fileMetadata = {
    name: filename,
    parents: [FOLDER_ID],
  };
  const media = {
    mimeType: 'application/json',
    body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  };
  const res = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: 'id',
  });
  return res.data.id;
}

// Example usage:
if (process.argv[2] === 'test') {
  (async () => {
    const fileId = await uploadQuoteLog(
      'quote-test.json',
      { test: 'This is a test quote log', date: new Date().toISOString() }
    );
    console.log('Uploaded file ID:', fileId);
  })();
}
