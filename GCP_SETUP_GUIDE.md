# KatalogitAI — Google Cloud Setup Guide (Production Foundation)

> **Scope:** Everything needed for user accounts, photo storage, credits/wallet, and the
> API — fully production-grade. **The AI model pipeline is intentionally LAST** (Phase 6);
> the job-queue plumbing exists but the model itself is not wired.
>
> Companion docs: [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) (design + data model),
> [`backend/`](backend/) (rules, SQL schema, OpenAPI, env template).
> This guide is the *operational* walkthrough — exact console paths + gcloud commands.

---

## ⚡ Current provisioning status (2026-08-06)

Project **`katalogitai-501916`** (billing ON, owner: agarwalmanas009@gmail.com):

| Item | Status | Notes |
|---|---|---|
| gcloud CLI + Firebase CLI | ✅ Installed | gcloud 579.0.0, firebase 15.25.1 (via Homebrew) |
| All 10 APIs enabled | ✅ | Firestore, Run, Tasks, Secret, identitytoolkit, Build, Artifact, firebaserules, Storage |
| Firestore database | ✅ Created | Native mode, `asia-south1` (Mumbai) |
| Firestore security rules | ✅ Deployed | via firebaserules API (backend/schema/firestore.rules) |
| Firestore composite indexes | ✅ Created | products×2, jobs, notifications |
| GCS buckets | ✅ Created | `katalogit-originals` + `katalogit-processed`, PAP enforced, CORS set |
| Storage rules | ✅ Deployed | via firebaserules API (backend/schema/storage.rules) |
| Cloud Tasks queue | ✅ Created | `ai-jobs` in asia-south1 |
| Secret Manager | ✅ Created | katalogit-db-url, razorpay-key, razorpay-webhook (placeholders) |
| **Cloud Run API** | ✅ **LIVE** | `https://katalogit-api-lhrnfvmswa-el.a.run.app` — full Express API deployed (rev 00005), `--no-allow-unauthenticated`, scales to zero |
| **Credit ledger** | ✅ **LIVE** | Implemented on **Firestore transactions** (atomic + idempotency keys — same guarantees as the SQL schema, **$0/mo**) — Cloud SQL no longer required |
| Smoke test | ✅ 13/13 | Ledger atomicity/idempotency + black-box HTTP verified against real Firestore |
| Runtime SA | ✅ Created | `katalogit-api-runner` — minimal roles (Firestore, GCS, Secrets, Tasks, logging) |
| **Cloud SQL** | ⏭️ **Skipped** | Google-side "internal service" restriction; the Firestore ledger makes it unnecessary |
| Firebase Auth | ⏳ **Console step (you)** | Enable Email/Password (+ Phone) in Firebase console — the ONLY remaining blocker for real accounts |

---

## 🚨 Your part — the only 3 things left that need you

1. **Firebase console (~3 min):** <https://console.firebase.google.com> → *Add project* →
   pick **katalogitai-501916** (skip Analytics) → **Build → Authentication → Get started →
   Sign-in method** → enable **Email/Password** (free; make it primary) and **Phone**
   (optional, ~₹0.8/OTP). Then grab the **Web SDK config** (⚙ Project settings → Your apps →
   Web) and paste the `firebaseConfig` snippet to me — or run `firebase login` in your
   terminal and I'll fetch it myself.
2. **Razorpay keys (Phase 3, non-blocking):** for real credit top-ups later — create the
   merchant account, then give me test API keys; I'll store them in Secret Manager.
3. **Custom domain + DNS** (at launch): map `app.yourdomain.com` to Firebase Hosting.

Everything else (API, ledger, storage, security) is deployed and verified.

## 💸 Cost-optimization plan (the cheap way)

Everything below is free-tier-first. Target: **~$0–5/month until real traffic**.

| Service | Free tier that covers early usage |
|---|---|
| Firebase Auth | Email/Password auth is **100% free**. Phone OTP costs **$0.01/verify** in India (Tier 1) — keep email as the primary sign-in to stay at $0. |
| Firestore | **50k reads / 20k writes / 1 GiB free per day** — far beyond early catalogues |
| Cloud Run | **2M requests + 180k vCPU-sec free/month**; scales to zero when idle |
| GCS | Storage is ~$0.02/GB/mo; free-tier GCS is US-only, so keep buckets in asia-south1 for latency (cheap anyway) |
| Cloud Tasks | Free (pay only for the worker compute, which is Cloud Run's free tier) |
| Secret Manager | First 6,000 secret versions + 10k access ops free |
| Cloud SQL | **THE one recurring cost (~$7–10/mo)** — see the workaround below |

**Biggest lever — avoid Cloud SQL entirely (saves ~$8/mo and dodges the current block):**

The credit ledger can run safely on **Firestore transactions** instead of Postgres:
Firestore `runTransaction` gives atomic read-modify-write, and an idempotency check
(unique `ledger/{jobId}` doc + transaction-conditional create) gives the same
never-double-spend guarantee. The `backend/schema/cloudsql/schema.sql` is still the
reference for the exact semantics. **Decision needed:** stay Postgres (safest, ~$8/mo)
or go Firestore-only (free, slightly more ledger code).

---

## ⚠️ Cloud SQL blocked — how to fix (5 min, you click)

Cloud SQL is currently refused with *"Service cloudsql.googleapis.com is an internal
service..."* — a known Google-side flag on consumer (gmail.com) billing accounts. CLI/API
enablement is blocked, but the **console UI uses a different path**:

1. Open **<https://console.cloud.google.com/apis/library/cloudsql.googleapis.com?project=katalogitai-501916>**
   and click **Enable**. (Sometimes this alone clears it.)
2. If that still fails, open **<https://console.cloud.google.com/billing/accounts>**,
   and in your billing account click **Manage payments profile** → verify/complete the
   profile (missing payment profile verification is the #1 cause of this flag).
3. If still blocked, file a free support case: console → **Support → Create case** →
   product "Cloud SQL", type "Enablement". They lift the internal-service flag within a
   day or two.
4. **Skip it entirely (free option):** go Firestore-transactions-only for the ledger
   (see cost plan above) — no Cloud SQL, no wait, ~$8/mo saved.

---

## 0. The full inventory — what cloud stuff you need

| # | Service | What it does for KatalogitAI | Region |
|---|---|---|---|
| 1 | **GCP Project + Billing** | Everything lives in one project; billing must be enabled for Cloud Run/SQL/Auth OTP | — |
| 2 | **Firebase Auth** | User accounts — Phone OTP (Indian vendors) + Email/Password fallback | global |
| 3 | **Cloud Firestore** (Native) | Catalogue: `users`, `stores`, `products`, `jobs`, `notifications` | `asia-south1` |
| 4 | **Cloud SQL (PostgreSQL)** | **Credit ledger** — wallets, ledger, orders, pricing. ACID = never double-spend | `asia-south1` |
| 5 | **Cloud Storage** (2 buckets) | `katalogit-originals` (private raw photos) + `katalogit-processed` (AI results) | `asia-south1` |
| 6 | **Cloud Run** | Node/Express API — scales to zero, near-zero idle cost | `asia-south1` |
| 7 | **Cloud Tasks** | Async AI job queue (stub worker now, real model later) | `asia-south1` |
| 8 | **Secret Manager** | API keys, DB passwords, Razorpay keys — never in code or env | global |
| 9 | **Razorpay** *(Phase 3)* | Credit top-ups (UPI/cards/net-banking) via webhooks | India |
| 10 | **Hosting/CDN** *(optional)* | Serve the React frontend + processed photos fast | global/asia |

**You do NOT need:** compute VMs (Cloud Run replaces them), Kubernetes, BigQuery
(optional later), an AI/ML API yet.

---

## 1. One-time account setup (5 min)

1. **Google account** — you need a Google account (you likely have one). No GCP credit card
   is charged until you enable billing; the free tier covers small volumes.
2. **Create the project**
   - Go to <https://console.cloud.google.com> → project selector (top bar) → **New Project**
   - Name: `katalogitai` (or `katalogitai-prod`) → **Create**
   - Note your **Project ID** (auto-generated, e.g. `katalogitai-438921`). This is the value
     I need from you to do the rest. *Project ID cannot be changed later.*
3. **Enable billing**
   - Left menu → **Billing** → link/create a billing account → attach it to the project.
   - ⚠️ Phone OTP (SMS), Cloud Run, Cloud SQL, Cloud Tasks all require a **billing-enabled**
     project. Google may ask you to re-authenticate when attaching billing (newer security).

---

## 2. Install the CLI tools (I can do this for you)

Your machine: macOS 26.6, Homebrew 6.0.11, Node v24.18 — all ready.

```bash
# 1) Google Cloud SDK
brew install --cask google-cloud-sdk

# 2) Firebase CLI (rules + auth + hosting)
npm install -g firebase-tools

# 3) Verify
gcloud --version && firebase --version
```

Then **authenticate once** (opens your browser; you approve with your Google account):

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
```

> After this one step, I can run every remaining command for you — you won't need to
> type anything else. This is the cleanest division of labour.

---

## 3. Enable the APIs (once, ~2 min)

```bash
gcloud services enable \
  firebase.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  cloudsql.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  identitytoolkit.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

> `identitytoolkit` = Firebase Auth backend. `cloudbuild` + `artifactregistry` =
> build & host the API container for Cloud Run.

---

## 4. Firebase Auth — user accounts (Phase 1)

**Console:** <https://console.firebase.google.com> → select `katalogitai` →
**Build → Authentication → Sign-in method**:

| Provider | Enable | Notes |
|---|---|---|
| **Phone** | ✅ | Primary for Indian vendors. Needs billing-enabled project. |
| **Email/Password** | ✅ | Fallback — India SMS can be flaky; keep this on. |

Security settings (recommended):
- **Email enumeration protection** → ON (prevents account probing).
- **Password policy** → require 8+ chars with mixed case/digits.
- Add a test phone number under **Authentication → Settings** for dev.

**What your app does today vs later:** the frontend `src/api/auth.js` does local PBKDF2 +
localStorage. The swap is one file: replace it with the **Firebase JS SDK**
`signInWithPhoneNumber` / `createUserWithEmailAndPassword`, then send the resulting
**ID token** (`user.getIdToken()`) as `Authorization: Bearer <idToken>` on every API call.
The backend verifies it with the Firebase Admin SDK — that's the real security boundary.

---

## 5. Firestore — catalogue database (Phase 1)

**Console:** <https://console.cloud.google.com> → **Databases → Firestore → Create database**:

1. **Mode:** `Native mode` (NOT Datastore). *Permanent choice.*
2. **Database ID:** `(default)`
3. **Region:** `asia-south1` (Mumbai). *Permanent choice — this is why we decide now.*

Then deploy the already-written rules + indexes from your repo:

```bash
cd backend
firebase deploy --only firestore:rules,firestore:indexes
```

These rules enforce **per-user/per-store isolation** (a vendor can only read/write their
own store's docs). The scaffold in `backend/schema/firestore.rules` + `.indexes.json` is
ready to go.

---

## 6. Cloud Storage — photos (Phase 2)

```bash
# Two buckets — originals are PRIVATE; processed is private too, served via signed URLs
gsutil mb -l asia-south1 -b on gs://katalogit-originals
gsutil mb -l asia-south1 -b on gs://katalogit-processed

# Block public access by default (defense in depth)
gsutil pap set enforced gs://katalogit-originals
gsutil pap set enforced gs://katalogit-processed

# CORS — allows the browser to PUT photos directly (signed-URL upload)
gsutil cors set backend/schema/storage-cors.json gs://katalogit-originals
```

Deploy the bucket rules (owner-only reads, backend-only writes):

```bash
firebase deploy --only storage
```

**The upload flow (no server proxy — fast + cheap):**
```
Client → POST /v1/uploads/urls  →  API returns a 15-min signed PUT URL
Client → PUT photo directly to GCS (≤10 MB, image/* enforced)
Client → POST /v1/products      →  API verifies the object exists, then saves the product
```
Originals stay private forever; processed AI results are served to the owner via short-lived
signed URLs (never public buckets).

---

## 7. Cloud SQL — the credit ledger (Phase 3, the money)

```bash
gcloud sql instances create katalogit-credit \
  --database-version=POSTGRES_16 \
  --region=asia-south1 \
  --tier=db-f1-micro \
  --backup-start-time=01:00

gcloud sql databases create katalogit --instance=katalogit-credit

# Apply the schema (wallets, ledger, orders, pricing + atomic reserve/grant functions)
gcloud sql connect katalogit-credit --user=postgres --database=katalogit \
  < backend/schema/cloudsql/schema.sql
```

**Why Postgres for credits:** your `schema.sql` already contains `reserve_credits()`,
`grant_credits()` and a UNIQUE idempotency-key constraint. That means a job reservation,
a refund, and a Razorpay webhook **cannot double-charge even if delivered twice**. Firestore
rules alone can't give you that guarantee — this is the hard part of the money.

> Cost note: `db-f1-micro` ≈ a few $/month. Upgrade only when ledger writes grow.

---

## 8. Secret Manager — never commit secrets

```bash
echo -n "$DATABASE_URL" | gcloud secrets create katalogit-db-url --data-file=-
echo -n "$RAZORPAY_KEY_SECRET" | gcloud secrets create razorpay-secret --data-file=-
echo -n "$RAZORPAY_WEBHOOK_SECRET" | gcloud secrets create razorpay-webhook --data-file=-
```

The Cloud Run service reads these at runtime via the Secret Manager API. `backend/.env.example`
holds placeholders only — real values never live in the repo.

---

## 9. Deploy the API to Cloud Run (DONE — redeploy recipe)

The full Express API lives in `backend/` (entry: `src/server.js`) and is **already live**
(`https://katalogit-api-lhrnfvmswa-el.a.run.app`). To rebuild/redeploy after code
changes (Buildpacks — no Dockerfile needed):

```bash
cd backend
gcloud run deploy katalogit-api --source . --region asia-south1 \
  --no-allow-unauthenticated --min-instances 0 --max-instances 2 \
  --memory 512Mi --cpu 1 \
  --service-account katalogit-api-runner@katalogitai-501916.iam.gserviceaccount.com \
  --set-env-vars "^|^FIREBASE_PROJECT_ID=katalogitai-501916|ADMIN_EMAILS=you@example.com|CORS_ORIGIN=https://app.yourdomain.com" \
  --set-secrets "RAZORPAY_KEY_ID=razorpay-key:latest,RAZORPAY_KEY_SECRET=razorpay-key:latest,RAZORPAY_WEBHOOK_SECRET=razorpay-webhook:latest"
```

Notes from the live run:
- `--no-allow-unauthenticated` = the front gate refuses anonymous calls (403) and invalid
  tokens (401) before the app is reached; the app then re-verifies Firebase ID tokens.
- **`/healthz` is reserved by the run.app front gate (always 404 externally) — the app's
  health route is `/ping`.** Use `/ping` for uptime monitors.
- Verify locally with an impersonated identity token:
  `gcloud auth print-identity-token --impersonate-service-account=katalogit-api-runner@… --audiences=<URL>`

---

## 10. Wire the frontend (the swap)

The frontend is deliberately storage-agnostic today. The swap points:

| File | Today | Later |
|---|---|---|
| `src/api/auth.js` | local PBKDF2 + localStorage | Firebase JS SDK (ID tokens) |
| `src/api/client.js` | localStorage, wrapped `{v,d,c}` | `fetch('/api/...')` with Bearer token |
| `src/api/ai.js` | offline MockProvider | job create/poll against `POST /v1/jobs` (model still mock until Phase 6) |

No UI component changes — the data layer is already async and mirrors the API contract.
When the backend is live, put the app on Firebase Hosting with a **rewrite** so `/api/**`
proxies to Cloud Run (keeps CORS tight: single origin).

---

## 11. Razorpay billing (Phase 3 — do after credits work locally)

1. Create a Razorpay merchant account (needs GST/pan for payouts — India compliance).
2. Store keys in Secret Manager (§8).
3. `POST /v1/credits/orders` creates an order → client completes payment →
   Razorpay **webhook** → signature-verified → wallet top-up in one SQL transaction
   (idempotency key = `payment_id`). GST invoice server-side.

Until then, credits can be granted by admins (the Admin Console already exists in the app).

---

## 12. Go-live checklist (run before production launch)

- [ ] `gcloud auth login` done; only you + trusted team have access
- [ ] Firestore + Storage rules deployed and **tested with a second dummy account**
- [ ] Cloud Run `--no-allow-unauthenticated` + ID-token middleware tested
- [ ] Phone OTP + email fallback both sign in/up successfully
- [ ] Reserve/refund cycle tested: insufficient credits → 402; job fail → refund
- [ ] Signed-URL upload works; oversized/evil files rejected (10 MB cap, magic bytes)
- [ ] CORS locked to your frontend origin only
- [ ] Backups on: Cloud SQL auto-backups + PITR, GCS lifecycle on processed bucket
- [ ] `ADMIN_EMAILS` allowlist populated for your team (both `src/api/auth.js` + `website/auth.js`)

---

## 13. Cost estimate (rough, early stage)

| Item | ~Cost/month |
|---|---|
| Firebase Auth (email) | **$0** (free) |
| Firebase Auth (phone OTP) | $0.01 per verification (India) — use email primary |
| Firestore | $0 within free tier (50k reads / 20k writes / 1 GiB daily) |
| Cloud Run | ~$0 (2M free requests, scales to zero) |
| Cloud Tasks | $0 |
| Secret Manager | $0 (free tier) |
| **Cloud SQL** (if used) | **$7–10** — the only recurring line item |
| GCS + egress | $0–2 until real traffic |
| Razorpay | Per-transaction fee only |

**With the Firestore-only ledger: ~$0–3/month until real traffic.**
With Cloud SQL: ~$8–13/month.

---

## What I need from you to proceed

1. **Firebase Auth (the one blocker — ~3 min, you click):** <https://console.firebase.google.com>
   → *Add project* → pick **katalogitai-501916** → **Build → Authentication → Get started →
   Sign-in method** → enable **Email/Password** (+ Phone if wanted).
2. **Web SDK config:** copy the `firebaseConfig` snippet (⚙ → Project settings → Your apps
   → Web) and paste it to me — or run `firebase login` in your terminal and I'll fetch it
   myself and wire `website/` sign-in.
3. **Razorpay keys** when you're ready for paid top-ups (Phase 3).

Once Auth is on, I'll: flip the frontend's `src/api/auth.js` + `src/api/client.js` to the
real API (Firebase ID tokens → Bearer header), deploy the frontend to Firebase Hosting with
an `/api/**` rewrite to Cloud Run, and run the full end-to-end signup→store→credit→shoot test.
