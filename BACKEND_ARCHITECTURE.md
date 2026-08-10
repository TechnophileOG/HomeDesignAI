# KatalogitAI — Backend Architecture (Google Cloud Platform)

> **Status:** Design + scaffold. Cloud services are NOT connected yet.
> This document is the source of truth for the backend we will build. The
> frontend (`src/`) is currently fully simulated (in-memory state). These
> designs map 1:1 onto what the app already shows so wiring it up later is
> mechanical.
>
> **AI pipeline is deliberately OUT OF SCOPE** until the end — but the job
> queue + storage + credit plumbing is designed NOW so AI slots in cleanly.

---

## 1. High-Level Architecture

```
                        ┌────────────────────────────────────────────┐
                        │                Frontend (React)            │
                        │      Firebase Hosting / Cloud CDN + CDN    │
                        └───────────────┬────────────────────────────┘
                                        │ HTTPS (same-origin /api/**)
                                        ▼
                        ┌────────────────────────────────────────────┐
                        │      Cloud Run — Node.js API (Express)     │
                        │   AuthN/AuthZ · Stores · Products · Jobs   │
                        │   Credits · Uploads · Stats · Webhooks     │
                        └───┬───────────────┬───────────────┬────────┘
                            │               │               │
              ┌─────────────▼──┐   ┌────────▼──────┐   ┌────▼─────────────┐
              │  Firestore     │   │ Cloud Storage │   │ Cloud SQL (PG)   │
              │  (catalogue,   │   │ (photos:      │   │ (credit LEDGER — │
              │   stores, jobs,│   │  originals +  │   │  wallets, ledger,│
              │   notifications│   │  AI results)  │   │  orders)         │
              └─────────────┬──┘   └────────┬──────┘   └────┬─────────────┘
                            │               │               │
                            ▼               ▼               ▼
              ┌─────────────────────────────────────────────────────┐
              │  Cloud Tasks (async queue)  ──►  Worker (AI later)  │
              │  Firebase Auth (ID tokens)  ·  Razorpay (billing)   │
              │  FCM/Email (notifications)  ·  Secret Manager        │
              └─────────────────────────────────────────────────────┘
```

### Why this shape

| Concern | Choice | Why |
|---|---|---|
| Authentication | **Firebase Auth** (Phone OTP + Email/Password) | Indian vendors use phone numbers; OTP is the natural login. Gives us ID tokens + custom claims for free. |
| Catalogue (products, stores, jobs) | **Firestore** | Flexible, serverless-friendly document model; matches the app's dynamic attributes (sizes, colors, categories); rules = built-in per-user authorization. |
| Credit ledger (money) | **Cloud SQL PostgreSQL** | Credits are financial-ish state. Needs ACID transactions, row locking (`FOR UPDATE`), `DECIMAL` precision, unique idempotency constraints. Firestore can do it but relational is safer for a ledger. |
| Photo storage | **Cloud Storage + Cloud CDN** | Private bucket + signed URLs for direct client uploads (no server proxy). Serving via CDN for speed. |
| API | **Cloud Run** (Node/Express) | Container control, 60-min request cap (long jobs via queue anyway), scales to zero, cheap. |
| Async AI jobs | **Cloud Tasks** | Reliable at-least-once delivery, exponential backoff, 100 KB payloads. Job IDs passed, not blobs. |
| Billing | **Razorpay** | UPI + cards + net-banking + e-FIRC for Indian vendors; webhooks with signature verification. |
| Secrets | **Secret Manager** | Service account keys, Razorpay keys, DB creds — never in code/env. |

---

## 2. Data Model

### 2.1 Firestore collections (catalogue side)

```
users/{uid}                          ← Firebase Auth user
  email, phone, displayName, role: 'owner'|'admin',
  stores: [storeId], createdAt

stores/{storeId}                     ← created during onboarding
  ownerUid, name, city, storeType,
  categories: ['women','men',...],
  scale: 'small'|'growing'|...,
  salesChannel, yearsInBusiness, inventoryTurnover,
  hasInventorySystem, orderValue, brandStyle,
  aiFeatures: ['Auto-pricing', 'Advanced-analytics', ...],
  plan: 'free'|'pro'|'business',      ← derived from scale + aiFeatures
  status: 'active'|'suspended',
  createdAt, updatedAt

stores/{storeId}/products/{productId}
  title, category, price, qty, rating,
  flatLay: { path, contentType, size },   ← original photo
  aiResults: [{ path, createdAt, approved }],
  status: 'pending_approve'|'pending_retake'|'live',
  sku, aiSpecs: { description, sizes, colors, ... },
  createdAt, updatedAt

stores/{storeId}/jobs/{jobId}        ← async AI pipeline records
  type: 'model_shoot'|'regen_shot'|'full_regen'|'retake',
  inputPhotoPath, outputPaths: [],
  status: 'queued'|'processing'|'done'|'failed'|'refunded',
  creditsReserved, creditsSettled,
  attempts, errorCode, createdAt, startedAt, finishedAt

stores/{storeId}/notifications/{nid}
  type, title, body, read, data, createdAt
```

### 2.2 Cloud SQL — credit ledger (relational, ACID)

```sql
wallets (
  store_id       TEXT PRIMARY KEY,
  balance        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- in credits
  lifetime_used  NUMERIC(12,2) NOT NULL DEFAULT 0,
  plan           TEXT NOT NULL DEFAULT 'free',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)

ledger (
  id              BIGSERIAL PRIMARY KEY,
  store_id        TEXT NOT NULL REFERENCES wallets(store_id),
  type            TEXT NOT NULL,   -- GRANT|TOPUP|CONSUME|REFUND|EXPIRY|ADJUST
  amount          NUMERIC(12,2) NOT NULL,   -- signed (+topup / −consume)
  balance_after   NUMERIC(12,2) NOT NULL,
  reference_type  TEXT,            -- 'job'|'order'|'admin'|'signup'|'referral'
  reference_id    TEXT,
  idempotency_key TEXT NOT NULL,   -- UNIQUE — kills double-charges
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, idempotency_key)
)
CREATE INDEX idx_ledger_store_time ON ledger (store_id, created_at DESC);

orders (                          -- Razorpay top-up orders
  order_id        TEXT PRIMARY KEY,      -- rzp_order_xxx
  store_id        TEXT NOT NULL,
  plan_or_pack_id TEXT,
  credits         NUMERIC(12,2) NOT NULL,
  amount_paise    BIGINT NOT NULL,       -- ₹ → paise
  currency        TEXT NOT NULL DEFAULT 'INR',
  status          TEXT NOT NULL DEFAULT 'created',  -- created|paid|failed|refunded
  rzp_payment_id  TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
)

pricing (         -- per-operation credit cost (config, mutable)
  op_key   TEXT PRIMARY KEY,       -- 'model_shoot' | 'regen_shot' | 'full_regen'
  credits  NUMERIC(12,2) NOT NULL
)
```

> **Why two datastores?** Catalogue = flexible documents, writes are fine.
> Credits = must never double-spend; Postgres `FOR UPDATE` + UNIQUE
> idempotency key gives us hard guarantees Firestore rules can't.

---

## 3. User Account Creation & Auth Flow

1. **Sign up / sign in (client-side):** Firebase Auth — **phone OTP** (primary for
   Indian vendors) and **email/password** (fallback). Web uses invisible reCAPTCHA.
2. **Account linking:** If a phone user later adds email (or vice versa), link
   credentials in Firebase — never create a duplicate user.
3. **First sign-in → auto-create `users/{uid}`** via a `beforeUserCreated`/trigger
   (or lazily in the API). No manual account creation on our side.
4. **Onboarding (existing frontend flow)** → `POST /v1/stores` creates the store,
   then `POST /v1/stores/{id}/credits/grant` with idempotency key `signup:{storeId}`
   awards the free starter credits.
5. **ID token flow:** every API call sends `Authorization: Bearer <idToken>`;
   Cloud Run verifies it with the Firebase Admin SDK (`verifyIdToken`).
6. **Roles:** `role: 'owner'` on the user; `role: 'admin'` (support staff) via
   **custom claims**. Claims refresh client-side (`getIdToken(true)`).

**Firestore rules guarantee** users can only read/write `users/{theirUid}`
and `stores/{stores they own}` (see `backend/schema/firestore.rules`).

---

## 4. Photo Storage & Uploads

### Flow (direct-to-GCS, no server proxy)

```
Client ──POST /v1/uploads/urls {fileName, contentType, purpose}──▶ API
API    ──creates 15-min V4 signed PUT URL (private bucket)───────▶ Client
Client ──PUT file directly to GCS (size + content-type enforced)─▶ GCS
Client ──POST /v1/products {flatLay: {path, ...}}───────────────▶ API (verifies object exists)
```

- **Buckets:** `katalogit-originals` (private — raw vendor photos),
  `katalogit-processed` (private — AI results, served via **signed URLs** or
  **Cloud CDN signed cookies** for vendor previews). Never public buckets.
- **Signed URL policy:** short TTL (≤15 min), `content-type` pinned to
  `image/jpeg|png|webp`, **max size 10 MB**, single path prefix per store:
  `stores/{storeId}/products/{productId}/...`.
- **Storage rules** (`storage.rules`) restrict reads/writes to `request.auth.uid`
  == the store owner.
- **CDN:** `Cache-Control: public, max-age=31536000, immutable` on processed
  assets; originals stay private.
- **Malware/validation:** post-upload trigger validates magic bytes/dimensions;
  quarantine-and-notify on failure. (Vision-safe validation can hook the AI worker later.)

---

## 5. Credit Consumption & Management (core)

### 5.1 Lifecycle

```
            GRANT (signup/referral)        TOPUP (Razorpay webhook)
                     │                              │
                     ▼                              ▼
        ┌──────────────────────┐            ┌──────────────────────┐
        │       WALLET          │◀──────────│   LEDGER (append-only)│
        │  balance (NUMERIC)    │            │  every change logged │
        └──────────┬───────────┘            └──────────────────────┘
                   │
                   ▼
        Job created ──▶ RESERVE credits (pending)        ── job status: queued
        Job done    ──▶ SETTLE (reservation finalized)   ── job status: done
        Job failed  ──▶ REFUND reservation back          ── job status: refunded
```

### 5.2 Atomic consumption (never double-spend)

```sql
-- inside a single Postgres transaction
BEGIN;
SELECT balance FROM wallets WHERE store_id = $1 FOR UPDATE;
INSERT INTO ledger (store_id, type, amount, balance_after, reference_type,
                    reference_id, idempotency_key, note)
SELECT $1, 'CONSUME', -$3, balance - $3, 'job', $2, $2, 'reserve for job'
FROM wallets WHERE store_id = $1 AND balance >= $3
RETURNING balance_after;
UPDATE wallets SET balance = balance_after FROM (SELECT ... ) ...;
COMMIT;
-- if zero rows returned → insufficient credits → 402 Payment Required
```

- **Idempotency keys:** `job:{jobId}` for consumption, `rzp:{payment_id}` for
  top-ups, `signup:{storeId}` for grants. The UNIQUE constraint is the last line
  of defense — duplicate webhook deliveries simply fail the insert.
- **Reservation model:** credits are deducted when the job is *created*, and
  refunded (with the same idempotency key) if the job *fails* — so a user can
  never run jobs into negative balance or lose credits on failures.

### 5.3 Pricing config (per operation)

| op_key | Cost | Frontend equivalent |
|---|---|---|
| `model_shoot` | 3 credits | "AI creates model photos" (AddProductFlow) |
| `regen_shot` | 1 credit | "Regen Shot" (ReviewPDP) |
| `full_regen` | 3 credits | "Regenerate Full Product" (ReviewPDP) |
| `retake` | 0 credits | "Send for Retake" — free, but limits apply |

Stored in `pricing` table → admin-adjustable without redeploys.

### 5.4 Plans & entitlements (aligns with existing onboarding UI)

| Plan | Credits | Entitlements (from `aiFeatures` UI) |
|---|---|---|
| **Free** | 20 one-time grant | Auto-pricing, Auto-description, Image-enhancement |
| **Pro** (₹/mo) | 500/mo + rollover 100 max | + Advanced-analytics, Bulk-operations |
| **Business** (₹/mo) | 5000/mo | Priority queue, API access, multi-store |

- `GET /v1/stores/{id}/credits` → `{ balance, plan, entitlements, pricing }` —
  the frontend **already renders** FREE/PRO badges; this endpoint powers them.
- **Low-balance alerts:** notify at 20% / 10% / 0 (FCM + email + in-app).
- **Expiry:** unused Pro/business monthly credits expire at cycle end (ledger
  `EXPIRY` rows); paid top-up credits never expire.

### 5.5 Billing (Razorpay)

1. `POST /v1/credits/orders` → creates Razorpay order (amount, credits, currency INR).
2. Client SDK completes payment → **Razorpay webhook** → verify signature →
   `orders` row `paid` + wallet top-up **in one transaction** (idempotency = payment_id).
3. Failure/refund webhooks → reverse credits with `REFUND` ledger rows.
4. **GST invoice** generated server-side for paid top-ups (India compliance).

---

## 6. Async AI Job Pipeline (plumbing now, AI last)

```
POST /v1/jobs  {type, productId, inputPhoto}
  → API validates credits (reserve) + quota
  → writes Firestore jobs/{jobId} (status: queued)
  → enqueues Cloud Tasks {jobId}
  → returns 202 + {jobId}          (client polls GET /v1/jobs/{id})

Cloud Tasks → worker (Cloud Run, same API service or separate)
  → marks processing, runs AI pipeline (stub today / Vertex AI later)
  → writes outputs to katalogit-processed
  → updates job done + settles credits
  → on failure: marks failed + refunds reservation (idempotent)
```

- **Idempotent worker:** checks `job.status` before acting (at-least-once delivery).
- **Frontend already has the polling UX pattern** (simulated "Generating model
  photoshoot…" timers) — it just needs to call `GET /v1/jobs/{id}` instead.
- **Quotas:** max N queued jobs per store (free=2, pro=10, business=50) —
  checked at creation, stored as a counter document with sharded writes.

---

## 7. Other Important Features (designed now, built with backend)

1. **Notifications** — in-app (Firestore subcollection, already in UI header),
   FCM push, email (low credit, job done, payment). Email via Cloud Functions
   trigger + SMTP/Resend.
2. **Stats & analytics** — `GET /v1/stores/{id}/stats` backed by a
   `daily_stats` aggregate collection (sales, clicks, AI usage). Optional
   BigQuery export later. (StatsView exists in the frontend today with hardcoded
   data — this is its data source.)
3. **Rate limiting & abuse prevention** — per-user token bucket on Cloud Run
   (credits endpoints get strictest limits); daily photo-upload cap;
   reCAPTCHA on OTP + contact forms.
4. **Audit log** — server-side `audit_log` table for admin actions, credit
   adjustments, and suspicious activity.
5. **Admin console API** — `role: 'admin'` claims; endpoints to adjust credits,
   suspend stores, view ledger. (Separate admin UI later.)
6. **Referrals** — `referral:{storeId}` grant when an invited store completes
   onboarding (idempotent, capped).
7. **Search & filtering** — Firestore compound queries for catalogue search
   (title, category, status); pagination via cursor. Upgrade to a search index
   (Typesense/Algolia) only if catalogue > 50k docs.
8. **Backups & retention** — GCS lifecycle (originals: keep, processed: 90d),
   Firestore scheduled backups, Postgres point-in-time recovery.
9. **i18n/l10n readiness** — Hinglish content already in UI; API returns plain
   strings, no server-side text generation.
10. **CORS & CSP** — Cloud Run CORS locked to the hosted frontend origin;
    keep the CSP from the frontend security work aligned with any CDN domains.

---

## 8. API Surface (v1) — see `backend/api/openapi.yaml`

| Method | Path | Purpose | Credits? |
|---|---|---|---|
| POST | `/v1/stores` | Create store (onboarding) | — |
| GET/PATCH | `/v1/stores/{id}` | Read/update store profile | — |
| POST | `/v1/uploads/urls` | Get signed upload URL | — |
| GET/POST | `/v1/stores/{id}/products` | List/create products | — |
| PATCH/DELETE | `/v1/stores/{id}/products/{pid}` | Update/delete | — |
| POST | `/v1/jobs` | Create AI job | **reserve** |
| GET | `/v1/jobs/{id}` | Poll job status | — |
| GET | `/v1/stores/{id}/credits` | Balance + plan + pricing | — |
| GET | `/v1/stores/{id}/credits/ledger` | Transaction history | — |
| POST | `/v1/credits/orders` | Create Razorpay top-up | — |
| POST | `/v1/webhooks/razorpay` | Payment webhook | **top-up** |
| GET | `/v1/stores/{id}/stats` | Dashboard stats | — |
| GET | `/v1/stores/{id}/notifications` | In-app notifications | — |
| POST | `/v1/auth/refresh-claims` | Force claim refresh after plan change | — |
| *Admin* | `/v1/admin/**` | Credits adjust, suspend, audit | — |

All responses: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
Auth: `Authorization: Bearer <Firebase ID token>` everywhere except webhooks
(which use signature verification).

---

## 9. Security Checklist

- [ ] Firebase ID token verified on **every** request (Admin SDK)
- [ ] Firestore + Storage rules = per-user scoping (files provided in scaffold)
- [ ] Cloud Run set to `require authentication`; frontend invokes via Firebase
      Hosting rewrite (service agent has `roles/run.invoker`)
- [ ] GCS buckets private; only signed URLs / CDN signed cookies
- [ ] Razorpay webhook signature verified; idempotency keys everywhere
- [ ] Secrets in Secret Manager; `.env.example` has placeholders only
- [ ] CORS restricted to frontend origin; CSP updated with any CDN domain
- [ ] Rate limits + quotas on credit-consuming and upload endpoints
- [ ] No sensitive data in client-visible Firestore docs (ledger is server-only)

---

## 10. Build Roadmap (AI pipeline LAST, as requested)

| Phase | Scope | Delivered artifacts |
|---|---|---|
| **0. Foundation** | GCP project, IAM, buckets, secrets, CI/CD | `terraform/` or gcloud scripts |
| **1. Auth + Stores** | Firebase Auth triggers, `users`/`stores`, onboarding API, rules | API endpoints + rules |
| **2. Products + Uploads** | Signed URLs, products CRUD, storage rules, CDN | Upload flow end-to-end |
| **3. Credits + Billing** | Wallets, ledger, pricing, Razorpay orders/webhooks, plans | Credit system + tests |
| **4. Jobs pipeline** | Cloud Tasks, worker stub, quotas, notifications | Queue + polling |
| **5. Stats + Admin + Referrals** | Aggregates, admin API, referral grants | Remaining features |
| **6. AI pipeline (LAST)** | Worker implementation (Vertex AI/Imagen), retries, cost metering | AI integration |

The scaffold in `backend/` (rules, schema, OpenAPI, env) already matches phases
1–3 so you can start wiring Firestore + Cloud SQL immediately.

---

## 11. Cost Notes (rough)

- Firebase Auth: free tier covers OTP volume for early users (India SMS can be
  flaky — keep email fallback).
- Firestore: pay-per-read/write; catalogue reads dominate → fine.
- Cloud SQL: smallest HA instance ≈ manageable; scale when ledger grows.
- Cloud Run: scales to zero → near-zero idle cost.
- GCS + CDN: storage is cheap; CDN egress is the main cost driver for photos.
- Razorpay: per-transaction fee (industry standard for India).
