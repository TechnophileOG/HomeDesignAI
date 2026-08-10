/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — platform CSV export unit tests
   ────────────────────────────────────────────────────────────────────────
   Pure-function tests — no network, no Firestore, no ADC. Covers:
     • every platform renders a header row + one data row
     • CSV cell escaping (commas, quotes, newlines)
     • platform rules flow through: Amazon title ≤75, Meesho no ALL-CAPS
     • image URLs come from the product's real photo paths
     • deterministic output (same product ⇒ same bytes)
     • unknown platform ⇒ null
   ════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { platformExport, exportImageUrls, EXPORT_PLATFORMS, cpmFromProduct } from '../src/export.js';

const results = [];
const pass = (name) => { results.push(`  ✅ ${name}`); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { results.push(`  ❌ ${name}: ${err?.message || err}`); console.error(`  ❌ ${name}:`, err?.message || err); process.exitCode = 1; };

const product = {
  id: 'p-abc123',
  sku: 'KUR-NAVY-42',
  title: 'Women Cotton Printed Kurti with Full Sleeves for Festival and Casual Wear',
  category: 'Kurtis',
  price: '999',
  qty: 50,
  aiSpecs: {
    description: 'A breathable cotton kurti in navy blue with a printed pattern, regular fit.',
    material: 'Cotton',
    fit: 'Regular',
    care: 'Machine wash cold',
    colors: ['Navy', 'Blue'],
    sizes: ['S', 'M', 'L', 'XL'],
  },
  flatLay: { path: 'stores/store-abc12345/flat_lay/hero.png' },
  gallery: [
    { path: 'stores/store-abc12345/products/p-abc123/poses/pose_0.png' },
    { path: 'stores/store-abc12345/products/p-abc123/poses/pose_1.png' },
  ],
};

console.log('\n═══ IMAGE URLS ═══');
try {
  const urls = exportImageUrls(product);
  assert.strictEqual(urls.length, 3, 'flat-lay + 2 gallery poses');
  assert.ok(urls[0].startsWith('https://storage.googleapis.com/katalogit-originals/'), 'flat-lay from originals bucket');
  assert.ok(urls[1].includes('katalogit-processed/'), 'poses from processed bucket');
  pass('image URLs resolved from real photo paths');
} catch (err) { fail('images', err); }

console.log('\n═══ ALL PLATFORMS RENDER ═══');
try {
  for (const platform of EXPORT_PLATFORMS) {
    const out = platformExport({ platform, product, brand: 'SS Fashion House' });
    assert.ok(out && out.csv, `${platform} produces csv`);
    assert.ok(out.filename.startsWith(`katalogit-${platform}-`), `${platform} filename prefix`);
    const lines = out.csv.trim().split('\r\n');
    assert.strictEqual(lines.length, 2, `${platform} has header + 1 data row`);
    assert.ok(lines[0].includes(',') && lines[1].includes(','), `${platform} rows are comma-separated`);
    pass(`${platform} renders (${lines[0].split(',').length} columns)`);
  }
} catch (err) { fail('render all', err); }

console.log('\n═══ PLATFORM RULES FLOW THROUGH ═══');
try {
  const amazon = platformExport({ platform: 'amazon', product, brand: 'SS Fashion House' });
  const titleCell = amazon.csv.split('\r\n')[1].split(',')[0].replace(/^"|"$/g, '');
  assert.ok(titleCell.length <= 75, `Amazon title ≤75 chars, got ${titleCell.length}`);
  pass(`amazon title ≤75 (got ${titleCell.length})`);

  const meesho = platformExport({ platform: 'meesho', product, brand: 'SS Fashion House' });
  const meeshoTitle = meesho.csv.split('\r\n')[1].split(',')[0].replace(/^"|"$/g, '');
  assert.ok(!/[A-Z]{4,}/.test(meeshoTitle), 'meesho title has no ALL-CAPS run');
  pass('meesho title clean (no ALL-CAPS)');
} catch (err) { fail('rules', err); }

console.log('\n═══ ESCAPING ═══');
try {
  // Quote-aware CSV row splitter (naive split(',') breaks inside quoted cells).
  const splitCsvRow = (row) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (inQ) {
        if (ch === '"') {
          if (row[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };

  // The CPM templates render aiSpecs.material into the description/bullets —
  // put hostile cell content there (commas + quotes) and verify the CSV cell
  // comes out quoted with doubled quotes.
  const tricky = {
    ...product,
    aiSpecs: { ...product.aiSpecs, material: 'Cotton, 100% "Breezy"' },
  };
  const out = platformExport({ platform: 'amazon', product: tricky, brand: 'B' });
  const [header, ...rows] = out.csv.trim().split('\r\n');
  const line = rows[0];
  assert.ok(line.includes('""Breezy""'), 'embedded quotes are doubled ("")');
  assert.ok(line.includes('"Crafted from Cotton, 100%'), 'cell containing commas is wrapped in quotes');
  assert.strictEqual(splitCsvRow(line).length, splitCsvRow(header).length, 'row/header column counts match');
  pass('CSV escaping handles quotes + commas');
} catch (err) { fail('escaping', err); }

console.log('\n═══ DETERMINISM + GUARDS ═══');
try {
  const a = platformExport({ platform: 'myntra', product, brand: 'X' });
  const b = platformExport({ platform: 'myntra', product, brand: 'X' });
  assert.strictEqual(a.csv, b.csv, 'same product ⇒ byte-identical CSV');
  assert.strictEqual(platformExport({ platform: 'instagram', product, brand: 'X' }), null, 'non-export platform ⇒ null');
  assert.strictEqual(platformExport({ platform: 'amazon', product: null, brand: '' }), null, 'null product ⇒ null');
  assert.ok(cpmFromProduct(product).productType.includes('Kurtis'), 'cpmFromProduct derives productType from category');
  pass('deterministic + unknown/null guarded');
} catch (err) { fail('guards', err); }

const failed = results.some((r) => r.includes('❌'));
console.log(`\n${failed ? 'TESTS FAILED' : 'ALL TESTS PASSED'} (${results.filter((x) => x.includes('✅')).length}/${results.length})\n`);
process.exit(failed ? 1 : 0);
