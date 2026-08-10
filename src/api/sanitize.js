/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — Sanitization
   ────────────────────────────────────────────────────────────────────────────
   EVERY user-supplied value passes through these helpers before it is
   persisted or sent anywhere. Rules:
     • strip control chars / null bytes (JSON smuggling, terminal escapes)
     • strip HTML tags & dangerous URI schemes (XSS via <script>, javascript:)
     • hard length caps (memory/DoS protection)
     • digits-only for numbers, whitelist for ids

   The real backend MUST re-validate (never trust client output) — see
   backend/api/openapi.yaml. This layer is the client-side first gate.
   ════════════════════════════════════════════════════════════════════════════ */

/* Remove control chars, null bytes, RTL/LTR overrides, zero-width chars.
   Iterative (no regex literal) so the sanitizer is lint-clean and predictable. */
const cleanControl = (s) => {
  let out = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if ((c >= 0 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 31) || c === 127) {
      out += ' ';                    // control chars → space
    } else if (c === 0x200B || c === 0x200C || c === 0x200D || c === 0x2060 || c === 0xFEFF) {
      out += '';                     // zero-width / BOM → drop
    } else if (c >= 0x202A && c <= 0x202E) {
      out += '';                     // bidi overrides → drop
    } else {
      out += ch;
    }
  }
  return out;
};

/* Strip anything that looks like markup — tags, event handlers, URLs. */
const stripHtml = (s) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/&#?\w+;/g, ' ');

/** Plain text (titles, notes, descriptions). No tags, capped length. */
export const sanitizeText = (raw, maxLen = 120) => {
  const cleaned = cleanControl(stripHtml(raw))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLen);
};

/** A person/store name — letters, numbers, spaces, and a few safe marks. */
export const sanitizeName = (raw, maxLen = 60) =>
  sanitizeText(raw, maxLen).replace(/[^a-zA-Z0-9\s.,'&()/-]/g, '');

/** City / location names. */
export const sanitizeCity = (raw, maxLen = 40) =>
  sanitizeText(raw, maxLen).replace(/[^a-zA-Z0-9\s.,'()-]/g, '');

/** Numeric string → integer, clamped to a range. Returns fallback on junk. */
export const sanitizeInt = (raw, { min = 0, max = 999999999, fallback = 0 } = {}) => {
  const n = parseInt(String(raw ?? '').replace(/[^0-9-]/g, ''), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

/** Currency value (paise-safe integer or decimal string). */
export const sanitizeMoney = (raw, max = 99999999, fallback = 0) =>
  sanitizeInt(raw, { max, fallback });

/** Phone — digits only, typical Indian length. */
export const sanitizePhone = (raw, maxLen = 15) =>
  String(raw ?? '').replace(/[^0-9+]/g, '').slice(0, maxLen);

/** Email — lowercase, trimmed, basic shape check, no payload chars. */
export const sanitizeEmail = (raw, maxLen = 120) => {
  const e = String(raw ?? '').trim().toLowerCase().slice(0, maxLen);
  return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e) ? e : '';
};

/** Safe id — alphanumerics, dash, underscore, dot, colon. */
export const sanitizeId = (raw, maxLen = 64) =>
  String(raw ?? '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, maxLen);

/** One-line note for ledger/admin (no markup, no newlines). */
export const sanitizeNote = (raw, maxLen = 120) =>
  sanitizeText(raw, maxLen).replace(/\n/g, ' ');

/**
 * Image source — ONLY allows safe schemes. Blocks javascript:, data:text/html,
 * external http(s) unless they are our known CDN hosts.
 */
export const sanitizeImageSrc = (raw, { allowExternal = false } = {}) => {
  const s = String(raw ?? '');
  if (!s) return '';
  if (s.startsWith('data:image/')) return s.slice(0, 2_500_000); // base64 photo cap
  if (s.startsWith('blob:')) return s.slice(0, 2_500_000);
  if (s.startsWith('/')) return s.slice(0, 500); // same-origin path
  if (allowExternal && /^https:\/\/([a-z0-9-]+\.)?(katalogit\.(ai|com|in)|gstatic\.com|googleapis\.com|cloudinary\.com|imgix\.net)\//i.test(s)) {
    return s.slice(0, 1000);
  }
  return '';
};

/** Free-form checkbox / enum values — allow only safe words. */
export const sanitizeToken = (raw, allowed = [], fallback = null, maxLen = 40) => {
  const v = String(raw ?? '').slice(0, maxLen);
  return allowed.includes(v) ? v : fallback;
};

/** Display price — keep the ₹ prefix + digits + commas, cap length. */
export const sanitizePrice = (raw, maxLen = 20) => {
  const s = sanitizeText(raw, maxLen).replace(/[^0-9₹,.\s/-]/g, '');
  return s.slice(0, maxLen);
};

/** Deep-clean a product object (all user-reachable fields). */
export const sanitizeProduct = (p = {}) => {
  // aiSpecs comes from the AI pipeline — deep-clean each field so nothing
  // user-controlled or model-generated can smuggle markup into the UI.
  const hasSpecs = p.aiSpecs && typeof p.aiSpecs === 'object';
  return {
    id:         sanitizeId(p.id) || ('prod-' + Date.now().toString(36)),
    title:      sanitizeText(p.title, 80) || 'Untitled product',
    price:      sanitizePrice(p.price),
    category:   sanitizeText(p.category, 40),
    image:      sanitizeImageSrc(p.image),
    backImage:  sanitizeImageSrc(p.backImage),
    rating:     sanitizeText(p.rating, 8) || '5.0',
    hasAiPhoto: Boolean(p.hasAiPhoto),
    aiImage:    sanitizeImageSrc(p.aiImage),
    // AI pipeline outputs (must survive persistence + reload)
    gallery:    Array.isArray(p.gallery)
                  ? p.gallery.map(sanitizeImageSrc).filter(Boolean).slice(0, 8)
                  : [],
    modelId:    sanitizeId(p.modelId, 20),
    aiSpecs:    hasSpecs
                  ? {
                      description: sanitizeText(p.aiSpecs.description, 300),
                      sizes:       Array.isArray(p.aiSpecs.sizes)
                                     ? p.aiSpecs.sizes.map((s) => sanitizeText(s, 12)).filter(Boolean).slice(0, 12)
                                     : [],
                      colors:      Array.isArray(p.aiSpecs.colors)
                                     ? p.aiSpecs.colors.map((c) => sanitizeText(c, 24)).filter(Boolean).slice(0, 12)
                                     : [],
                      material:    sanitizeText(p.aiSpecs.material, 60),
                      fit:         sanitizeText(p.aiSpecs.fit, 30),
                      care:        sanitizeText(p.aiSpecs.care, 80),
                    }
                  : null,
    status:     sanitizeToken(p.status, ['pending_approve','pending_retake','draft','live'], 'pending_approve'),
    qty:        sanitizeInt(p.qty, { min: 0, max: 100000, fallback: 0 }),
    isDraft:    Boolean(p.isDraft),
    savedAt:    String(p.savedAt || new Date().toISOString()).slice(0, 40),
  };
};

/** Deep-clean a store profile. */
export const sanitizeProfile = (p = {}) => ({
  storeName:   sanitizeName(p.storeName, 60) || 'My Store',
  name:        sanitizeName(p.name, 60),
  city:        sanitizeCity(p.city, 40),
  phone:       sanitizePhone(p.phone, 15),
  email:       sanitizeEmail(p.email, 120),
  categories:  Array.isArray(p.categories)
                 ? p.categories.map((c) => sanitizeText(c, 30)).filter(Boolean).slice(0, 20)
                 : [],
  scale:       sanitizeText(p.scale, 30),
  aiFeatures:  Array.isArray(p.aiFeatures)
                 ? p.aiFeatures.map((f) => sanitizeText(f, 30)).filter(Boolean).slice(0, 20)
                 : [],
  survey:      Array.isArray(p.survey)
                 ? p.survey.map((a) => sanitizeText(a, 60)).filter(Boolean).slice(0, 20)
                 : [],
  createdAt:   String(p.createdAt || new Date().toISOString()).slice(0, 40),
});

/** Sanitize a single ledger/alert entry. */
export const sanitizeLedgerEntry = (l = {}) => ({
  id:         sanitizeId(l.id),
  storeId:    sanitizeId(l.storeId, 40),
  storeName:  sanitizeName(l.storeName, 60),
  type:       sanitizeToken(l.type, ['grant','topup','gift','consume','refund','draft'], 'grant'),
  amount:     sanitizeInt(l.amount, { min: -1000000, max: 1000000, fallback: 0 }),
  note:       sanitizeNote(l.note, 120),
  actor:      sanitizeToken(l.actor, ['user','admin','system'], 'system', 20),
  ts:         String(l.ts || new Date().toISOString()).slice(0, 40),
});

export const sanitizeAlert = (a = {}) => ({
  id:         sanitizeId(a.id),
  storeId:    sanitizeId(a.storeId, 40),
  storeName:  sanitizeName(a.storeName, 60),
  type:       sanitizeText(a.type, 30),
  message:    sanitizeNote(a.message, 160),
  balance:    sanitizeInt(a.balance, { min: 0, max: 1000000, fallback: 0 }),
  ts:         String(a.ts || new Date().toISOString()).slice(0, 40),
  resolved:   Boolean(a.resolved),
  resolvedTs: String(a.resolvedTs || '').slice(0, 40),
});
