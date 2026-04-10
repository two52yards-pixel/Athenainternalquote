
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

export async function uploadToR2(filename, content) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: filename,
    Body: typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    ContentType: "application/json",
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
