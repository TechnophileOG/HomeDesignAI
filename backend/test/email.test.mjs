/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — branded email template unit tests
   ────────────────────────────────────────────────────────────────────────
   Pure-function tests — no network, no Firestore, no env secrets. Covers:
     • template renders with brand lockup, heading, body, CTA, footer
     • user-controlled text is HTML-escaped (no template injection)
     • a missing CTA renders a body without a button link
     • emailConfigured() is false without env (graceful fallback state)
   ════════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { renderBranded, emailConfigured, escapeHtml } from '../src/email.js';

const results = [];
const pass = (name) => { results.push(`  ✅ ${name}`); console.log(`  ✅ ${name}`); };
const fail = (name, err) => { results.push(`  ❌ ${name}: ${err?.message || err}`); console.error(`  ❌ ${name}:`, err?.message || err); process.exitCode = 1; };

console.log('\n═══ STRUCTURE ═══');
try {
  const html = renderBranded({
    title: 'Reset your KatalogitAI password',
    preheader: 'Follow this link.',
    heading: 'Reset your password',
    bodyHtml: '<p>Hello <strong>store@example.com</strong>.</p>',
    ctaText: 'Set a new password',
    ctaUrl: 'https://katalogit.ai/app?mode=resetPassword&oobCode=abc123',
    footNote: 'Expires in 1 hour.',
  });
  assert.ok(html.includes('Katalogit'), 'brand wordmark present');
  assert.ok(html.includes('Reset your password'), 'heading present');
  assert.ok(html.includes('store@example.com'), 'body content present');
  assert.ok(html.includes('Set a new password'), 'CTA label present');
  assert.ok(html.includes('https://katalogit.ai/app?mode=resetPassword'), 'CTA href present');
  assert.ok(html.includes('Expires in 1 hour.'), 'footnote present');
  assert.ok(html.includes('<!DOCTYPE html>'), 'valid html document');
  pass('full template renders (lockup + heading + body + CTA + footer)');
} catch (err) { fail('structure', err); }

console.log('\n═══ ESCAPING (no injection) ═══');
try {
  const hostile = '<script>alert(1)</script>" onclick="steal()"';
  // bodyHtml is a TRUSTED-markup channel — user data must pass through
  // escapeHtml() first, exactly as the route senders do. Everything else
  // (title/heading/CTA/footnote) is escaped internally by the template.
  const html = renderBranded({
    title: hostile,
    heading: hostile,
    bodyHtml: `<p>User ${escapeHtml(hostile)}</p>`,
    ctaText: hostile,
    ctaUrl: 'https://x.test/" onmouseover="alert(2)',
    footNote: hostile,
  });
  assert.ok(!html.includes('<script>'), 'raw <script> never emitted');
  assert.ok(html.includes('&lt;script&gt;'), 'script is escaped');
  assert.ok(!html.includes('onclick="steal()"'), 'event handler not injectable');
  assert.ok(!html.includes('onmouseover="alert(2)'), 'attribute breakout blocked');
  assert.ok(html.includes('&quot;'), 'quotes escaped (&quot;)');
  pass('heading/body/CTA/footnote all HTML-escaped');
} catch (err) { fail('escaping', err); }

console.log('\n═══ NO CTA ═══');
try {
  const html = renderBranded({ title: 't', preheader: '', heading: 'h', bodyHtml: '<p>b</p>' });
  assert.ok(!html.includes('display:inline-block;background:#0f6240;color:#ffffff'), 'no button when CTA missing');
  assert.ok(html.includes('Need help?'), 'help block still present');
  pass('CTA-less render is safe');
} catch (err) { fail('no-cta', err); }

console.log('\n═══ CONFIG STATE ═══');
try {
  // No env secrets in the test runner → provider is unconfigured → the
  // routes must fall back to Firebase's own email. This is the default state
  // until the user wires Resend.
  assert.strictEqual(emailConfigured(), false, 'no secrets ⇒ not configured');
  pass('emailConfigured() false without env (fallback path active)');
} catch (err) { fail('config', err); }

const failed = results.some((r) => r.includes('❌'));
console.log(`\n${failed ? 'TESTS FAILED' : 'ALL TESTS PASSED'} (${results.filter((x) => x.includes('✅')).length}/${results.length})\n`);
process.exit(failed ? 1 : 0);
