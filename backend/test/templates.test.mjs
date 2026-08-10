/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Template Engine unit tests (Phase A)
   ────────────────────────────────────────────────────────────────────────
   Pure-function tests — no Firestore, no network, runs anywhere:
     npm test   (from backend/)
   Verifies every platform rule from PLATFORM_SEO_PLAYBOOK.md:
     Amazon  title ≤75 chars · bullets ≤5 × ≤1000 · backend ≤250 BYTES ·
             Item Highlights ≤5 × ≤40
     Meesho  title 50–120 chars
     Flipkart / Myntra / Alibaba / Instagram sane + deterministic
   Plus CPM normalization (whitelist keys, caps, defaults) and seller-form
   seeding.
   ════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { normalizeCpm, cpmFromSellerForm, COSMO_RELATIONS, PLATFORMS } from '../src/cpm.js';
import {
  amazonTitle, amazonBullets, amazonBackendKeywords, amazonItemHighlights,
  meeshoTitle, flipkartTitle, myntraTitle, alibabaTitle, instagramCaption,
  renderPack, renderAll,
} from '../src/platform-templates.js';

const results = [];
const pass = (name) => { results.push(`  ✅ ${name}`); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { results.push(`  ❌ ${name}: ${err?.message || err}`); console.error(`  ❌ ${name}:`, err?.message || err); process.exitCode = 1; };

/* ── a realistic kurti CPM (matches the HLD worked example) ───────────── */
const kurti = normalizeCpm({
  sku: 'KUR-NAV-001',
  brand: 'Katalogit',
  category: 'apparel',
  productType: "Women's Cotton Printed Kurti",
  fabricHandfeel: 'soft breathable 100% cotton',
  attributes: {
    fabric: 'cotton', fit: 'regular', color: 'navy', pattern: 'printed',
    sleeve: '3/4', neck: 'round', occasion: 'casual', care: 'machine wash cold',
    measurements: { S: '36-38 in', M: '38-40 in', L: '40-42 in', XL: '42-44 in' },
  },
  useCases: ['daily wear', 'office', 'festive casual'],
  keywords: {
    primary: ['cotton kurti', 'printed kurti for women'],
    longTail: ['navy blue printed cotton kurti', 'kurti for office wear women'],
    intent: ['kurti under 500', 'kurti for college'],
    vernacular: ['kurti', 'kurta', 'cotton kurta for women'],
    misspellings: ['kurty', 'kurtie'],
    synonyms: ['ethnic wear', 'indian dress'],
  },
  cosmoRelations: [
    { relation: 'Used_For_Event', object: 'festival' },
    { relation: 'Used_For_Audience', object: 'working women' },
    { relation: 'Used_With', object: 'leggings and jhumkas' },
    { relation: 'xWant', object: 'look elegant without tight clothes' },
    { relation: 'Used_In_Body', object: 'soft on skin' },
  ],
  compliance: { genderFit: 'women', sizeChartRequired: true, logoFree: true, aiPerson: true, modestyProfile: 'loose' },
});

console.log('\n═══ AMAZON ═══');
try {
  const title = amazonTitle(kurti);
  assert.ok(title.length <= 75, `Amazon title must be ≤75 chars, got ${title.length}: "${title}"`);
  assert.ok(!/\s{2,}/.test(title), 'no double spaces');
  assert.ok(!title.includes('undefined') && !title.includes('null'), 'no undefined/null leaks');
  pass(`amazonTitle ≤75 (${title.length}): "${title}"`);

  const bullets = amazonBullets(kurti);
  assert.ok(bullets.length >= 4 && bullets.length <= 5, `5 bullets max, got ${bullets.length}`);
  for (const b of bullets) assert.ok(b.length <= 1000, `bullet ≤1000 chars, got ${b.length}`);
  pass(`amazonBullets ${bullets.length}× ≤1000: "${bullets[0]}"`);

  const bk = amazonBackendKeywords(kurti);
  assert.ok(Buffer.byteLength(bk, 'utf8') <= 250, `backend keywords ≤250 BYTES, got ${Buffer.byteLength(bk, 'utf8')}`);
  assert.ok(bk.toLowerCase().includes('kurti'), 'vernacular keyword survives');
  pass(`amazonBackendKeywords ≤250B (${Buffer.byteLength(bk, 'utf8')}B)`);

  const highlights = amazonItemHighlights(kurti);
  assert.ok(highlights.length <= 5, '≤5 highlights');
  for (const h of highlights) assert.ok(h.length <= 40, `highlight ≤40 chars, got ${h.length}`);
  pass(`amazonItemHighlights ${highlights.length}× ≤40`);

  // A pathological long title must still be word-safe (no mid-word cut).
  const longCpm = normalizeCpm({ productType: 'Women Premium Hand Embroidered Silk Blend Anarkali Suit Set With Dupatta Party Wear', attributes: { color: 'royal blue', pattern: 'embroidered', fabric: 'silk blend', fit: 'flared' }, compliance: { genderFit: 'women' } });
  const longTitle = amazonTitle(longCpm);
  assert.ok(longTitle.length <= 75, `long title truncated to ≤75, got ${longTitle.length}`);
  const last = longTitle.split(' ').pop();
  assert.ok(longCpm.productType.includes(last) || ['royal', 'blue', 'embroidered', 'silk', 'blend', 'flared'].includes(last), 'last word must be a complete token');
  pass(`long-title truncation word-safe (${longTitle.length}): "${longTitle}"`);
} catch (err) { fail('amazon', err); }

console.log('\n═══ MEESHO ═══');
try {
  const title = meeshoTitle(kurti);
  assert.ok(title.length >= 50 && title.length <= 120, `Meesho title must be 50–120, got ${title.length}: "${title}"`);
  assert.ok(!/[A-Z]{2,}/.test(title), 'no ALL CAPS runs');
  pass(`meeshoTitle 50–120 (${title.length}): "${title}"`);

  // A sparse CPM must be padded UP to the 50 floor.
  const sparse = normalizeCpm({ productType: 'Kurti', attributes: { color: 'navy' }, useCases: ['daily wear', 'office'] });
  const padded = meeshoTitle(sparse);
  assert.ok(padded.length >= 50, `sparse CPM padded to ≥50, got ${padded.length}: "${padded}"`);
  pass(`meeshoTitle pads sparse CPM to ≥50 (${padded.length})`);
} catch (err) { fail('meesho', err); }

console.log('\n═══ FLIPKART / MYNTRA / ALIBABA / INSTAGRAM ═══');
try {
  const ft = flipkartTitle(kurti);
  assert.ok(ft.length <= 150, `Flipkart title sane (≤150), got ${ft.length}`);
  assert.ok(ft.toLowerCase().includes('kurti'), 'keyword-first: type survives');
  pass(`flipkartTitle (${ft.length}): "${ft}"`);

  const mt = myntraTitle(kurti);
  assert.ok(/Women's/i.test(mt), 'Myntra gender language');
  assert.ok(mt.length <= 120, `Myntra title ≤120, got ${mt.length}`);
  pass(`myntraTitle gender+fit (${mt.length}): "${mt}"`);

  const at = alibabaTitle(kurti);
  assert.ok(at.toLowerCase().includes('ready to ship'), 'Alibaba spec-first framing');
  pass(`alibabaTitle (${at.length}): "${at}"`);

  const cap = instagramCaption(kurti);
  assert.ok(cap.length > 0 && cap.length < 500, 'Instagram caption sane');
  pass(`instagramCaption (${cap.length}): "${cap}"`);
} catch (err) { fail('other platforms', err); }

console.log('\n═══ CPM NORMALIZATION ═══');
try {
  const clean = normalizeCpm({ productType: 'Kurti', evil: 'drop me', attributes: { fabric: 'cotton', evilAttr: 'x' }, cosmoRelations: [{ relation: 'Not_A_Relation', object: 'x' }, { relation: 'Used_With', object: 'leggings' }], compliance: { genderFit: 'alien', sizeChartRequired: true } });
  assert.strictEqual(clean.evil, undefined, 'unknown top-level key dropped');
  assert.strictEqual(clean.attributes.evilAttr, undefined, 'unknown attribute key dropped');
  assert.strictEqual(clean.cosmoRelations.length, 1, 'unknown relation dropped, valid kept');
  assert.strictEqual(clean.cosmoRelations[0].relation, 'Used_With');
  assert.strictEqual(clean.compliance.genderFit, 'unisex', 'invalid enum falls back to default');
  assert.strictEqual(clean.compliance.sizeChartRequired, true, 'valid boolean preserved');
  pass('normalizeCpm whitelists keys, drops unknowns, applies defaults');

  // Seller-form seeding produces a schema-clean CPM.
  const seeded = cpmFromSellerForm({ productType: 'Kurti', fabric: 'cotton', color: 'navy', genderFit: 'women', keywords: { primary: ['cotton kurti'] }, measurements: { M: '38-40 in' } });
  assert.strictEqual(seeded.attributes.fabric, 'cotton');
  assert.strictEqual(seeded.compliance.genderFit, 'women');
  assert.strictEqual(seeded.attributes.measurements.M, '38-40 in');
  pass('cpmFromSellerForm seeds a valid CPM');

  // COSMO + platform enums are complete and stable.
  assert.strictEqual(COSMO_RELATIONS.length, 15, '15 COSMO relation types');
  assert.ok(PLATFORMS.includes('amazon') && PLATFORMS.includes('instagram'));
  pass(`enums: 15 COSMO relations, ${PLATFORMS.length} platforms`);
} catch (err) { fail('cpm normalization', err); }

console.log('\n═══ DETERMINISM + DISPATCH ═══');
try {
  const a = renderAll(kurti);
  const b = renderAll(kurti);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), 'same CPM ⇒ identical packs');
  assert.ok(a.length >= 4, `priority-ordered packs for ${a.length} platforms`);
  assert.strictEqual(a[0].platform, 'amazon', 'platformPriority respected');
  pass(`renderAll deterministic, ${a.length} platforms (${a.map((p) => p.platform).join(', ')})`);

  const pack = renderPack('amazon', kurti);
  assert.strictEqual(pack.platform, 'amazon');
  assert.ok(pack.title && pack.bullets.length > 0 && pack.backendKeywords, 'amazon pack complete');
  pass('renderPack dispatcher returns the amazon pack');
} catch (err) { fail('determinism/dispatch', err); }

const failed = results.some((r) => r.includes('❌'));
console.log(`\n${failed ? 'TESTS FAILED' : 'ALL TESTS PASSED'} (${results.filter((x) => x.includes('✅')).length}/${results.length})\n`);
process.exit(failed ? 1 : 0);
