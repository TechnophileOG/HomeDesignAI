/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Cloud Storage (photos)
   ────────────────────────────────────────────────────────────────────────
   Clients never get raw bucket access. They request a short-lived V4 signed
   PUT URL from the API (15 min), upload directly to GCS, then reference the
   object path. The bucket is chosen by the API from a fixed map — a client
   can never point us at an arbitrary bucket.
   ════════════════════════════════════════════════════════════════════════ */

import { Storage } from '@google-cloud/storage';
import { GCS_ORIGINALS_BUCKET, GCS_PROCESSED_BUCKET,
         GCS_UPLOAD_URL_TTL_SECONDS } from './config.js';
import { badRequest, notConfigured } from './errors.js';

const storage = new Storage();

/** purpose → bucket. The ONLY way to pick a bucket (allowlist, not input). */
const BUCKETS = {
  flat_lay: GCS_ORIGINALS_BUCKET,
  ai_result: GCS_PROCESSED_BUCKET,
  session: GCS_ORIGINALS_BUCKET, // live-session captures (phone side)
};

const cap = (sec) => Math.min(Math.max(60, sec), 3600);
const uploadTtlMs = () => cap(GCS_UPLOAD_URL_TTL_SECONDS) * 1000;

async function sign(bucketName, objectPath, opts) {
  try {
    return await storage.bucket(bucketName).file(objectPath).getSignedUrl(opts);
  } catch (err) {
    // Signature failures usually mean the runtime account can't sign.
    console.error('[storage] signed url error:', err && err.message ? err.message : err);
    throw notConfigured('STORAGE_UNAVAILABLE', 'Photo storage is temporarily unavailable.');
  }
}

// Hard cap on any single photo upload (browser captures stay well under this).
// Enforced BY GCS on the PUT itself — a hostile client can't stuff a huge
// file into our bucket through a signed URL (cost + disk abuse protection).
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export async function signedUploadUrl({ purpose, objectPath, contentType }) {
  const bucketName = BUCKETS[purpose];
  if (!bucketName) throw badRequest('INVALID_FIELD', 'Unknown upload purpose.');
  const [uploadUrl] = await sign(bucketName, objectPath, {
    action: 'write', version: 'v4', expires: Date.now() + uploadTtlMs(), contentType,
    contentLengthRange: [1, MAX_UPLOAD_BYTES],
  });
  return { uploadUrl, objectPath, bucket: bucketName };
}

/** Confirm an object actually exists (guards product creation with real uploads). */
export async function objectExists(bucketName, objectPath) {
  try {
    const [exists] = await storage.bucket(bucketName).file(objectPath).exists();
    return exists;
  } catch {
    return false;
  }
}
