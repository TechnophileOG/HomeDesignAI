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
