
// Load environment variables from .env
import 'dotenv/config';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// If you get SSL/TLS handshake errors, update Node.js to the latest LTS version.

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export async function uploadToR2(filename, content, contentType) {
  // Debug logging for Render troubleshooting
  console.log('[R2 DEBUG] ENV BUCKET:', R2_BUCKET);
  console.log('[R2 DEBUG] ENV ENDPOINT:', R2_ENDPOINT);
  console.log('[R2 DEBUG] ENV ACCESS_KEY_ID:', R2_ACCESS_KEY_ID ? 'set' : 'missing');
  console.log('[R2 DEBUG] ENV SECRET_ACCESS_KEY:', R2_SECRET_ACCESS_KEY ? 'set' : 'missing');
  if (!R2_BUCKET) {
    throw new Error('R2_BUCKET environment variable is not set');
  }
  let body = content;
  let type = contentType;
  // Debug: log type and buffer status
  console.log('[R2 DEBUG] Uploading:', filename, '| typeof:', typeof body, '| isBuffer:', Buffer.isBuffer(body), '| isStream:', body && typeof body.pipe === 'function');
  if (!type) {
    // Default to JSON if not specified
    if (typeof content === 'string' || content instanceof Buffer) {
      type = 'application/octet-stream';
    } else {
      body = JSON.stringify(content, null, 2);
      type = 'application/json';
    }
  }
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: filename,
    Body: body,
    ContentType: type,
  });
  await s3.send(command);
  console.log("Upload successful:", filename);
}

// Test upload
if (process.argv[2] === 'test') {
  uploadToR2(
    'quote-test.json',
    { test: 'This is a test quote log', date: new Date().toISOString() }
  ).catch(console.error);
}
