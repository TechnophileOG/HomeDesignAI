/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — AI pipeline orchestrator (Cloud Run side)
   ────────────────────────────────────────────────────────────────────────
   Turns a job + product into a GPU-box run WITHOUT ever giving the box any
   credentials: it signs a short-lived GET URL for the flat-lay and 8 short-
   lived PUT URLs for the outputs, and sends only those + prompt config over
   HTTPS with the shared worker secret. All real secrets stay in Cloud Run.
   ════════════════════════════════════════════════════════════════════════ */

import { GCS_ORIGINALS_BUCKET, GCS_PROCESSED_BUCKET, GPU_HOST_URL, GPU_AUTH_TOKEN } from './config.js';
import { signedReadUrl, signedPutUrl } from './storage.js';
import { AppError } from './errors.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The 8 fixed poses + their prompt suffixes (single source of truth).
const POSES = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../ai/poses.json'), 'utf8')
);

export const POSE_LIST = POSES.map((p, index) => ({ id: p.id, name: p.name, prompt: p.prompt, index }));

/** FNV-1a 32-bit — deterministic seed from store+product+pose (no shuffling). */
export const fnv1a = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const MODEL_DESCRIPTOR = 'a beautiful young Indian female model, natural skin, natural makeup, commercial fashion model, photorealistic';
const STYLE = 'studio product photography, soft studio lighting, seamless light gray background, professional e-commerce catalog, sharp focus, 4k, high detail, photorealistic';

/** Strip prompt-metacharacters and instruction-like keywords from user text
    before it reaches the model (weight syntax `(x:1.4)`, brackets, commas,
    quotes) — a store owner must never be able to inject instructions/NSFW/
    celebrity content into a prompt the company is legally liable for. */
const INJECTION_PATTERNS = /\b(ignore|disregard|system|override|bypass|jailbreak|reveal|instruction|prompt)\b/gi;
const promptSafe = (text, max) => {
  const clean = String(text || '')
    .replace(/[()[\]{}:,/\\'"<>;|*~`]/g, ' ')
    .replace(INJECTION_PATTERNS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  // Reject suspiciously short/empty results (callers fall back to defaults).
  return clean.length < 3 ? '' : clean;
};

const gpuConfig = () => ({ host: GPU_HOST_URL, token: GPU_AUTH_TOKEN });

const outputPathFor = ({ storeId, productId, index, seed }) =>
  `stores/${storeId}/products/${productId}/poses/pose_${index}_${seed}.png`;

/**
 * Build the prompt for a product (garment descriptor comes from the listing).
 */
export function buildPrompt(product) {
  // Sanitized fields only — never raw user input (prompt-injection safe).
  const title = promptSafe(product.title, 60) || 'this garment';
  const category = promptSafe(product.category, 40);
  const colors = Array.isArray(product.aiSpecs?.colors) && product.aiSpecs.colors.length
    ? ` in ${product.aiSpecs.colors.slice(0, 4).map((c) => promptSafe(c, 30)).filter(Boolean).join(', ').toLowerCase()}`
    : '';
  return `${MODEL_DESCRIPTOR} wearing ${title}${colors}${category ? `, ${category}` : ''}, ${STYLE}`;
}

/**
 * Submit a GPU job. `signers` is injectable for tests (defaults to GCS).
 * Returns { jobId, outputs: [{ poseId, index, objectPath, putUrl }] }.
 */
export async function submitGpuJob({ job, product }, { signers = {} } = {}) {
  const gpu = gpuConfig();
  if (!gpu.host || !gpu.token) {
    throw new AppError(501, 'GPU_NOT_CONFIGURED', 'The AI worker is not configured yet.');
  }

  const read = signers.readUrl || signedReadUrl;
  const put = signers.putUrl || signedPutUrl;

  const flatLayPath = product.flatLay?.path;
  if (!flatLayPath) throw new AppError(400, 'INVALID_FIELD', 'Product has no flat-lay photo.');

  const garmentUrl = await read(GCS_ORIGINALS_BUCKET, flatLayPath);

  const seedBase = `${job.storeId}:${product.id}`;
  const poses = [];
  for (const pose of POSE_LIST) {
    const seed = fnv1a(`${seedBase}:${pose.id}`);
    const objectPath = outputPathFor({ storeId: job.storeId, productId: product.id, index: pose.index, seed });
    const putUrl = await put(GCS_PROCESSED_BUCKET, objectPath, 'image/png');
    poses.push({ poseId: pose.id, index: pose.index, prompt: pose.prompt, seed, outputUrl: putUrl, objectPath });
  }

  const payload = {
    jobId: job.id,
    seedBase,
    prompt: buildPrompt(product),
    garmentUrl,
    poses: poses.map(({ poseId, index, prompt, seed, outputUrl }) => ({ poseId, index, prompt, seed, outputUrl })),
    width: 512,
    height: 768,
  };

  const res = await fetch(`${gpu.host}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': gpu.token },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[ai-client] GPU submit failed:', res.status, text.slice(0, 300));
    throw new AppError(502, 'GPU_SUBMIT_FAILED', 'The AI worker rejected the job.');
  }
  const body = await res.json().catch(() => ({}));
  return { jobId: body.jobId || job.id, poses };
}

/**
 * Poll the GPU box until the job is done/failed. Returns the job status.
 * Uses exponential backoff (base → capped) so a fleet of failing jobs can't
 * pile up hundreds of concurrent hot loops against the worker.
 */
export async function pollGpuJob(gpuJobId, { timeoutMs = 8 * 60 * 1000, intervalMs = 4000 } = {}) {
  const gpu = gpuConfig();
  const deadline = Date.now() + timeoutMs;
  let delay = Math.max(intervalMs, 1000);
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${gpu.host}/run/${encodeURIComponent(gpuJobId)}`, {
      headers: { 'X-Auth-Token': gpu.token },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      last = await res.json();
      if (last.status === 'done' || last.status === 'failed') return last;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 30_000); // cap at 30s
  }
  throw new AppError(504, 'GPU_TIMEOUT', `GPU job ${gpuJobId} did not finish in time.`);
}
