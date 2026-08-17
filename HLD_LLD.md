# KatalogitAI — System Design (HLD + LLD)

> **What this app is:** an AI product-photoshoot SaaS for Indian fashion retailers.
> A seller shoots a **flat-lay photo** of a garment on their phone → our pipeline
> generates **4–8 studio model photos** in fixed poses → the seller reviews,
> approves, and exports catalogue images for Flipkart/Meesho/Instagram.
>
> Status: **production-wired.** Real Firebase Auth, real Cloud Run API, real
> Firestore ledger, real GCS storage, real AI jobs via the managed Vertex AI
> engine (Nano Banana 2 Lite images + Gemini text) once `VERTEX_AI_LOCATION`
> is set on Cloud Run.
>
> Companion docs: `BACKEND_ARCHITECTURE.md` (design rationale), `GCP_SETUP_GUIDE.md`
> (operations), `MODEL_DECISION.md` (model choice + licensing), `PLATFORM_SEO_PLAYBOOK.md`.

---

## PART 1 — HIGH-LEVEL DESIGN (HLD)

### 1.1 What the system does (one paragraph)

A store owner signs up with email/password (Firebase Auth), completes onboarding,
gets a wallet of free credits, photographs garments, and pays **credits** to queue
AI jobs. A managed Vertex AI image model (Nano Banana 2 Lite) renders the posed
photos, the results land back on the product, the seller approves them into a
live catalogue, and can top up credits with Razorpay. The owner (OWNER_EMAIL +
passcode) can gift credits, review the global ledger, and see low-balance
follow-up alerts.

### 1.2 Architecture diagram

```
                         ┌───────────────────────────────┐
                         │  FRONTEND (React + Vite)      │
                         │  src/ · website/ (landing)    │
                         │  Firebase Auth (client SDK)   │
                         └───────┬───────────────┬───────┘
                                 │               │
                 Bearer ID token │               │ photos via signed PUT
                                 ▼               ▼
                         ┌────────────────────────────────────────┐
                         │  CLOUD RUN — katalogit-api (Express)   │
                         │  • requireAuth (Firebase ID token)     │
                         │  • CORS allowlist · helmet · rate-limit│
                         │  • core / credits / jobs / admin routes│
                         └────┬───────────┬───────────┬───────────┘
                              │           │           │
                     ┌────────▼──┐ ┌──────▼─────┐ ┌───▼──────────┐
                     │ Firestore │ │ GCS        │ │ Razorpay     │
                     │ users     │ │ originals  │ │ (orders +    │
                     │ stores    │ │ processed  │ │  webhook)    │
                     │ products  │ │ (signed    │ └───┬──────────┘
                     │ jobs      │ │  URLs)     │     │ HMAC-verified
                     │ wallets   │ │            │     │ + idempotent
                     │ ledger    │ └──────┬─────┘     │
                     │ orders    │        │           │
                     └────────┬──┘        │           │
                              │           │           │
                              ▼           ▼           ▼
                     ┌────────────────────────────────────────┐
                     │  Vertex AI (managed, via Cloud Tasks   │
                     │  worker) — Nano Banana 2 Lite, text    │
                     │  via Gemini Flash-Lite. No GPU to      │
                     │  run or secure; billed per image.      │
                     └────────────────────────────────────────┘
```

### 1.3 Components (what each piece is)

| Component | Tech | Role | Status |
|---|---|---|---|
| **Web app** | React 19 + Vite 8 | Seller dashboard: catalogue, review center, stats, settings, credits | ✅ live |
| **Landing site** | `website/` (vanilla JS + Firebase compat) | Marketing page + sign-in/sign-up | ✅ live |
| **Auth** | Firebase Auth (Identity Platform) | Email/password accounts; ID tokens | ✅ live |
| **API** | Express on Cloud Run (Node 20+) | All business logic; the only path to data | ✅ live |
| **Catalogue DB** | Cloud Firestore (asia-south1) | stores, products, jobs, notifications | ✅ live |
| **Credit ledger** | Firestore transactions | wallets + append-only ledger, exactly-once | ✅ live |
| **Photo storage** | Cloud Storage (2 buckets) | originals (private) + processed (public-read, unlistable) | ✅ live |
| **Payments** | Razorpay | Credit top-ups: orders + signature-verified webhook | ✅ wired (keys pending) |
| **Async queue** | Cloud Tasks (`ai-jobs`) | At-least-once job delivery to the engine | ✅ created |
| **AI engine** | Vertex AI managed API | Flat-lay → 8 posed model photos + listing text | ✅ wired (needs `VERTEX_AI_LOCATION`) |
| **Secrets** | Secret Manager | Razorpay keys, worker secrets | ✅ |
| **Owner console** | Inside web app (`AdminPanel`) | Gift credits, global ledger, follow-ups — OWNER_EMAIL + passcode session | ✅ |

### 1.4 Key architectural decisions (and why)

1. **One API, black-box style.** The browser never touches Firestore/GCS directly.
   Every request carries a Firebase ID token; the server derives the store id from
   the *verified token* (`store-{uid8}`), never from client input. This kills
   IDOR/oracle attacks by construction.
2. **Firestore transactions for money, not a SQL ledger.** `runTransaction` +
   idempotency markers (`credit_ops/{idemKey}`) give exactly-once reserve/grant/
   refund — retries, double-taps and doubled webhooks can never double-charge.
   Cost: **$0/mo** (Cloud SQL was blocked by Google's internal-service flag and
   would have cost ~$8/mo).
3. **Signed URLs instead of server-side upload proxying.** The API issues 15-min
   V4 signed PUT URLs; the browser uploads straight to GCS. No bandwidth through
   Cloud Run, no file buffering, no credential exposure.
4. **Managed AI, no GPU to secure.** Jobs run on Vertex AI (Nano Banana 2
   Lite for images, Gemini Flash-Lite for text) — billed per image, no box to
   harden, no secrets to leak. The worker route verifies Cloud Tasks OIDC
   tokens (audience = WORKER_URL) or the shared secret before doing anything.
5. **Deterministic AI output.** Seed = FNV-1a(storeId:productId:poseId) + fixed
   model + fixed pose prompts → the same product renders consistently on retry.
6. **Licensing is a business constraint.** Managed Google models are
   commercial-safe by default. Self-hosted VTON stacks (IDM-VTON/CatVTON/
   OOTDiffusion) stay excluded — non-commercial licenses.

### 1.5 Data flows (the important journeys)

**A. Sign up → first catalogue (happy path)**
```
Sign up (Firebase) → GET /me (server derives store-{uid8}, returns onboarded:false)
→ OnboardingFlow → POST /stores (creates store + grants welcome credits exactly once)
→ AddProductFlow: camera → data URL → POST /uploads/urls → PUT to GCS → POST /products
→ POST /jobs (reserves 3 credits atomically) → job queued → Cloud Tasks worker
→ Vertex AI renders 8 poses → gallery written to product → job done
→ ReviewCenter: approve → product live → visible in Catalogue
```

**B. Low balance (the "draft" safety net)**
```
AddProductFlow sees balance < 3×model_shoot cost → warns "you can catalog 1–2 products"
→ if user proceeds: photos upload + product created (status: pending_approve)
→ POST /jobs fails 402 INSUFFICIENT_CREDITS → product flipped to status: draft
→ a low_balance follow-up alert is queued to admin_alerts (deduped while open)
→ Drafts sit in Review Center "Waiting for credits"; recharge → Generate Draft
```

**C. Top-up (Razorpay)**
```
TopUpModal → POST /credits/orders → Razorpay order (pack price in paise)
→ client opens checkout.razorpay.com with public keyId
→ payment.captured webhook → HMAC-SHA256 verified over RAW body
→ grantCredits idemKey rzp:{paymentId} → order marked paid → wallet updated
→ frontend polls GET wallet until balance moves
```

**D. Admin gifting**
```
AdminPanel (only renders for isAdmin) → POST /admin/credits {storeId|email, amount, note}
→ requireAdmin (OWNER_EMAIL + passcode-issued short-lived session) → grant/refund idempotent
→ visible in GET /admin/stores + GET /admin/ledger (global mirror stream)
```

### 1.6 Security posture (the "black box")

- **AuthN:** Firebase ID token verified on every `/api/v1` call (except webhooks/
  worker which authenticate by HMAC/OIDC/shared-secret). Cloud Run runs
  `--allow-unauthenticated` at the IAM layer (browser can't do IAM), but the
  app-level `requireAuth` rejects anything without a valid token. Invalid/garbage
  tokens → 401. `/ping` is the only public route.
- **AuthZ:** store ownership enforced on every store/product/job/ledger route
  (`requireStoreOwner`); foreign store ids → 404 (no existence oracle).
  `plan`, `status`, `balance`, `ownerUid` are server-managed and reject client
  writes (PATCH forbids-list).
- **Input:** every field passes `validate.js` (backend) — whitelisted keys,
  strict types, length caps, enum allowlists, control-char stripping. Object
  keys are whitelisted → no prototype pollution. Client also sanitizes
  (`src/api/sanitize.js`) as a first gate.
- **Prompt injection:** user text entering the AI prompt is scrubbed of
  `()[\]{},:/\"'<>;|*~`` weight-syntax/metacharacters server-side.
- **Rate limiting:** global per-IP limiter (600/15 min) + per-user limiters on
  jobs (20/hr) and orders (10/hr).
- **Head hardening:** helmet defaults, X-Powered-By off, CSP meta in production
  build (`vite.config.js`), frame-ancestors 'none', strict CORS allowlist,
  uniform `{ok, data|error}` responses with no stack traces to clients.
- **Secrets:** Secret Manager only; `.env.example` has placeholders; the web API
  key is public by design (it only identifies the project to Google).

### 1.7 Cost profile (deliberately cheap)

| Service | Cost posture |
|---|---|
| Firebase Auth (email/password) | $0 |
| Firestore | free tier (50k reads/20k writes/day) |
| Cloud Run | scales to zero; free tier covers early traffic |
| GCS | ~$0.02/GB/mo; public-read only on processed |
| Cloud Tasks / Secret Manager | $0 within free tier |
| Razorpay | per-transaction fee |
| Vertex AI images | ~$0.034/image (Batch API ≈ half); text ~$0.001 |
| **Monthly target** | **~$0–3 until real traffic** |

---

## PART 2 — LOW-LEVEL DESIGN (LLD)

### 2.1 Backend file map

```
backend/
  src/
    server.js        entrypoint — helmet, CORS, body cap, route mounting, /ping
    config.js        env → config (CORS_ORIGIN, OWNER_EMAIL, ADMIN_PASSCODE, pricing, packs, secrets)
    auth.js          verifyIdToken (OAuth2Client) + requireAuth + requireAdmin
    db.js            Firestore singleton + collection refs + snap()
    ledger.js        grantCredits / reserveCredits / refundCredits / listLedger
                     (all idempotent via credit_ops/{idemKey} inside runTransaction)
    storage.js       signedUploadUrl / signedReadUrl / signedPutUrl / objectExists
    validate.js      s, so, id, email, phone, int, num, bool, oneOf, strArr,
                     fileName, objectPath, priceStr, aiSpecs, product, store,
                     jobCreate, orderCreate, adminAdjust
    errors.js        AppError + handlers (uniform JSON, no leaks)
    rate-limit.js    globalLimiter + userLimiter factory
    ai-client.js     buildPrompt (sanitized), promptSafe, fnv1a, POSE_LIST
    ai-fallback.js   generateWithVertexAi — managed image render (single engine)
    ai-text.js       generateListingText — Gemini listing/SEO copy (best-effort)
    routes/
      core.js        /me, /stores CRUD, /products CRUD, /uploads/urls, /notifications
      credits.js     /credits, /credits/ledger, /credits/packs, /credits/orders,
                     /webhooks/razorpay, /admin/stores, /admin/ledger, /admin/credits,
                     /admin/follow-ups      jobs.js       /jobs POST (quota→reserve→record→enqueue), GET /jobs, GET /jobs/:id,
                     /workers/run-job (atomic claim, Vertex AI render, refund on fail)
      owners.js      requireStoreOwner (ownership guard, 404 on foreign)
  test/smoke.mjs     17 checks — ledger idempotency/atomicity + HTTP black-box
  ai/                poses.json + poses/ (pose reference images for prompts)
```

### 2.2 Firestore data model (actual, live)

```
users/{uid}                        { uid, email, name, createdAt }   (server-written)
stores/{storeId}                   { id, ownerUid, ownerEmail, plan:'free', status,
                                     name, city, categories[], scale, aiFeatures[],
                                     salesChannel, yearsInBusiness, inventoryTurnover,
                                     hasInventorySystem, orderValue, brandStyle,
                                     storeType, createdAt, updatedAt }
  stores/{sid}/products/{pid}      { id, storeId, status, title, category, price,
                                     qty, flatLay:{path,contentType,size},
                                     gallery:[{path,contentType,size,pose,ts}],
                                     aiSpecs, modelId, note, createdAt, updatedAt }
  stores/{sid}/jobs/{jobId}        { id, storeId, type, productId, photoPath,
                                     status: queued|processing|done|failed,
                                     creditsReserved, outputPaths[], errorCode,
                                     createdAt, updatedAt, lastAttemptedAt }
  stores/{sid}/ledger/{entryId}    { storeId, type GRANT|CONSUME|REFUND|TOPUP,
                                     amount, balanceAfter, referenceType,
                                     referenceId, note, actor, ts }
  stores/{sid}/notifications/{nid} { id, storeId, type, message, balance, read, ts }
wallets/{storeId}                  { storeId, balance, plan, createdAt, updatedAt }
credit_ops/{idemKey}               { idemKey, done:true, result, ts }   (exactly-once)
orders/{orderId}                   { orderId, storeId, uid, packId, credits,
                                     amountPaise, currency, status, createdAt, paidAt }
webhook_events/{eventId}           { event, receivedAt }                (dedupe)
ledger_global/{entryId}            mirror of every ledger row (admin stream)
admin_alerts/{id}                  { storeId, storeName, ownerEmail, type,
                                     message, balance, ts, resolved, resolvedTs }
```

### 2.3 Credit ledger semantics (the money)

```
grantCredits / reserveCredits / refundCredits
  └─ runIdempotent(idemKey, fn)
       └─ db.runTransaction:
            1. read credit_ops/{idemKey}
            2. if exists → return recorded result (REPLAY, no double-charge)
            3. else run fn(tx):
                 • read wallet (serializable read-then-write)
                 • reserve: balance >= amount else throw 402 INSUFFICIENT_CREDITS
                 • update balance
                 • append ledger row (per-store) + ledger_global row (same tx)
            4. tx.set(credit_ops/{idemKey}, {result})
```

Idempotency keys in use: `signup:{uid}` (welcome grant), `job:{jobId}` (reserve),
`refund:{jobId}` (refund), `rzp:{paymentId}` (top-up), `admin:{store}:{amt}:{note}`.

### 2.4 API surface (v1 — all Bearer-authed except webhook/worker/ping)

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/ping`, `/healthz` | public | health (run.app reserves /healthz → use /ping) |
| GET | `/me` | auth | bootstrap: user + store + wallet + isAdmin |
| POST | `/stores` | auth | onboarding, idempotent, grants welcome credits |
| GET/PATCH | `/stores/:id` | owner | PATCH forbids plan/status/balance/owner fields |
| GET/POST | `/stores/:id/products` | owner | list (filter by status) / create |
| PATCH/DELETE | `/stores/:id/products/:pid` | owner | patch whitelists keys |
| POST | `/uploads/urls` | auth | signed PUT URL, purpose→bucket allowlist |
| GET | `/stores/:id/notifications` | owner | in-app feed |
| POST | `/stores/:id/notifications` | owner | queues admin follow-up (deduped) |
| GET | `/stores/:id/credits` | owner | balance + plan + pricing |
| GET | `/stores/:id/credits/ledger` | owner | history |
| GET | `/credits/packs` | auth | purchasable packs |
| POST | `/credits/orders` | auth + 10/hr | Razorpay order |
| POST | `/webhooks/razorpay` | HMAC | signature-verified, exactly-once top-up |
| POST | `/jobs` | owner + 20/hr | quota → atomic reserve → record → enqueue |
| GET | `/jobs`, `/jobs/:id` | owner | list / poll |
| POST | `/workers/run-job` | OIDC/secret | atomic claim → Vertex AI render → settle/refund |
| GET | `/admin/stores`, `/admin/ledger` | **admin** | allowlist-gated |
| POST | `/admin/credits` | **admin** | gift/reverse by storeId or email |
| GET/POST | `/admin/follow-ups[/:id/resolve]` | **admin** | team queue |

Response envelope: `{ ok:true, data }` | `{ ok:false, error:{ code, message } }`.
Codes: 400 INVALID_FIELD / 401 UNAUTHORIZED / 402 INSUFFICIENT_CREDITS /
403 FORBIDDEN / 404 NOT_FOUND / 409 STORE_CONFLICT / 413 PAYLOAD_TOO_LARGE /
429 RATE_LIMITED / 501 not-configured / 502 VERTEX_FAILED / 504 TIMEOUT.

### 2.5 Frontend file map

```
src/
  main.jsx                    React root
  App.jsx                     Shell: auth gate → preloader → onboarding → dashboard.
                              Owns all server data + every handler (approve, gift,
                              draft-generate, top-up polling, sign-out state reset).
  api/
    firebase.js               Firebase init (public web config)
    auth.js                   Firebase Auth wrapper (same interface as old local one)
    client.js                 THE API client — every endpoint, session cache, mappers
                              (toUiProduct / toServerPatch / toUiLedger / …)
    ai.js                     job create/poll + pipeline stages + model roster
    sanitize.js               client-side sanitizers (first gate)
  components/
    AuthGate.jsx              sign in / create account (Firebase)
    KatalogitPreloader.jsx    brand intro animation (per page load)
    OnboardingFlow.jsx        store profile wizard → POST /stores
    AddProductFlow.jsx        camera/upload → low-balance warning → shoot → draft fallback
    ReviewCenterView.jsx      approve / retake / draft tabs (ReviewPDP + RetakeSession)
    ReviewPDP.jsx             per-product review, regen shot / full regen (real jobs)
    RetakeSession.jsx         re-shoot a product
    ProductDetailModal.jsx    catalogue PDP
    CatalogGrid.jsx           live catalogue + search
    StatsView.jsx             dashboard stats
    SettingsView.jsx          profile, credits, admin entry, sign out
    CreditsWallet.jsx         TopUpModal (Razorpay) + TransactionsModal (ledger)
    AdminPanel.jsx            admin console (gift, global ledger, follow-ups)
    BannerCarousel.jsx, TopStatusBar.jsx, ProductModal.jsx, AIModelWizard.jsx
website/                      public landing + sign-in (Firebase compat SDK)
vercel.json                   security headers + CSP for the hosted site
vite.config.js                dev/preview headers + prod CSP injection plugin
```

### 2.6 Job lifecycle (worker orchestration, exact)

```
POST /jobs
 1. validate type/productId; product must exist & belong to store
 2. quota check: open jobs < JOB_QUOTA[plan] (free=2, pro=10, business=50)
 3. reserveCredits(amount=CREDIT_PRICING[type], idemKey=job:{jobId})   → 402 if broke
 4. write Firestore job (queued)
 5. enqueue Cloud Tasks (tolerant — failure is non-fatal)

worker POST /run-job (verified OIDC token or shared secret)
 1. atomic claim: tx reads job; terminal states (done/failed) → return duplicate;
    else → status='processing'  (a crash lets the next retry re-claim)
 2. Vertex AI unconfigured → revert to 'queued' (honest stub; credits stay reserved)
 3. product missing → 'failed' + refundCredits(refund:{jobId})
 4. text pass: generateListingText (Gemini) — fills aiSpecs + placeholder title,
    best-effort, never fails the job
 5. generateWithVertexAi: managed render of 8 poses for the garment
 6. failure → job 'failed' + refundCredits(refund:{jobId}); stale 'processing'
    (> STALE_JOB_MS) also fails + refunds so nothing hangs forever
 7. success → append output paths to product.gallery (deduped), job 'done'
    (gallery written BEFORE done so a crash between them can't lose renders)
```

### 2.7 Frontend state → server mapping (key rules)

- **Store id** is never typed — `getCurrentStoreId()` = `store-{uid8}` from the
  session cache, mirroring the server's derivation.
- **Credits**: every mutation goes through the API; the UI *displays* the wallet
  and opens TopUp on `402/INSUFFICIENT_CREDITS`. Client-side `CREDIT_PRICING` is
  display-only — the server is the source of truth.
- **isAdmin** is decided by the server (`GET /me` checks OWNER_EMAIL match;
  the session); the client only gates rendering.
- **Low-balance UX**: `LOW_BALANCE_SHOOT_THRESHOLD = 3` shoots → if
  `balance < 3 × 3` the AddProductFlow warns the user; if they proceed and hit 402,
  the product becomes a **draft** (photos never lost) and a follow-up alert pings
  the admin queue.
- **Sign-out** resets ALL in-memory state so the next account on the device never
  sees the previous user's inventory.

### 2.8 Security checklist (verified live)

- [x] `/ping` only public route; `/api/v1/*` → 401 without valid Firebase token
- [x] Garbage token → 401; unknown origin → no ACAO headers (CORS deny verified)
- [x] helmet headers present; X-Powered-By absent
- [x] Ownership guard on every store-scoped route (foreign id → 404)
- [x] Ledger idempotency (replayed ops return recorded result, no double-charge)
- [x] 256 KB body cap; malformed JSON → clean 400
- [x] Rate limits: global 600/15min/IP + jobs 20/hr/user + orders 10/hr/user
- [x] Razorpay webhook: HMAC over raw body, timing-safe compare, event dedupe
- [x] Admin routes: OWNER_EMAIL + passcode-issued session (env), never client-supplied
- [x] GCS: public-access-prevention removed ONLY on processed bucket for browser
      display (objects unlistable, paths unguessable); originals stay private
- [x] CSP injected in prod build + `vercel.json` headers; frame-ancestors 'none'
- [x] Prompt-injection scrub on AI prompt fields

### 2.9 What remains before full production

1. **Firebase Auth providers** — ensure Email/Password is enabled in the console
   (the account flow is coded; console switch is the only user-side blocker).
2. **Razorpay keys** → Secret Manager (test keys to start; the flow is wired).
3. **Vertex AI** — set `VERTEX_AI_LOCATION` (e.g. `global` or `asia-south1`)
   on Cloud Run; the managed image + text engines then render real jobs.
4. **Custom domain** — map `katalogit.ai` → hosting/CDN for the frontend.
5. **Monitoring** — uptime check on `/ping`, error alerts on Cloud Run logs.
