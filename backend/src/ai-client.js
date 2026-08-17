/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — prompt utilities + pose catalog (shared by all engines)
   ────────────────────────────────────────────────────────────────────────
   The 8 fixed poses + their prompt suffixes (single source of truth).
   Prompt building / sanitization for the Vertex AI engine. No network
   code — pure functions.
   ════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The 8 fixed poses + their prompt suffixes (single source of truth).
const POSES = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../ai/poses.json'), 'utf8'),
);

export const POSE_LIST = POSES.map((p, index) => ({ id: p.id, name: p.name, prompt: p.prompt, index }));

/** FNV-1a 32-bit — deterministic seed from store+product+pose (no shuffling). */
export const fnv1a = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const MODEL_DESCRIPTOR = 'a beautiful young Indian female model, natural skin, natural makeup, commercial fashion model, photorealistic';
const STYLE = 'studio product photography, soft studio lighting, seamless light gray background, professional e-commerce catalog, sharp focus, 4k, high detail, photorealistic';

/** Strip prompt-metacharacters and instruction-like keywords from user text
    before it reaches the model (weight syntax `(x:1.4)`, brackets, commas,
    quotes) — a store owner must never be able to inject instructions/NSFW/
    celebrity content into a prompt the company is legally liable for. */
const INJECTION_PATTERNS = /\b(ignore|disregard|system|override|bypass|jailbreak|reveal|instructions?|prompt|developer|assistant)\b|(ignore|forget|disregard)\s+(all|any|previous)|previous\s+(instructions?|messages?|prompts?)|follow\s+these|new\s+instructions?|output\s+only/gi;
export const promptSafe = (text, max) => {
  const clean = String(text || '')
    .replace(/[()[\]{}:,/\\'"<>;|*~`]/g, ' ')
    .replace(INJECTION_PATTERNS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  // Reject suspiciously short/empty results (callers fall back to defaults).
  return clean.length < 3 ? '' : clean;
};

/**
 * Build the prompt for a product (garment descriptor comes from the listing).
 */
export function buildPrompt(product) {
  // Sanitized fields only — never raw user input (prompt-injection safe).
  const title = promptSafe(product.title, 60) || 'this garment';
  const category = promptSafe(product.category, 40);
  const colors = Array.isArray(product.aiSpecs?.colors) && product.aiSpecs.colors.length
    ? ` in ${product.aiSpecs.colors.slice(0, 4).map((c) => promptSafe(c, 30)).filter(Boolean).join(', ').toLowerCase()}`
    : '';
  return `${MODEL_DESCRIPTOR} wearing ${title}${colors}${category ? `, ${category}` : ''}, ${STYLE}`;
}
