/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — owner console unlock
   ────────────────────────────────────────────────────────────────────────
   The owner console (all /admin/* routes) is gated by requireAdmin, which
   needs BOTH:
     • a Firebase login whose email is exactly OWNER_EMAIL, and
     • a short-lived session token issued HERE, after the owner proves they
       know the ADMIN_PASSCODE.

   This endpoint is the ONLY way to get that token. Defenses:
     • requires an authenticated Firebase session (mounted inside the v1 gate)
     • only the OWNER_EMAIL account may call it (strangers get 403 before
       the passcode is even touched)
     • passcode compared timing-safe (no timing oracle)
     • per-user rate limit — 5 attempts / 15 min, then locked out briefly
     • every attempt (success AND failure) is written to the audit trail
     • the returned token is HMAC-signed, uid+email-bound, expires in 15 min
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { OWNER_EMAIL, ADMIN_PASSCODE } from '../config.js';
import { verifyAdminPasscode, issueAdminSession } from '../auth.js';
import { userLimiter } from '../rate-limit.js';
import { badRequest, forbidden, notConfigured } from '../errors.js';
import { auditWrite } from '../audit.js';

export const adminRouter = Router();

const unlockLimiter = userLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many unlock attempts. Try again in a few minutes.',
});

const maskIp = (ip) => {
  const v = String(ip || '').trim();
  if (!v) return '';
  if (v.includes(':')) return `${v.split(':').filter(Boolean).slice(0, 4).join(':')}::`;
  return v.replace(/\.[0-9]+$/, '.0');
};

// POST /admin/unlock  { passcode } → { token, expiresIn }
adminRouter.post('/admin/unlock', unlockLimiter, (req, res, next) => {
  try {
    // 1) Only the owner may even attempt this.
    if (!OWNER_EMAIL) throw notConfigured('ADMIN_NOT_CONFIGURED', 'Owner console is not configured.');
    if (String(req.user?.email || '').toLowerCase() !== OWNER_EMAIL) {
      auditWrite({ kind: 'admin_unlock_denied', method: 'POST', path: '/api/v1/admin/unlock', status: 403, uid: req.user?.uid || '', ip: maskIp(req.ip), email: String(req.user?.email || '').slice(0, 1) + '***' });
      throw forbidden('Owner only.');
    }

    // 2) Verify the passcode (timing-safe). No passcode configured → locked.
    if (!ADMIN_PASSCODE) throw notConfigured('ADMIN_NOT_CONFIGURED', 'Owner console is not configured.');
    const passcode = String((req.body && req.body.passcode) || '').slice(0, 256);
    if (!passcode || !verifyAdminPasscode(passcode)) {
      auditWrite({ kind: 'admin_unlock_failed', method: 'POST', path: '/api/v1/admin/unlock', status: 403, uid: req.user.uid, ip: maskIp(req.ip) });
      throw forbidden('Incorrect passcode.');
    }

    // 3) Success — issue the short-lived signed session and audit it.
    const token = issueAdminSession(req.user.uid, req.user.email);
    auditWrite({ kind: 'admin_unlock_ok', method: 'POST', path: '/api/v1/admin/unlock', status: 200, uid: req.user.uid, ip: maskIp(req.ip) });
    res.json({ ok: true, data: { token } });
  } catch (err) { next(err); }
});
