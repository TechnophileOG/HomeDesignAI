/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — credit ledger (atomic, exactly-once)
   ────────────────────────────────────────────────────────────────────────
   Credits are financial-ish state, so every mutation runs inside a
   Firestore TRANSACTION together with an idempotency marker
   (`credit_ops/{idemKey}`, created inside the same transaction). The marker
   gives EXACTLY-ONCE semantics: retrying a job reservation, a doubled
   webhook delivery or a double-tap can never double-charge or double-grant.
   Balance updates use read-then-write inside the transaction (serializable),
   so concurrent reserves cannot race into a negative balance.

   Mirrors the Cloud SQL reference schema (backend/schema/cloudsql/schema.sql)
   1:1 — if Cloud SQL is unblocked later, swap these four functions behind
   the same signatures and nothing else in the API changes.
   ════════════════════════════════════════════════════════════════════════ */

import { db, walletRef, ledgerColl, globalLedgerColl, opRef } from './db.js';
import { insufficientCredits } from './errors.js';

const DEFAULT_PLAN = 'free';

/** Run `fn(tx)` exactly once per idemKey; replay the recorded result after. */
async function runIdempotent(idemKey, fn) {
  const ref = opRef(idemKey);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return existing.data().result; // already applied → replay
    const result = await fn(tx);
    // tx.create — NOT tx.set — makes the marker claim atomic. If a concurrent
    // transaction created the same marker first, our commit aborts, Firestore
    // auto-retries (maxAttempts), and the retry sees `existing.exists` and
    // replays. A marker can never be half-written (transactions commit
    // atomically), so `exists` ⇒ `done`. This closes the check-then-write
    // race on the idempotency key.
    tx.create(ref, { idemKey, done: true, result, ts: Date.now() });
    return result;
  });
}

async function getWalletData(storeId) {
  const doc = await walletRef(storeId).get();
  if (!doc.exists) return { storeId, balance: 0, plan: DEFAULT_PLAN, ts: null };
  return doc.data();
}

/** Read the current balance (no mutation). */
export async function getWallet(storeId) {
  return getWalletData(storeId);
}

/** Idempotently grant credits (welcome bonus, top-up, gift, admin adjust).
    `plan` (optional) upgrades the wallet tier inside the SAME transaction and
    idempotency marker as the credit grant — a paid top-up can atomically flip
    the store to PRO, and a replayed webhook can never apply it twice. */
export async function grantCredits({ storeId, amount, idemKey, note = '', actor = 'system', plan = null }) {
  if (!(amount > 0)) throw new Error('grant amount must be positive');
  return runIdempotent(idemKey, async (tx) => {
    const ref = walletRef(storeId);
    const doc = await tx.get(ref);
    if (!doc.exists) {
      tx.set(ref, { storeId, balance: 0, plan: DEFAULT_PLAN, createdAt: Date.now(), updatedAt: Date.now() });
    }
    const before = doc.exists ? doc.data().balance : 0;
    const balance = before + amount;
    const update = { balance, updatedAt: Date.now() };
    if (plan) update.plan = plan;
    tx.update(ref, update);
    writeLedger(tx, storeId, {
      type: 'GRANT', amount, balanceAfter: balance, referenceType: 'GRANT',
      referenceId: idemKey, note, actor,
    });
    return { storeId, balance, plan: plan || (doc.exists ? doc.data().plan : DEFAULT_PLAN) };
  });
}

/** Idempotently reserve credits. Throws INSUFFICIENT_CREDITS (402) if broke. */
export async function reserveCredits({ storeId, amount, idemKey, refType = 'JOB', note = '' }) {
  if (!(amount > 0)) throw new Error('reserve amount must be positive');
  return runIdempotent(idemKey, async (tx) => {
    const ref = walletRef(storeId);
    const doc = await tx.get(ref);
    if (!doc.exists) throw insufficientCredits(0);
    const before = doc.data().balance;
    if (before < amount) throw insufficientCredits(before);
    const balance = before - amount;
    tx.update(ref, { balance, updatedAt: Date.now() });
    writeLedger(tx, storeId, {
      type: 'CONSUME', amount, balanceAfter: balance, referenceType: refType,
      referenceId: idemKey, note, actor: 'system',
    });
    return { storeId, balance };
  });
}

/** Idempotently refund reserved credits (job failure / manual reversal). */
export async function refundCredits({ storeId, amount, idemKey, note = '', actor = 'system' }) {
  if (!(amount > 0)) throw new Error('refund amount must be positive');
  return runIdempotent(idemKey, async (tx) => {
    const ref = walletRef(storeId);
    const doc = await tx.get(ref);
    if (!doc.exists) tx.set(ref, { storeId, balance: 0, plan: DEFAULT_PLAN, createdAt: Date.now(), updatedAt: Date.now() });
    const before = doc.exists ? doc.data().balance : 0;
    const balance = before + amount;
    tx.update(ref, { balance, updatedAt: Date.now() });
    writeLedger(tx, storeId, {
      type: 'REFUND', amount, balanceAfter: balance, referenceType: 'REFUND',
      referenceId: idemKey, note, actor,
    });
    return { storeId, balance };
  });
}

/* ── Global mirror ──────────────────────────────────────────────────────
   Every ledger entry is ALSO written to ledger_global inside the same
   transaction, so admins can read one append-only stream across all stores
   (no collection-group index needed). Replays are safe: runIdempotent
   never re-runs fn(), so a retried op can't duplicate rows.             */

function writeLedger(tx, storeId, row) {
  const ref = ledgerColl(storeId).doc();
  const entry = { ...row, storeId, ts: Date.now() };
  tx.set(ref, entry);
  tx.set(globalLedgerColl().doc(ref.id), entry);
}

/** Recent ledger history for a store, newest first. */
export async function listLedger(storeId, limit = 50) {
  const cap = Math.min(Math.max(1, limit), 200);
  const snap = await ledgerColl(storeId).orderBy('ts', 'desc').limit(cap).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
