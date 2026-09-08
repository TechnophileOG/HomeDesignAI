/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — account routes (auth-gated)
   ────────────────────────────────────────────────────────────────────────
   POST /me/send-verification — re-send the email-verification mail.

   The client's OLD path (Firebase SDK sendEmailVerification) had no rate
   limit of its own. Here it is: per-USER limited (3/hr), audit-logged, and
   delivered as a branded Katalogit email when Resend is configured — with a
   graceful fallback to Firebase's own email service, so the flow never
   breaks during the email-provider setup.
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { db, now } from '../db.js';
import { userLimiter } from '../rate-limit.js';
import { auditWrite } from '../audit.js';
import { badRequest } from '../errors.js';
import { sendVerificationBranded, safeContinueUrl } from '../email.js';
import { FIREBASE_WEB_API_KEY } from '../config.js';

const meRouter = Router();

const verifyLimiter = userLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: 'Too many verification emails. Try again in an hour.',
});

/** The raw ID token requireAuth just verified — needed to mint a fresh
    one-time VERIFY_EMAIL code against the Identity Toolkit. */
const idTokenFrom = (req) => {
  const h = String(req.headers.authorization || '');
  const [scheme, token] = h.split(' ');
  return scheme === 'Bearer' && token ? token.slice(0, 2048) : '';
};

meRouter.post('/me/send-verification', verifyLimiter, async (req, res, next) => {
  try {
    const idToken = idTokenFrom(req);
    if (!idToken) throw badRequest('INVALID_TOKEN', 'Missing authentication token.');
    const email = String(req.user?.email || '').toLowerCase();
    // Client may pass its own origin so the verify link returns to the exact
    // app instance — validated against APP_URL/CORS origins, never attacker-set.
    const continueUrl = safeContinueUrl((req.body || {}).continueUrl);

    // Preferred: branded email via our provider. Fallback: Firebase's own
    // verification email (Identity Toolkit with the user's ID token).
    const branded = await sendVerificationBranded(email, idToken, continueUrl);
    if (!branded && FIREBASE_WEB_API_KEY) {
      try {
        const resp = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken, ...(continueUrl ? { continueUrl } : {}) }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          console.error(`[verify-email] identitytoolkit ${resp.status}:`, text.slice(0, 300));
        }
      } catch (err) {
        console.error('[verify-email] upstream error:', err && err.message ? err.message : err);
      }
    }

    // Store a durable record of who asked, when (abuse review).
    await db.collection('verification_requests').add({
      uid: req.user.uid,
      email: email.slice(0, 1) + '***' + email.slice(email.indexOf('@')), // masked
      ip: String(req.ip || '').replace(/\.[0-9]+$/, '.0'),
      ts: now(),
    }).catch(() => {});

    auditWrite({
      kind: 'auth_verify_request', method: 'POST', path: '/api/v1/me/send-verification',
      status: 200, uid: req.user.uid || '', ip: String(req.ip || ''),
    });
    res.json({ ok: true, data: { sent: true } });
  } catch (err) { next(err); }
});

export { meRouter };
