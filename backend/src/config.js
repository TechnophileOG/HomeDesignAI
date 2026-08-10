/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — configuration
   ────────────────────────────────────────────────────────────────────────
   Reads everything from the environment. On Cloud Run the environment is
   injected at deploy time:
     • plain values via `--set-env-vars`   (ADMIN_EMAILS, CORS_ORIGIN, …)
     • secrets via `--set-secrets`          (RAZORPAY_* from Secret Manager)
   No secret value ever ships inside the image or the repo.
   ════════════════════════════════════════════════════════════════════════ */

const env = (name) => process.env[name] || '';

/** GCP project id — Cloud Run injects GOOGLE_CLOUD_PROJECT automatically. */
export const PROJECT_ID = env('GOOGLE_CLOUD_PROJECT') || env('FIREBASE_PROJECT_ID');

/** Firebase ID tokens are verified against this audience. */
export const FIREBASE_AUDIENCE = env('FIREBASE_PROJECT_ID') || PROJECT_ID;

/** Firebase signs ID tokens with issuer `https://securetoken.google.com/<projectId>`. */
export const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_AUDIENCE}`;

export const GCS_ORIGINALS_BUCKET = env('GCS_ORIGINALS_BUCKET') || 'katalogit-originals';
export const GCS_PROCESSED_BUCKET = env('GCS_PROCESSED_BUCKET') || 'katalogit-processed';

// Signed URL lifetimes. Two tiers:
//   • uploads (client-facing PUT) — SHORT (5 min): the only credential a
//     browser ever holds; minimize the window a leaked URL stays valid.
//   • worker (GPU box read/PUT) — LONGER (30 min): generated at submit time
//     but consumed minutes later when each pose finishes rendering.
export const GCS_UPLOAD_URL_TTL_SECONDS = parseInt(env('GCS_UPLOAD_URL_TTL_SECONDS') || '300', 10);
export const GCS_WORKER_URL_TTL_SECONDS = parseInt(env('GCS_WORKER_URL_TTL_SECONDS') || '1800', 10);

/** Comma-separated allowlist of browser origins (production = your domain). */
export const CORS_ORIGIN = env('CORS_ORIGIN')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Comma-separated admin emails — the ONLY accounts allowed on /admin/*. */
export const ADMIN_EMAILS = env('ADMIN_EMAILS')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** One-time welcome bonus (credits) — granted exactly once per user. */
export const WELCOME_CREDITS = parseInt(env('DEFAULT_FREE_CREDITS') || '10', 10);

/** Mirrors the frontend CREDIT_PRICING — server is the source of truth. */
export const CREDIT_PRICING = {
  model_shoot: 3,
  regen_shot: 1,
  full_regen: 3,
  retake: 1,
};

/** Jobs a store may have queued at once (anti-abuse). */
export const JOB_QUOTA = {
  free: 2,
  pro: 10,
  business: 50,
};

/** Purchasable credit packs (INR). */
export const CREDIT_PACKS = [
  { packId: 'pack_50',   credits: 50,   pricePaise: 24900,  currency: 'INR' },
  { packId: 'pack_120',  credits: 120,  pricePaise: 49900,  currency: 'INR' },
  { packId: 'pack_300',  credits: 300,  pricePaise: 99900,  currency: 'INR' },
  { packId: 'pack_1000', credits: 1000, pricePaise: 249900, currency: 'INR' },
];

/** Razorpay — considered unconfigured until real-looking keys are set. */
export const RAZORPAY = {
  keyId: env('RAZORPAY_KEY_ID'),
  keySecret: env('RAZORPAY_KEY_SECRET'),
  webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
};

/** Reject webhook events older than this (replay protection). Razorpay
    retries arrive within minutes, so 10 min is safe while killing replays. */
export const WEBHOOK_MAX_AGE_SECONDS = parseInt(env('WEBHOOK_MAX_AGE_SECONDS') || '600', 10);
export const razorpayConfigured = () => {
  const looksReal = (v) => v && !/placeholder|your-|replace/i.test(v) && v.length > 10;
  return looksReal(RAZORPAY.keyId) && looksReal(RAZORPAY.keySecret);
};

/** Cloud Tasks worker URL + shared secret (worker stub for now). */
export const WORKER_URL = env('WORKER_URL');
export const WORKER_AUTH_TOKEN = env('WORKER_AUTH_TOKEN');
export const TASKS_QUEUE = env('TASKS_QUEUE');

/** GPU box — the real AI pipeline (see backend/ai/). When unset, the
    worker responds as a stub and credits stay reserved.               */
export const GPU_HOST_URL = env('GPU_HOST_URL');
export const GPU_AUTH_TOKEN = env('GPU_AUTH_TOKEN');

/** Managed-API fallback image generation (Vertex AI).
    • VERTEX_AI_LOCATION  set it (e.g. `global` or `asia-south1`) to ARM the
      fallback — the worker then renders through the model below whenever the
      GPU box is absent or unreachable.
    • VERTEX_AI_MODEL     the cheapest ACTIVE Google lane is
      `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite, ~$0.034/1K image).
      `gemini-3.1-flash-image` (Nano Banana 2) is the quality step-up. Note:
      the Imagen 4 family is being SHUT DOWN Aug 17 2026 — don't switch to it.
    • AI_ENGINE           auto (GPU first, Vertex fallback) | gpu | vertex
    Runtime SA needs roles/aiplatform.user + read on the originals bucket. */
export const VERTEX_AI_LOCATION = env('VERTEX_AI_LOCATION');
export const VERTEX_AI_MODEL = env('VERTEX_AI_MODEL') || 'gemini-3.1-flash-lite-image';
export const AI_ENGINE = env('AI_ENGINE') || 'auto';
export const vertexConfigured = () => !!VERTEX_AI_LOCATION;

/** Fail fast if the deployment is fundamentally misconfigured. */
export function assertConfig() {
  const missing = [];
  if (!PROJECT_ID) missing.push('GOOGLE_CLOUD_PROJECT/FIREBASE_PROJECT_ID');
  if (!GCS_ORIGINALS_BUCKET) missing.push('GCS_ORIGINALS_BUCKET');
  if (!GCS_PROCESSED_BUCKET) missing.push('GCS_PROCESSED_BUCKET');
  if (missing.length) {
    console.error('[config] Missing required env vars:', missing.join(', '));
    process.exit(1);
  }
}
