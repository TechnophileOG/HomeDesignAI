/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — landing-page leads (the REAL contact form backend)
   ────────────────────────────────────────────────────────────────────────
   The website contact form used to fake success client-side. Now it POSTs
   here and the lead lands in Firestore `leads` for the team.

   This route is PUBLIC (pre-signup visitors), so its defenses are:
     • per-IP rate limit — 5 submissions/hour (the global limiter also applies)
     • honeypot fields — bots that fill hidden fields get fake success, data dropped
     • hard sanitization of every field (validate.lead)
     • no PII echoed back in the response (just { received: true })
     • the IP is stored MASKED (last octet removed) for fraud review
   Admins list/resolve leads through /admin/leads (requireAdmin).
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, now, snap } from '../db.js';
import { lead as sanitizeLead, id as cleanId, email as cleanEmail } from '../validate.js';
import { tooMany, notFound } from '../errors.js';
import { requireAdmin } from '../auth.js';
import { auditWrite } from '../audit.js';
import { FIREBASE_WEB_API_KEY, RESET_CONTINUE_URL } from '../config.js';
import { sendPasswordResetBranded } from '../email.js';

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    const msg = tooMany('Too many submissions. Try again later.');
    res.status(429).set('Content-Type', 'application/json')
      .json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});

/** Mask an email for audit storage: keep the first character + domain.
    e.g. m***@gmail.com — enough for fraud review, not full PII. */
const maskEmail = (email) => {
  const v = String(email || '').trim().toLowerCase();
  const at = v.indexOf('@');
  if (at <= 0) return '***';
  return `${v.slice(0, 1)}***${v.slice(at)}`;
};

/** Mask an IP for storage: IPv4 keeps its first 3 octets, IPv6 keeps its
    first 4 hextets — enough for fraud review, not enough to track a host. */
const maskIp = (ip) => {
  const v = String(ip || '').trim();
  if (!v) return '';
  if (v.startsWith('::ffff:')) return v.slice(7).replace(/\.[0-9]+$/, '.0'); // v4-mapped v6
  if (v.includes(':')) return `${v.split(':').filter(Boolean).slice(0, 4).join(':')}::`; // v6
  return v.replace(/\.[0-9]+$/, '.0'); // v4
};

export const publicRouter = Router();

/* ── password reset email (public, heavily rate-limited) ──────────────────
   Sending the reset email is routed through HERE (not the Firebase SDK on
   the client) so it is: rate-limited per IP AND per email, audit-logged,
   and replies identically whether or not the account exists (no email
   enumeration). Without this, a spammed "forgot password" button could
   drop a dozen reset emails — exactly what happened in production.      */
const resetIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,                       // 3 reset requests per IP per hour
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    const msg = tooMany('Too many reset requests. Try again later.');
    res.status(429).set('Content-Type', 'application/json')
      .json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});
const resetEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 2,                       // 2 per email per hour
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String((req.body && req.body.email) || '').toLowerCase().trim(),
  handler: (req, res) => {
    const msg = tooMany('Too many reset requests. Try again later.');
    res.status(429).set('Content-Type', 'application/json')
      .json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});

publicRouter.post('/auth/reset-email', resetIpLimiter, resetEmailLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const targetEmail = cleanEmail(body.email);

    if (!FIREBASE_WEB_API_KEY) {
      auditWrite({ kind: 'auth_reset_misconfig', method: 'POST', path: '/api/v1/public/auth/reset-email', status: 501, uid: '', ip: maskIp(req.ip) });
      return res.status(501).json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Password reset is temporarily unavailable.' } });
    }

    // 1) Preferred: our branded email (Resend). 2) Fallback: Firebase's own
    // email service (Identity Toolkit). Always reply success generically —
    // the caller must never learn whether the address has an account.
    const branded = await sendPasswordResetBranded(targetEmail);
    if (!branded) {
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestType: 'PASSWORD_RESET',
              email: targetEmail,
              ...(RESET_CONTINUE_URL ? { continueUrl: RESET_CONTINUE_URL } : {}),
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!resp.ok) {
          // Log the real cause server-side, but reply generically either way.
          const text = await resp.text().catch(() => '');
          console.error(`[reset-email] identitytoolkit ${resp.status}:`, text.slice(0, 300));
        }
      } catch (err) {
        console.error('[reset-email] upstream error:', err && err.message ? err.message : err);
      }
    }

    auditWrite({
      kind: 'auth_reset_request', method: 'POST', path: '/api/v1/public/auth/reset-email',
      status: 200, uid: '', ip: maskIp(req.ip), email: maskEmail(targetEmail),
    });
    res.json({ ok: true, data: { sent: true } });
  } catch (err) { next(err); }
});

publicRouter.post('/leads', leadLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};

    // Honeypot: these fields are invisible to humans; bots autofill them.
    if (body.website || body.company || body.url) {
      // Fake success to the bot — payload dropped, nothing stored.
      return res.status(201).json({ ok: true, data: { received: true } });
    }

    const clean = sanitizeLead(body);
    const ref = db.collection('leads').doc();
    const lead = {
      id: ref.id,
      ...clean,
      source: 'website',
      status: 'new',
      ts: now(),
      ip: maskIp(req.ip),
    };
    await ref.set(lead);
    auditWrite({ kind: 'lead', method: 'POST', path: '/api/v1/public/leads', status: 201, uid: '', ip: maskIp(req.ip) });
    res.status(201).json({ ok: true, data: { received: true } });
  } catch (err) { next(err); }
});

/* ── admin (mounted inside the auth gate; requireAdmin per route) ──────── */

export const adminLeadsRouter = Router();

adminLeadsRouter.get('/admin/leads', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 300);
    const snap2 = await db.collection('leads').orderBy('ts', 'desc').limit(limit).get();
    res.json({ ok: true, data: { leads: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

adminLeadsRouter.post('/admin/leads/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    const id = cleanId(req.params.id, { max: 64, label: 'lead id' });
    const ref = db.collection('leads').doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw notFound('Lead not found.');
    await ref.update({ status: 'contacted', resolvedAt: now(), resolvedBy: req.user.email });
    res.json({ ok: true, data: { lead: snap(await ref.get()) } });
  } catch (err) { next(err); }
});
