/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — input validation & sanitisation
   ────────────────────────────────────────────────────────────────────────
   EVERY field that comes from a client passes through here. Rules:
     • strict types (string/number/bool) — wrong type ⇒ 400
     • control chars / null bytes stripped or rejected
     • hard length caps on every string
     • enums/allowlists for anything with a known domain
     • object keys are WHITELISTED — unknown keys are dropped (this is the
       real defence against prototype pollution and smuggling)
   ════════════════════════════════════════════════════════════════════════ */

import { badRequest } from './errors.js';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const fail = (label) => { throw badRequest('INVALID_FIELD', `Invalid ${label}.`); };

/* ── scalars ─────────────────────────────────────────────────────────── */

/** Required non-empty string, trimmed, control-chars removed, length-capped. */
export const s = (v, { max = 200, label = 'value' } = {}) => {
  if (typeof v !== 'string') fail(label);
  const clean = v.replace(CONTROL_CHARS, '').trim();
  if (!clean) fail(label);
  if (clean.length > max) fail(label);
  return clean;
};

/** Optional string — undefined/null → undefined, else same rules as s(). */
export const so = (v, { max = 200, label = 'value' } = {}) =>
  (v === undefined || v === null) ? undefined : s(v, { max, label });

/** Identifier: safe charset, no slashes/dots/quotes, length cap. */
export const id = (v, { max = 64, label = 'id' } = {}) => {
  const clean = s(v, { max, label });
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) fail(label);
  return clean;
};

export const email = (v, { max = 120, label = 'email' } = {}) => {
  const clean = s(v, { max, label }).toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(clean)) fail(label);
  return clean;
};

export const phone = (v, { label = 'phone' } = {}) => {
  const clean = s(v, { max: 15, label }).replace(/[^0-9+]/g, '');
  if (!/^\+?[0-9]{6,15}$/.test(clean)) fail(label);
  return clean;
};

export const int = (v, { min = 0, max = Number.MAX_SAFE_INTEGER, label = 'number' } = {}) => {
  if (!Number.isInteger(v) || v < min || v > max) fail(label);
  return v;
};

export const num = (v, { min = 0, max = Number.MAX_SAFE_INTEGER, decimals = 2, label = 'number' } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(label);
  return Math.round(v * 10 ** decimals) / 10 ** decimals;
};

export const bool = (v, { label = 'value' } = {}) => {
  if (typeof v !== 'boolean') fail(label);
  return v;
};

export const oneOf = (v, allowlist, { label = 'value' } = {}) => {
  if (!Array.isArray(allowlist) || !allowlist.includes(v)) fail(label);
  return v;
};

/** String array with per-item + total caps and dedupe. */
export const strArr = (v, { itemMax = 40, maxItems = 20, label = 'list' } = {}) => {
  if (!Array.isArray(v) || v.length > maxItems) fail(label);
  const out = [];
  for (const item of v) {
    const clean = so(item, { max: itemMax, label });
    if (clean !== undefined && !out.includes(clean)) out.push(clean);
  }
  return out;
};

/* ── domain-specific ──────────────────────────────────────────────────── */

export const IMAGE_CONTENT_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/avif',
];

/** Upload file name: simple safe name, no slashes, no dot-dot, no spaces. */
export const fileName = (v, { label = 'fileName' } = {}) => {
  const clean = s(v, { max: 120, label });
  if (!/^[A-Za-z0-9._-]+$/.test(clean) || clean.includes('..')) fail(label);
  return clean;
};

/** Storage object path: must live under stores/{storeId}/..., image extension only. */
export const objectPath = (v, { label = 'path' } = {}) => {
  const clean = s(v, { max: 240, label });
  if (!/^stores\/[A-Za-z0-9_-]+\/[A-Za-z0-9_/.-]+\.(jpe?g|png|webp|heic|heif|avif)$/.test(clean)) fail(label);
  if (clean.includes('..')) fail(label);
  return clean;
};

/**
 * Storage object path SCOPED to a specific store: the path must live under
 * stores/{storeId}/... This is the ONLY variant used for client-supplied
 * photo references (product flatLay/gallery/aiResults, job photoPath). A
 * generic path check would let a user reference ANOTHER store's photo — the
 * GPU worker then fetches it with service-account-signed URLs, bypassing
 * storage rules (cross-tenant data exposure).
 */
export const objectPathFor = (v, storeId, { label = 'path' } = {}) => {
  const clean = objectPath(v, { label });
  if (!clean.startsWith(`stores/${storeId}/`)) fail(label);
  return clean;
};

export const priceStr = (v, { label = 'price' } = {}) => {
  const clean = s(v, { max: 12, label });
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(clean)) fail(label);
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0 || n > 100000000) fail(label);
  return clean;
};

const AI_SPEC_KEYS = ['title', 'description', 'priceSuggestion', 'category',
  'colors', 'sizes', 'material', 'fit', 'care', 'model', 'style', 'occasions', 'tags'];

/** AI-generated spec — whitelisted keys only, capped strings. */
export const aiSpecs = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) fail('aiSpecs');
  const out = {};
  for (const key of AI_SPEC_KEYS) {
    const val = v[key];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) out[key] = strArr(val, { itemMax: 60, maxItems: 30, label: key });
    else if (typeof val === 'string') out[key] = s(val, { max: 500, label: key });
    else if (typeof val === 'number') out[key] = num(val, { label: key });
  }
  return Object.keys(out).length ? out : undefined;
};

/** Photo reference {path, contentType, size} — used inside products. */
const photoRef = (v, storeId) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('photo');
  return {
    path: storeId ? objectPathFor(v.path, storeId) : objectPath(v.path),
    contentType: oneOf(v.contentType, IMAGE_CONTENT_TYPES, { label: 'contentType' }),
    size: int(v.size ?? 0, { min: 0, max: 40 * 1024 * 1024, label: 'size' }),
  };
};

const PRODUCT_KEYS = ['id', 'title', 'description', 'category', 'price', 'qty',
  'status', 'flatLay', 'gallery', 'aiResults', 'aiSpecs', 'modelId', 'note',
  'savedAt', 'createdAt', 'updatedAt', 'tags', 'barcode', 'sku'];

/** Full product sanitizer — whitelisted keys only. Returns a clean object.
    Pass `storeId` to scope every photo reference to that store (closes
    cross-tenant object-path references). */
export const product = (raw, storeId) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('product');
  const out = {};
  for (const key of PRODUCT_KEYS) {
    if (raw[key] === undefined) continue;
    switch (key) {
      case 'id':            out.id = id(raw[key], { max: 64, label: 'product id' }); break;
      case 'title':         out.title = s(raw[key], { max: 120, label: 'title' }); break;
      case 'description':   out.description = s(raw[key], { max: 1500, label: 'description' }); break;
      case 'category':      out.category = s(raw[key], { max: 60, label: 'category' }); break;
      case 'price':         out.price = priceStr(raw[key]); break;
      case 'qty':           out.qty = int(raw[key], { min: 0, max: 1000000, label: 'qty' }); break;
      case 'status':        out.status = oneOf(raw[key],
        ['pending_approve', 'pending_retake', 'draft', 'live'], { label: 'status' }); break;
      case 'flatLay':       out.flatLay = photoRef(raw[key], storeId); break;
      case 'gallery':       if (Array.isArray(raw[key])) out.gallery = raw[key].slice(0, 30).map((g) => photoRef(g, storeId)); break;
      case 'aiResults':     if (Array.isArray(raw[key])) out.aiResults = raw[key].slice(0, 30).map((g) => photoRef(g, storeId)); break;
      case 'aiSpecs':       { const sp = aiSpecs(raw[key]); if (sp) out.aiSpecs = sp; break; }
      case 'modelId':       out.modelId = so(raw[key], { max: 20, label: 'modelId' }); break;
      case 'note':          out.note = so(raw[key], { max: 300, label: 'note' }); break;
      case 'savedAt':       out.savedAt = so(raw[key], { max: 40, label: 'savedAt' }); break;
      case 'createdAt':     out.createdAt = so(raw[key], { max: 40, label: 'createdAt' }); break;
      case 'updatedAt':     out.updatedAt = so(raw[key], { max: 40, label: 'updatedAt' }); break;
      case 'tags':          out.tags = strArr(raw[key], { itemMax: 40, maxItems: 30, label: 'tags' }); break;
      case 'barcode':       out.barcode = so(raw[key], { max: 40, label: 'barcode' }); break;
      case 'sku':           out.sku = so(raw[key], { max: 40, label: 'sku' }); break;
      default: break;
    }
  }
  return out;
};

/** Partial update — like product() but allows a missing id. */
export const productPatch = (raw, storeId) => {
  const clean = product(raw, storeId);
  delete clean.id; // id is immutable — patched via the URL only
  return clean;
};

const STORE_KEYS = ['id', 'name', 'city', 'categories', 'scale', 'aiFeatures',
  'salesChannel', 'yearsInBusiness', 'inventoryTurnover', 'hasInventorySystem',
  'orderValue', 'brandStyle', 'storeType'];

/** Store profile — plan/status/balance are SERVER-MANAGED and never accepted. */
export const store = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('store');
  const out = {};
  for (const key of STORE_KEYS) {
    if (raw[key] === undefined) continue;
    switch (key) {
      case 'id':            out.id = id(raw[key], { max: 48, label: 'store id' }); break;
      case 'name':          out.name = s(raw[key], { max: 60, label: 'store name' }); break;
      case 'city':          out.city = s(raw[key], { max: 40, label: 'city' }); break;
      case 'categories':    out.categories = strArr(raw[key], { itemMax: 40, maxItems: 20, label: 'categories' }); break;
      case 'aiFeatures':    out.aiFeatures = strArr(raw[key], { itemMax: 40, maxItems: 20, label: 'aiFeatures' }); break;
      case 'salesChannel':  out.salesChannel = so(raw[key], { max: 40, label: 'salesChannel' }); break;
      case 'yearsInBusiness': out.yearsInBusiness = so(raw[key], { max: 20, label: 'yearsInBusiness' }); break;
      case 'inventoryTurnover': out.inventoryTurnover = so(raw[key], { max: 40, label: 'inventoryTurnover' }); break;
      case 'hasInventorySystem': out.hasInventorySystem = bool(raw[key], { label: 'hasInventorySystem' }); break;
      case 'orderValue':    out.orderValue = so(raw[key], { max: 40, label: 'orderValue' }); break;
      case 'brandStyle':    out.brandStyle = so(raw[key], { max: 40, label: 'brandStyle' }); break;
      case 'storeType':     out.storeType = so(raw[key], { max: 40, label: 'storeType' }); break;
      case 'scale':         out.scale = oneOf(raw[key], ['starter', 'small', 'growing', 'large'], { label: 'scale' }); break;
      default: break;
    }
  }
  return out;
};

/** Job creation body. Pass `storeId` to scope the optional photoPath. */
export const jobCreate = (raw, storeId) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('job');
  return {
    type: oneOf(raw.type, ['model_shoot', 'regen_shot', 'full_regen', 'retake'], { label: 'job type' }),
    productId: id(raw.productId, { max: 64, label: 'product id' }),
    photoPath: raw.photoPath === undefined ? undefined
      : (storeId ? objectPathFor(raw.photoPath, storeId) : objectPath(raw.photoPath)),
  };
};

/** Top-up order body. */
export const orderCreate = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('order');
  return { packId: id(raw.packId, { max: 24, label: 'packId' }) };
};

/** Admin credit adjustment body. */
export const adminAdjust = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('adjustment');
  const out = {};
  if (raw.storeId !== undefined) out.storeId = id(raw.storeId, { max: 48, label: 'store id' });
  if (raw.email !== undefined) out.email = email(raw.email);
  if (!out.storeId && !out.email) fail('storeId or email');
  out.amount = num(raw.amount, { min: -1000000, max: 1000000, label: 'amount' });
  if (out.amount === 0) fail('amount');
  out.note = so(raw.note, { max: 200, label: 'note' }) || 'Admin adjustment';
  out.idemKey = so(raw.idemKey, { max: 80, label: 'idemKey' });
  return out;
};

/** Landing-page lead body (public form — sanitize hard, honeypot checked in route). */
export const lead = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('lead');
  return {
    name: s(raw.name, { max: 80, label: 'name' }),
    phone: phone(raw.phone, { label: 'phone' }),
    email: email(raw.email),
    products: so(raw.products, { max: 40, label: 'products' }) || '',
    platform: so(raw.platform, { max: 30, label: 'platform' }) || '',
  };
};

/** Marketplaces a seller can connect (drives platform priority + publishing). */
export const PLATFORM_NAMES = ['amazon', 'flipkart', 'meesho', 'myntra', 'alibaba'];

/** CSV/Excel export body — which platform's bulk-upload format to render.
    The file content is derived server-side from the product (never free-form
    from the client); this field only picks the template. */
export const exportRequest = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('export');
  return {
    platform: oneOf(raw.platform, PLATFORM_NAMES, { label: 'platform' }),
  };
};

/** Notification creation body. */
export const notification = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('notification');
  return {
    type: oneOf(raw.type, ['low_balance', 'follow_up', 'system', 'job'], { label: 'type' }),
    message: s(raw.message, { max: 300, label: 'message' }),
    balance: num(raw.balance ?? 0, { min: 0, max: 100000000, label: 'balance' }),
  };
};
