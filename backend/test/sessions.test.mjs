/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — live session security unit tests (validators)
   ────────────────────────────────────────────────────────────────────────
   Pure-function tests — no network, no Firestore. Covers the join-token
   charset rule, photo data-URL rules (mime whitelist, size cap, strict
   base64), and body whitelisting for join/photo/create.
   ════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import {
  sessionToken, deviceName, sessionPhotoMeta, sessionPhotoConfirm,
  sessionCreate, sessionJoin, sessionPhotoUpload,
} from '../src/validate.js';

const results = [];
const pass = (name) => { results.push(`  ✅ ${name}`); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { results.push(`  ❌ ${name}: ${err?.message || err}`); console.error(`  ❌ ${name}:`, err?.message || err); process.exitCode = 1; };
const rejects = async (fn) => { try { fn(); return false; } catch { return true; } };

console.log('\n═══ JOIN/DEVICE TOKENS ═══');
try {
  const good = 'a'.repeat(64);
  assert.strictEqual(sessionToken(good), good, '64-hex accepted');
  assert.strictEqual(sessionToken('0'.repeat(32) + 'f'.repeat(32)), '0'.repeat(32) + 'f'.repeat(32));
  pass('64-hex tokens accepted');

  let ok = await rejects(() => sessionToken('a'.repeat(63)));
  assert.ok(ok, '63 chars rejected');
  ok = await rejects(() => sessionToken('g'.repeat(64)));
  assert.ok(ok, 'non-hex rejected');
  ok = await rejects(() => sessionToken('A'.repeat(64)));
  assert.ok(ok, 'uppercase hex rejected (strict lowercase)');
  ok = await rejects(() => sessionToken(undefined));
  assert.ok(ok, 'undefined rejected');
  ok = await rejects(() => sessionToken('a'.repeat(65)));
  assert.ok(ok, '65 chars rejected');
  pass('malformed tokens rejected');
} catch (err) { fail('tokens', err); }

console.log('\n═══ DEVICE NAMES ═══');
try {
  assert.strictEqual(deviceName('  Rahul <script>  '), 'Rahul');
  assert.strictEqual(deviceName('Samsung A54'), 'Samsung A54');
  let ok = await rejects(() => deviceName('x'.repeat(41)));
  assert.ok(ok, 'oversize name rejected');
  pass('names sanitized + capped');
} catch (err) { fail('names', err); }

console.log('\n═══ PHOTO METADATA (GCS-staged) ═══');
try {
  const meta = sessionPhotoMeta({ mime: 'image/jpeg', size: 5 * 1024 * 1024, index: 3 });
  assert.strictEqual(meta.mime, 'image/jpeg');
  assert.strictEqual(meta.size, 5 * 1024 * 1024);
  assert.strictEqual(meta.index, 3);
  pass('jpeg/png/webp metadata accepted');

  let ok = await rejects(() => sessionPhotoMeta({ mime: 'image/gif', size: 100, index: 0 }));
  assert.ok(ok, 'gif rejected');
  ok = await rejects(() => sessionPhotoMeta({ mime: 'image/jpeg', size: 0, index: 0 }));
  assert.ok(ok, 'zero-size rejected');
  ok = await rejects(() => sessionPhotoMeta({ mime: 'image/jpeg', size: 10 * 1024 * 1024 + 1, index: 0 }));
  assert.ok(ok, '>10MB rejected');
  ok = await rejects(() => sessionPhotoMeta({ mime: 'image/jpeg', size: 'huge', index: 0 }));
  assert.ok(ok, 'non-numeric size rejected');
  ok = await rejects(() => sessionPhotoMeta('data:image/jpeg;base64,AAAA'));
  assert.ok(ok, 'raw data-URL body rejected (metadata only now)');
  pass('forged/oversize photo metadata rejected');

  // confirm path validates the same metadata rules
  const conf = sessionPhotoConfirm({ mime: 'image/webp', size: 1234, index: 7 });
  assert.strictEqual(conf.mime, 'image/webp');
  assert.strictEqual(conf.size, 1234);
  assert.strictEqual(conf.index, 7);
  ok = await rejects(() => sessionPhotoConfirm({ mime: 'image/jpeg', size: 11 * 1024 * 1024, index: 0 }));
  assert.ok(ok, 'confirm rejects oversize');
  pass('confirm shares the same rules');
} catch (err) { fail('photos', err); }

console.log('\n═══ BODY WHITELISTING ═══');
try {
  const created = sessionCreate({ title: '  Morning shoot  ', evil: 'x', __proto__: { hacked: 1 } });
  assert.strictEqual(created.title, 'Morning shoot');
  assert.ok(!('evil' in created), 'unknown keys dropped');
  assert.ok(!('hacked' in created), 'prototype pollution blocked');

  const joined = sessionJoin({ token: 'a'.repeat(64), deviceName: 'iPhone 15', junk: true });
  assert.strictEqual(joined.deviceName, 'iPhone 15');
  assert.ok(!('junk' in joined), 'unknown join keys dropped');

  const up = sessionPhotoUpload({ mime: 'image/png', size: 2048, index: 3, nope: 1, dataUrl: 'x' });
  assert.strictEqual(up.index, 3);
  assert.strictEqual(up.mime, 'image/png');
  assert.strictEqual(up.size, 2048);
  assert.ok(!('nope' in up), 'unknown photo keys dropped');
  assert.ok(!('dataUrl' in up), 'payload bytes never accepted via the API');
  pass('bodies whitelisted, pollution-safe');
} catch (err) { fail('bodies', err); }

const failed = results.some((r) => r.includes('❌'));
console.log(`\n${failed ? 'TESTS FAILED' : 'ALL TESTS PASSED'} (${results.filter((x) => x.includes('✅')).length}/${results.length})\n`);
process.exit(failed ? 1 : 0);
