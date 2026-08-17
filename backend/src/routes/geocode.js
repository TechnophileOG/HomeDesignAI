/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — geocoding proxy (store location, onboarding)
   ────────────────────────────────────────────────────────────────────────
   The browser NEVER talks to a geocoder directly. It POSTs a sanitized query
   here; we enforce per-user rate limits, cache results in Firestore, and
   query Nominatim (OpenStreetMap) with a proper identifying User-Agent.

   Why a proxy instead of the browser → nominatim call:
     • rate-limited per USER (6/min, 30/hr) — a bot can't hammer OSM through
       our origin or burn our upstream quota
     • cached — repeated lookups (same address) cost zero upstream calls
     • the query is re-sanitized + length-capped server-side
     • our origin + UA identify us to OSM (their usage policy requires it)
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { createHash } from 'node:crypto';
import { db, now } from '../db.js';
import { s } from '../validate.js';
import { userLimiter } from '../rate-limit.js';
import { NOMINATIM_EMAIL } from '../config.js';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — addresses barely change

const geocodeRouter = Router();

const perMin = userLimiter({
  windowMs: 60 * 1000,
  limit: 6,
  message: 'Too many location lookups. Try again in a minute.',
});
const perHour = userLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: 'Too many location lookups. Try again later.',
});

const cacheKey = (q) => createHash('sha256').update(q.toLowerCase().trim()).digest('hex').slice(0, 40);

/** Query Nominatim with a proper, identifying request (their usage policy:
    a real User-Agent + contact email for heavy use). One result max. */
async function nominatim(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', q);
  url.searchParams.set('accept-language', 'en');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'KatalogitAI/1.0 (https://katalogit.ai; store-location picker)',
      ...(NOMINATIM_EMAIL ? { 'email': NOMINATIM_EMAIL } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const hits = await res.json();
  const hit = Array.isArray(hits) ? hits[0] : null;
  if (!hit || hit.lat === undefined || hit.lon === undefined) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    label: String(hit.display_name || q).slice(0, 200),
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  };
}

geocodeRouter.post('/geocode', perMin, perHour, async (req, res, next) => {
  try {
    const q = s((req.body || {}).q || '', { max: 120, label: 'location query' });
    const key = cacheKey(q);

    // Cache hit — no upstream call, no per-query cost.
    const cached = await db.collection('geocode_cache').doc(key).get().catch(() => null);
    const cachedDoc = cached && cached.exists ? cached.data() : null;
    if (cachedDoc && cachedDoc.result && Date.now() - (cachedDoc.ts || 0) < CACHE_TTL_MS) {
      return res.json({ ok: true, data: { query: q, result: cachedDoc.result } });
    }

    let result = null;
    try {
      result = await nominatim(q);
    } catch (err) {
      // Upstream hiccup — never fail the user's onboarding over geocoding.
      console.error('[geocode] nominatim error:', err && err.message ? err.message : err);
    }

    if (result) {
      await db.collection('geocode_cache').doc(key).set({
        q: q.toLowerCase().trim(),
        result,
        ts: now(),
      }).catch(() => { /* cache write is best-effort */ });
    }
    res.json({ ok: true, data: { query: q, result } });
  } catch (err) { next(err); }
});

export { geocodeRouter };
