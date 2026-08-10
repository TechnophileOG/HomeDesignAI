/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — async AI jobs
   ────────────────────────────────────────────────────────────────────────
   POST /jobs  → quota check → ATOMIC credit reservation (idempotent by job
                 id) → Firestore job record → Cloud Tasks enqueue (optional)
   GET  /jobs/{id} → poll status
   POST /workers/run-job → the queue worker. Today it is an honest stub —
     the AI pipeline (AI_PIPELINE_PLAN.md) plugs in here later. The endpoint
     only accepts requests carrying a Cloud Tasks OIDC token or the shared
     worker secret — nobody else can drive it.
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { db, jobsColl, productsColl, storeRef, now, snap } from '../db.js';
import { jobCreate, id as cleanId } from '../validate.js';
import { reserveCredits, refundCredits } from '../ledger.js';
import { CREDIT_PRICING, JOB_QUOTA, WORKER_URL, WORKER_AUTH_TOKEN, TASKS_QUEUE,
         GPU_HOST_URL, GPU_AUTH_TOKEN, vertexConfigured, AI_ENGINE } from '../config.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { userLimiter } from '../rate-limit.js';
import { requireStoreOwner } from './owners.js';
import { submitGpuJob, pollGpuJob, POSE_LIST } from '../ai-client.js';
import { generateWithVertexAi } from '../ai-fallback.js';

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
jobsRouter.post('/jobs', createJobLimiter, requireStoreOwner, async (req, res, next) => {
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

    // Enqueue to Cloud Tasks if configured (tolerant — worker ships later).
    if (WORKER_URL && TASKS_QUEUE) {
      enqueueTask(job).catch((err) =>
        console.error('[jobs] enqueue failed (non-fatal):', err && err.message ? err.message : err));
    }

    res.status(202).json({ ok: true, data: { job, wallet } });
  } catch (err) { next(err); }
});

// GET /jobs/:jobId — poll status.
jobsRouter.get('/jobs/:jobId', requireStoreOwner, async (req, res, next) => {
  try {
    const jobId = cleanId(req.params.jobId);
    const doc = await jobsColl(req.store.id).doc(jobId).get();
    if (!doc.exists) throw notFound('Job not found.');
    res.json({ ok: true, data: { job: snap(doc) } });
  } catch (err) { next(err); }
});

// GET /jobs — own jobs (newest first).
jobsRouter.get('/jobs', requireStoreOwner, async (req, res, next) => {
  try {
    const max = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 300);
    const snap2 = await jobsColl(req.store.id).orderBy('createdAt', 'desc').limit(max).get();
    res.json({ ok: true, data: { jobs: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

/* ── worker stub (Cloud Tasks) — mounted OUTSIDE the auth gate ──────────
   Cloud Tasks sends OIDC tokens, not Firebase ID tokens, so this cannot
   live behind requireAuth. It authenticates via the queue's OIDC token or
   the shared worker secret; anything else gets 403.                    */

export const workerRouter = Router();

// POST /run-job — called by Cloud Tasks (OIDC token) or the API (shared
// secret). Runs the REAL AI pipeline when a GPU box is configured; otherwise
// behaves as a stub (credits stay reserved, job stays queued).
workerRouter.post('/run-job', async (req, res, next) => {
  try {
    const isTask = !!req.headers['x-cloudtasks-taskname'];
    const bearer = req.headers.authorization || '';
    const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';

    const oidcOk = isTask && token.length > 0; // Cloud Tasks OIDC token (audience = WORKER_URL)
    const secretOk = WORKER_AUTH_TOKEN && token === WORKER_AUTH_TOKEN;
    if (!oidcOk && !secretOk) throw forbidden('Workers only.');

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

    // ── Engine selection ───────────────────────────────────────────────
    //    AI_ENGINE: 'auto' (GPU first → Vertex fallback) | 'gpu' | 'vertex'.
    //    With NO engine configured the worker stays an honest stub (credits
    //    stay reserved, job stays queued).
    const canGpu = !!(GPU_HOST_URL && GPU_AUTH_TOKEN);
    const canVertex = vertexConfigured();
    const enginePref = AI_ENGINE || 'auto';
    if (!canGpu && !canVertex) {
      await jobRef.update({ status: 'queued', updatedAt: now() });
      return res.json({ ok: true, data: { status: 'queued', note: 'worker stub — no AI engine configured yet' } });
    }

    const productDoc = await productsColl(storeId).doc(job.productId).get();
    if (!productDoc.exists) {
      await jobRef.update({ status: 'failed', errorCode: 'PRODUCT_MISSING', updatedAt: now() });
      await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: product missing` });
      return res.json({ ok: true, data: { status: 'failed', errorCode: 'PRODUCT_MISSING' } });
    }

    const product = productDoc.data();
    let engine = null;
    let submitted = null;

    if (enginePref === 'vertex' && canVertex) {
      engine = 'vertex';
    } else if (canGpu) {
      try {
        submitted = await submitGpuJob({ job, product });
        engine = 'gpu';
      } catch (err) {
        if (canVertex && enginePref !== 'gpu') {
          // Box unreachable/rejected → try the managed fallback before giving up.
          console.error('[jobs] GPU submit failed, falling back to Vertex AI:', err.code || err.message);
          engine = 'vertex';
        } else {
          // Release the claim so Cloud Tasks can retry (backoff). Do NOT
          // refund yet — the job may still succeed on retry.
          await jobRef.update({ status: 'queued', errorCode: err.code || 'GPU_SUBMIT_FAILED', updatedAt: now() });
          throw err;
        }
      }
    } else if (canVertex) {
      engine = 'vertex';
    }

    if (engine === 'vertex') {
      try {
        submitted = await generateWithVertexAi({ job, product });
      } catch (err) {
        // Managed API failed → definitive: fail the job and REFUND (idempotent
        // key, safe — a retry can never double-refund).
        await jobRef.update({ status: 'failed', errorCode: err.code || 'VERTEX_FAILED', updatedAt: now() });
        await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: ${err.message || 'Vertex AI failure'}` });
        return res.json({ ok: true, data: { status: 'failed', errorCode: err.code || 'VERTEX_FAILED' } });
      }
    }

    if (engine === 'gpu') {
      let result;
      try {
        result = await pollGpuJob(submitted.jobId);
      } catch (err) {
        // Definitive timeout → fail the job and REFUND (idempotent key, safe).
        await jobRef.update({ status: 'failed', errorCode: 'GPU_TIMEOUT', updatedAt: now() });
        await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: GPU timeout` });
        return res.json({ ok: true, data: { status: 'failed', errorCode: 'GPU_TIMEOUT' } });
      }
      if (result.status === 'failed') {
        await jobRef.update({ status: 'failed', errorCode: result.error || 'GPU_JOB_FAILED', updatedAt: now() });
        await refundCredits({ storeId, amount: job.creditsReserved, idemKey: `refund:${jobId}`, note: `Job ${jobId}: ${result.error || 'worker failure'}` });
        return res.json({ ok: true, data: { status: 'failed' } });
      }
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

/* ── Cloud Tasks helper ───────────────────────────────────────────────── */

async function enqueueTask(job) {
  const { CloudTasksClient } = await import('@google-cloud/tasks');
  const client = new CloudTasksClient();
  const parent = client.queuePath(
    TASKS_QUEUE.split('/')[1],        // project
    TASKS_QUEUE.split('/')[3],        // location
    TASKS_QUEUE.split('/')[5],        // queue
  );
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: WORKER_URL,
      oidcToken: { serviceAccountEmail: process.env.RUNTIME_SA_EMAIL || '' },
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ jobId: job.id, storeId: job.storeId })).toString('base64'),
    },
  };
  await client.createTask({ parent, task });
}
