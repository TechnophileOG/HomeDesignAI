/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — credits: balance, ledger, packs, top-up orders, webhook
   ────────────────────────────────────────────────────────────────────────
   • The webhook is the ONLY unauthenticated route besides /healthz — it
     authenticates via Razorpay's HMAC-SHA256 signature over the raw body.
   • Every webhook event is stored once (idempotency) and credit top-ups use
     ledger idempotency keys — a doubled webhook can never double-grant.
   • Admin endpoints are gated by requireAdmin — OWNER_EMAIL + a short-lived
     passcode-issued session token (never client-supplied).
   ════════════════════════════════════════════════════════════════════════ */

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, now, ordersColl, subscriptionsColl, storeRef, storesColl, globalLedgerColl, adminAlertsColl, snap } from '../db.js';
import { getWallet, listLedger, grantCredits, refundCredits } from '../ledger.js';
import { CREDIT_PACKS, CREDIT_PRICING, SUBSCRIPTION_PLAN, RAZORPAY, razorpayConfigured, subscriptionConfigured, WEBHOOK_MAX_AGE_SECONDS } from '../config.js';
import { orderCreate, adminAdjust } from '../validate.js';
import { badRequest, notFound, notConfigured, tooMany } from '../errors.js';
import { userLimiter } from '../rate-limit.js';
import { requireAdmin } from '../auth.js';
import { requireStoreOwner } from './owners.js';

const orderLimiter = userLimiter({ windowMs: 60 * 60 * 1000, limit: 10, message: 'Too many order attempts. Try again later.' });

// Webhook flood guard — HMAC keeps forgery out, but a leaked/compromised
// secret should still not be able to spam us. All webhook traffic (any IP)
// shares one budget: 100 events/min (Razorpay never bursts anywhere near this).
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: () => 'webhook:razorpay',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    const msg = tooMany('Too many webhook events. Try again later.');
    res.status(429).set('Content-Type', 'application/json')
      .json({ ok: false, error: { code: msg.code, message: msg.message } });
  },
});

export const creditsRouter = Router();

/* ── balance + ledger ─────────────────────────────────────────────────── */

creditsRouter.get('/stores/:storeId/credits', requireStoreOwner, async (req, res, next) => {
  try {
    const wallet = await getWallet(req.store.id);
    const plan = wallet.plan || 'free';
    const entitlements = plan === 'business'
      ? ['unlimited_shoots', 'priority_queue', 'custom_model']
      : plan === 'pro'
        ? ['priority_queue', 'custom_model']
        : ['basic_shoots'];
    res.json({ ok: true, data: { balance: wallet.balance, plan, entitlements, pricing: CREDIT_PRICING } });
  } catch (err) { next(err); }
});

creditsRouter.get('/stores/:storeId/credits/ledger', requireStoreOwner, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const entries = await listLedger(req.store.id, limit);
    res.json({ ok: true, data: { ledger: entries } });
  } catch (err) { next(err); }
});

/* ── packs + orders (Razorpay) ────────────────────────────────────────── */

creditsRouter.get('/credits/packs', (_req, res) => {
  res.json({ ok: true, data: { packs: CREDIT_PACKS } });
});

creditsRouter.post('/credits/orders', orderLimiter, async (req, res, next) => {
  try {
    if (!razorpayConfigured()) throw notConfigured('PAYMENTS_NOT_CONFIGURED', 'Payments are not configured yet.');
    const { packId } = orderCreate(req.body || {});
    const pack = CREDIT_PACKS.find((p) => p.packId === packId);
    if (!pack) throw badRequest('INVALID_FIELD', 'Unknown credit pack.');

    // Store id is derived from the authenticated user — never from the body.
    const storeId = `store-${req.user.uid.slice(0, 8)}`;
    const receipt = `kat-${now().toString(36)}`;

    const basic = Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString('base64');
    const rpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        amount: pack.pricePaise,
        currency: 'INR',
        receipt,
        notes: { storeId, packId, uid: req.user.uid },
      }),
    });
    if (!rpRes.ok) {
      console.error('[razorpay] order create failed:', rpRes.status, await rpRes.text().catch(() => ''));
      throw new Error('razorpay order failed');
    }
    const order = await rpRes.json();

    const orderDoc = {
      orderId: order.id,
      storeId,
      uid: req.user.uid,
      packId: pack.packId,
      credits: pack.credits,
      amountPaise: pack.pricePaise,
      currency: 'INR',
      status: 'created',
      createdAt: now(),
    };
    await ordersColl().doc(order.id).set(orderDoc);

    res.status(201).json({
      ok: true,
      data: {
        orderId: order.id,
        credits: pack.credits,
        amountPaise: pack.pricePaise,
        currency: 'INR',
        status: 'created',
        keyId: RAZORPAY.keyId, // public by design (checkout UI needs it)
      },
    });
  } catch (err) { next(err); }
});

/* ── Pro subscription (Razorpay recurring) ─────────────────────────────── */

// GET /credits/subscription — the plan card (public pricing, no secrets).
creditsRouter.get('/credits/subscription', (_req, res) => {
  res.json({
    ok: true,
    data: {
      plan: {
        pricePaise: SUBSCRIPTION_PLAN.pricePaise,
        monthlyCredits: SUBSCRIPTION_PLAN.monthlyCredits,
        currency: SUBSCRIPTION_PLAN.currency,
        configured: subscriptionConfigured(),
      },
    },
  });
});

// POST /credits/subscriptions — create a Razorpay subscription (12 monthly
// renewals). The store id is derived from the authenticated user, never from
// the body. The webhook grants 40 credits + PRO on every `subscription.charged`.
creditsRouter.post('/credits/subscriptions', orderLimiter, async (req, res, next) => {
  try {
    if (!subscriptionConfigured()) {
      throw notConfigured('PAYMENTS_NOT_CONFIGURED', 'Pro subscription is not available yet.');
    }

    // Store id is derived from the authenticated user — never from the body.
    const storeId = `store-${req.user.uid.slice(0, 8)}`;
    const receipt = `kat-sub-${now().toString(36)}`;

    const basic = Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString('base64');
    const rpRes = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({
        plan_id: SUBSCRIPTION_PLAN.planId,
        total_count: 12,           // 12 monthly renewals
        customer_notify: 1,
        notes: { storeId, uid: req.user.uid },
      }),
    });
    if (!rpRes.ok) {
      console.error('[razorpay] subscription create failed:', rpRes.status, await rpRes.text().catch(() => ''));
      throw new Error('razorpay subscription failed');
    }
    const sub = await rpRes.json();

    await subscriptionsColl().doc(sub.id).set({
      subscriptionId: sub.id,
      storeId,
      uid: req.user.uid,
      status: sub.status || 'created',
      createdAt: now(),
      updatedAt: now(),
    });

    res.status(201).json({
      ok: true,
      data: {
        subscriptionId: sub.id,
        keyId: RAZORPAY.keyId, // public by design (checkout UI needs it)
        amountPaise: SUBSCRIPTION_PLAN.pricePaise,
        currency: 'INR',
      },
    });
  } catch (err) { next(err); }
});

/* ── Razorpay webhook — NO bearer token; authenticates via HMAC signature.
   Mounted OUTSIDE the auth gate (see server.js). Reads req.rawBody.   ── */

export const webhookRouter = Router();

webhookRouter.post('/razorpay', webhookLimiter, async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || '';
    const body = req.rawBody || '';
    const secret = RAZORPAY.webhookSecret;
    if (!secret || !signature) throw badRequest('BAD_SIGNATURE', 'Missing signature.');

    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const given = Buffer.from(signature, 'hex');
    const exp = Buffer.from(expected, 'hex');
    if (given.length !== exp.length || !timingSafeEqual(given, exp)) {
      throw badRequest('BAD_SIGNATURE', 'Signature verification failed.');
    }

    let payload;
    try { payload = JSON.parse(body); } catch { throw badRequest('BAD_SIGNATURE', 'Malformed payload.'); }

    // Replay protection: reject events that are missing a created_at or are
    // older than the allowed window (defense-in-depth on top of HMAC + the
    // exactly-once event marker — a captured old webhook can't be replayed).
    const eventTs = Number(payload.created_at);
    const nowSec = Math.floor(Date.now() / 1000);
    const MAX_AGE = WEBHOOK_MAX_AGE_SECONDS;
    if (!Number.isFinite(eventTs) || eventTs <= 0 || nowSec - eventTs > MAX_AGE || eventTs > nowSec + 300) {
      throw badRequest('BAD_SIGNATURE', 'Webhook event is stale or invalid.');
    }

    // Exactly-once: record every accepted event once. The document id must be
    // a SAFE Firestore id — `event:paymentId` contains ':' (and arbitrary
    // event names), which would fail id() and 400 EVERY webhook. Hash it:
    // deterministic, unique, charset-safe.
    const rawEventKey = [payload.event, payload.payload?.payment?.entity?.id,
      payload.payload?.payment?.entity?.order_id || ''].filter(Boolean).join(':');
    const eventKey = createHash('sha256').update(rawEventKey || String(now())).digest('hex').slice(0, 48);
    const eventRef = db.doc(`webhook_events/${eventKey}`);
    const seen = await eventRef.get();
    if (!seen.exists) {
      await eventRef.set({ event: payload.event, eventKey: rawEventKey, receivedAt: now() });
    } else {
      return res.json({ ok: true, data: { received: true, duplicate: true } });
    }

    if (payload.event === 'payment.captured') {
      const payment = payload.payload?.payment?.entity;
      const razorpayOrderId = payment?.order_id;
      if (razorpayOrderId) {
        const orderDoc = await ordersColl().doc(razorpayOrderId).get();
        if (orderDoc.exists && orderDoc.data().status !== 'paid') {
          const order = orderDoc.data();
          // Amount-integrity: only grant what THIS order was created for. If
          // the captured amount/currency ever disagrees with our stored order,
          // refuse to credit and let the team see it — never auto-grant on a
          // mismatched capture.
          const capturedPaise = Number(payment.amount);
          const capturedCur = payment.currency || 'INR';
          if (Number.isFinite(capturedPaise) && capturedPaise === order.amountPaise && capturedCur === order.currency) {
            // Idempotent by payment id — retries of this webhook can't double-grant.
            // A successful PAID top-up also upgrades the wallet to PRO inside the
            // same transaction+idempotency marker (replays can't re-apply it).
            await grantCredits({
              storeId: order.storeId,
              amount: order.credits,
              idemKey: `rzp:${payment.id}`,
              type: 'TOPUP',
              note: `Razorpay top-up · ${order.packId}`,
              actor: 'razorpay',
              plan: 'pro',
            });
            await ordersColl().doc(razorpayOrderId).update({ status: 'paid', paidAt: now(), paymentId: payment.id });
          } else {
            console.error('[razorpay] amount mismatch — NOT crediting:',
              { order: razorpayOrderId, expected: order.amountPaise, got: capturedPaise, currency: capturedCur });
          }
        }
      }
    }

    // Pro subscription: each monthly renewal (`subscription.charged`) grants
    // the monthly credit allowance + PRO, exactly once per payment. Cancels
    // and completions flip the subscription record (wallet plan stays until
    // the store actually runs out — a mid-cycle cancel keeps existing perks).
    if (payload.event === 'subscription.charged') {
      const sub = payload.payload?.subscription?.entity;
      const payment = payload.payload?.payment?.entity;
      const subId = sub?.id;
      const paymentId = payment?.id;
      if (subId && paymentId) {
        const subDoc = await subscriptionsColl().doc(subId).get();
        if (subDoc.exists) {
          const storeId = subDoc.data().storeId;
          await grantCredits({
            storeId,
            amount: SUBSCRIPTION_PLAN.monthlyCredits,
            idemKey: `sub:${paymentId}`,            // one grant per payment — replay-safe
            type: 'SUBGRANT',
            note: `Pro subscription · monthly credits`,
            actor: 'razorpay',
            plan: 'pro',
          });
          await subscriptionsColl().doc(subId).update({ status: 'active', updatedAt: now() });
        }
      }
    }

    if (payload.event === 'subscription.cancelled' || payload.event === 'subscription.completed') {
      const subId = payload.payload?.subscription?.entity?.id;
      if (subId) {
        await subscriptionsColl().doc(subId).update({
          status: payload.event === 'subscription.cancelled' ? 'cancelled' : 'completed',
          updatedAt: now(),
        }).catch((e) => console.error('[razorpay] sub status update failed:', e && e.message ? e.message : e));
      }
    }

    res.json({ ok: true, data: { received: true } });
  } catch (err) { next(err); }
});

/* ── owner console (requireAdmin: OWNER_EMAIL + unlock session) ────────── */

// GET /admin/stores — every store with its live wallet balance (admin console).
creditsRouter.get('/admin/stores', requireAdmin, async (req, res, next) => {
  try {
    const snap2 = await storesColl().limit(300).get();
    const stores = [];
    for (const doc of snap2.docs) {
      const s = snap(doc);
      const w = await getWallet(s.id).catch(() => null);
      stores.push({ ...s, balance: w?.balance ?? 0, plan: w?.plan || s.plan || 'free' });
    }
    stores.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ ok: true, data: { stores } });
  } catch (err) { next(err); }
});

// GET /admin/ledger — the global append-only credit stream (newest first).
creditsRouter.get('/admin/ledger', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 300);
    const snap2 = await globalLedgerColl().orderBy('ts', 'desc').limit(limit).get();
    res.json({ ok: true, data: { ledger: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

// POST /admin/credits — adjust a store's balance (grant or reverse).
// 🔒 requireAdmin = OWNER_EMAIL + passcode-issued session (see auth.js) —
//    NEVER just "signed in". Any authenticated user reaching this otherwise
//    could mint themselves unlimited credits.
creditsRouter.post('/admin/credits', requireAdmin, async (req, res, next) => {
  try {
    const body = adminAdjust(req.body || {});

    let storeId = body.storeId;
    if (!storeId && body.email) {
      // Look up the user's store via the ownerEmail we stamp at onboarding.
      const hit = await db.collection('stores').where('ownerEmail', '==', body.email).limit(1).get();
      if (hit.empty) throw notFound('No store for that email.');
      storeId = hit.docs[0].id;
    }
    const storeDoc = await storeRef(storeId).get();
    if (!storeDoc.exists) throw notFound('Store not found.');

    const idemKey = body.idemKey || `admin:${storeId}:${body.amount}:${body.note}`;
    let wallet;
    if (body.amount > 0) {
      wallet = await grantCredits({
        storeId, amount: body.amount, idemKey,
        type: 'GRANT', note: body.note, actor: `admin:${req.user.email}`,
      });
    } else {
      wallet = await refundCredits({
        storeId, amount: Math.abs(body.amount), idemKey,
        note: body.note, actor: `admin:${req.user.email}`,
      });
    }
    res.json({ ok: true, data: { storeId, wallet } });
  } catch (err) { next(err); }
});

// GET /admin/follow-ups — open low-balance/follow-up alerts for the team.
creditsRouter.get('/admin/follow-ups', requireAdmin, async (req, res, next) => {
  try {
    const snap2 = await adminAlertsColl().where('resolved', '==', false).orderBy('ts', 'desc').limit(200).get();
    res.json({ ok: true, data: { alerts: snap2.docs.map(snap) } });
  } catch (err) { next(err); }
});

// POST /admin/follow-ups/:id/resolve
creditsRouter.post('/admin/follow-ups/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    const ref = adminAlertsColl().doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) throw notFound('Alert not found.');
    await ref.update({ resolved: true, resolvedTs: now(), resolvedBy: req.user.email });
    res.json({ ok: true, data: { alert: snap(await ref.get()) } });
  } catch (err) { next(err); }
});

// GET /admin/jobs — AI jobs across ALL stores (newest first). Enriches each
// job with the store name for the admin console.
creditsRouter.get('/admin/jobs', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 60), 200);
    const snap2 = await db.collectionGroup('jobs').orderBy('createdAt', 'desc').limit(limit).get();
    const jobs = snap2.docs.map(snap);

    // Store names (one batched lookup via Promise.all — cheap at admin scale).
    const names = {};
    await Promise.all(jobs.map(async (j) => {
      if (!j.storeId || names[j.storeId]) return;
      const s = await storeRef(j.storeId).get().catch(() => null);
      if (s && s.exists) names[j.storeId] = s.data().name || j.storeId;
      else names[j.storeId] = j.storeId;
    }));
    res.json({ ok: true, data: { jobs: jobs.map((j) => ({ ...j, storeName: names[j.storeId] || j.storeId })) } });
  } catch (err) { next(err); }
});

// GET /admin/orders — Razorpay top-up orders + subscriptions (newest first).
creditsRouter.get('/admin/orders', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 60), 200);
    const [orders, subs] = await Promise.all([
      ordersColl().orderBy('createdAt', 'desc').limit(limit).get(),
      subscriptionsColl().orderBy('createdAt', 'desc').limit(limit).get(),
    ]);
    const items = [
      ...orders.docs.map((d) => ({ kind: 'order', ...snap(d) })),
      ...subs.docs.map((d) => ({ kind: 'subscription', ...snap(d) })),
    ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);

    const names = {};
    await Promise.all(items.map(async (it) => {
      if (!it.storeId || names[it.storeId]) return;
      const s = await storeRef(it.storeId).get().catch(() => null);
      if (s && s.exists) names[it.storeId] = s.data().name || it.storeId;
      else names[it.storeId] = it.storeId;
    }));
    res.json({ ok: true, data: { orders: items.map((it) => ({ ...it, storeName: names[it.storeId] || it.storeId })) } });
  } catch (err) { next(err); }
});

