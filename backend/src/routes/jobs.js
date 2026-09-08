/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — async AI jobs
   ────────────────────────────────────────────────────────────────────────
   POST /jobs  → quota check → ATOMIC credit reservation (idempotent by job
                 id) → Firestore job record → Cloud Tasks enqueue (optional)
   GET  /jobs/{id} → poll status
   POST /workers/run-job → the queue worker. Runs the real pipeline via the
     managed Vertex AI engine (Nano Banana 2 Lite images + Gemini listing text)
     when VERTEX_AI_LOCATION is set; otherwise jobs stay 'queued' honestly.
     The endpoint only accepts requests carrying a Cloud Tasks OIDC token or
     the shared worker secret — nobody else can drive it.
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { db, jobsColl, productsColl, now, snap } from '../db.js';
import { jobCreate, id as cleanId } from '../validate.js';
import { reserveCredits, refundCredits } from '../ledger.js';
import { CREDIT_PRICING, JOB_QUOTA, WORKER_URL, WORKER_AUTH_TOKEN, TASKS_QUEUE,
         vertexConfigured, textAiConfigured,
         VERTEX_AI_MODEL, VERTEX_TEXT_MODEL } from '../config.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { userLimiter } from '../rate-limit.js';
import { requireOwnStore } from './owners.js';
import { POSE_LIST } from '../ai-client.js';
import { generateWithVertexAi } from '../ai-fallback.js';
import { generateListingText } from '../ai-text.js';

// Tighter per-user cap on job creation (anti-abuse on the paid path).
const createJobLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 20, message: 'Job limit reached. Try again later.' });

// A job left in 'processing' longer than this (no worker heartbeat) is dead —
// the Cloud Run instance polling it crashed. It gets failed + refunded.
const STALE_JOB_MS = 10 * 60 * 1000;

/** Fail + refund a store's stale 'processing' jobs (idempotent refund keys). */
async function reapStaleJobs(storeId) {
  const cutoff = now() - STALE_JOB_MS;
  const snap = await jobsColl(storeId)
    .where('status', '==', 'processing').limit(100).get();
  for (const doc of snap.docs) {
    const j = doc.data();
    if (!j.lastAttemptedAt || j.lastAttemptedAt > cutoff) continue;
    await doc.ref.update({ status: 'failed', errorCode: 'TIMEOUT', updatedAt: now() })
      .catch((e) => console.error('[jobs] stale reap update failed:', e && e.message ? e.message : e));
    await refundCredits({
      storeId, amount: j.creditsReserved, idemKey: `refund:${j.id}`,
      note: `Job ${j.id}: stale (no worker progress)`, actor: 'system',
    }).catch((e) => console.error('[jobs] stale refund failed:', e && e.message ? e.message : e));
  }
}

export const jobsRouter = Router();

const genJobId = () => `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

// POST /jobs — create a job. Reserves credits atomically (402 if broke).
jobsRouter.post('/jobs', createJobLimiter, requireOwnStore, async (req, res, next) => {
  try {
    // storeId scopes photoPath to this store (cross-tenant guard).
    const body = jobCreate(req.body || {}, req.store.id);
    const { type, productId } = body;

    // The product must exist and belong to this store.
    const prodDoc = await productsColl(req.store.id).doc(productId).get();
    if (!prodDoc.exists) throw badRequest('INVALID_FIELD', 'Unknown product.');

    const cost = CREDIT_PRICING[type];
    if (!cost) throw badRequest('INVALID_FIELD', 'Unknown job type.');

    // Queued-job quota (anti-abuse): free=2, pro=10, business=50.
    const open = await jobsColl(req.store.id)
      .where('status', 'in', ['queued', 'processing']).limit(100).get();
    const quota = JOB_QUOTA[req.store.plan] ?? JOB_QUOTA.free;
    if (open.size >= quota) {
      throw badRequest('JOB_QUOTA_EXCEEDED', `You already have ${open.size} job(s) in the queue (limit ${quota}).`);
    }

    // Self-healing: first clear any jobs this store left stuck in
    // 'processing' (crashed poller) so their credits come back automatically.
    // Non-fatal — a reap failure must never block creating a new job.
    await reapStaleJobs(req.store.id).catch((e) =>
      console.error('[jobs] stale reap failed (non-fatal):', e && e.message ? e.message : e));

    const jobId = genJobId();

    // Atomic reservation — idempotency keyed by the job id, so a retry of
    // this request can never double-charge.
    const wallet = await reserveCredits({
      storeId: req.store.id,
      amount: cost,
      idemKey: `job:${jobId}`,
      refType: 'JOB',
      note: `${type} · ${productId}`,
    });

    const job = {
      id: jobId,
      storeId: req.store.id,
      type,
      productId,
      photoPath: body.photoPath || null,
      status: 'queued',
      creditsReserved: cost,
      outputPaths: [],
      errorCode: null,
      createdAt: now(),
      updatedAt: now(),
    };
    await jobsColl(req.store.id).doc(jobId).set(job);

    // Trigger the worker so the job actually RUNS (it is never left parked):
    //   1) Cloud Tasks queue configured  → enqueue a task (OIDC).
    //   2) otherwise WORKER_URL set      → direct self-invoke with the shared
    //      worker secret, fire-and-forget (the worker endpoint authenticates
    //      the call; the job runs on another in-flight request and the UI
    //      polls status).
    if (WORKER_URL && TASKS_QUEUE) {
      enqueueTask(job)
        .catch((err) => {
          // Queue hiccup → fall back to a direct self-invoke so the job still
          // runs (the queue's concurrency cap is the funnel when it's up).
          console.error('[jobs] enqueue failed (non-fatal, falling back):', err && err.message ? err.message : err);
          return invokeWorkerDirect(job);
        })
        .catch((err) =>
          console.error('[jobs] worker invoke failed (non-fatal):', err && err.message ? err.message : err));
    } else if (WORKER_URL) {
      invokeWorkerDirect(job).catch((err) =>
        console.error('[jobs] worker invoke failed (non-fatal):', err && err.message ? err.message : err));
    }

    res.status(202).json({ ok: true, data: { job, wallet } });
  } catch (err) { next(err); }
});

// GET /jobs/:jobId — poll status.
jobsRouter.get('/jobs/:jobId', requireOwnStore, async (req, res, next) => {
  try {
    const jobId = cleanId(req.params.jobId);
    const doc = await jobsColl(req.store.id).doc(jobId).get();
    if (!doc.exists) throw notFound('Job not found.');
    res.json({ ok: true, data: { job: snap(doc) } });
  } catch (err) { next(err); }
});

// GET /jobs — own jobs (newest first).
jobsRouter.get('/jobs', requireOwnStore, async (req, res, next) => {
  try {
    const max = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 300);
    const snap2 = await jobsColl(req.store.id).orderBy('createdAt', 'desc').limit(max).get();
    res.json({ ok: true, data: { jobs: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

// GET /ai/status — engine state for the UI (which model will render, and
// whether the proprietary pipeline is online). Auth-gated; no secrets.
jobsRouter.get('/ai/status', requireOwnStore, (_req, res) => {
  const canVertex = vertexConfigured();
  res.json({
    ok: true,
    data: {
      engine: canVertex ? 'vertex' : 'none',
      proprietaryOnline: false,
      fallbackActive: false,
      workerActive: !!WORKER_URL,
      imageModel: canVertex ? VERTEX_AI_MODEL : null,
      textModel: textAiConfigured() ? VERTEX_TEXT_MODEL : null,
      textAiEnabled: textAiConfigured(),
    },
  });
});

/* ── worker stub (Cloud Tasks) — mounted OUTSIDE the auth gate ──────────
   Cloud Tasks sends OIDC tokens, not Firebase ID tokens, so this cannot
   live behind requireAuth. It authenticates via the queue's OIDC token or
   the shared worker secret; anything else gets 403.                    */

export const workerRouter = Router();

// OIDC token verifier for Cloud Tasks calls. The token is Google-signed and
// MUST be verified against Google's certs with the WORKER_URL as audience —
// we never trust a header alone (a spoofed x-cloudtasks-taskname + any token
// was previously accepted; that's an auth bypass).
const oidcClient = new OAuth2Client();
let oidcVerification = null; // memoised per token (tokens are short-lived)
async function verifyOidcToken(token) {
  if (!token) return false;
  // Don't re-verify the same token string in a burst.
  if (oidcVerification && oidcVerification.token === token) return oidcVerification.ok;
  let ok = false;
  // Cloud Tasks sets audience = the exact URL in the task definition.
  const workerUrl = WORKER_URL.endsWith('/api/v1/workers/run-job') ? WORKER_URL : `${WORKER_URL.replace(/\/$/, '')}/api/v1/workers/run-job`;
  try {
    const ticket = await oidcClient.verifyIdToken({
      idToken: token,
      audience: workerUrl,
    });
    ok = !!ticket.getPayload();
  } catch { ok = false; }
  oidcVerification = { token, ok };
  return ok;
}

// POST /run-job — called by Cloud Tasks (verified OIDC token) or the API
// (shared secret). Runs the Vertex AI engine when VERTEX_AI_LOCATION is set;
// otherwise reverts to 'queued' (credits stay reserved, job stays queued).
workerRouter.post('/run-job', async (req, res, next) => {
  try {
    const bearer = req.headers.authorization || '';
    const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';

    // TWO valid paths: a cryptographically verified Cloud Tasks OIDC token
    // (audience = WORKER_URL) OR the shared worker secret. Nothing else.
    const secretOk = WORKER_AUTH_TOKEN && token === WORKER_AUTH_TOKEN;
    if (!secretOk && !(await verifyOidcToken(token))) throw forbidden('Workers only.');

    // Worker-supplied ids build Firestore references — validate them the same
    // way as any other input (a hostile/compromised caller must not be able to
    // inject path separators or oversized ids).
    const jobId = cleanId(req.body?.jobId ?? '', { max: 64, label: 'job id' });
    const storeId = cleanId(req.body?.storeId ?? '', { max: 48, label: 'store id' });

    const jobRef = jobsColl(storeId).doc(jobId);

    // Atomic claim: terminal states are final; anything else transitions to
    // 'processing' exactly once per attempt (a retry sees the terminal state
    // and stops — no re-run, no re-charge). 'processing' itself stays
    // claimable so a crashed attempt can recover on the next retry.
    let job;
    const claim = await db.runTransaction(async (tx) => {
      const doc = await tx.get(jobRef);
      if (!doc.exists) throw notFound('Job not found.');
      const data = doc.data();
      if (data.status === 'done' || data.status === 'failed') return { duplicate: true, job: data };
      // Stale 'processing' job (poller crashed) → fail it; the refund below
      // returns the credits to the store. Newer 'processing' jobs stay
      // claimable so a retry can recover a crashed attempt.
      if (data.status === 'processing' && data.lastAttemptedAt && now() - data.lastAttemptedAt > STALE_JOB_MS) {
        tx.update(jobRef, { status: 'failed', errorCode: 'TIMEOUT', updatedAt: now() });
        return { stale: true, job: data };
      }
      tx.update(jobRef, { status: 'processing', lastAttemptedAt: now(), updatedAt: now() });
      return { duplicate: false, job: data };
    });
    job = claim.job;
    if (claim.duplicate) {
      return res.json({ ok: true, data: { status: job.status, duplicate: true } });
    }
    if (claim.stale) {
      await refundCredits({
        storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`,
        note: `Job ${jobId}: stale (no worker progress)`, actor: 'system',
      });
      return res.json({ ok: true, data: { status: 'failed', errorCode: 'TIMEOUT' } });
    }

    // ── Engine: Vertex AI (Nano Banana 2 Lite) ────────────────────────
    const canVertex = vertexConfigured();
    if (!canVertex) {
      await jobRef.update({ status: 'queued', updatedAt: now() });
      return res.json({ ok: true, data: { status: 'queued', note: 'Vertex AI not configured yet' } });
    }

    const productDoc = await productsColl(storeId).doc(job.productId).get();
    if (!productDoc.exists) {
      await jobRef.update({ status: 'failed', errorCode: 'PRODUCT_MISSING', updatedAt: now() });
      await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: product missing` });
      return res.json({ ok: true, data: { status: 'failed', errorCode: 'PRODUCT_MISSING' } });
    }

    let product = productDoc.data();
    let submitted = null;

    // ── Pass 1: listing text (Gemini, best-effort) — the SEO copy the
    //    seller sees (title, description, sizes, colours, material, price
    //    suggestion). Improves the image prompt too (the generated title
    //    replaces the placeholder). NEVER fails the job: images can still
    //    render even if the text pass breaks.
    if (textAiConfigured()) {
      try {
        const listing = await generateListingText(product);
        if (listing) {
          const patch = { aiSpecs: listing.aiSpecs, updatedAt: now() };
          const titleIsPlaceholder = !product.title
            || product.title === 'Product photo'
            || /^untitled/i.test(product.title);
          if (listing.title && titleIsPlaceholder) patch.title = listing.title;
          await productsColl(storeId).doc(job.productId).update(patch);
          product = { ...product, ...patch };
        }
      } catch (err) {
        console.error('[jobs] text pass failed (non-fatal):', err.code || err.message);
      }
    }

    try {
      submitted = await generateWithVertexAi({ job, product });
    } catch (err) {
      // Managed API failed → definitive: fail the job and REFUND (idempotent
      // key, safe — a retry can never double-refund).
      await jobRef.update({ status: 'failed', errorCode: err.code || 'VERTEX_FAILED', updatedAt: now() });
      await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: ${err.message || 'Vertex AI failure'}` });
      return res.json({ ok: true, data: { status: 'failed', errorCode: err.code || 'VERTEX_FAILED' } });
    }

    // Success — persist the output gallery onto the product FIRST, then mark
    // the job done (so a crash between the two can't lose the gallery: a retry
    // would re-claim and the gallery dedupe keeps it idempotent).
    const outputPaths = submitted.poses.map((p) => p.objectPath);
    const productData = productDoc.data();
    const existing = Array.isArray(productData.gallery) ? productData.gallery : [];
    const known = new Set(existing.map((g) => g.path));
    const gallery = [
      ...existing,
      ...outputPaths
        .filter((p) => !known.has(p))
        .map((p, i) => ({ path: p, contentType: 'image/png', size: 0, pose: POSE_LIST[i]?.id || 'pose', ts: now() })),
    ];
    await productsColl(storeId).doc(job.productId).update({ gallery, updatedAt: now() });
    await jobRef.update({ status: 'done', outputPaths, updatedAt: now() });

    res.json({ ok: true, data: { status: 'done', outputPaths } });
  } catch (err) { next(err); }
});

/* ── Direct self-invoke helper (no Cloud Tasks queue needed) ───────────
   POSTs the job to our own worker endpoint with the shared secret. Called
   fire-and-forget from POST /jobs; the worker endpoint runs the real
   pipeline on a separate in-flight request (Cloud Run keeps the instance
   alive for it) and the UI polls GET /jobs/{id} for progress.          */

async function invokeWorkerDirect(job) {
  if (!WORKER_AUTH_TOKEN) {
    console.warn('[jobs] WORKER_URL set but WORKER_AUTH_TOKEN missing — job left queued.');
    return;
  }
  const workerUrl = WORKER_URL.endsWith('/api/v1') ? `${WORKER_URL}/workers/run-job` : `${WORKER_URL}/api/v1/workers/run-job`;
  const res = await fetch(workerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WORKER_AUTH_TOKEN}`,
    },
    body: JSON.stringify({ jobId: job.id, storeId: job.storeId }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[jobs] worker self-invoke failed:', res.status, text.slice(0, 200));
  }
}

/* ── Cloud Tasks helper ───────────────────────────────────────────────── */

async function enqueueTask(job) {
  const { CloudTasksClient } = await import('@google-cloud/tasks');
  const client = new CloudTasksClient();
  const parent = client.queuePath(
    TASKS_QUEUE.split('/')[1],        // project
    TASKS_QUEUE.split('/')[3],        // location
    TASKS_QUEUE.split('/')[5],        // queue
  );    const workerUrl = WORKER_URL.endsWith('/api/v1/workers/run-job') ? WORKER_URL : `${WORKER_URL.replace(/\/$/, '')}/api/v1/workers/run-job`;
    const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: workerUrl,
      oidcToken: { serviceAccountEmail: process.env.RUNTIME_SA_EMAIL || '' },
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ jobId: job.id, storeId: job.storeId })).toString('base64'),
    },
  };
  await client.createTask({ parent, task });
}
