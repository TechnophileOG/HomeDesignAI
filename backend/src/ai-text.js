/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — listing text pass (Gemini via Vertex AI)
   ────────────────────────────────────────────────────────────────────────
   Pass 1 of the multi-platform pipeline: turns the raw product (photo +
   category + whatever the seller typed) into a canonical listing object —
   title, description, price suggestion, category, keywords, sizes, colours,
   material, fit — the CPM seed that platform-templates.js later renders per
   marketplace. Pure functions are exported for tests; the network call is
   isolated behind injectable deps (same pattern as ai-fallback.js).

   Cost: Gemini 2.5 Flash-Lite ≈ $0.10/1M input, $0.40/1M output tokens —
   a listing is ~1–2K tokens ⇒ well under $0.001 per SKU (the ₹1–3/SKU
   budget has enormous headroom for text).
   ════════════════════════════════════════════════════════════════════════ */

import { GoogleAuth } from 'google-auth-library';
import { PROJECT_ID, VERTEX_AI_LOCATION, VERTEX_TEXT_MODEL } from './config.js';
import { AppError } from './errors.js';
import { promptSafe } from './ai-client.js';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

/** Vertex generateContent endpoint for the configured TEXT model. */
export const textEndpoint = ({
  project = PROJECT_ID,
  location = VERTEX_AI_LOCATION,
  model = VERTEX_TEXT_MODEL,
} = {}) => {
  const base = location === 'global'
    ? 'https://aiplatform.googleapis.com'
    : `https://${location}-aiplatform.googleapis.com`;
  return `${base}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
};

/** Strip control chars + HTML/XML tags; trim; cap length. Safe for the DB
    and for re-injection into prompts (no raw user echo). */
export const cleanText = (v, max) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // eslint-disable-line no-control-regex
    // script/style blocks removed WHOLE (content included), then any tag
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const cleanOpt = (v, max) => (v === undefined || v === null || v === '') ? '' : cleanText(v, max);

const strArr = (v, itemMax, maxItems) => {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v.slice(0, maxItems)) {
    // Only plain strings; junk/oversize/non-string items are DROPPED (a
    // capped 300-char garbage keyword is still garbage).
    if (typeof item !== 'string' || item.trim().length > itemMax) continue;
    const c = cleanOpt(item, itemMax);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
};

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

const CATEGORIES = [
  'Apparel', 'Ethnic Wear', 'Western Wear', 'Kurtis', 'Sarees', 'Dresses', 'Tops',
  'T-Shirts', 'Shirts', 'Jeans', 'Trousers', 'Innerwear', 'Kids Wear', 'Footwear',
  'Accessories', 'Home & Living', 'Other',
];

/**
 * Defensive parser for the model's JSON reply. Never trusts the shape:
 * unknown keys are dropped, every string is cleaned + capped, lists capped.
 */
export const parseListingJson = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new AppError(502, 'TEXT_BAD_OUTPUT', 'Model returned a malformed listing.');
  }
  const title = cleanOpt(raw.title, 120);
  if (!title) throw new AppError(502, 'TEXT_BAD_OUTPUT', 'Model returned no title.');
  return {
    title,
    description: cleanOpt(raw.description, 500),
    priceSuggestion: num(raw.priceSuggestion, 0),
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Apparel',
    keywords: strArr(raw.keywords, 40, 8),
    sizes: strArr(raw.sizes, 12, 12),
    colors: strArr(raw.colors, 30, 8),
    material: cleanOpt(raw.material, 60),
    fit: cleanOpt(raw.fit, 40),
    brand: cleanOpt(raw.brand, 60),
  };
};

/** The instruction sent to Gemini. Keep it deterministic + structured. */
export const buildListingPrompt = (product) => {
  // promptSafe strips prompt-metacharacters + instruction-like keywords so
  // a hostile seller title can never inject instructions into the model.
  const seedTitle = promptSafe(product.title, 120) || 'apparel product';
  const category = promptSafe(product.category, 40) || 'Apparel';
  const brand = promptSafe(product.brand || product.aiSpecs?.brand, 40) || '';
  const colors = Array.isArray(product.aiSpecs?.colors) && product.aiSpecs.colors.length
    ? ` The garment's colours: ${product.aiSpecs.colors.slice(0, 4).map((c) => promptSafe(c, 30)).filter(Boolean).join(', ')}.`
    : '';
  return [
    'You are the listing copywriter for an Indian e-commerce catalog AI.',
    'From the garment described below, produce ONE product listing as strict JSON only.',
    'Rules: title max 120 chars, keyword-rich, front-loaded, no hype words, no emojis;',
    'description 2-4 short sentences (fabric, fit, occasion, care) aimed at an Indian',
    'online buyer; priceSuggestion a realistic INR number for a small store; category one',
    'of: ' + CATEGORIES.join(', ') + '; keywords 5-8 realistic search phrases; sizes a',
    'clothing size list; colors from the garment; material fabric; fit silhouette;',
    'brand only if given.',
    '',
    `Garment: ${seedTitle}. Category: ${category}.${brand ? ` Brand: ${brand}.` : ''}${colors}`,
    '',
    'Respond with the JSON object only — no markdown, no commentary.',
  ].join('\n');
};

/** One generateContent call → parsed listing JSON. */
async function callTextModel(prompt, { endpoint = textEndpoint(), timeoutMs = 60_000 } = {}) {
  const token = await auth.getAccessToken();
  if (!token) throw new AppError(502, 'TEXT_AUTH_FAILED', 'Vertex AI authentication failed.');
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError(502, 'TEXT_UNREACHABLE', 'Vertex AI is unreachable.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new AppError(502, 'TEXT_FORBIDDEN',
        'Vertex AI access denied — grant the runtime service account roles/aiplatform.user.');
    }
    if (res.status === 429) {
      throw new AppError(502, 'TEXT_QUOTA', 'Vertex AI quota exceeded — try again shortly.');
    }
    console.error('[ai-text] vertex error:', res.status, text.slice(0, 300));
    throw new AppError(502, 'TEXT_FAILED', 'Vertex AI text generation failed.');
  }
  const body = await res.json().catch(() => ({}));
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) throw new AppError(502, 'TEXT_NO_OUTPUT', 'Vertex AI returned no text.');

  // Defensive JSON extraction: tolerate code fences and surrounding noise.
  let jsonText = text.replace(/```(?:json)?/gi, '').trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end <= start) throw new AppError(502, 'TEXT_BAD_OUTPUT', 'Model reply was not JSON.');
  jsonText = jsonText.slice(start, end + 1);
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { throw new AppError(502, 'TEXT_BAD_OUTPUT', 'Model reply was not valid JSON.'); }
  return parseListingJson(parsed);
}

/**
 * Generate a full listing for a product. `deps.callModel` injectable for
 * tests. Throws AppError on failure — the CALLER decides whether a text
 * failure is fatal (it is not: images can still render).
 */
export async function generateListingText(product, { callModel = callTextModel } = {}) {
  const listing = await callModel(buildListingPrompt(product));
  return {
    ...listing,
    aiSpecs: {
      description: listing.description,
      sizes: listing.sizes,
      colors: listing.colors,
      material: listing.material,
      fit: listing.fit,
      keywords: listing.keywords,
    },
  };
}
