/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Template Engine (Pass 2, deterministic, CPU-only)
   ────────────────────────────────────────────────────────────────────────
   Every platform's listing content is a PURE function of the CPM. No LLM
   involved — this is why rendering 6 platforms costs ₹0 and runs 1000s of
   times. All rules come from PLATFORM_SEO_PLAYBOOK.md (verified Jul 2026):

     Amazon  title ≤75 chars (LIVE Jul 27, 2026) · bullets ≤5 × ≤1000 ·
             backend keywords ≤250 BYTES · Item Highlights (COSMO signals)
     Flipkart title keyword-first (no hard cap) · benefit bullets, size-first
     Meesho  title 50–120 chars, no ALL CAPS/symbols · vernacular keywords
     Myntra  fashion-forward gender+fit language · fabric/fit/care + styling
     Alibaba B2B spec-first · honest measurements (PIS quality)
     Instagram marketing caption + hashtags

   Rules enforced here:
     • word-safe truncation — NEVER split a word mid-token
     • byte-aware truncation for Amazon backend keywords (UTF-8 aware)
     • min-length padding for Meesho (pad with use-case keywords)
     • no double spaces, no control chars, no "undefined" leaks
     • pure functions — same CPM ⇒ byte-identical output (deterministic)
   ════════════════════════════════════════════════════════════════════════ */

import { PLATFORMS } from './cpm.js';

/* ── tiny text helpers ────────────────────────────────────────────────── */

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const joinWords = (parts) => parts.filter(Boolean).map((p) => p.trim()).join(' ').replace(/\s+/g, ' ');
const attr = (cpm, key) => String(cpm?.attributes?.[key] || '').trim();
const rel = (cpm, name) => cpm?.cosmoRelations?.find((r) => r.relation === name)?.object || '';
const dedupe = (arr) => [...new Set(arr.filter(Boolean))];

/** Strip control chars + collapse whitespace (no raw newlines in titles). */
const sanitize = (str) => String(str || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(); // eslint-disable-line no-control-regex

/** Word-safe hard cap: keep the front, drop trailing words, never split one. */
const enforceMax = (str, max) => {
  const t = sanitize(str);
  if (t.length <= max) return t;
  const parts = words(t);
  let out = '';
  for (const p of parts) {
    const candidate = out ? `${out} ${p}` : p;
    if (candidate.length > max) break; // drop this word entirely (front-loading preserved)
    out = candidate;
  }
  return out;
};

/** Word-safe min+max: pad with extra keywords when under the floor. */
const enforceRange = (str, min, max, padWith = []) => {
  let t = sanitize(str);
  if (t.length > max) t = enforceMax(t, max);
  for (const kw of padWith) {
    if (t.length >= min) break;
    const c = sanitize(kw);
    if (!c) continue;
    const candidate = t ? `${t} ${c}` : c;
    if (candidate.length > max) continue;
    t = candidate;
  }
  return t;
};

const utf8Bytes = (s) => Buffer.byteLength(String(s || ''), 'utf8');

/** Byte-aware cap (Amazon backend keywords: 250 BYTES). */
const enforceBytes = (str, maxBytes) => {
  const t = sanitize(str);
  if (utf8Bytes(t) <= maxBytes) return t;
  const parts = words(t);
  let out = '';
  for (const p of parts) {
    const candidate = out ? `${out} ${p}` : p;
    if (utf8Bytes(candidate) > maxBytes) break;
    out = candidate;
  }
  return out;
};

const genderWord = (g) => (g === 'women' ? "Women's" : g === 'men' ? "Men's" : g === 'kids' ? "Kids'" : '');

/** Case-insensitive word dedupe (keeps first occurrence) — kills "Women's
    Women's Cotton…" when productType already embeds the gender word. */
const dedupeTokens = (str) => {
  const seen = new Set();
  const out = [];
  for (const w of words(str)) {
    const key = w.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(w); }
  }
  return out.join(' ');
};

const genderInType = (cpm) => {
  const g = genderWord(cpm.compliance?.genderFit);
  return g && cpm.productType.toLowerCase().startsWith(g.toLowerCase());
};

/* ═══════════════ AMAZON ═══════════════ */

/**
 * Title ≤75 chars. Front-load: brand (if any) → productType → color →
 * pattern → fabric → fit → occasion. Truncation drops the tail, so the
 * highest-intent words always survive.
 */
export const amazonTitle = (cpm) => {
  const brand = sanitize(cpm.brand);
  const parts = [brand, cpm.productType, attr(cpm, 'color'), attr(cpm, 'pattern'),
    attr(cpm, 'fabric'), attr(cpm, 'fit'), attr(cpm, 'occasion')];
  return enforceMax(dedupeTokens(joinWords(parts)), 75);
};

/**
 * Item Highlights: 4–5 short COSMO intent signals (the new structured slot).
 * Each ≤40 chars — short, scannable, benefit-first.
 */
export const amazonItemHighlights = (cpm) => {
  const out = [];
  const push = (s) => { const c = enforceMax(s, 40); if (c) out.push(c); };
  const fabric = attr(cpm, 'fabric');
  if (fabric) push(cpm.fabricHandfeel ? `${fabric}: ${cpm.fabricHandfeel}` : `Crafted in ${fabric}`);
  push(rel(cpm, 'Used_For_Event') || rel(cpm, 'Used_On') || attr(cpm, 'occasion'));
  push(rel(cpm, 'Used_For_Audience') || rel(cpm, 'Used_By') || rel(cpm, 'xIs_A'));
  push(rel(cpm, 'Used_With'));
  push(rel(cpm, 'xWant') || attr(cpm, 'care'));
  return dedupe(out).slice(0, 5);
};

/** Bullets: ≤5, each ≤1000 chars, benefit → feature, COSMO-relation driven. */
export const amazonBullets = (cpm) => {
  const bullets = [];
  const push = (s) => { const c = enforceMax(s, 1000); if (c && !bullets.includes(c)) bullets.push(c); };

  const fabric = attr(cpm, 'fabric');
  if (fabric) push(`Crafted from ${fabric}${cpm.fabricHandfeel ? ` — ${cpm.fabricHandfeel}` : ''} for everyday comfort.`);

  const fit = attr(cpm, 'fit');
  if (fit) push(`Designed with a ${fit} fit that drapes naturally and moves with you all day.`);

  const event = rel(cpm, 'Used_For_Event') || attr(cpm, 'occasion');
  if (event) push(`Perfect for ${event} — pairs effortlessly from morning errands to evening outings.`);

  const audience = rel(cpm, 'Used_For_Audience') || rel(cpm, 'Used_By') || rel(cpm, 'xIs_A');
  if (audience) push(`Thoughtfully made for ${audience}, with practical everyday styling in mind.`);

  const with_ = rel(cpm, 'Used_With');
  if (with_) push(`Pairs beautifully with ${with_} — a complete look in one order.`);

  const want = rel(cpm, 'xWant');
  if (want) push(`Designed to help you ${want} — quality that shows, value that lasts.`);

  const care = attr(cpm, 'care');
  if (care && bullets.length < 5) push(`Easy care: ${care}.`);

  const sizeChart = cpm.compliance?.sizeChartRequired ? 'Size chart included for the perfect fit.' : 'Check the size guide before ordering.';
  if (bullets.length < 5) push(sizeChart);

  return bullets.slice(0, 5);
};

/** Backend search terms: ≤250 BYTES, deduped against the title's own words. */
export const amazonBackendKeywords = (cpm) => {
  const titleWords = new Set(words(amazonTitle(cpm)).map((w) => w.toLowerCase()));
  const pool = [
    ...(cpm.keywords?.primary || []),
    ...(cpm.keywords?.longTail || []),
    ...(cpm.keywords?.intent || []),
    ...(cpm.keywords?.vernacular || []),
    ...(cpm.keywords?.misspellings || []),
    ...(cpm.keywords?.synonyms || []),
  ];
  const kept = dedupe(pool.map((k) => sanitize(k)))
    .filter((k) => {
      const kws = words(k).map((w) => w.toLowerCase());
      return !kws.every((w) => titleWords.has(w)); // drop phrases fully covered by the title
    });
  return enforceBytes(joinWords(kept), 250);
};

export const amazonDescription = (cpm) => {
  const occasion = rel(cpm, 'Used_For_Event') || attr(cpm, 'occasion');
  const audience = rel(cpm, 'Used_For_Audience') || rel(cpm, 'Used_By') || rel(cpm, 'xIs_A');
  const parts = [
    `${cpm.productType}${attr(cpm, 'color') ? ` in ${attr(cpm, 'color')}` : ''}${attr(cpm, 'pattern') ? `, ${attr(cpm, 'pattern')}` : ''}${attr(cpm, 'fabric') ? `, made from ${attr(cpm, 'fabric')}` : ''}${cpm.fabricHandfeel ? ` — ${cpm.fabricHandfeel}` : ''}.`,
    audience ? `Designed for ${audience}.` : '',
    occasion ? `Ideal for ${occasion}.` : '',
    attr(cpm, 'care') ? `Care: ${attr(cpm, 'care')}.` : '',
  ];
  return joinWords(parts);
};

export const amazonPack = (cpm) => ({
  platform: 'amazon',
  title: amazonTitle(cpm),
  itemHighlights: amazonItemHighlights(cpm),
  bullets: amazonBullets(cpm),
  description: amazonDescription(cpm),
  backendKeywords: amazonBackendKeywords(cpm),
});

/* ═══════════════ FLIPKART ═══════════════ */

/** Keyword-first, no hard cap (sane soft cap 150). Richer than Amazon's. */
export const flipkartTitle = (cpm) => {
  const brand = sanitize(cpm.brand);
  const gender = genderInType(cpm) ? '' : genderWord(cpm.compliance?.genderFit);
  const parts = [brand, gender, cpm.productType,
    attr(cpm, 'color'), attr(cpm, 'pattern'), attr(cpm, 'fabric'),
    attr(cpm, 'fit'), attr(cpm, 'sleeve'), attr(cpm, 'neck'), attr(cpm, 'occasion')];
  return enforceMax(dedupeTokens(joinWords(parts)), 150);
};

export const flipkartDescription = (cpm) => {
  const parts = [
    `${cpm.productType}${attr(cpm, 'color') ? ` in ${attr(cpm, 'color')}` : ''}${attr(cpm, 'fabric') ? ` made from soft ${attr(cpm, 'fabric')}` : ''}${attr(cpm, 'fit') ? ` with a ${attr(cpm, 'fit')} fit` : ''}.`,
    cpm.fabricHandfeel ? cpm.fabricHandfeel[0].toUpperCase() + cpm.fabricHandfeel.slice(1) + '.' : '',
    attr(cpm, 'occasion') ? `Perfect for ${attr(cpm, 'occasion')}.` : '',
    'Check the size chart for the perfect fit.',
    attr(cpm, 'care') ? `Care instructions: ${attr(cpm, 'care')}.` : '',
  ];
  return joinWords(parts);
};

export const flipkartPack = (cpm) => ({
  platform: 'flipkart',
  title: flipkartTitle(cpm),
  description: flipkartDescription(cpm),
  bullets: amazonBullets(cpm).slice(0, 4), // shared benefit bullets, trimmed
  keywords: joinWords(dedupe([...(cpm.keywords?.primary || []), ...(cpm.keywords?.longTail || [])].map(sanitize))),
});

/* ═══════════════ MEESHO ═══════════════ */

/**
 * Title 50–120 chars, clean, keyword-focused, no symbols/ALL CAPS.
 * Pattern: color + productType + pattern + fabric + fit (+ wear). Padded to
 * the 50 floor with use-case keywords when the base is too short.
 */
export const meeshoTitle = (cpm) => {
  const base = dedupeTokens(joinWords([attr(cpm, 'color'), cpm.productType, attr(cpm, 'pattern'),
    attr(cpm, 'fabric'), attr(cpm, 'fit'), 'wear']));
  // Pad from the widest pool possible so even a sparse CPM reaches the 50-char
  // floor. Tier 1 = honest content (use-cases, every keyword group, and
  // attribute-derived phrases). Tier 2 = standard retail qualifiers (no false
  // claims: no "best seller", no material claims the CPM doesn't state).
  const tier1 = [
    ...(cpm.useCases || []),
    ...(cpm.keywords?.intent || []),
    ...(cpm.keywords?.primary || []),
    ...(cpm.keywords?.longTail || []),
    ...(cpm.keywords?.vernacular || []),
    ...(cpm.keywords?.synonyms || []),
    attr(cpm, 'occasion') ? `for ${attr(cpm, 'occasion')}` : '',
    attr(cpm, 'sleeve') ? `${attr(cpm, 'sleeve')} sleeves` : '',
    attr(cpm, 'neck') ? `${attr(cpm, 'neck')} neck` : '',
  ].filter(Boolean);
  const tier2 = ['stylish', 'trendy', 'comfortable', 'everyday wear'];
  const padded = enforceRange(base, 50, 120, tier1);
  return padded.length >= 50 ? padded : enforceRange(padded, 50, 120, tier2);
};

export const meeshoDescription = (cpm) => {
  const parts = [
    `${cpm.productType}${attr(cpm, 'color') ? ` in ${attr(cpm, 'color')}` : ''}${attr(cpm, 'fabric') ? ` made from ${attr(cpm, 'fabric')}` : ''} — ${cpm.fabricHandfeel || 'soft and comfortable for daily wear'}.`,
    attr(cpm, 'occasion') ? `Best for ${attr(cpm, 'occasion')}.` : '',
    attr(cpm, 'care') ? `Care: ${attr(cpm, 'care')}.` : '',
    cpm.compliance?.sizeChartRequired ? 'Size chart included — check before ordering.' : '',
  ];
  return joinWords(parts);
};

export const meeshoPack = (cpm) => ({
  platform: 'meesho',
  title: meeshoTitle(cpm),
  description: meeshoDescription(cpm),
  keywords: joinWords(dedupe([
    ...(cpm.keywords?.vernacular || []),
    ...(cpm.keywords?.primary || []),
    ...(cpm.keywords?.misspellings || []),
  ].map(sanitize))),
});

/* ═══════════════ MYNTRA ═══════════════ */

/** Fashion-forward: gender + fit + fabric + pattern + color, styling-aware. */
export const myntraTitle = (cpm) => {
  const g = genderWord(cpm.compliance?.genderFit);
  // Strip a leading gender word from productType when present (the gender
  // prefix comes first), so we never emit "Women's Women's Cotton…".
  const type = g && cpm.productType.toLowerCase().startsWith(g.toLowerCase())
    ? cpm.productType.slice(g.length).trim()
    : cpm.productType;
  const parts = [g, attr(cpm, 'fit'), type,
    attr(cpm, 'color') ? `in ${attr(cpm, 'color')}` : '', attr(cpm, 'occasion')];
  return enforceMax(dedupeTokens(joinWords(parts)), 120);
};

export const myntraDescription = (cpm) => {
  const with_ = rel(cpm, 'Used_With') || 'your favourite basics';
  const parts = [
    `${cpm.productType}${attr(cpm, 'color') ? ` in ${attr(cpm, 'color')}` : ''}${attr(cpm, 'fabric') ? `, crafted in ${attr(cpm, 'fabric')}` : ''} with a ${attr(cpm, 'fit') || 'regular'} fit — ${cpm.fabricHandfeel || 'made for all-day wear'}.`,
    `Style it with ${with_} for an effortless, put-together look.`,
    attr(cpm, 'care') ? `Care: ${attr(cpm, 'care')}.` : '',
  ];
  return joinWords(parts);
};

export const myntraPack = (cpm) => ({
  platform: 'myntra',
  title: myntraTitle(cpm),
  description: myntraDescription(cpm),
  bullets: amazonBullets(cpm).slice(0, 3),
  keywords: joinWords(dedupe([...(cpm.keywords?.primary || []), ...(cpm.keywords?.synonyms || [])].map(sanitize))),
});

/* ═══════════════ ALIBABA ═══════════════ */

/** B2B spec-first: type + material + specs + honest sizing. */
export const alibabaTitle = (cpm) => {
  const parts = [cpm.productType, attr(cpm, 'fabric'), attr(cpm, 'color'),
    attr(cpm, 'pattern'), attr(cpm, 'fit'), 'Ready to Ship'];
  return enforceMax(joinWords(parts), 120);
};

export const alibabaDescription = (cpm) => {
  const m = cpm.attributes?.measurements || {};
  const sizeLine = Object.keys(m).length
    ? `Available sizes: ${Object.entries(m).map(([s, v]) => `${s} (${v})`).join(', ')}.`
    : '';
  const parts = [
    `${cpm.productType}${attr(cpm, 'fabric') ? ` in ${attr(cpm, 'fabric')}` : ''}${attr(cpm, 'color') ? `, ${attr(cpm, 'color')}` : ''}${attr(cpm, 'pattern') ? `, ${attr(cpm, 'pattern')}` : ''}.`,
    cpm.fabricHandfeel ? cpm.fabricHandfeel[0].toUpperCase() + cpm.fabricHandfeel.slice(1) + '.' : '',
    sizeLine,
    attr(cpm, 'care') ? `Care: ${attr(cpm, 'care')}.` : '',
    'Bulk orders welcome — contact us for MOQ and lead time.',
  ];
  return joinWords(parts);
};

export const alibabaPack = (cpm) => ({
  platform: 'alibaba',
  title: alibabaTitle(cpm),
  description: alibabaDescription(cpm),
  keywords: joinWords(dedupe([...(cpm.keywords?.primary || []), ...(cpm.keywords?.synonyms || [])].map(sanitize))),
});

/* ═══════════════ INSTAGRAM ═══════════════ */

export const instagramCaption = (cpm) => {
  const occasion = rel(cpm, 'Used_For_Event') || attr(cpm, 'occasion');
  const parts = [
    `Introducing our ${cpm.productType.toLowerCase()}`,
    attr(cpm, 'color') ? `in ${attr(cpm, 'color')}` : '',
    occasion ? `— perfect for ${occasion}` : '',
    `${cpm.fabricHandfeel ? cpm.fabricHandfeel : attr(cpm, 'fabric') ? `Made from ${attr(cpm, 'fabric')}` : ''}.`,
    'Swipe for the full look. Link in bio to order!',
  ];
  return joinWords(parts);
};

export const instagramHashtags = (cpm) => {
  const tags = dedupe([
    ...(cpm.keywords?.primary || []),
    ...(cpm.keywords?.vernacular || []),
    ...(cpm.useCases || []),
  ].map((k) => sanitize(k).toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter((t) => t))
    .slice(0, 12)
    .map((t) => `#${t}`);
  return tags.join(' ');
};

export const instagramPack = (cpm) => ({
  platform: 'instagram',
  caption: instagramCaption(cpm),
  hashtags: instagramHashtags(cpm),
});

/* ═══════════════ dispatcher ═══════════════ */

export const renderPack = (platform, cpm) => {
  switch (platform) {
    case 'amazon': return amazonPack(cpm);
    case 'flipkart': return flipkartPack(cpm);
    case 'meesho': return meeshoPack(cpm);
    case 'myntra': return myntraPack(cpm);
    case 'alibaba': return alibabaPack(cpm);
    case 'instagram': return instagramPack(cpm);
    default: return null;
  }
};

/** Render every platform in the CPM's priority order. Deterministic. */
export const renderAll = (cpm) => {
  const order = (cpm.platformPriority || PLATFORMS).filter((p) => PLATFORMS.includes(p));
  return dedupe(order).map((p) => renderPack(p, cpm)).filter(Boolean);
};
