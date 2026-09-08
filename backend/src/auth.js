/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — authentication
   ────────────────────────────────────────────────────────────────────────
   All /api/v1 routes require a Firebase ID token (Bearer header). Tokens are
   verified against Firebase's securetoken signing keys (fetched from
   Google's x509 endpoint, cached) with the project id as audience and
   `https://securetoken.google.com/<projectId>` as issuer.

   NOTE: google-auth-library's `verifyIdToken` only knows Google's OAuth2
   certs — it CANNOT verify Firebase `securetoken` keys ("No pem found").
   That's why we fetch the securetoken certs ourselves and call
   `verifySignedJwtWithCertsAsync` against them.

   The app NEVER sees a user's password — sign-in happens entirely in the
   client SDK against Firebase Auth. The Owner Console is gated by
   OWNER_EMAIL (single owner account) PLUS a passcode-issued short-lived
   session token (see requireAdmin below) — no custom claims are trusted.
   ════════════════════════════════════════════════════════════════════════ */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { FIREBASE_AUDIENCE, FIREBASE_ISSUER, OWNER_EMAIL, ADMIN_PASSCODE, ADMIN_SESSION_TTL_SECONDS, PROJECT_ID } from './config.js';
import { unauthorized, forbidden } from './errors.js';

const client = new OAuth2Client();

/** Firebase publishes project-scoped signing keys here (kid → PEM). */
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CERTS_TTL_MS = 5 * 60 * 1000; // refresh certs at most every 5 min

let certsCache = { certs: null, fetchedAt: 0 };
let certsFetching = null;

async function fetchCerts() {
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`securetoken certs fetch failed: ${res.status}`);
  return res.json();
}

/** Cached certs — single in-flight fetch, TTL, and rotation refetch support. */
async function getCerts(force = false) {
  if (!force && certsCache.certs && Date.now() - certsCache.fetchedAt < CERTS_TTL_MS) {
    return certsCache.certs;
  }
  if (certsFetching) return certsFetching;
  certsFetching = (async () => {
    try {
      const certs = await fetchCerts();
      certsCache = { certs, fetchedAt: Date.now() };
      return certs;
    } finally {
      certsFetching = null;
    }
  })();
  return certsFetching;
}

async function verifyWithCerts(token, certs) {
  const ticket = await client.verifySignedJwtWithCertsAsync(
    token, certs, FIREBASE_AUDIENCE, [FIREBASE_ISSUER],
  );
  const p = ticket.getPayload();
  return {
    uid: p.sub,
    email: (p.email || '').toLowerCase(),
    name: p.name || '',
    emailVerified: !!p.email_verified,
    phone: p.phone_number || '',
    // Admin = the ONE owner account. No custom claims are trusted — an
    // account is admin only if its email exactly matches OWNER_EMAIL.
    isAdmin: (p.email || '').toLowerCase() === OWNER_EMAIL,
  };
}

let warnedAudience = false;

function ensureAudience() {
  if (!FIREBASE_AUDIENCE) {
    // Only possible if neither env var is set — the smoke test sets them.
    if (!warnedAudience) { console.error('[auth] no FIREBASE_PROJECT_ID configured'); warnedAudience = true; }
    throw unauthorized();
  }
}

/** Verify a Bearer token → { uid, email, name, emailVerified, phone, isAdmin } */
export async function verifyIdToken(token) {
  ensureAudience();
  try {
    const certs = await getCerts();
    try {
      return await verifyWithCerts(token, certs);
    } catch (err) {
      // Key rotation: the token was signed with a key published after our
      // cache — refetch once and retry before giving up.
      if (err instanceof Error && /No pem found/i.test(err.message)) {
        const fresh = await getCerts(true);
        return await verifyWithCerts(token, fresh);
      }
      throw err;
    }
  } catch {
    throw unauthorized();
  }
}

/** Express middleware — 401 unless a valid Firebase ID token is present. */
export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, rawToken] = header.split(' ');
    // Firebase ID tokens are ~1 KB; 2048 caps the memory/CPU a hostile header
    // can force us to spend (DoS hardening). Node already caps raw header size.
    if (scheme !== 'Bearer' || !rawToken) throw unauthorized();
    req.user = await verifyIdToken(rawToken.slice(0, 2048));
    next();
  } catch (err) {
    next(err);
  }
}

/* ── Owner console: passcode + short-lived signed sessions ───────────────
   The owner console needs TWO things, both verified server-side:
     1. a Firebase login whose email is exactly OWNER_EMAIL (above), and
     2. a short-lived session token issued by POST /admin/unlock after the
        owner proves they know ADMIN_PASSCODE (timing-safe, rate-limited).
   The session is an HMAC-SHA256-signed payload { uid, email, exp } — no
   server-side state to leak or rotate, but it expires on its own and is
   bound to the exact uid+email that unlocked. Without a valid, unexpired
   token in the x-admin-session header, every /admin/* call is forbidden. */

/** Timing-safe passcode check (constant-time, no early exit). */
export function verifyAdminPasscode(passcode) {
  if (!ADMIN_PASSCODE || !passcode) return false;
  const a = createHash('sha256').update(String(passcode)).digest();
  const b = createHash('sha256').update(ADMIN_PASSCODE).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Signing key derived from the passcode + project — rotating either
    invalidates every outstanding session immediately. */
function adminSessionKey() {
  return createHash('sha256')
    .update(`katalogit:admin:${ADMIN_PASSCODE}:${PROJECT_ID}`)
    .digest('hex');
}

/** Issue a short-lived signed owner session for this uid+email. */
export function issueAdminSession(uid, email) {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ uid, email, exp })).toString('base64url');
  const sig = createHmac('sha256', adminSessionKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify an owner session token: signature, expiry, uid+email binding. */
export function verifyAdminSession(token, uid, email) {
  try {
    if (!token) return false;
    const parts = String(token).split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const expect = createHmac('sha256', adminSessionKey()).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp < Math.floor(Date.now() / 1000)) return false;
    if (data.uid !== uid) return false;
    if (String(data.email || '').toLowerCase() !== String(email || '').toLowerCase()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Express middleware — must come after requireAuth. The owner must be
    signed in as OWNER_EMAIL AND hold a valid, unexpired unlock session. */
export function requireAdmin(req, _res, next) {
  try {
    if (!req.user) throw unauthorized();
    if (!OWNER_EMAIL) throw forbidden('Owner console is not configured.');
    if (String(req.user.email || '').toLowerCase() !== OWNER_EMAIL) throw forbidden('Owner only.');
    const token = req.headers['x-admin-session'] || '';
    if (!verifyAdminSession(token, req.user.uid, req.user.email)) {
      throw forbidden('Owner session required. Unlock the console first.');
    }
    next();
  } catch (err) {
    next(err);
  }
}
