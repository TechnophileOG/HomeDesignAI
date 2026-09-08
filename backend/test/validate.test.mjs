/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — store validator tests (pin + location)
   ────────────────────────────────────────────────────────────────────────
   Pure-function tests — no network, no Firestore, no ADC. Verifies that the
   new onboarding fields are sanitized server-side: PIN must be exactly 6
   digits, location is key-whitelisted with numeric bounds, and junk input
   is rejected or dropped — never persisted.
   ════════════════════════════════════════════════════════════════════════ */

import { strict as assert } from 'node:assert';
import { store as sanitizeStore } from '../src/validate.js';

const throwsCode = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.code || err.message;
  }
  return null;
};

// A valid base payload to mutate per-test.
const base = () => ({
  name: 'Fashion House',
  city: 'Delhi',
  pin: '110024',
  location: { label: 'Lajpat Nagar, New Delhi', lat: 28.567, lng: 77.245 },
  categories: ['women'],
  scale: 'small',
});

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`); };

/* 1 — valid payload passes through clean */
{
  const out = sanitizeStore(base());
  assert.equal(out.pin, '110024');
  assert.equal(out.location.label, 'Lajpat Nagar, New Delhi');
  assert.equal(out.location.lat, 28.567);
  assert.equal(out.location.lng, 77.245);
  ok('valid pin + location pass through');
}

/* 2 — PIN must be exactly 6 digits */
{
  for (const bad of ['11002', '1100244', 'abc123', '110 24', '110024a']) {
    assert.ok(throwsCode(() => sanitizeStore({ ...base(), pin: bad })), `pin '${bad}' must be rejected`);
  }
  ok('malformed PINs are rejected (empty string is the explicit clear)');
}

/* 3 — location is optional */
{
  const out = sanitizeStore({ ...base(), location: undefined, pin: undefined });
  assert.equal(out.pin, undefined);
  assert.equal(out.location, undefined);
  ok('location/pin optional (undefined dropped)');
}

/* 3b — empty pin string clears (onboarding sends '' when skipped) */
{
  const out = sanitizeStore({ ...base(), pin: '' });
  assert.equal(out.pin, '');
  ok('empty PIN clears without failing (no 400 on skip)');
}

/* 4 — location keys are whitelisted; junk keys dropped */
{
  const out = sanitizeStore({ ...base(), location: { label: 'Okhla', evil: 'x', lat: 1, lng: 2 } });
  assert.deepEqual(Object.keys(out.location).sort(), ['label', 'lat', 'lng']);
  ok('unknown location keys are dropped (whitelist)');
}

/* 5 — location coordinate bounds enforced */
{
  assert.ok(throwsCode(() => sanitizeStore({ ...base(), location: { lat: 91, lng: 0 } })), 'lat > 90 rejected');
  assert.ok(throwsCode(() => sanitizeStore({ ...base(), location: { lat: 0, lng: -181 } })), 'lng < -180 rejected');
  assert.ok(throwsCode(() => sanitizeStore({ ...base(), location: { label: 'x', lat: '28' } })), 'string lat rejected');
  ok('coordinate bounds + types enforced');
}

/* 6 — control chars / HTML never survive into stored fields */
{
  const out = sanitizeStore({ ...base(), name: 'Store<script>alert(1)</script>', city: 'Delhi\u0000 City' });
  assert.ok(!/</.test(out.name));
  assert.ok(!/\u0000/.test(out.city)); // eslint-disable-line no-control-regex
  ok('control chars + markup stripped from store fields');
}

console.log(`\nvalidate.test: ${passed} passed`);
