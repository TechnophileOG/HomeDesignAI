/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — API entrypoint (Cloud Run)
   ────────────────────────────────────────────────────────────────────────
   Security posture (the "black box"):
     • helmet() default headers; X-Powered-By suppressed
     • CORS allowlist from env — no ACAO headers for unknown origins
     • global per-IP rate limit on every /api call
     • every /api/v1 route requires a Firebase ID token (except webhook +
       healthz). Deployed with `--no-allow-unauthenticated`, so Cloud Run
       rejects unknown callers before the app is even reached.
     • 256 KB JSON body cap; malformed/oversized bodies get clean 400/413
     • webhook reads the RAW body for signature verification (never parsed
       first — HMAC must cover the exact bytes)
     • uniform `{ok, data|error}` JSON; internals never leak
   ════════════════════════════════════════════════════════════════════════ */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { assertConfig, CORS_ORIGIN, PROJECT_ID } from './config.js';
import { globalLimiter } from './rate-limit.js';
import { requireAuth } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { logRequest } from './audit.js';
import { coreRouter } from './routes/core.js';
import { creditsRouter, webhookRouter } from './routes/credits.js';
import { jobsRouter, workerRouter } from './routes/jobs.js';
import { publicRouter, adminLeadsRouter } from './routes/leads.js';
import { geocodeRouter } from './routes/geocode.js';
import { meRouter } from './routes/me.js';
import { contentRouter, adminContentRouter } from './routes/content.js';
import { sessionsRouter, sessionsPublicRouter } from './routes/sessions.js';
import { adminRouter } from './routes/admin.js';

assertConfig();

const app = express();
app.disable('x-powered-by');
// Trust exactly ONE proxy hop (Cloud Run's LB). `true` would let anyone spoof
// X-Forwarded-For and is rejected by express-rate-limit v7 (ERR_ERL_PERMISSIVE_TRUST_PROXY).
app.set('trust proxy', 1);

// Hardened headers. This API only serves JSON, so a strict CSP is safe and
// locks the surface down even if a future endpoint ever returns HTML.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://storage.googleapis.com'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"], // clickjacking
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'no-referrer' },
}));

// Strict CORS: only allowlisted origins get ACAO headers.
const originList = CORS_ORIGIN.length ? CORS_ORIGIN : [];
app.use(cors({
  origin(origin, cb) {
    if (!origin || originList.length === 0) return cb(null, originList.length === 0 ? false : true);
    if (originList.includes(origin.toLowerCase())) return cb(null, true);
    return cb(null, false); // no ACAO header → browser blocks the response
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  // x-admin-session = the short-lived owner-console unlock token. Without it
  // in the preflight allowlist, browsers BLOCK every admin call cross-origin.
  allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-session'],
  maxAge: 86400,
  credentials: false,
}));

// Capture the raw body for webhook signature verification.
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

app.use(globalLimiter);

// ── Audit: every request is registered (Cloud Logging) and anomalies /
//    sensitive paths are written to the durable audit trail. Runs after the
//    rate limiter (so blocked callers are logged too) and before routes. ──
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    logRequest({ req, status: res.statusCode, ms: Date.now() - started, uid: req.user?.uid || '' });
  });
  next();
});

/* ── public surface (minimal, no secrets) ─────────────────────────────── */
// NOTE: the run.app front gate reserves the `/healthz` path, so external
// monitoring uses `/ping`. Both are registered (harmless).
const health = (_req, res) => res.json({ ok: true, service: 'katalogit-api', project: PROJECT_ID, ts: Date.now() });
app.get('/ping', health);
app.get('/healthz', health);

// These mount BEFORE the auth gate — they authenticate by their own means:
//   webhooks → Razorpay HMAC signature;  workers → Cloud Tasks OIDC/shared secret.
//   public   → the landing-page lead form (rate-limited per IP + honeypot).
app.use('/api/v1/webhooks', webhookRouter);
app.use('/api/v1/workers', workerRouter);
app.use('/api/v1/public', publicRouter);
// Live session JOIN + photo uploads — the scanning phone has no account,
// so these authenticate via single-use join token / per-device token.
app.use('/api/v1/public', sessionsPublicRouter);

/* ── v1 — everything else requires a valid Firebase ID token ──────────── */
const v1 = express.Router();
v1.use(requireAuth);

v1.use('/', coreRouter);
v1.use('/', creditsRouter);
v1.use('/', jobsRouter);
v1.use('/', geocodeRouter);
v1.use('/', meRouter);
v1.use('/', contentRouter);
v1.use('/', sessionsRouter);
// Owner-console unlock (auth-gated; issues the short-lived admin session)
// + all admin-only routes (requireAdmin, inside the auth gate).
v1.use('/', adminRouter);
v1.use('/', adminLeadsRouter);
v1.use('/', adminContentRouter);

app.use('/api/v1', v1);

app.use((_req, _res, next) => next(notFound()));
app.use(errorHandler);

const PORT = parseInt(process.env.PORT || '8080', 10);
const server = app.listen(PORT, () => {
  console.log(`[server] katalogit-api listening on :${PORT} (project ${PROJECT_ID})`);
});

/* ── graceful shutdown ────────────────────────────────────────────────── */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[server] ${sig} received, closing…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
