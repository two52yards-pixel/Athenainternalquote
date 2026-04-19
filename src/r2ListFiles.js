import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import 'dotenv/config';

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

export async function listR2QuoteFiles() {
  const command = new ListObjectsV2Command({
    Bucket: R2_BUCKET,
    Prefix: '',
  });
  const result = await s3.send(command);
  return (result.Contents || []).map(obj => obj.Key);
}
