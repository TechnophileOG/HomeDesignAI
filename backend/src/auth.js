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
   client SDK against Firebase Auth. `role: admin` claims and the
   ADMIN_EMAILS allowlist gate admin endpoints.
   ════════════════════════════════════════════════════════════════════════ */

import { OAuth2Client } from 'google-auth-library';
import { FIREBASE_AUDIENCE, FIREBASE_ISSUER, ADMIN_EMAILS } from './config.js';
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
    isAdmin: p.role === 'admin' || ADMIN_EMAILS.includes((p.email || '').toLowerCase()),
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
  } catch (err) {
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

/** Express middleware — must come after requireAuth. */
export function requireAdmin(req, _res, next) {
  try {
    if (!req.user) throw unauthorized();
    if (ADMIN_EMAILS.length === 0) throw forbidden('Admin access is not configured.');
    if (!ADMIN_EMAILS.includes(String(req.user.email || '').toLowerCase())) throw forbidden('Admin only.');
    next();
  } catch (err) {
    next(err);
  }
}
