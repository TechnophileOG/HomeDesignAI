# KatalogitAI — Backend (Node/Express, deployed to Cloud Run)

> 📘 Full design: [`../BACKEND_ARCHITECTURE.md`](../BACKEND_ARCHITECTURE.md) ·
> Operational guide: [`../GCP_SETUP_GUIDE.md`](../GCP_SETUP_GUIDE.md)

**Live:** `https://katalogit-api-lhrnfvmswa-el.a.run.app` (asia-south1,
`--no-allow-unauthenticated`, scales to zero). Health route: `GET /ping`
(`/healthz` is reserved by the run.app front gate).

## What's implemented

| Area | Route | Notes |
|---|---|---|
| Health | `GET /ping` | public, minimal (no secrets) |
| Stores | `POST /stores`, `GET/PATCH /stores/:id` | owner-scoped; plan/status server-managed; welcome bonus granted exactly once (`signup:{uid}`) |
| Products | `GET/POST /stores/:id/products`, `PATCH/DELETE /…/:productId` | sanitized, whitelisted keys, per-store ownership |
| Uploads | `POST /uploads/urls` | 15-min V4 signed PUT URL; bucket chosen from an allowlist (`flat_lay`/`ai_result`) |
| Credits | `GET /stores/:id/credits`, `…/credits/ledger`, `GET /credits/packs` | balance + plan + pricing |
| Orders | `POST /credits/orders` | Razorpay order (501 until real keys are in Secret Manager) |
| Webhook | `POST /webhooks/razorpay` | HMAC-SHA256 signature over raw body; exactly-once by payment id |
| Jobs | `POST /jobs`, `GET /jobs/:id`, `GET /jobs` | credit reservation + queued-job quota + Cloud Tasks enqueue |
| Worker | `POST /workers/run-job` | Cloud Tasks OIDC/shared-secret gated — runs the Vertex AI engine (Nano Banana 2 Lite + Gemini text) |
| Notifications | `GET/POST /stores/:id/notifications` | low-balance follow-ups dedupe into `admin_alerts` |
| Admin | `POST /admin/credits`, `GET /admin/follow-ups`, `POST …/:id/resolve` | Owner Console: `OWNER_EMAIL` + passcode-issued session |

## Security posture (the black box)

- Cloud Run deployed with `--no-allow-unauthenticated`: anonymous → 403, invalid token → 401
  at the front gate, **before** the app. The app then re-verifies Firebase ID tokens
  (`google-auth-library`, audience = project id).
- **Rate limiting:** global per-IP (600/15 min) + per-user limiters for sensitive routes.
- **Sanitisation:** every input field passes `src/validate.js` — strict types, length caps,
  control-char stripping, allowlists, and **whitelisted keys only** (prototype-pollution safe).
- **Ledger:** Firestore transactions + idempotency keys (`credit_ops/{key}`) = exactly-once
  reserve/grant/refund — retries and doubled webhooks can never double-charge.
- **Secrets:** Razorpay keys via `--set-secrets` from Secret Manager; `OWNER_EMAIL` from
  deploy env. Nothing sensitive ships in the image or the repo.
- **Errors:** uniform `{ok, error:{code,message}}`; stack traces logged server-side only.
- helmet() headers, strict CORS allowlist, 256 KB body cap, raw-body webhook signing.

## Local development

```bash
cd backend
npm install
GOOGLE_CLOUD_PROJECT=katalogitai-501916 PORT=8080 npm run dev
```

Local runs use ADC (gcloud user or a service account). The smoke test injects the gcloud
user token directly (the org forbids service-account key files).

## Smoke test (13 checks, runs against the REAL Firestore)

```bash
GOOGLE_CLOUD_PROJECT=katalogitai-501916 npm run smoke
```

Verifies: grant → reserve → idempotent replay (no double-charge) → insufficient-credits 402
(no mutation) → refund → ledger history, plus HTTP black-box checks (401 without/garbage
token, 400 unsigned webhook, 413 oversized body, 404 unknown path).

## Deploy (Buildpacks — no Dockerfile)

```bash
gcloud run deploy katalogit-api --source . --region asia-south1 \
  --no-allow-unauthenticated --min-instances 0 --max-instances 2 \
  --memory 512Mi --cpu 1 \
  --service-account katalogit-api-runner@katalogitai-501916.iam.gserviceaccount.com \
  --set-env-vars "^|^FIREBASE_PROJECT_ID=katalogitai-501916|OWNER_EMAIL=<you>@gmail.com|CORS_ORIGIN=<frontend origins>" \
  --set-secrets "RAZORPAY_KEY_ID=razorpay-key:latest,RAZORPAY_KEY_SECRET=razorpay-key:latest,RAZORPAY_WEBHOOK_SECRET=razorpay-webhook:latest"
```

The runtime service account `katalogit-api-runner` holds only: Firestore user, GCS object
admin, secret accessor, tasks enqueuer, token creator (signing), logging.

## Files

```
src/server.js      entry — helmet, CORS, rate limits, auth gate, error handler
src/config.js      env + pricing/quota constants (no secrets)
src/errors.js      AppError + JSON error handler (no internals leaked)
src/validate.js    input sanitisation + validation (the security gate)
src/auth.js        Firebase ID-token verification + admin allowlist
src/db.js          Firestore client + collection helpers
src/ledger.js      atomic, idempotent credit ledger
src/storage.js     signed upload URLs (bucket allowlist)
src/rate-limit.js  per-IP + per-user limiters
src/routes/*       stores/products/uploads · credits/orders/webhook/admin · jobs/worker
test/smoke.mjs     13-check smoke test
```
