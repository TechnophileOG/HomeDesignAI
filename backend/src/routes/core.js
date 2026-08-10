/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — core routes: stores, products, uploads, notifications
   ────────────────────────────────────────────────────────────────────────
   Every store route enforces OWNERSHIP: a user may only read/write stores
   where stores/{storeId}.ownerUid === their uid. A foreign store id looks
   identical to a missing one (404) — no existence oracle.
   ════════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import {
  db, now, storeRef, storesColl, productsColl, notifsColl, adminAlertsColl, usersRef, snap,
} from '../db.js';
import { store as sanitizeStore, product as sanitizeProduct, productPatch,
         fileName, oneOf, id as cleanId, notification as sanitizeNotif,
         exportRequest } from '../validate.js';
import { signedUploadUrl } from '../storage.js';
import { getWallet, grantCredits } from '../ledger.js';
import { WELCOME_CREDITS } from '../config.js';
import { badRequest, conflict, notFound, unauthorized, verifyEmailRequired } from '../errors.js';
import { userLimiter } from '../rate-limit.js';
import { requireStoreOwner } from './owners.js';
import { platformExport } from '../export.js';

// Anti-abuse: store creation mints the welcome bonus, signed URLs spend our
// signing budget, and notifications feed the admin follow-up queue. Each gets
// a per-user budget on top of the global per-IP limiter.
const storeCreateLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 5, message: 'Too many store creations. Try again later.' });
const uploadLimiter = userLimiter({ windowMs: 60 * 1000, limit: 60, message: 'Too many upload requests. Try again shortly.' });
const notifLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 30, message: 'Too many notifications. Try again later.' });
// CSV exports are cheap, but a per-user budget still stops a misbehaving
// client from hammering the template renderer.
const exportLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 120, message: 'Too many export requests. Try again later.' });

// Express route params are attacker-controlled strings — never build a
// Firestore reference from them unvalidated.
const safeParam = (v, label = 'id') => cleanId(v, { max: 64, label });

export const coreRouter = Router();

/* ── bootstrap ────────────────────────────────────────────────────────── */

// GET /me — one call to hydrate the whole app: user, store, wallet, admin flag.
// Store id is DERIVED from the token (never client-supplied), so a caller can
// only ever see their own account.
coreRouter.get('/me', async (req, res, next) => {
  try {
    const storeId = `store-${req.user.uid.slice(0, 8)}`;
    const storeDoc = await storeRef(storeId).get();
    let store = snap(storeDoc);
    // Ownership guard: /me must NEVER return a store that belongs to another
    // account, even if this uid happens to derive the same id (defense-in-
    // depth against id collisions / hijacking). A mismatched doc reads as
    // "not onboarded" — same as missing.
    if (store && store.ownerUid !== req.user.uid) store = null;
    const wallet = store ? await getWallet(storeId) : null;
    res.json({
      ok: true,
      data: {
        user: {
          uid: req.user.uid, email: req.user.email, name: req.user.name,
          emailVerified: req.user.emailVerified, isAdmin: req.user.isAdmin,
        },
        store, wallet, onboarded: !!store,
      },
    });
  } catch (err) { next(err); }
});

/* ── stores ───────────────────────────────────────────────────────────── */

// POST /stores — complete onboarding. Idempotent per user.
coreRouter.post('/stores', storeCreateLimiter, async (req, res, next) => {
  try {
    // Defensive: requireAuth always sets req.user, but never build an id from
    // an undefined uid (would silently create a shared 'store-undefined').
    if (!req.user?.uid) throw unauthorized();
    // Anti-abuse: store creation mints the welcome bonus (10 credits). Requiring
    // a verified email stops bots from farming unlimited free credits. Google
    // sign-in accounts are verified by default. (Existing stores are untouched.)
    if (!req.user.emailVerified) throw verifyEmailRequired();
    const body = sanitizeStore(req.body || {});
    const requestedId = body.id;
    if (requestedId !== undefined && !/^store-[A-Za-z0-9_-]{1,16}$/.test(requestedId)) {
      throw badRequest('INVALID_FIELD', 'Invalid store id.');
    }
    const storeId = requestedId || `store-${req.user.uid.slice(0, 8)}`;

    const existing = await storeRef(storeId).get();
    if (existing.exists) {
      if (existing.data().ownerUid !== req.user.uid) throw conflict('STORE_CONFLICT', 'That store id belongs to another account.');
      // Already onboarded → replay (idempotent), return current state.
      const wallet = await getWallet(storeId);
      return res.status(200).json({ ok: true, data: { store: snap(existing), wallet } });
    }

    // Firestore rejects `undefined` field values — default every optional
    // field so a partial onboarding payload can never 500 the write.
    const store = {
      id: storeId,
      ownerUid: req.user.uid,
      ownerEmail: req.user.email,
      plan: 'free',            // server-managed — clients can never self-upgrade
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
      name: body.name || 'My Store',
      city: body.city || '',
      categories: body.categories || [],
      scale: body.scale || 'starter',
      aiFeatures: body.aiFeatures || [],
      salesChannel: body.salesChannel || '',
      yearsInBusiness: body.yearsInBusiness || '',
      inventoryTurnover: body.inventoryTurnover || '',
      hasInventorySystem: body.hasInventorySystem ?? false,
      orderValue: body.orderValue || '',
      brandStyle: body.brandStyle || '',
      storeType: body.storeType || '',
    };

    await db.runTransaction(async (tx) => {
      tx.set(storeRef(storeId), store);
      tx.set(usersRef(req.user.uid), {
        uid: req.user.uid, email: req.user.email, name: req.user.name, createdAt: now(),
      }, { merge: true });
    });

    // Welcome bonus — exactly-once per user (idempotency key signup:{uid}).
    let wallet = { storeId, balance: 0, plan: 'free' };
    if (WELCOME_CREDITS > 0) {
      wallet = await grantCredits({
        storeId, amount: WELCOME_CREDITS, idemKey: `signup:${req.user.uid}`,
        type: 'GRANT', note: 'Welcome bonus', actor: 'system',
      });
    }
    return res.status(201).json({ ok: true, data: { store, wallet } });
  } catch (err) { next(err); }
});

// GET /stores/:storeId — store + live balance.
coreRouter.get('/stores/:storeId', requireStoreOwner, async (req, res, next) => {
  try {
    const wallet = await getWallet(req.store.id);
    res.json({ ok: true, data: { store: req.store, wallet } });
  } catch (err) { next(err); }
});

// PATCH /stores/:storeId — profile fields only. plan/status/balance are untouchable.
coreRouter.patch('/stores/:storeId', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const patch = sanitizeStore(req.body || {});
    const FORBIDDEN = ['id', 'plan', 'status', 'balance', 'ownerUid', 'ownerEmail', 'createdAt'];
    for (const key of FORBIDDEN) {
      if (patch[key] !== undefined) throw badRequest('INVALID_FIELD', `Field "${key}" is server-managed.`);
    }
    if (Object.keys(patch).length === 0) throw badRequest('INVALID_FIELD', 'Nothing to update.');
    const update = { ...patch, updatedAt: now() };
    await storeRef(req.store.id).update(update);
    const fresh = snap(await storeRef(req.store.id).get());
    const wallet = await getWallet(req.store.id);
    res.json({ ok: true, data: { store: fresh, wallet } });
  } catch (err) { next(err); }
});

/* ── products ─────────────────────────────────────────────────────────── */

// GET /stores/:storeId/products?status= — list (filter in code; subcollection query is owner-scoped).
coreRouter.get('/stores/:storeId/products', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const status = req.query.status ? oneOf(req.query.status,
      ['pending_approve', 'pending_retake', 'draft', 'live'], { label: 'status' }) : null;
    const max = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 200), 500);
    const snap2 = await productsColl(req.store.id).orderBy('createdAt', 'desc').limit(max).get();
    let items = snap2.docs.map(snap);
    if (status) items = items.filter((p) => p.status === status);
    res.json({ ok: true, data: { products: items } });
  } catch (err) { next(err); }
});

// POST /stores/:storeId/products — create (id optional; generated if absent).
coreRouter.post('/stores/:storeId/products', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    // storeId scopes every photo reference to THIS store (cross-tenant guard).
    const clean = sanitizeProduct(req.body || {}, req.store.id);
    const productId = clean.id || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const doc = {
      id: productId,
      storeId: req.store.id,
      status: clean.status || 'pending_approve',
      createdAt: now(),
      updatedAt: now(),
      ...clean,
      id: productId,
    };
    await productsColl(req.store.id).doc(productId).set(doc);
    res.status(201).json({ ok: true, data: { product: doc } });
  } catch (err) { next(err); }
});

// PATCH /stores/:storeId/products/:productId — merge a sanitized patch.
coreRouter.patch('/stores/:storeId/products/:productId', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const productId = safeParam(req.params.productId, 'product id');
    const ref = productsColl(req.store.id).doc(productId);
    const existing = await ref.get();
    if (!existing.exists) throw notFound('Product not found.');
    const patch = productPatch(req.body || {}, req.store.id);
    if (Object.keys(patch).length === 0) throw badRequest('INVALID_FIELD', 'Nothing to update.');
    await ref.update({ ...patch, updatedAt: now() });
    res.json({ ok: true, data: { product: snap(await ref.get()) } });
  } catch (err) { next(err); }
});

// DELETE /stores/:storeId/products/:productId
coreRouter.delete('/stores/:storeId/products/:productId', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const productId = safeParam(req.params.productId, 'product id');
    await productsColl(req.store.id).doc(productId).delete();
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /stores/:storeId/products/:productId/export — render the platform's
// bulk-upload CSV for this product (Amazon / Flipkart / Meesho / Myntra /
// Alibaba). Pure template output — no API keys, no credentials, nothing is
// pushed anywhere; the seller downloads and uploads the file themselves.
coreRouter.post('/stores/:storeId/products/:productId/export', exportLimiter, requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const productId = safeParam(req.params.productId, 'product id');
    const { platform } = exportRequest(req.body || {});
    const doc = await productsColl(req.store.id).doc(productId).get();
    if (!doc.exists) throw notFound('Product not found.');
    const product = doc.data();
    const out = platformExport({ platform, product, brand: req.store.name || '' });
    if (!out) throw badRequest('INVALID_FIELD', 'Unknown platform.');
    res.json({ ok: true, data: { filename: out.filename, csv: out.csv } });
  } catch (err) { next(err); }
});

/* ── uploads (signed URLs) ────────────────────────────────────────────── */

// POST /uploads/urls — short-lived signed PUT URL for a validated object path.
coreRouter.post('/uploads/urls', uploadLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const purpose = oneOf(body.purpose, ['flat_lay', 'ai_result'], { label: 'purpose' });
    const name = fileName(body.fileName);
    const contentType = oneOf(body.contentType,
      ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif'],
      { label: 'contentType' });
    // Object paths always live under stores/{storeId}/… so they match the
    // storage rules + product photo paths. storeId is DERIVED from the
    // authenticated user (never client-supplied).
    const storeId = `store-${req.user.uid.slice(0, 8)}`;
    const objectPath = `stores/${storeId}/${purpose}/${name}`;
    const out = await signedUploadUrl({ purpose, objectPath, contentType });
    res.json({ ok: true, data: out });
  } catch (err) { next(err); }
});

/* ── notifications + admin follow-up alerts ───────────────────────────── */

// GET /stores/:storeId/notifications
coreRouter.get('/stores/:storeId/notifications', requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const snap2 = await notifsColl(req.store.id).orderBy('ts', 'desc').limit(50).get();
    res.json({ ok: true, data: { notifications: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

// POST /stores/:storeId/notifications — low-balance follow-ups queue a
// matching admin alert so the team can reach out. Deduped while unresolved.
coreRouter.post('/stores/:storeId/notifications', notifLimiter, requireStoreOwner, async (req, res, next) => {
  try {
    safeParam(req.params.storeId, 'store id');
    const body = sanitizeNotif(req.body || {});
    const { type } = body;

    if (type === 'follow_up' || type === 'low_balance') {
      // Don't spam the admin queue with duplicates of the same open issue.
      const open = await adminAlertsColl()
        .where('storeId', '==', req.store.id)
        .where('type', '==', type)
        .where('resolved', '==', false)
        .limit(1).get();
      if (open.empty) {
        await adminAlertsColl().add({
          storeId: req.store.id,
          storeName: req.store.name,
          ownerEmail: req.store.ownerEmail || '',
          type,
          message: body.message,
          balance: body.balance,
          ts: now(),
          resolved: false,
          resolvedTs: null,
        });
      }
    }

    const ref = notifsColl(req.store.id).doc();
    const entry = { id: ref.id, ...body, storeId: req.store.id, read: false, ts: now() };
    await ref.set(entry);
    res.status(201).json({ ok: true, data: { notification: entry } });
  } catch (err) { next(err); }
});
