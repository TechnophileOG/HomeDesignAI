/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — rate limiting
   ────────────────────────────────────────────────────────────────────────
   • globalLimiter — every /api call, per-IP (Cloud Run is set with
     `trust proxy`, so X-Forwarded-For from Cloud Run's LB is used).
   • userLimiter({...}) — tighter per-USER limits on expensive/sensitive
     routes (job creation, credit orders, webhooks). Must be mounted AFTER
     requireAuth so req.user exists.
   Limits are in-memory per instance; with max-instances capped low this is
   a strong anti-abuse layer on top of Cloud Run's own concurrency cap.
   ════════════════════════════════════════════════════════════════════════ */

import rateLimit from 'express-rate-limit';
import { tooMany } from './errors.js';

const sendBlocked = (req, res) => {
  const msg = tooMany();
  res.status(429).set('Content-Type', 'application/json')
    .set('Retry-After', String(Math.ceil(res.getHeaders()['retry-after'] || 60)))
    .json({ ok: false, error: { code: msg.code, message: msg.message } });
};

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,                       // generous per-IP baseline
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Multi-device bulk capture: every phone on a store's WiFi shares ONE
  // public IP. The live-session public routes (join/photo/confirm) are
  // already bounded by their own limiters — per-DEVICE token for photos
  // (60/min) and per-IP for join (300/hr) — so the global per-IP budget
  // must NOT cap a big store's shoot (8+ phones × 60 photos would blow
  // 600/15min). Everything else keeps the per-IP budget.
  skip: (req) => /^\/api\/v1\/public\/sessions\//.test(String(req.path || '')),
  handler: sendBlocked,
});

/** Per-user limiter factory for sensitive routes. */
export const userLimiter = ({ windowMs, limit, message = 'Too many requests. Try again later.' }) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (req) => req.user?.uid || req.ip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => !req.user,       // unauthenticated requests die in requireAuth anyway
    handler: (req, res) => {
      const msg = tooMany(message);
      res.status(429).set('Content-Type', 'application/json')
        .json({ ok: false, error: { code: msg.code, message: msg.message } });
    },
  });
