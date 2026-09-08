/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — Data Layer (real API)
   ────────────────────────────────────────────────────────────────────────────
   The single frontend↔backend client. Every call carries a fresh Firebase
   ID token (Bearer) and hits the Cloud Run API. There is NO localStorage
   inventory/credit state anymore:
     • products/pending → Firestore via the API (per-user, ownership-guarded)
     • wallet/ledger     → server-managed — the UI can never mint credits
     • admin data        → owner-console endpoints (OWNER_EMAIL + unlock session)
   The only localStorage left is the session cache (uid + last-known data),
   which exists purely so the app can gate rendering instantly on reload.

   Photo storage: the API hands out short-lived signed PUT URLs; the browser
   uploads the photo bytes straight to GCS, then references the object path.
   ════════════════════════════════════════════════════════════════════════════ */

import {
  sanitizeProfile,
  sanitizeText, sanitizeInt, sanitizeId, sanitizeNote, sanitizeEmail,
} from './sanitize';

export const API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) ||
  'https://katalogit-api-787935596465.asia-south1.run.app/api/v1';

export const GCS_BASE = 'https://storage.googleapis.com';
export const ORIGINALS_BUCKET = 'katalogit-originals';
export const PROCESSED_BUCKET = 'katalogit-processed';

const SESSION_KEY = 'kat_auth_v1';
const ADMIN_SESSION_KEY = 'kat_admin_session_v1'; // owner console unlock (short-lived)

/* ── Owner-console unlock session (short-lived, tab-scoped) ───────────────
   Unlike the auth cache, this is kept in sessionStorage (dies with the tab)
   and is a short-TTL token the SERVER re-verifies on every admin call — the
   client never trusts its presence as proof of access. */
const readAdminSession = () => {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const writeAdminSession = (token) => {
  try { sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({ token })); } catch { /* noop */ }
};
const clearAdminSession = () => {
  try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* noop */ }
};

/* ── Credit pricing (display only — the server is the source of truth) ──── */
export const CREDIT_PRICING = {
  model_shoot: 3,
  regen_shot: 1,
  full_regen: 3,
  retake: 1,
};

export const LOW_BALANCE_SHOOT_THRESHOLD = 3; // shoots
export const lowBalanceThresholdCredits = () =>
  CREDIT_PRICING.model_shoot * LOW_BALANCE_SHOOT_THRESHOLD;

/* ── session cache ──────────────────────────────────────────────────────── */
const readSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const writeSession = (s) => {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* noop */ }
};

/** This user's store id — mirrors the server derivation (store-{uid8}). */
export const getCurrentStoreId = () => {
  const s = readSession();
  return s?.uid ? `store-${s.uid.slice(0, 8)}` : '';
};

let tokenGetter = null;
/** auth.js injects a fresh-ID-token getter here (avoids a circular import). */
export const setTokenGetter = (fn) => { tokenGetter = fn; };

async function authToken() {
  // The ONLY source of ID tokens is the Firebase SDK (auth.js injects a
  // fresh-token getter). We deliberately do NOT persist tokens in
  // localStorage — a stored token is a broader XSS blast radius and can go
  // stale; the SDK handles refresh + storage in its own secure store.
  if (tokenGetter) {
    const t = await tokenGetter();
    if (t) return t;
  }
  return '';
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, timeout = 30000 } = {}) {
  const token = await authToken();
  const admin = readAdminSession();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // owner-console unlock token — only sent on admin routes
        ...(path.startsWith('/admin') && admin?.token ? { 'x-admin-session': admin.token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError('Network error — check your connection.', 'NETWORK', 0);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    // A stale/expired unlock session is not a real error — drop it so the
    // next admin action asks the owner to unlock again.
    if (path.startsWith('/admin') && res.status === 403) clearAdminSession();
    throw new ApiError(
      json?.error?.message || `Request failed (${res.status}).`,
      json?.error?.code || 'ERROR',
      res.status,
    );
  }
  return json?.data ?? {};
}

/* ── photo display helpers ──────────────────────────────────────────────── */
export const photoUrl = (path) => {
  if (!path) return '';
  // flat-lay (owner uploads) and live-session captures live in the originals
  // bucket; everything else (AI results) in the processed bucket.
  const bucket = /\/(flat_lay|sessions)\//.test(String(path)) ? ORIGINALS_BUCKET : PROCESSED_BUCKET;
  return `${GCS_BASE}/${bucket}/${path}`;
};

export const dataUrlToBlob = (dataUrl) => {
  const [meta, b64] = String(dataUrl || '').split(',');
  const mime = (String(meta).match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
};

/* ── server ⇄ UI mappers ────────────────────────────────────────────────── */
const toUiProduct = (p) => {
  const flat = p?.flatLay?.path;
  const gallery = Array.isArray(p?.gallery) ? p.gallery.map((g) => photoUrl(g.path)).filter(Boolean) : [];
  return {
    id: p.id,
    title: p.title || 'Untitled product',
    price: p.price ? `₹${Number(p.price).toLocaleString('en-IN')}` : '',
    category: p.category || '',
    image: flat ? photoUrl(flat) : '',
    backImage: '',
    aiImage: gallery[0] || (flat ? photoUrl(flat) : ''),
    gallery,
    aiSpecs: p.aiSpecs || null,
    status: p.status || 'pending_approve',
    qty: p.qty || 0,
    modelId: p.modelId || '',
    isDraft: p.status === 'draft',
    savedAt: p.savedAt || '',
  };
};

const toServerPatch = (p) => {
  const out = {};
  if (p.title !== undefined) out.title = sanitizeText(p.title, 120) || 'Untitled product';
  if (p.category !== undefined) out.category = sanitizeText(p.category, 60);
  if (p.price !== undefined) {
    const digits = String(p.price).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    if (digits && digits.length <= 12) out.price = digits;
  }
  if (p.qty !== undefined) out.qty = sanitizeInt(p.qty, { min: 0, max: 1000000, fallback: 0 });
  if (p.status !== undefined) {
    out.status = ['pending_approve', 'pending_retake', 'draft', 'live'].includes(p.status) ? p.status : 'pending_approve';
  }
  if (p.note !== undefined) out.note = sanitizeNote(p.note, 300);
  if (p.barcode !== undefined) out.barcode = sanitizeText(p.barcode, 40);
  if (p.sku !== undefined) out.sku = sanitizeText(p.sku, 40);
  if (p.flatLay && typeof p.flatLay === 'object') {
    out.flatLay = {
      path: String(p.flatLay.path || '').slice(0, 240),
      contentType: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif']
        .includes(p.flatLay.contentType) ? p.flatLay.contentType : 'image/jpeg',
      size: sanitizeInt(p.flatLay.size, { max: 40 * 1024 * 1024, fallback: 0 }),
    };
  }
  return out;
};

const toUiLedger = (e) => ({
  id: e.id,
  storeId: e.storeId || '',
  storeName: e.storeName || '',
  type: String(e.type || 'grant').toLowerCase(),
  amount: typeof e.amount === 'number' ? e.amount : 0,
  note: e.note || '',
  actor: e.actor || 'system',
  ts: new Date(e.ts || Date.now()).toISOString(),
});

const toUiAdminStore = (s) => ({
  id: s.id,
  storeName: s.name || s.storeName || 'My Store',
  city: s.city || '',
  plan: String(s.plan || 'free').toUpperCase(),
  balance: typeof s.balance === 'number' ? s.balance : 0,
  lastActive: new Date(s.updatedAt || s.createdAt || Date.now()).toISOString(),
});

const toUiBanner = (b) => ({
  id: b.id,
  title: b.title || '',
  subtitle: b.subtitle || '',
  badge: b.badge || '',
  ctaText: b.ctaText || '',
  ctaUrl: b.ctaUrl || '',
  theme: [1, 2, 3].includes(b.theme) ? b.theme : 1,
  enabled: !!b.enabled,
  order: typeof b.order === 'number' ? b.order : 100,
  createdAt: b.createdAt || 0,
  updatedAt: b.updatedAt || 0,
});

const toUiAnnouncement = (a) => ({
  id: a.id,
  title: a.title || '',
  message: a.message || '',
  type: ['info', 'promo', 'maintenance'].includes(a.type) ? a.type : 'info',
  enabled: !!a.enabled,
  expiresAt: a.expiresAt || 0,
  createdAt: a.createdAt || 0,
});

/** Admin banner form → server payload (whitelisted, length-capped). */
const sanitizeBannerForServer = (b = {}) => {
  const out = {
    title: sanitizeText(b.title, 80),
    subtitle: sanitizeText(b.subtitle, 200),
    badge: sanitizeText(b.badge, 30),
    ctaText: sanitizeText(b.ctaText, 40),
    ctaUrl: sanitizeText(b.ctaUrl, 300),
    theme: [1, 2, 3].includes(b.theme) ? b.theme : 1,
    enabled: Boolean(b.enabled),
    order: sanitizeInt(b.order, { min: 0, max: 1000, fallback: 100 }),
  };
  if (!/^https?:\/\/[^\s<>"']+$/.test(out.ctaUrl) && !out.ctaUrl.startsWith('/')) out.ctaUrl = '';
  return out;
};

/** Admin announcement form → server payload. */
const sanitizeAnnouncementForServer = (a = {}) => {
  const out = {
    title: sanitizeText(a.title, 100),
    message: sanitizeText(a.message, 500),
    type: ['info', 'promo', 'maintenance'].includes(a.type) ? a.type : 'info',
    enabled: Boolean(a.enabled),
  };
  if (Number.isFinite(Number(a.expiresAt)) && Number(a.expiresAt) > 0) out.expiresAt = sanitizeInt(a.expiresAt, { min: 0, max: 4102444800000, fallback: 0 });
  return out;
};

const toUiAlert = (a) => ({
  id: a.id,
  storeId: a.storeId || '',
  storeName: a.storeName || 'My Store',
  type: a.type || 'low_balance',
  message: a.message || '',
  balance: typeof a.balance === 'number' ? a.balance : 0,
  ts: new Date(a.ts || Date.now()).toISOString(),
  resolved: !!a.resolved,
  resolvedTs: a.resolvedTs ? new Date(a.resolvedTs).toISOString() : '',
});

/* ════════════════════════════════════════════════════════════════════════════
   The API
   ════════════════════════════════════════════════════════════════════════════ */
export const api = {
  /* ── Session (local cache only — auth lives in Firebase) ─────────────── */

  /* ── Owner console: unlock / lock / state ───────────────────────────────
     Unlock proves ownership of the admin passcode and returns a short-lived
     signed token. The SERVER is the source of truth — hasAdminSession() is
     only a local hint so the UI can show the lock screen without a round-
     trip; every admin call re-verifies the token server-side. */
  async adminUnlock(passcode) {
    const data = await request('/admin/unlock', { method: 'POST', body: { passcode }, timeout: 15000 });
    if (data.token) writeAdminSession(data.token);
    return data;
  },
  adminLock() { clearAdminSession(); },
  hasAdminSession() { return !!readAdminSession()?.token; },

  async getSession() { return readSession(); },
  async saveSession(session) {
    // NOTE: no `token` field is persisted — ID tokens live only in the
    // Firebase SDK (see authToken()). The cache holds identity for instant
    // render-gating; the server re-verifies on every call.
    writeSession({
      uid: String(session?.uid || '').slice(0, 64),
      name: String(session?.name || '').slice(0, 60),
      phone: String(session?.phone || '').slice(0, 15),
      email: String(session?.email || '').toLowerCase().slice(0, 120),
      emailVerified: Boolean(session?.emailVerified),
      isAdmin: Boolean(session?.isAdmin),
      createdAt: session?.createdAt || new Date().toISOString(),
      expiresAt: session?.expiresAt || new Date().toISOString(),
    });
    return session;
  },
  async clearSession() { localStorage.removeItem(SESSION_KEY); },

  /* ── Bootstrap (one hydration pass) ──────────────────────────────────── */
  async bootstrap() {
    const me = await request('/me');
    // Source of truth is the SERVER: a not-yet-onboarded user has no store
    // (storeId = ''), so all store-scoped calls are skipped instead of 404ing.
    const storeId = me.store?.id || '';
    const isAdmin = !!me.user?.isAdmin;
    const s = readSession();
    if (s) {
      writeSession({
        ...s,
        isAdmin,
        name: me.user?.name || s.name,
        email: me.user?.email || s.email,
        // server is the source of truth for verification state
        emailVerified: Boolean(me.user?.emailVerified),
      });
    }
    const [products, allProducts, credits, ledger, adminStores, alerts, leads] = await Promise.all([
      storeId ? this.listProducts('live') : Promise.resolve([]),
      storeId ? this.listProducts() : Promise.resolve([]),
      storeId ? this.getCredits(storeId) : Promise.resolve({ balance: 0, plan: 'free' }),
      storeId ? this.getLedger(storeId) : Promise.resolve([]),
      // Admin data is fetched ONLY when the owner has a valid unlock session
      // — otherwise these 403 and the console stays locked.
      isAdmin && this.hasAdminSession() ? this.adminGetStores() : Promise.resolve([]),
      isAdmin && this.hasAdminSession() ? this.adminFollowUps() : Promise.resolve([]),
      isAdmin && this.hasAdminSession() ? this.adminGetLeads() : Promise.resolve([]),
    ]);
    const pending = allProducts.filter(
      (p) => ['pending_approve', 'pending_retake', 'draft'].includes(p.status),
    );
    return {
      user: me.user,
      store: me.store,
      onboarded: !!me.onboarded,
      isAdmin,
      wallet: { id: storeId, balance: credits.balance, plan: credits.plan },
      products: products.map(toUiProduct),
      pending: pending.map(toUiProduct),
      ledger,
      stores: isAdmin ? adminStores : (me.store ? [toUiAdminStore({ ...me.store, balance: credits.balance })] : []),
      alerts,
      leads,
    };
  },

  /* ── Onboarding ──────────────────────────────────────────────────────── */
  async onboard(profile) {
    const clean = sanitizeProfile(profile);
    const data = await request('/stores', {
      method: 'POST',
      body: {
        name: clean.storeName,
        city: clean.city,
        pin: clean.pin,
        location: clean.location,
        categories: clean.categories,
        scale: clean.scale,
        aiFeatures: clean.aiFeatures,
        salesChannel: clean.salesChannel,
        storeType: clean.storeType,
        yearsInBusiness: clean.yearsInBusiness,
        inventoryTurnover: clean.inventoryTurnover,
        hasInventorySystem: clean.hasInventorySystem,
        orderValue: clean.orderValue,
        brandStyle: clean.brandStyle,
      },
    });
    return { store: data.store, wallet: data.wallet };
  },

  /* ── Profile (the store doc) ─────────────────────────────────────────── */
  async getProfile() {
    const me = await request('/me');
    return me.store || null;
  },
  async saveProfile(profile) {
    const clean = sanitizeProfile(profile);
    const storeId = getCurrentStoreId();
    if (!storeId) return clean;
    const data = await request(`/stores/${storeId}`, {
      method: 'PATCH',
      body: {
        name: clean.storeName,
        city: clean.city,
        pin: clean.pin,
        location: clean.location,
        categories: clean.categories,
        scale: clean.scale,
        aiFeatures: clean.aiFeatures,
      },
    });
    return data.store || clean;
  },

  /* ── Password reset (rate-limited server-side — see the public route) ── */
  async sendPasswordResetEmail(email, continueUrl = '') {
    // Public endpoint: works without a session. The server rate-limits per
    // IP AND per email (3/hr IP, 2/hr email) and replies generically — no
    // account enumeration, no way to spam reset emails. The continue URL
    // (validated server-side) sends the user back to /app after resetting.
    await request('/public/auth/reset-email', {
      method: 'POST',
      body: { email: sanitizeEmail(email), ...(continueUrl ? { continueUrl } : {}) },
      timeout: 15000,
    });
  },

  /* ── Products (live catalogue) ───────────────────────────────────────── */
  async getProducts() {
    const storeId = getCurrentStoreId();
    if (!storeId) return [];
    return (await this.listProducts('live')).map(toUiProduct);
  },
  async listProducts(status) {
    const storeId = getCurrentStoreId();
    if (!storeId) return [];
    const q = status ? `?status=${status}` : '';
    const data = await request(`/stores/${storeId}/products${q}`);
    return data.products || [];
  },
  async createProduct(payload) {
    const storeId = getCurrentStoreId();
    const clean = {
      title: sanitizeText(payload.title, 120) || 'Untitled product',
      category: sanitizeText(payload.category, 60) || 'Apparel',
      status: ['pending_approve', 'draft', 'live', 'pending_retake'].includes(payload.status)
        ? payload.status : 'pending_approve',
    };
    if (payload.flatLay) clean.flatLay = {
      path: payload.flatLay.path,
      contentType: payload.flatLay.contentType,
      size: sanitizeInt(payload.flatLay.size, { max: 40 * 1024 * 1024, fallback: 0 }),
    };
    const data = await request(`/stores/${storeId}/products`, { method: 'POST', body: clean });
    return data.product;
  },
  async patchProduct(productId, patch) {
    const storeId = getCurrentStoreId();
    const clean = toServerPatch(patch);
    if (Object.keys(clean).length === 0) return null;
    const data = await request(`/stores/${storeId}/products/${productId}`, { method: 'PATCH', body: clean });
    return data.product || null;
  },
  async deleteProduct(productId) {
    const storeId = getCurrentStoreId();
    await request(`/stores/${storeId}/products/${productId}`, { method: 'DELETE', timeout: 15000 });
  },

  /* ── Pending queue ───────────────────────────────────────────────────── */
  async getPending() {
    const storeId = getCurrentStoreId();
    if (!storeId) return [];
    const [all, jobs] = await Promise.all([this.listProducts(), this.listJobs()]);
    const jobByProduct = {};
    for (const j of jobs) {
      if (!jobByProduct[j.productId]) jobByProduct[j.productId] = j;
    }
    return all
      .filter((p) => ['pending_approve', 'pending_retake', 'draft'].includes(p.status))
      .map((p) => {
        const ui = toUiProduct(p);
        const j = jobByProduct[p.id];
        if (j) { ui.jobId = j.id; ui.jobStatus = j.status; }
        return ui;
      });
  },

  /* ── Wallet + ledger (server-managed) ────────────────────────────────── */
  async getWallet(storeId = getCurrentStoreId()) {
    if (!storeId) return { id: '', balance: 0, plan: 'free' };
    const c = await this.getCredits(storeId);
    return { id: storeId, balance: c.balance, plan: c.plan };
  },
  async getCredits(storeId = getCurrentStoreId()) {
    if (!storeId) return { balance: 0, plan: 'free', pricing: CREDIT_PRICING };
    const data = await request(`/stores/${storeId}/credits`);
    return {
      balance: typeof data.balance === 'number' ? data.balance : 0,
      plan: data.plan || 'free',
      pricing: data.pricing || CREDIT_PRICING,
    };
  },
  async getLedger(storeId = getCurrentStoreId()) {
    if (!storeId) return [];
    const data = await request(`/stores/${storeId}/credits/ledger?limit=200`);
    return (data.ledger || []).map(toUiLedger);
  },

  /* ── Credits: top-up orders (Razorpay) ───────────────────────────────── */
  async getCreditPacks() {
    const data = await request('/credits/packs');
    return data.packs || [];
  },
  async createOrder(packId) {
    const data = await request('/credits/orders', { method: 'POST', body: { packId } });
    return data; // { orderId, credits, amountPaise, currency, keyId }
  },

  /* ── Pro subscription (Razorpay recurring, ₹499/mo) ─────────────────── */
  async getSubscriptionPlan() {
    const data = await request('/credits/subscription');
    return data.plan || null; // { pricePaise, monthlyCredits, currency, configured }
  },
  async createSubscription() {
    const data = await request('/credits/subscriptions', { method: 'POST' });
    return data; // { subscriptionId, keyId, amountPaise, currency }
  },

  /* ── Async AI jobs ───────────────────────────────────────────────────── */
  async createJob({ type, productId }) {
    const data = await request('/jobs', { method: 'POST', body: { type, productId } });
    return { job: data.job, wallet: data.wallet }; // wallet = new balance after reservation
  },
  async getJob(jobId) {
    const data = await request(`/jobs/${jobId}`);
    return data.job;
  },
  async listJobs() {
    const storeId = getCurrentStoreId();
    if (!storeId) return [];
    const data = await request('/jobs?limit=100');
    return data.jobs || [];
  },

  /* ── AI engine status (which model renders; is the proprietary pipeline
     online?) — drives the honest fallback notice before a shoot ──────── */
  async getAiStatus() {
    const data = await request('/ai/status').catch(() => null);
    return data || null; // { engine, proprietaryOnline, fallbackActive, workerActive, imageModel, textModel, textAiEnabled }
  },

  /* ── Live cataloging sessions (QR multi-device, owner side) ──────────── */
  async createSession(title) {
    const data = await request('/sessions', { method: 'POST', body: { title: title || '' } });
    return data; // { session, joinToken, joinExpiresAt, joinUrl }
  },
  async listSessions() {
    const data = await request('/sessions?limit=50');
    return data.sessions || [];
  },
  async getSessionStatus(sessionId) {
    const data = await request(`/sessions/${sessionId}`);
    return data.session; // light status: { id, title, status, devices, photoCount, activity, createdAt }
  },
  async getSessionPhotos(sessionId) {
    const data = await request(`/sessions/${sessionId}/photos`);
    return data.photos || []; // [{ pid, deviceId, mime, dataUrl, index, ts }]
  },
  async mintJoinUrl(sessionId) {
    const data = await request(`/sessions/${sessionId}/join-url`, { method: 'POST' });
    return data; // { joinToken, joinExpiresAt, joinUrl }
  },
  async closeSession(sessionId) {
    const data = await request(`/sessions/${sessionId}/close`, { method: 'POST' });
    return data.session;
  },

  /* ── Joined-phone side (NO Firebase account — token-authenticated) ───── */
  async joinSession(sessionId, token, deviceName) {
    const res = await fetch(`${API_BASE}/public/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceName: deviceName || 'Phone' }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new ApiError(
        json?.error?.message || 'Could not join the session.',
        json?.error?.code || 'JOIN_FAILED',
        res.status,
      );
    }
    return json.data; // { sessionId, deviceId, deviceName, deviceToken, storeName }
  },
  /** Stage a capture: validates metadata, returns a signed GCS PUT URL. */
  async sessionPhotoStart(sessionId, deviceToken, { mime, size, index }) {
    const res = await fetch(`${API_BASE}/public/sessions/${sessionId}/photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ mime, size, index }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new ApiError(
        json?.error?.message || 'Photo could not be staged.',
        json?.error?.code || 'PHOTO_FAILED',
        res.status,
      );
    }
    return json.data; // { photoId, objectPath, uploadUrl }
  },
  /** Confirm the GCS upload — registers the capture in the session. */
  async sessionPhotoConfirm(sessionId, deviceToken, photoId, { mime, size, index }) {
    const res = await fetch(`${API_BASE}/public/sessions/${sessionId}/photo/${photoId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ mime, size, index }),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      throw new ApiError(
        json?.error?.message || 'Photo could not be confirmed.',
        json?.error?.code || 'PHOTO_FAILED',
        res.status,
      );
    }
    return json.data; // { photoId, path }
  },
  /** Upload raw bytes to a signed GCS URL (no app token needed). */
  async putBytes(uploadUrl, blob, contentType) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      throw new ApiError('Photo upload failed. Try again.', 'UPLOAD_FAILED', res.status);
    }
  },

  /* ── Photo uploads (signed URLs) ─────────────────────────────────────── */
  async getUploadUrl(purpose, fileName, contentType) {
    const data = await request('/uploads/urls', {
      method: 'POST',
      body: { purpose, fileName, contentType },
    });
    return data; // { uploadUrl, objectPath, bucket }
  },
  async uploadBlob(uploadUrl, blob, contentType) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'image/jpeg' },
      body: blob,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      throw new ApiError('Photo upload failed. Try again.', 'UPLOAD_FAILED', res.status);
    }
  },

  /* ── Content: admin-controlled banners + announcements ──────────────── */
  async getBanners() {
    const data = await request('/content/banners');
    return (data.banners || []).map(toUiBanner);
  },
  async getAnnouncements() {
    const data = await request('/content/announcements');
    return (data.announcements || []).map(toUiAnnouncement);
  },
  async adminListBanners() {
    const data = await request('/admin/content/banners');
    return (data.banners || []).map(toUiBanner);
  },
  async adminCreateBanner(banner) {
    const data = await request('/admin/content/banners', { method: 'POST', body: sanitizeBannerForServer(banner) });
    return data.banner;
  },
  async adminUpdateBanner(id, banner) {
    const data = await request(`/admin/content/banners/${sanitizeId(id)}`, { method: 'PATCH', body: sanitizeBannerForServer(banner) });
    return data.banner;
  },
  async adminDeleteBanner(id) {
    await request(`/admin/content/banners/${sanitizeId(id)}`, { method: 'DELETE' });
  },
  async adminListAnnouncements() {
    const data = await request('/admin/content/announcements');
    return (data.announcements || []).map(toUiAnnouncement);
  },
  async adminCreateAnnouncement(ann) {
    const data = await request('/admin/content/announcements', { method: 'POST', body: sanitizeAnnouncementForServer(ann) });
    return data.announcement;
  },
  async adminUpdateAnnouncement(id, ann) {
    const data = await request(`/admin/content/announcements/${sanitizeId(id)}`, { method: 'PATCH', body: sanitizeAnnouncementForServer(ann) });
    return data.announcement;
  },
  async adminDeleteAnnouncement(id) {
    await request(`/admin/content/announcements/${sanitizeId(id)}`, { method: 'DELETE' });
  },

  /* ── Account: branded verification email (rate-limited server-side). The
     continue URL (validated server-side) makes the verify link return the
     user to /app — without it Firebase's bare handler dead-ends. ───────── */
  async sendVerificationEmail(continueUrl = '') {
    await request('/me/send-verification', {
      method: 'POST',
      body: continueUrl ? { continueUrl } : {},
      timeout: 15000,
    });
  },

  /* ── Geocoding (store location) — proxied + rate-limited server-side ── */
  async geocode(query) {
    const data = await request('/geocode', {
      method: 'POST',
      body: { q: sanitizeText(query, 120) },
      timeout: 15000,
    });
    return data.result || null; // { label, lat, lng } | null
  },

  /* ── Landing-page leads (real contact form) ─────────────────────────── */
  async submitLead({ name, phone, email, products, platform }) {
    await request('/public/leads', {
      method: 'POST',
      body: {
        name: sanitizeText(name, 80),
        phone: String(phone || '').replace(/[^0-9+]/g, '').slice(0, 15),
        email: sanitizeEmail(email),
        products: sanitizeText(products, 40),
        platform: sanitizeText(platform, 30),
      },
    });
  },
  async adminGetLeads() {
    const data = await request('/admin/leads');
    return (data.leads || []).map((l) => ({
      id: l.id,
      name: l.name || '',
      phone: l.phone || '',
      email: l.email || '',
      products: l.products || '',
      platform: l.platform || '',
      status: l.status || 'new',
      ts: new Date(l.ts || Date.now()).toISOString(),
    }));
  },
  async adminResolveLead(leadId) {
    await request(`/admin/leads/${sanitizeId(leadId)}/resolve`, { method: 'POST' });
    return this.adminGetLeads();
  },

  /* ── Notifications + admin follow-up alerts ──────────────────────────── */
  async addFollowUpAlert({ storeId, type, message, balance }) {
    const sid = storeId || getCurrentStoreId();
    if (!sid) return [];
    await request(`/stores/${sid}/notifications`, {
      method: 'POST',
      body: {
        type: type === 'follow_up' ? 'follow_up' : 'low_balance',
        message: sanitizeNote(message || 'Low balance — user may need a recharge nudge', 300),
        balance: sanitizeInt(balance, { max: 100000000, fallback: 0 }),
      },
    });
    return this.adminFollowUps().catch(() => []);
  },
  async getAlerts() {
    try { return await this.adminFollowUps(); } catch { return []; }
  },
  async resolveAlert(alertId) {
    await request(`/admin/follow-ups/${sanitizeId(alertId)}/resolve`, { method: 'POST' });
    return this.adminFollowUps();
  },

  /* ── Platform CSV/Excel export (the seller's take-away file) ─────────── */
  async exportProduct(productId, platform) {
    const storeId = getCurrentStoreId();
    if (!storeId) throw new ApiError('Not onboarded yet.', 'NOT_ONBOARDED', 400);
    const data = await request(`/stores/${storeId}/products/${sanitizeId(productId)}/export`, {
      method: 'POST',
      body: { platform: sanitizeId(platform) },
      timeout: 30000,
    });
    return data; // { filename, csv }
  },

  /* ── Owner console (requireAdmin server-side: OWNER_EMAIL + unlock token) ── */
  async adminGetStores() {
    const data = await request('/admin/stores');
    return (data.stores || []).map(toUiAdminStore);
  },
  async adminGetLedger() {
    const data = await request('/admin/ledger?limit=300');
    return (data.ledger || []).map(toUiLedger);
  },
  async adminAdjustCredits({ storeId, amount, note }) {
    const data = await request('/admin/credits', {
      method: 'POST',
      body: { storeId, amount, note },
    });
    return data.wallet;
  },
  async adminFollowUps() {
    const data = await request('/admin/follow-ups');
    return (data.alerts || []).map(toUiAlert);
  },
  async adminGetJobs() {
    const data = await request('/admin/jobs?limit=100');
    return (data.jobs || []).map((j) => ({
      id: j.id,
      storeId: j.storeId,
      storeName: j.storeName || j.storeId,
      type: j.type || '',
      status: j.status || 'queued',
      creditsReserved: j.creditsReserved || 0,
      errorCode: j.errorCode || null,
      createdAt: new Date(j.createdAt || Date.now()).toISOString(),
      updatedAt: new Date(j.updatedAt || j.createdAt || Date.now()).toISOString(),
    }));
  },
  async adminGetOrders() {
    const data = await request('/admin/orders?limit=100');
    return (data.orders || []).map((o) => ({
      id: o.orderId || o.id,
      kind: o.kind || 'order',
      storeId: o.storeId,
      storeName: o.storeName || o.storeId,
      credits: o.credits || 0,
      amountPaise: o.amountPaise || 0,
      status: o.status || '',
      createdAt: new Date(o.createdAt || Date.now()).toISOString(),
    }));
  },

  /* ── Legacy no-op saves (server is truth; kept for call-site safety) ─── */
  async saveProducts() { return []; },
  async savePending() { return []; },
  async saveStores() { return []; },
  async saveLedger() { return []; },
  async saveAlerts() { return []; },
  async ensureWelcomeStore() { return []; },
};

/* ── Shared UI helpers ────────────────────────────────────────────────────── */
export const formatINR = (n) =>
  Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const timeAgo = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const LEDGER_META = {
  grant:   { label: 'Grant',   tone: 'green' },
  topup:   { label: 'Top-up',  tone: 'gold' },
  gift:    { label: 'Gift',    tone: 'blue' },
  consume: { label: 'Consume', tone: 'red' },
  refund:  { label: 'Refund',  tone: 'green' },
  draft:   { label: 'Draft',   tone: 'gray' },
};

export { sanitizeText, sanitizeName, sanitizeCity, sanitizeInt, sanitizeMoney,
         sanitizePrice, sanitizePhone, sanitizeEmail, sanitizeId, sanitizeNote,
         sanitizeImageSrc, sanitizeToken, sanitizeProduct, sanitizeProfile,
         sanitizeLedgerEntry, sanitizeAlert } from './sanitize';
