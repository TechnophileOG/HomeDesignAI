/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Canonical Product Master (CPM)
   ────────────────────────────────────────────────────────────────────────
   The CPM is the single structured truth for a product: facts, attributes,
   keywords, COSMO intent relations, and compliance flags. Pass 1 of the
   multi-platform pipeline (the VLM) fills it ONCE per SKU; Pass 2 (the
   template engine) reads ONLY this object to render every platform's pack.

   This module owns the schema: `normalizeCpm()` defensively whitelists every
   key (unknown keys dropped — same anti-pollution rule as validate.js), caps
   every string, and applies defaults. `cpmFromSellerForm()` seeds a CPM from
   seller input so the engine is real before the VLM exists (Phase A).

   Companion docs: MULTIPLATFORM_PIPELINE_HLD.md, PLATFORM_SEO_PLAYBOOK.md
   ════════════════════════════════════════════════════════════════════════ */

import { badRequest } from './errors.js';

const fail = (label) => { throw badRequest('INVALID_FIELD', `Invalid ${label}.`); };

/* ── enums (the known domains) ────────────────────────────────────────── */

/** The 15 COSMO commonsense relations (Amazon, from the SIGMOD-2024 paper). */
export const COSMO_RELATIONS = [
  'Used_For_Func', 'Used_To', 'Capable_Of',       // functional
  'Used_For_Audience', 'Used_By', 'xIs_A',        // audience
  'Used_For_Event', 'Used_On', 'Used_In_Location', 'Used_In_Body', // context
  'Used_As', 'Is_A',                              // classification
  'Used_With', 'xInterested_In', 'xWant',         // complementary / interest
];

/** How the garment must be shown on the model (our modesty-aware feature). */
export const MODESTY_PROFILES = ['drape', 'loose', 'fitted'];

export const GENDER_FITS = ['women', 'men', 'kids', 'unisex'];

export const PLATFORMS = ['amazon', 'flipkart', 'meesho', 'myntra', 'alibaba', 'instagram'];

export const KEYWORD_GROUPS = ['primary', 'longTail', 'intent', 'vernacular', 'misspellings', 'synonyms'];

const ATTR_KEYS = ['fabric', 'fit', 'color', 'pattern', 'sleeve', 'neck', 'occasion', 'care', 'measurements'];

/* ── small safe helpers (local, not exported — validate.js stays the API boundary) ── */

const clean = (v, max) => {
  const t = String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim(); // eslint-disable-line no-control-regex
  if (t.length > max) fail('cpm field');
  return t;
};

const cleanOpt = (v, max) => (v === undefined || v === null) ? '' : clean(v, max);

const strArr = (v, itemMax, maxItems) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItems) fail('cpm list');
  const out = [];
  for (const item of v) {
    const c = clean(item, itemMax);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
};

/* ── the schema ───────────────────────────────────────────────────────── */

/**
 * Defensively normalize a raw CPM. Whitelists keys, caps every string, drops
 * unknown keys (prototype pollution / smuggling), applies defaults. Safe to
 * feed untrusted input (LLM output, seller form).
 */
export const normalizeCpm = (raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('cpm');
  const out = {
    sku: cleanOpt(raw.sku, 40),
    brand: cleanOpt(raw.brand, 60),
    category: cleanOpt(raw.category, 60),
    productType: cleanOpt(raw.productType, 120),
    fabricHandfeel: cleanOpt(raw.fabricHandfeel, 200),
  };

  // attributes — whitelisted keys only; measurements is a size→string map.
  const attrs = (typeof raw.attributes === 'object' && raw.attributes !== null && !Array.isArray(raw.attributes)) ? raw.attributes : {};
  out.attributes = {};
  for (const key of ATTR_KEYS) {
    if (key === 'measurements') {
      if (attrs.measurements !== undefined && attrs.measurements !== null) {
        if (typeof attrs.measurements !== 'object' || Array.isArray(attrs.measurements)) fail('measurements');
        out.attributes.measurements = {};
        for (const [size, spec] of Object.entries(attrs.measurements).slice(0, 8)) {
          out.attributes.measurements[clean(size, 8)] = clean(spec, 120);
        }
      }
    } else {
      const c = cleanOpt(attrs[key], 80);
      if (c) out.attributes[key] = c;
    }
  }

  out.useCases = strArr(raw.useCases, 40, 10);

  // keywords — grouped so each platform template picks the group it needs.
  out.keywords = {};
  for (const group of KEYWORD_GROUPS) {
    out.keywords[group] = strArr(raw.keywords?.[group], 60, 10);
  }

  // cosmoRelations — the intent layer (Amazon). Relation ∈ the 15 types.
  if (raw.cosmoRelations !== undefined && raw.cosmoRelations !== null) {
    if (!Array.isArray(raw.cosmoRelations) || raw.cosmoRelations.length > 15) fail('cosmoRelations');
    out.cosmoRelations = [];
    for (const r of raw.cosmoRelations) {
      if (typeof r !== 'object' || r === null || Array.isArray(r)) fail('cosmoRelation');
      if (!COSMO_RELATIONS.includes(r.relation)) continue; // unknown relation dropped
      const obj = cleanOpt(r.object, 60);
      if (obj) out.cosmoRelations.push({ relation: r.relation, object: obj });
    }
  } else {
    out.cosmoRelations = [];
  }

  // compliance — flags that drive image ordering, tags, and modesty poses.
  const comp = (typeof raw.compliance === 'object' && raw.compliance !== null && !Array.isArray(raw.compliance)) ? raw.compliance : {};
  out.compliance = {
    genderFit: GENDER_FITS.includes(comp.genderFit) ? comp.genderFit : 'unisex',
    modestyProfile: MODESTY_PROFILES.includes(comp.modestyProfile) ? comp.modestyProfile : 'loose',
    sizeChartRequired: typeof comp.sizeChartRequired === 'boolean' ? comp.sizeChartRequired : false,
    logoFree: typeof comp.logoFree === 'boolean' ? comp.logoFree : true,
    aiPerson: typeof comp.aiPerson === 'boolean' ? comp.aiPerson : true,
  };

  out.platformPriority = strArr(raw.platformPriority, 20, PLATFORMS.length)
    .filter((p) => PLATFORMS.includes(p));
  if (!out.platformPriority.length) out.platformPriority = [...PLATFORMS];

  return out;
};

/**
 * Phase A seed: build a CPM from a seller's manual form input (no AI yet).
 * Accepts a flat form; runs everything through normalizeCpm() so the output
 * is always schema-clean. Unknown form keys are ignored.
 */
export const cpmFromSellerForm = (form) => {
  if (typeof form !== 'object' || form === null || Array.isArray(form)) fail('form');
  const measurements = {};
  if (typeof form.measurements === 'object' && form.measurements !== null) {
    for (const [size, spec] of Object.entries(form.measurements)) {
      const s = clean(size, 8);
      const v = clean(spec, 120);
      if (s && v) measurements[s] = v;
    }
  }
  return normalizeCpm({
    sku: form.sku,
    brand: form.brand,
    category: form.category,
    productType: form.productType,
    fabricHandfeel: form.fabricHandfeel,
    attributes: {
      fabric: form.fabric,
      fit: form.fit,
      color: form.color,
      pattern: form.pattern,
      sleeve: form.sleeve,
      neck: form.neck,
      occasion: form.occasion,
      care: form.care,
      measurements,
    },
    useCases: form.useCases,
    keywords: {
      primary: form.keywords?.primary,
      longTail: form.keywords?.longTail,
      intent: form.keywords?.intent,
      vernacular: form.keywords?.vernacular,
      misspellings: form.keywords?.misspellings,
      synonyms: form.keywords?.synonyms,
    },
    cosmoRelations: form.cosmoRelations,
    compliance: {
      genderFit: form.genderFit,
      modestyProfile: form.modestyProfile,
      sizeChartRequired: form.sizeChartRequired,
      logoFree: form.logoFree,
      aiPerson: form.aiPerson,
    },
    platformPriority: form.platformPriority,
  });
};
