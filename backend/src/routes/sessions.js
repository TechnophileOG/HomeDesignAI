/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — live cataloging sessions (QR multi-device join)
   ────────────────────────────────────────────────────────────────────────
   A store owner starts a session from Add Product → Multiple Products. The
   session mints JOIN tokens — each one powers ONE QR code, is usable ONCE
   (a second scan is rejected), and expires after 15 minutes. A scanning
   phone exchanges its single-use join token for a per-DEVICE token (valid
   for the session), then uploads captured photos against that token.

   Security:
     • Tokens are minted as 64-hex random bytes and stored ONLY as sha256
       hashes — a Firestore leak exposes no usable join/device token.
     • Token comparison uses timingSafeEqual.
     • Join is public by design (scanning phones have no account) but
       per-IP rate limited; the single-use exchange is ATOMIC (a race can
       never join twice with one QR).
     • Photos stream to GCS via signed URLs (metadata-only to the API) — a
       10MB capture can never exceed Firestore's 1MB document limit. Bytes
       are rate-limited per device; there are NO device/photo hard caps (a
       big store can bring as many phones and shoot as much as it needs —
       the session auto-expires after 6h of inactivity instead).
     • Every mutation is scoped to the session's store; foreign ids 404.
   ════════════════════════════════════════════════════════════════════════ */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, sessionsColl, sessionPhotosColl, storeRef, now, snap } from '../db.js';
import {
  sessionCreate, sessionJoin, sessionPhotoUpload, sessionPhotoConfirm, id as cleanId,
} from '../validate.js';
import { badRequest, notFound, forbidden, tooMany } from '../errors.js';
import { requireOwnStore } from './owners.js';
import { userLimiter } from '../rate-limit.js';
import { signedUploadUrl, objectExists } from '../storage.js';
import { GCS_ORIGINALS_BUCKET } from '../config.js';

const hashToken = (t) => createHash('sha256').update(t).digest('hex');
const mintToken = () => randomBytes(32).toString('hex');
const safeEqual = (a, b) => {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

const JOIN_TTL_MS = 15 * 60 * 1000;       // one QR = 15 minutes to scan
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // auto-expires after 6h (long shoots)
const MAX_PHOTOS_FETCH = 2000;             // safety for one owner fetch, not a cap
const MAX_ACTIVITY = 100;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;  // 10MB per capture (complex fabrics)

// Two surfaces:
//   • sessionsRouter      — owner routes, mounted INSIDE the auth gate.
//   • sessionsPublicRouter — join + photo (joined phones have no account),
//     mounted OUTSIDE the gate; authenticated by single-use/device tokens.
export const sessionsRouter = Router();
export const sessionsPublicRouter = Router();

const genSessionId = () => `ses-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

/* ── rate limits ─────────────────────────────────────────────────────── */
const createLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 10, message: 'Too many sessions. Close old ones before starting new ones.' });
const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 300,                             // per IP — big stores have many
                                          // phones on one network; abuse is
                                          // still bounded by the single-use
                                          // token + 6h session TTL
  keyGenerator: (req) => req.ip,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => {
    const msg = tooMany('Too many join attempts. Try again later.');
    res.status(429).set('Content-Type', 'application/json').json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});
const photoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,                              // per device token (photos/minute)
  keyGenerator: (req) => req.deviceKey || req.ip,
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (req, res) => {
    const msg = tooMany('Photo upload limit reached. Slow down a moment.');
    res.status(429).set('Content-Type', 'application/json').json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});

/* ── auth helpers ────────────────────────────────────────────────────── */

const bearerToken = (req) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
};

/** Load a session doc, lazily expiring stale ones. Throws 404 for unknown. */
async function loadSession(req, res, next) {
  try {
    const sessionId = cleanId(req.params.sessionId, { max: 48, label: 'session id' });
    const doc = await sessionsColl().doc(sessionId).get();
    if (!doc.exists) throw notFound('Session not found.');
    const data = doc.data();
    if (data.status === 'active' && now() - data.createdAt > SESSION_TTL_MS) {
      await doc.ref.update({ status: 'expired', closedAt: now(), updatedAt: now() });
      data.status = 'expired';
    }
    req.session = { id: sessionId, ...data };
    next();
  } catch (err) { next(err); }
}

/** Owner-only access: the session's store must belong to the authenticated
    user (checks the STORE doc's ownerUid — never trusts the session doc). */
async function requireSessionOwner(req, _res, next) {
  try {
    if (!req.session) throw notFound('Session not found.');
    const storeDoc = await storeRef(req.session.storeId).get();
    if (!storeDoc.exists || storeDoc.data().ownerUid !== req.user.uid) throw notFound('Session not found.');
    req.store = { id: req.session.storeId, ...storeDoc.data() };
    next();
  } catch (err) { next(err); }
}

/** Joined-device access: Bearer device token must hash-match a device. */
function requireDeviceToken(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) throw forbidden('This session needs a device token.');
    const devices = Array.isArray(req.session.devices) ? req.session.devices : [];
    const hit = devices.find((d) => safeEqual(d.deviceTokenHash || '', hashToken(token)));
    if (!hit) throw forbidden('Invalid or expired device token.');
    req.device = hit;
    req.deviceKey = hit.deviceTokenHash;
    next();
  } catch (err) { next(err); }
}

const stripSession = (s) => ({
  id: s.id,
  storeId: s.storeId,
  title: s.title || 'Bulk cataloging session',
  status: s.status,
  createdAt: s.createdAt,
  closedAt: s.closedAt || null,
  devices: (s.devices || []).map(({ deviceId, deviceName, joinedAt }) => ({ deviceId, deviceName, joinedAt })),
  photoCount: s.photoCount || 0,
  activity: (s.activity || []).slice(-MAX_ACTIVITY),
});

/* ── routes ──────────────────────────────────────────────────────────── */

// POST /sessions — owner starts a live session (mints the first QR token).
sessionsRouter.post('/sessions', createLimiter, requireOwnStore, async (req, res, next) => {
  try {
    const { title } = sessionCreate(req.body || {});
    const joinToken = mintToken();
    const sessionId = genSessionId();
    await sessionsColl().doc(sessionId).set({
      storeId: req.store.id,
      ownerUid: req.user.uid,
      title: title || null,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      joinTokenHash: hashToken(joinToken), // single-use — usable once
      joinExpiresAt: now() + JOIN_TTL_MS,
      joinUsedAt: null,
      devices: [],
      activity: [{ ts: now(), type: 'session_started', deviceName: 'Owner', detail: 'Session created' }],
      photoCount: 0,
    });
    res.status(201).json({
      ok: true,
      data: {
        session: { id: sessionId, status: 'active' },
        joinToken,           // plaintext ONLY here — the owner renders the QR
        joinExpiresAt: now() + JOIN_TTL_MS,
        joinUrl: `/join/${sessionId}?t=${joinToken}`,
      },
    });
  } catch (err) { next(err); }
});

// POST /sessions/:id/join — PUBLIC, single-use QR token → device token.
sessionsPublicRouter.post('/sessions/:sessionId/join', joinLimiter, loadSession, async (req, res, next) => {
  try {
    const { token, deviceName } = sessionJoin(req.body || {});
    const s = req.session;
    if (s.status !== 'active') throw badRequest('SESSION_CLOSED', 'This session is no longer active.');
    if (now() > (s.joinExpiresAt || 0)) throw badRequest('JOIN_EXPIRED', 'This link has expired. Ask the store for a fresh QR code.');
    if (s.joinUsedAt) throw badRequest('JOIN_USED', 'This link was already used. Ask the store for a fresh QR code.');

    // Atomic single-use exchange: only ONE device can ever redeem a token.
    let out;
    await db.runTransaction(async (tx) => {
      const ref = sessionsColl().doc(s.id);
      const cur = (await tx.get(ref)).data();
      if (cur.joinUsedAt) { out = { duplicate: true }; return; }
      if (cur.status !== 'active') throw badRequest('SESSION_CLOSED', 'This session is no longer active.');
      if (now() > (cur.joinExpiresAt || 0)) throw badRequest('JOIN_EXPIRED', 'This link has expired.');
      const deviceToken = mintToken();
      const device = {
        deviceId: randomBytes(6).toString('hex'),
        deviceName,
        deviceTokenHash: hashToken(deviceToken),
        joinedAt: now(),
      };
      tx.update(ref, {
        joinUsedAt: now(),
        joinTokenHash: null,
        devices: [...(cur.devices || []), device],
        activity: [...(cur.activity || []).slice(-MAX_ACTIVITY), { ts: now(), type: 'device_joined', deviceName, detail: 'Phone joined' }],
        updatedAt: now(),
      });
      out = { device, deviceToken };
    });

    if (out.duplicate) throw badRequest('JOIN_USED', 'This link was already used. Ask the store for a fresh QR code.');

    // Store display name comes from the session owner's store doc.
    const storeDoc = await storeRef(s.storeId).get().catch(() => null);
    const storeName = storeDoc?.exists ? storeDoc.data().name : 'Store';

    res.json({
      ok: true,
      data: {
        sessionId: s.id,
        deviceId: out.device.deviceId,
        deviceName: out.device.deviceName,
        deviceToken: out.deviceToken,   // plaintext ONCE — kept on the phone
        storeName,
      },
    });
  } catch (err) { next(err); }
});

// POST /sessions/:id/photo — joined device STAGES a capture: validates the
// metadata, issues a photo id + GCS path, returns a signed PUT URL. The phone
// uploads the bytes straight to GCS, then calls confirm. Firestore holds only
// a tiny pending doc — a 10MB photo can never exceed the 1MB doc limit, and
// the signed URL keeps raw bucket access out of the phone's hands.
sessionsPublicRouter.post('/sessions/:sessionId/photo', photoLimiter, loadSession, requireDeviceToken, async (req, res, next) => {
  try {
    if (req.session.status !== 'active') throw badRequest('SESSION_CLOSED', 'This session is no longer active.');
    const { mime, size, index } = sessionPhotoUpload(req.body || {});

    const pid = randomBytes(6).toString('hex');
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const objectPath = `stores/${req.session.storeId}/sessions/${req.session.id}/${pid}.${ext}`;
    const { uploadUrl } = await signedUploadUrl({ purpose: 'session', objectPath, contentType: mime });

    await sessionPhotosColl(req.session.id).doc(pid).set({
      pid, deviceId: req.device.deviceId, mime, size, index,
      path: objectPath, status: 'pending', ts: now(),
    });
    res.status(201).json({ ok: true, data: { photoId: pid, objectPath, uploadUrl } });
  } catch (err) { next(err); }
});

// POST /sessions/:id/photo/:photoId/confirm — the phone finished the GCS PUT;
// register the capture (path + metadata must match the staged doc, the object
// must actually exist) and bump the session counter + activity.
sessionsPublicRouter.post('/sessions/:sessionId/photo/:photoId/confirm', photoLimiter, loadSession, requireDeviceToken, async (req, res, next) => {
  try {
    if (req.session.status !== 'active') throw badRequest('SESSION_CLOSED', 'This session is no longer active.');
    const photoId = cleanId(req.params.photoId, { max: 48, label: 'photo id' });
    const { mime, size, index } = sessionPhotoConfirm(req.body || {});

    const ref = sessionPhotosColl(req.session.id).doc(photoId);
    const doc = await ref.get();
    if (!doc.exists || doc.data().status !== 'pending') {
      throw badRequest('PHOTO_INVALID', 'This photo was not staged for this session.');
    }
    const rec = doc.data();
    if (rec.mime !== mime || rec.size !== size || rec.index !== index || rec.deviceId !== req.device.deviceId) {
      throw badRequest('PHOTO_MISMATCH', 'Photo details do not match the staged capture.');
    }
    // The object must actually exist in GCS before we count it.
    if (!(await objectExists(GCS_ORIGINALS_BUCKET, rec.path))) {
      throw badRequest('PHOTO_MISSING', 'The photo bytes were not uploaded.');
    }

    await ref.update({ status: 'saved', confirmedAt: now() });
    await sessionsColl().doc(req.session.id).update({
      photoCount: (req.session.photoCount || 0) + 1,
      activity: [...(req.session.activity || []).slice(-MAX_ACTIVITY),
        { ts: now(), type: 'photo', deviceName: req.device.deviceName, index, detail: `Photo ${index + 1}` }],
      updatedAt: now(),
    });
    res.status(201).json({ ok: true, data: { photoId, path: rec.path } });
  } catch (err) { next(err); }
});

// GET /sessions/:id — owner: LIGHT live status (polled every few seconds
// while the session is open — no photo bytes, stays cheap).
sessionsRouter.get('/sessions/:sessionId', loadSession, requireSessionOwner, async (req, res, next) => {
  try {
    res.json({ ok: true, data: { session: stripSession(req.session) } });
  } catch (err) { next(err); }
});

// GET /sessions/:id/photos — owner: FULL saved captures (fetched once on
// close so they can flow into the catalog pipeline). Each photo carries its
// public GCS url + object path (the path is what product creation references).
sessionsRouter.get('/sessions/:sessionId/photos', loadSession, requireSessionOwner, async (req, res, next) => {
  try {
    const photosSnap = await sessionPhotosColl(req.session.id).orderBy('ts', 'asc').limit(MAX_PHOTOS_FETCH).get();
    const photos = photosSnap.docs
      .map((d) => d.data())
      .filter((p) => p.status === 'saved' && p.path)
      .map((p) => ({
        pid: p.pid, deviceId: p.deviceId, mime: p.mime, index: p.index, ts: p.ts,
        path: p.path,
        url: `https://storage.googleapis.com/${GCS_ORIGINALS_BUCKET}/${p.path}`,
      }));
    res.json({ ok: true, data: { photos } });
  } catch (err) { next(err); }
});

// GET /sessions — owner: recent sessions (newest first) for the Review Center.
sessionsRouter.get('/sessions', requireOwnStore, async (req, res, next) => {
  try {
    const max = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const snap2 = await sessionsColl().where('storeId', '==', req.store.id)
      .orderBy('createdAt', 'desc').limit(max).get();
    const sessions = [];
    for (const doc of snap2.docs) sessions.push(stripSession({ id: doc.id, ...doc.data() }));
    res.json({ ok: true, data: { sessions } });
  } catch (err) { next(err); }
});

// POST /sessions/:id/join-url — owner mints a FRESH single-use QR token.
sessionsRouter.post('/sessions/:sessionId/join-url', userLimiter({ windowMs: 60 * 60 * 1000, limit: 60 }), loadSession, requireSessionOwner, async (req, res, next) => {
  try {
    if (req.session.status !== 'active') throw badRequest('SESSION_CLOSED', 'Session is not active.');
    const joinToken = mintToken();
    await sessionsColl().doc(req.session.id).update({
      joinTokenHash: hashToken(joinToken),
      joinExpiresAt: now() + JOIN_TTL_MS,
      joinUsedAt: null,
      updatedAt: now(),
    });
    res.json({
      ok: true,
      data: {
        joinToken,
        joinExpiresAt: now() + JOIN_TTL_MS,
        joinUrl: `/join/${req.session.id}?t=${joinToken}`,
      },
    });
  } catch (err) { next(err); }
});

// POST /sessions/:id/close — owner closes; photos stay for the review flow.
sessionsRouter.post('/sessions/:sessionId/close', loadSession, requireSessionOwner, async (req, res, next) => {
  try {
    if (req.session.status === 'active') {
      await sessionsColl().doc(req.session.id).update({
        status: 'closed', closedAt: now(), joinTokenHash: null, updatedAt: now(),
      });
    }
    res.json({ ok: true, data: { session: stripSession({ ...req.session, status: 'closed', closedAt: now() }) } });
  } catch (err) { next(err); }
});
