/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — Vertex AI fallback unit tests
   ────────────────────────────────────────────────────────────────────────
   Pure-function + injected-dependency tests — no network, no Firestore, no
   ADC. Covers:
     • endpoint construction (global + regional)
     • per-pose prompt composition (garment descriptor + pose, sanitized)
     • output-path determinism — byte-identical to the GPU path naming
     • generateWithVertexAi() with a stubbed generator/uploader: 8 poses,
       correct order, one upload per pose, same path for the same seed
   ════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import {
  vertexEndpoint, posePrompt, fallbackOutputPath, generateWithVertexAi, imageRequestPayload,
} from '../src/ai-fallback.js';

const results = [];
const pass = (name) => { results.push(`  ✅ ${name}`); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { results.push(`  ❌ ${name}: ${err?.message || err}`); console.error(`  ❌ ${name}:`, err?.message || err); process.exitCode = 1; };

console.log('\n═══ ENDPOINT ═══');
try {
  const global = vertexEndpoint({ project: 'p1', location: 'global', model: 'gemini-3.1-flash-lite-image' });
  assert.strictEqual(global,
    'https://aiplatform.googleapis.com/v1/projects/p1/locations/global/publishers/google/models/gemini-3.1-flash-lite-image:generateContent');
  pass('global endpoint');

  const regional = vertexEndpoint({ project: 'p1', location: 'asia-south1', model: 'gemini-3.1-flash-image' });
  assert.strictEqual(regional,
    'https://asia-south1-aiplatform.googleapis.com/v1/projects/p1/locations/asia-south1/publishers/google/models/gemini-3.1-flash-image:generateContent');
  pass('regional endpoint');
} catch (err) { fail('endpoint', err); }

console.log('\n═══ PROMPT ═══');
try {
  // Hostile title: parens/brackets/quotes/colons are prompt-metacharacters in
  // the model's weight syntax — promptSafe() must strip them BEFORE the text
  // reaches the model. Commas are allowed (our own pose instructions use
  // them); the check excludes the comma + slash the trusted pose text uses.
  const product = {
    title: "Women's Cotton Printed Kurti (Super) 100%: \"Premium\"",
    category: 'Ethnic Wear',
    aiSpecs: { colors: ['Navy', 'Blue'] },
  };
  const pose = { id: 'front', prompt: 'standing straight, facing the camera, full body' };
  const prompt = posePrompt(product, pose);
  assert.ok(prompt.includes('Kurti'), 'garment descriptor survives');
  assert.ok(prompt.includes('standing straight'), 'pose instruction survives');
  assert.ok(!/[()[\]{}:'"<>;|*~`]/.test(prompt), 'no prompt-metacharacters leak (injection-safe)');
  assert.ok(prompt.length > 40 && prompt.length < 600, `sane prompt length, got ${prompt.length}`);
  pass(`posePrompt composes + sanitizes (${prompt.length} chars)`);
} catch (err) { fail('prompt', err); }

console.log('\n═══ OUTPUT PATHS ═══');
try {
  const a = fallbackOutputPath({ storeId: 'store-abc12345', productId: 'p-1', index: 0, seed: 123456 });
  const b = fallbackOutputPath({ storeId: 'store-abc12345', productId: 'p-1', index: 0, seed: 123456 });
  assert.strictEqual(a, b, 'same inputs ⇒ same path (deterministic)');
  assert.strictEqual(a, 'stores/store-abc12345/products/p-1/poses/pose_0_123456.png', 'exact GPU-path naming');
  assert.ok(!a.includes('..'), 'no path traversal');
  pass('fallbackOutputPath matches GPU naming + deterministic');
} catch (err) { fail('output paths', err); }

console.log('\n═══ REQUEST PAYLOAD (live API shape) ═══');
try {
  const payload = imageRequestPayload({
    prompt: 'a model wearing a kurti',
    flatLayGcsUri: 'gs://katalogit-originals/stores/s/p/hero.png',
    flatLayMimeType: 'image/png',
  });
  assert.ok(payload.generationConfig?.imageConfig, 'imageConfig must be INSIDE generationConfig (the live API rejects it at top level)');
  assert.strictEqual(payload.generationConfig.imageConfig.aspectRatio, '2:3');
  assert.deepStrictEqual(payload.generationConfig.responseModalities, ['IMAGE']);
  assert.strictEqual(payload.contents[0].parts[0].fileData.fileUri, 'gs://katalogit-originals/stores/s/p/hero.png');
  pass('payload shape verified (imageConfig inside generationConfig)');
} catch (err) { fail('payload', err); }

console.log('\n═══ GENERATE (stubbed deps) ═══');
try {
  const uploads = [];
  const png = Buffer.from('fake-png-bytes');
  const { poses } = await generateWithVertexAi(
    { job: { storeId: 'store-abc12345' }, product: { id: 'p-1', flatLay: { path: 'stores/store-abc12345/flat_lay/hero.png', contentType: 'image/png' } } },
    {
      generate: async ({ prompt, flatLayGcsUri }) => {
        assert.ok(flatLayGcsUri.startsWith('gs://'), 'flat-lay passed as GCS uri');
        assert.ok(prompt.length > 0, 'prompt non-empty');
        return png;
      },
      upload: async (bucket, objectPath, buffer) => { uploads.push({ bucket, objectPath, buffer }); return objectPath; },
    },
  );

  assert.strictEqual(poses.length, 8, 'one pose per POSE_LIST entry (8)');
  assert.strictEqual(poses[0].poseId, 'front', 'poses in fixed order (front first)');
  assert.deepStrictEqual(poses.map((p) => p.index), [0, 1, 2, 3, 4, 5, 6, 7], 'indices 0–7');
  assert.strictEqual(uploads.length, 8, 'one upload per pose');
  for (const u of uploads) {
    assert.strictEqual(u.bucket, 'katalogit-processed');
    assert.strictEqual(u.buffer, png, 'uploaded bytes = generated bytes');
    assert.ok(u.objectPath.startsWith('stores/store-abc12345/products/p-1/poses/pose_'), 'upload path scoped to store+product');
  }
  // A second run with the same job+product yields the SAME paths (idempotent
  // gallery — switching engines never duplicates output).
  const run2 = await generateWithVertexAi(
    { job: { storeId: 'store-abc12345' }, product: { id: 'p-1', flatLay: { path: 'stores/store-abc12345/flat_lay/hero.png', contentType: 'image/png' } } },
    {
      generate: async () => png,
      upload: async (bucket, objectPath) => objectPath,
    },
  );
  assert.deepStrictEqual(run2.poses.map((p) => p.objectPath), poses.map((p) => p.objectPath), 'deterministic across runs');
  pass('generateWithVertexAi: 8 poses, ordered, one upload each, deterministic paths');
} catch (err) { fail('generate', err); }

console.log('\n═══ GUARDS ═══');
try {
  let threw = false;
  try {
    await generateWithVertexAi({ job: { storeId: 's' }, product: { id: 'p' } }); // no flatLay
  } catch { threw = true; }
  assert.ok(threw, 'missing flat-lay must reject');
  pass('missing flat-lay rejected');
} catch (err) { fail('guards', err); }

const failed = results.some((r) => r.includes('❌'));
console.log(`\n${failed ? 'TESTS FAILED' : 'ALL TESTS PASSED'} (${results.filter((x) => x.includes('✅')).length}/${results.length})\n`);
process.exit(failed ? 1 : 0);
