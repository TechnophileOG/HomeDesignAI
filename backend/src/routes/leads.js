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
import { lead as sanitizeLead, id as cleanId } from '../validate.js';
import { tooMany, notFound } from '../errors.js';
import { requireAdmin } from '../auth.js';
import { auditWrite } from '../audit.js';

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
