/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Firestore (catalogue + ledger)
   ────────────────────────────────────────────────────────────────────────
   Layout (matches backend/schema/firestore.rules + indexes):
     users/{uid}                          profile (server-written)
     stores/{storeId}                     store profile + ownerUid/ownerEmail
       └ products/{productId}             catalogue (incl. drafts/pending)
       └ jobs/{jobId}                     async AI pipeline records
       └ ledger/{entryId}                 credit history (append-only)
       └ notifications/{nid}              in-app notifications
     wallets/{storeId}                    atomic credit balance
     credit_ops/{idemKey}                 exactly-once idempotency markers
     orders/{orderId}                     Razorpay top-up orders
     admin_alerts/{id}                    admin follow-up queue (low balance)
   Server SDK bypasses security rules (IAM governs it); rules only matter
   for direct client access, which the black-box deployment forbids.
   ════════════════════════════════════════════════════════════════════════ */

import { Firestore } from '@google-cloud/firestore';

/* Lazy singleton with optional override (used by the smoke test to inject
   explicit credentials — production uses Application Default Credentials). */
let _db;
const getDb = () => (_db ?? (() => { _db = new Firestore(); return _db; })());

export function overrideDb(instance) { _db = instance; }

export const db = new Proxy({}, {
  get(_t, prop) {
    const inst = getDb();
    const v = inst[prop];
    return typeof v === 'function' ? v.bind(inst) : v;
  },
});

export const now = () => Date.now();

export const storeRef = (storeId) => db.doc(`stores/${storeId}`);
export const storesColl = () => db.collection('stores');
export const productsColl = (storeId) => db.collection(`stores/${storeId}/products`);
export const jobsColl = (storeId) => db.collection(`stores/${storeId}/jobs`);
export const ledgerColl = (storeId) => db.collection(`stores/${storeId}/ledger`);
export const globalLedgerColl = () => db.collection('ledger_global');
export const notifsColl = (storeId) => db.collection(`stores/${storeId}/notifications`);
export const walletRef = (storeId) => db.doc(`wallets/${storeId}`);
export const opRef = (idemKey) => db.doc(`credit_ops/${idemKey}`);
export const ordersColl = () => db.collection('orders');
export const adminAlertsColl = () => db.collection('admin_alerts');
export const usersRef = (uid) => db.doc(`users/${uid}`);

/** Firestore documents → plain JSON (strip undefined, keep timestamps as-is). */
export const snap = (doc) => (doc.exists ? { id: doc.id, ...doc.data() } : null);
