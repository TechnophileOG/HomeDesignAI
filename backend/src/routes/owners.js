/* ── shared store-ownership guard ──────────────────────────────────────
   A user may only read/write stores where stores/{storeId}.ownerUid === uid.
   Foreign ids look identical to missing ones (404) — no existence oracle. */
import { storeRef } from '../db.js';
import { notFound } from '../errors.js';
import { id as cleanId } from '../validate.js';

export async function requireStoreOwner(req, _res, next) {
  try {
    // The param is attacker-controlled — validate before touching Firestore.
    const storeId = cleanId(req.params.storeId, { max: 48, label: 'store id' });
    const doc = await storeRef(storeId).get();
    if (!doc.exists || doc.data().ownerUid !== req.user.uid) throw notFound('Store not found.');
    req.store = { id: storeId, ...doc.data() };
    next();
  } catch (err) { next(err); }
}
