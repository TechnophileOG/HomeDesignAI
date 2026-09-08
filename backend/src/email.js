/* ════════════════════════════════════════════════════════════════════════
   KatalogitAI — branded transactional email
   ────────────────────────────────────────────────────────────────────────
   Every user-facing email (password reset, email verification) is sent
   through HERE as a professionally-styled HTML email carrying the Katalogit
   brand — instead of Firebase's plain default template.

   Provider: Resend (REST, no SDK) — free tier 3,000 emails/mo is plenty at
   our stage. The one-time setup (user's part): a verified sending domain +
   RESEND_API_KEY in Secret Manager. Until then `emailConfigured()` is false
   and the routes gracefully fall back to Firebase's own email service, so
   nothing breaks during the transition.

   The one-time reset/verify codes are still MINTED by Firebase Identity
   Toolkit — only the delivery + design are ours. Codes stay single-use and
   short-lived; we never invent our own tokens.
   ════════════════════════════════════════════════════════════════════════ */

import { FIREBASE_WEB_API_KEY, RESEND_API_KEY, EMAIL_FROM, APP_URL, CORS_ORIGIN } from './config.js';

/* ── config ────────────────────────────────────────────────────────────── */

export const emailConfigured = () =>
  Boolean(RESEND_API_KEY && EMAIL_FROM && APP_URL && FIREBASE_WEB_API_KEY);

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ── Identity Toolkit: mint a one-time code (never invent our own) ─────── */

/** Validate a client-supplied continue URL: must be https (or localhost) and
    its origin must be the app's own (APP_URL or a CORS-allowlisted origin).
    Anything else is dropped — we never send a user to an attacker's domain. */
export const safeContinueUrl = (raw) => {
  try {
    const u = new URL(String(raw || '').slice(0, 500));
    const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!isLocalhost && u.protocol !== 'https:') return '';
    const allowed = new Set([
      APP_URL && new URL(APP_URL).origin,
      ...CORS_ORIGIN.map((o) => { try { return new URL(o).origin; } catch { return ''; } }),
    ].filter(Boolean));
    const origin = `${u.protocol}//${u.host}`;
    if (!allowed.has(origin)) return '';
    return u.toString().slice(0, 500);
  } catch { return ''; }
};

/** Mint a one-time code via Firebase Identity Toolkit.
    Returns { oobCode, oobLink } or null on failure. */
async function mintOob({ requestType, email, idToken, continueUrl }) {
  const body = { requestType, returnOobLink: true };
  if (email) body.email = email;
  if (idToken) body.idToken = idToken;
  // Prefer the validated client continue URL (it returns the user to the
  // exact app instance they came from); fall back to APP_URL when set.
  const cu = continueUrl || (APP_URL ? `${APP_URL}/app` : '');
  if (cu) body.continueUrl = cu;
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[email] sendOobCode ${resp.status}:`, text.slice(0, 300));
    return null;
  }
  const data = await resp.json();
  if (!data || !data.oobCode) return null;
  return { oobCode: data.oobCode, oobLink: data.oobLink || '' };
}

/** Password-reset one-time code for a given account email. */
export const mintPasswordResetCode = (email, continueUrl = '') =>
  mintOob({ requestType: 'PASSWORD_RESET', email, continueUrl });

/** Email-verification one-time code for the current user's ID token. */
export const mintVerificationCode = (idToken, continueUrl = '') =>
  mintOob({ requestType: 'VERIFY_EMAIL', idToken, continueUrl });

/* ── Resend: send an HTML email ────────────────────────────────────────── */

async function sendViaResend({ to, subject, html }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`[email] resend ${resp.status}:`, text.slice(0, 300));
    throw new Error('email provider rejected the message');
  }
  return true;
}

/* ── Branded template ──────────────────────────────────────────────────── */

const BRAND = {
  green: '#0f6240',
  greenDeep: '#0a3d28',
  cream: '#fdf7ee',
  gold: '#e9a93e',
  ink: '#24211d',
  muted: '#6b6459',
};

/**
 * Build the full branded email shell.
 * @param {object} o
 * @param {string} o.title          email subject
 * @param {string} o.preheader      hidden preview line
 * @param {string} o.heading        big in-body heading
 * @param {string} o.bodyHtml       main content (already escaped where needed)
 * @param {string} [o.ctaText]      button label
 * @param {string} [o.ctaUrl]       button href
 * @param {string} [o.footNote]     small note under the button
 */
export const renderBranded = ({
  title, preheader, heading, bodyHtml, ctaText, ctaUrl, footNote,
}) => {
  const cta = ctaText && ctaUrl
    ? `<div style="text-align:center;margin:26px 0 8px;">
         <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:12px;font-family:Inter,Arial,sans-serif;">${escapeHtml(ctaText)}</a>
       </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader || '')}&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};">
    <tr><td align="center" style="padding:28px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ecdfc8;">
        <!-- header -->
        <tr>
          <td align="center" style="background:linear-gradient(135deg, ${BRAND.green} 0%, ${BRAND.greenDeep} 100%);padding:26px 20px 22px;">
            <span style="display:inline-flex;align-items:center;gap:9px;">
              <span style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:9px;background:${BRAND.cream};color:${BRAND.green};font-weight:900;font-size:20px;text-align:center;font-family:Georgia,serif;">K</span>
              <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:Inter,Arial,sans-serif;">Katalogit<span style="color:${BRAND.gold};">AI</span></span>
            </span>
          </td>
        </tr>
        <!-- accent strip -->
        <tr><td height="4" style="background:${BRAND.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
        <!-- body -->
        <tr>
          <td style="padding:34px 34px 26px;font-family:Inter,Arial,sans-serif;">
            <h1 style="margin:0 0 14px;font-size:22px;line-height:1.35;font-weight:800;color:${BRAND.ink};font-family:Inter,Arial,sans-serif;">${escapeHtml(heading)}</h1>
            <div style="font-size:15px;line-height:1.7;color:#3d3831;">${bodyHtml}</div>
            ${cta}
            ${footNote ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(footNote)}</p>` : ''}
            <div style="margin:28px 0 0;padding:16px 18px;background:${BRAND.cream};border-radius:12px;font-size:12px;line-height:1.7;color:${BRAND.muted};">
              <strong style="color:${BRAND.green};">Need help?</strong> Reply to this email or reach us at
              <a href="mailto:hello@katalogit.ai" style="color:${BRAND.green};text-decoration:underline;">hello@katalogit.ai</a> —
              we reply within one business day.
            </div>
          </td>
        </tr>
        <!-- footer -->
        <tr>
          <td align="center" style="padding:18px 20px 24px;border-top:1px solid #f0e6d2;font-family:Inter,Arial,sans-serif;">
            <p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};">© ${new Date().getFullYear()} KatalogitAI · AI catalog photoshoots for Indian sellers</p>
            <p style="margin:0;font-size:11px;color:#a89c8a;">This is an automated message — please don't reply. We never ask for your password by email.</p>
          </td>
        </tr>
      </table>
      <p style="margin:14px 0 0;font-size:11px;color:#a89c8a;font-family:Inter,Arial,sans-serif;">KatalogitAI · India</p>
    </td></tr>
  </table>
</body>
</html>`;
};

/* ── High-level sends (used by the routes) ─────────────────────────────── */

/** Send a branded password-reset email. Returns true if delivered via our
    provider, false if the caller should fall back to Firebase's email. */
export async function sendPasswordResetBranded(email, toEmail = email, continueUrl = '') {
  if (!emailConfigured()) return false;
  try {
    const mint = await mintPasswordResetCode(email, continueUrl);
    if (!mint) return false;
    const url = `${APP_URL}/app?mode=resetPassword&oobCode=${encodeURIComponent(mint.oobCode)}`;
    const html = renderBranded({
      title: 'Reset your KatalogitAI password',
      preheader: 'Follow this link to set a new password for your store account.',
      heading: 'Reset your password',
      bodyHtml:
        `<p>We received a request to reset the password for <strong>${escapeHtml(toEmail)}</strong>.</p>
         <p>Tap the button below to choose a new password. This link expires in 1 hour and works once — if you didn't request it, you can safely ignore this email.</p>`,
      ctaText: 'Set a new password',
      ctaUrl: url,
      footNote: 'Button not working? Copy-paste this link into your browser: ' + url,
    });
    await sendViaResend({ to: toEmail, subject: 'Reset your KatalogitAI password', html });
    return true;
  } catch (err) {
    console.error('[email] branded reset failed:', err && err.message ? err.message : err);
    return false;
  }
}

/** Send a branded email-verification message. Returns true if delivered via
    our provider, false → caller falls back to Firebase's own email. */
export async function sendVerificationBranded(toEmail, idToken, continueUrl = '') {
  if (!emailConfigured()) return false;
  try {
    const mint = await mintVerificationCode(idToken, continueUrl);
    if (!mint) return false;
    const url = mint.oobLink || `${APP_URL}/app?mode=verifyEmail&oobCode=${encodeURIComponent(mint.oobCode)}`;
    const html = renderBranded({
      title: 'Verify your KatalogitAI email',
      preheader: 'Confirm your email address to activate your store account.',
      heading: 'Verify your email address',
      bodyHtml:
        `<p>Welcome to KatalogitAI, <strong>${escapeHtml(toEmail)}</strong>!</p>
         <p>Confirming your email activates your account and keeps your store protected. This link expires in 1 hour and works once.</p>`,
      ctaText: 'Verify my email',
      ctaUrl: url,
      footNote: 'Button not working? Copy-paste this link into your browser: ' + url,
    });
    await sendViaResend({ to: toEmail, subject: 'Verify your KatalogitAI email', html });
    return true;
  } catch (err) {
    console.error('[email] branded verify failed:', err && err.message ? err.message : err);
    return false;
  }
}
