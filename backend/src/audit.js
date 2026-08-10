/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — audit trail
   ────────────────────────────────────────────────────────────────────────
   The "black box" ledger of who did what:

     • EVERY /api request → one structured JSON line via console.log. On
       Cloud Run that lands in Cloud Logging automatically (queryable,
       zero Firestore cost, no per-request latency).
     • Anomalies (status ≥ 400) and sensitive paths (admin, webhooks,
       workers) ALSO get a row in Firestore `audit_events` — a durable,
       reviewable trail even if logs are rotated.
     • Firestore writes are throttled per (status-class × IP) so a hostile
       caller can't amplify our write costs by spamming 4xx requests.

   audit logging is fire-and-forget by design: a failure to log must never
   fail the request it describes.
   ════════════════════════════════════════════════════════════════════════ */

import { db, now } from './db.js';

/* ── write throttle (bounded Firestore cost under attack) ──────────────── */

const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_MAX_PER_KEY = 30; // writes/min per (class × IP)

const buckets = new Map(); // key → { count, windowStart }

function throttled(key) {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || t - b.windowStart > THROTTLE_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: t });
    return false;
  }
  if (b.count >= THROTTLE_MAX_PER_KEY) return true;
  b.count += 1;
  return false;
}

const statusClass = (status) => (status >= 500 ? '5xx' : status >= 400 ? '4xx' : 'ok');

/* ── durable audit row (never throws, never blocks) ────────────────────── */

export function auditWrite(entry) {
  db.collection('audit_events').add({
    ts: now(),
    ...entry,
  }).catch((err) => {
    console.error('[audit] write failed:', err && err.message ? err.message : err);
  });
}

/* ── per-request logger (mount as middleware in server.js) ─────────────── */

export function logRequest({ req, status, ms, uid }) {
  try {
    const method = req.method;
    const path = String(req.originalUrl || req.url || '').slice(0, 300);
    const ip = String(req.ip || '');
    const cls = statusClass(status);
    const isAnomaly = status >= 400;
    const isSensitive = /^\/api\/v1\/(admin|webhooks|workers)\//.test(path);

    // 1) EVERY request → structured log line (Cloud Logging on Cloud Run).
    console.log(JSON.stringify({
      event: 'request', ts: now(), method, path, status, ms,
      uid: uid || '', ip, cls,
    }));

    // 2) Anomalies + sensitive paths → durable Firestore trail (throttled).
    if (isAnomaly || isSensitive) {
      const key = `${cls}:${ip || 'unknown'}`;
      if (!throttled(key)) {
        auditWrite({
          kind: isAnomaly ? 'anomaly' : 'sensitive',
          method, path, status, ms, uid: uid || '', ip,
        });
      }
    }
  } catch (err) {
    // Audit must never take a request down with it.
    console.error('[audit] logRequest failed:', err && err.message ? err.message : err);
  }
}
