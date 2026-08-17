/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — configuration
   ────────────────────────────────────────────────────────────────────────
   Reads everything from the environment. On Cloud Run the environment is
   injected at deploy time:
     • plain values via `--set-env-vars`   (OWNER_EMAIL, CORS_ORIGIN, …)
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
//   • worker (engine read/PUT) — LONGER (30 min): generated at submit time
//     but consumed minutes later when each pose finishes rendering.
export const GCS_UPLOAD_URL_TTL_SECONDS = parseInt(env('GCS_UPLOAD_URL_TTL_SECONDS') || '300', 10);


/** Comma-separated allowlist of browser origins (production = your domain). */
export const CORS_ORIGIN = env('CORS_ORIGIN')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** The ONE account allowed into the owner console — the founder's email.
    Everything else is rejected even with a valid Firebase token. Set as
    OWNER_EMAIL (single address, not a list) — owner-only by design. */
export const OWNER_EMAIL = env('OWNER_EMAIL').trim().toLowerCase();

/** Second factor for the owner console — a passcode the owner types when
    opening the console (stored as a secret, verified timing-safe, and
    rate-limited server-side). Without it, /admin/* stays locked. */
export const ADMIN_PASSCODE = env('ADMIN_PASSCODE');

/** How long an unlocked owner session lasts (seconds). Short by design. */
export const ADMIN_SESSION_TTL_SECONDS = parseInt(env('ADMIN_SESSION_TTL_SECONDS') || '900', 10);

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

/** Purchasable credit packs (INR) — every tier clears the real COGS
    (Vertex Nano Banana Lite ≈ ₹11.5/SKU at 3 credits/SKU), so the biggest
    pack still earns margin. ₹/credit: 6.98 / 5.83 / 5.00 / 4.50. */
export const CREDIT_PACKS = [
  { packId: 'pack_50',   credits: 50,   pricePaise: 34900,  currency: 'INR' },
  { packId: 'pack_120',  credits: 120,  pricePaise: 69900,  currency: 'INR' },
  { packId: 'pack_300',  credits: 300,  pricePaise: 149900, currency: 'INR' },
  { packId: 'pack_1000', credits: 1000, pricePaise: 449900, currency: 'INR' },
];

/** ₹499/mo Pro subscription — 40 credits/month + priority queue + 20%
    cheaper top-ups. Requires a Razorpay plan id (created once in the
    Razorpay dashboard; set RAZORPAY_PRO_PLAN_ID). */
export const SUBSCRIPTION_PLAN = {
  pricePaise: 49900,
  monthlyCredits: 40,
  currency: 'INR',
  planId: env('RAZORPAY_PRO_PLAN_ID'),
};

export const subscriptionConfigured = () =>
  razorpayConfigured() && !!SUBSCRIPTION_PLAN.planId;

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

/** Cloud Tasks worker URL + shared secret. */
export const WORKER_URL = env('WORKER_URL');
export const WORKER_AUTH_TOKEN = env('WORKER_AUTH_TOKEN');
export const TASKS_QUEUE = env('TASKS_QUEUE');

/** Vertex AI image generation (Nano Banana 2 Lite — cheapest ACTIVE lane).
    • VERTEX_AI_LOCATION  set it (e.g. `global` or `asia-south1`) to arm it.
    • VERTEX_AI_MODEL     default `gemini-3.1-flash-lite-image` (~$0.034/1K image,
      ≈₹2.8/SKU for 8 poses). Upgrade to `gemini-3.1-flash-image` for quality.
    Runtime SA needs roles/aiplatform.user + read on the originals bucket. */
export const VERTEX_AI_LOCATION = env('VERTEX_AI_LOCATION');
export const VERTEX_AI_MODEL = env('VERTEX_AI_MODEL') || 'gemini-3.1-flash-lite-image';
export const vertexConfigured = () => !!VERTEX_AI_LOCATION;

/** Managed-API TEXT model (listing copy). Cheapest active lane is
    Gemini 2.5 Flash-Lite (~$0.10/1M input, $0.40/1M output tokens — a
    listing costs well under $0.001). Armed by the same VERTEX_AI_LOCATION
    as image generation. */
export const VERTEX_TEXT_MODEL = env('VERTEX_TEXT_MODEL') || 'gemini-2.5-flash-lite';
export const textAiConfigured = () => !!VERTEX_AI_LOCATION;

/** Firebase Auth web API key — used ONLY server-side to send the password-
    reset email via the Identity Toolkit REST API (rate-limited + audited).
    It is a PUBLIC key (browsers ship it too), but routing through our
    backend lets us enforce real limits and a durable audit trail — a
    client could otherwise spam Firebase's reset endpoint directly. */
export const FIREBASE_WEB_API_KEY = env('FIREBASE_WEB_API_KEY');

/** Where the reset email should land the user AFTER they change their
    password (our app, once it's deployed — e.g. https://app.katalogit.ai).
    Optional: when empty, Firebase's default action handler is used. */
export const RESET_CONTINUE_URL = env('RESET_CONTINUE_URL');

/** Contact email sent to Nominatim's geocoder as an operator identifier
    (their usage policy asks for one). Optional but recommended. */
export const NOMINATIM_EMAIL = env('NOMINATIM_EMAIL');

/** Branded transactional email (Resend free tier — 3,000/mo). Until
    RESEND_API_KEY + EMAIL_FROM + APP_URL are all set, emailConfigured() is
    false and the routes fall back to Firebase's default emails. */
export const RESEND_API_KEY = env('RESEND_API_KEY');
export const EMAIL_FROM = env('EMAIL_FROM');

/** Public app origin, e.g. https://katalogit.ai — used to build the branded
    reset/verify links (the app handles them at /app). */
export const APP_URL = env('APP_URL');

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
