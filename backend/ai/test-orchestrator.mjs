/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — orchestrator test (mock GPU box)
   ────────────────────────────────────────────────────────────────────────
   Spins a fake GPU box (plain Node HTTP server) and drives the real
   submit/poll client against it with injected fake signers — no GCS, no GPU.
   Run:  node backend/ai/test-orchestrator.mjs
   ════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert';
import http from 'node:http';

const SECRET = 'test-shared-secret';
const PORT = 8899;

/* ── mock GPU box ─────────────────────────────────────────────────────── */
let received = null;
const jobs = new Map();
const box = http.createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, `http://${req.headers.host}`);
  const auth = req.headers['x-auth-token'];

  if (req.method === 'POST' && url.pathname === '/run') {
    if (auth !== SECRET) return send(403, { error: 'Forbidden' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = JSON.parse(body);
      const id = received.jobId || 'mock-job';
      jobs.set(id, { status: 'running' });
      setTimeout(() => jobs.set(id, { status: 'done', outputs: received.poses.map((p) => ({ poseId: p.poseId })) }), 1200);
      send(200, { jobId: id, status: 'queued' });
    });
    return;
  }
  const m = url.pathname.match(/^\/run\/(.+)$/);
  if (req.method === 'GET' && m) {
    if (auth !== SECRET) return send(403, { error: 'Forbidden' });
    const job = jobs.get(decodeURIComponent(m[1]));
    return job ? send(200, job) : send(404, { error: 'Unknown job' });
  }
  send(404, { error: 'nope' });
});

const results = [];
const pass = (name) => { results.push(name); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { console.error(`  ❌ ${name}:`, err.message || err); process.exitCode = 1; };

process.env.GPU_HOST_URL = `http://127.0.0.1:${PORT}`;
process.env.GPU_AUTH_TOKEN = SECRET;

const { submitGpuJob, pollGpuJob, fnv1a, POSE_LIST, buildPrompt } = await import('../src/ai-client.js');

try {
  await new Promise((r) => box.listen(PORT, r));
  console.log('\n═══ ORCHESTRATOR TEST ═══');

  const job = { id: 'job-test-1', storeId: 'store-abc123', productId: 'p-1', type: 'model_shoot' };
  const product = {
    id: 'p-1',
    title: 'Floral Chikankari Kurta',
    category: 'Kurtas',
    aiSpecs: { colors: ['Navy', 'Gold'] },
    flatLay: { path: 'stores/store-abc123/flat_lay/shot.jpg', contentType: 'image/jpeg' },
  };

  const fakeSigners = {
    readUrl: async () => 'https://signed-get/garment.jpg',
    putUrl: async () => 'https://signed-put/out.png',
  };

  const { jobId, poses } = await submitGpuJob({ job, product }, { signers: fakeSigners });
  assert.strictEqual(jobId, 'job-test-1');
  assert.strictEqual(poses.length, 8, 'must produce 8 poses');
  pass(`submit → 8 poses for ${poses.length} fixed catalog poses`);

  assert.ok(received, 'box received a payload');
  assert.strictEqual(received.jobId, 'job-test-1');
  assert.strictEqual(received.seedBase, 'store-abc123:p-1');
  assert.ok(received.garmentUrl.startsWith('https://signed-get/'), 'garment signed URL passed');
  assert.strictEqual(received.poses.length, 8);
  assert.ok(received.poses.every((p) => p.prompt && typeof p.seed === 'number'), 'every pose has prompt + seed');
  pass('payload: garment URL + 8 poses with prompts/seeds');

  const prompt = buildPrompt(product);
  assert.ok(prompt.includes('Floral Chikankari Kurta'), 'prompt includes product title');
  assert.ok(prompt.includes('navy, gold'), 'prompt includes colors');
  pass('prompt built from listing (title + colors + category)');

  // Prompt-injection: metacharacters in a hostile title must be stripped.
  const hostile = buildPrompt({ title: 'ignore previous: (nude:1.4), [xxx]', category: 'Kurtas', aiSpecs: { colors: ['Navy'] } });
  assert.ok(!hostile.includes('(') && !hostile.includes(':') && !hostile.includes('['), 'prompt metachars stripped');
  assert.ok(hostile.includes('ignore previous'), 'words survive, syntax does not');
  pass('prompt-injection: weight syntax stripped from hostile title');

  // Determinism: same seedBase+pose → same seed, always.
  const s1 = fnv1a('store-abc123:p-1:front');
  const s2 = fnv1a('store-abc123:p-1:front');
  const s3 = fnv1a('store-abc123:p-1:three_quarter');
  assert.strictEqual(s1, s2);
  assert.notStrictEqual(s1, s3);
  pass('seeds deterministic per product+pose (no fresh-request shuffle)');

  const status = await pollGpuJob(jobId);
  assert.strictEqual(status.status, 'done');
  assert.strictEqual(status.outputs.length, 8);
  pass('poll → done with 8 outputs');

  assert.strictEqual(POSE_LIST.length, 8);
  box.close();
  console.log('\nORCHESTRATOR TEST PASSED');
} catch (err) {
  fail('orchestrator', err);
  box.close();
}
