/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — App Auth (Firebase Auth wrapper)
   ────────────────────────────────────────────────────────────────────────────
   Replaces the old on-device PBKDF2 store with REAL Firebase Auth. The public
   interface is unchanged (hasSession / signIn / register / signOut), so the
   UI (AuthGate, App) didn't have to learn a new API.

   Security notes:
     • Passwords NEVER touch our servers — sign-in happens in the Firebase
       SDK against Google's Identity Platform over TLS.
     • `isAdmin` is NEVER decided client-side: it comes from the server's
       OWNER_EMAIL check via GET /me and is merged into the session. The
       Owner Console additionally requires the passcode unlock session.
     • The ID token is short-lived (~1h); client.js refreshes it before every
       API call via getToken() (Firebase auto-refreshes).
   ════════════════════════════════════════════════════════════════════════════ */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  sendEmailVerification,
  reload as fbReload,
  signOut as fbSignOut,
  updateProfile,
  getIdToken,
  applyActionCode,
} from 'firebase/auth';
import { fbAuth } from './firebase';
import { api, setTokenGetter } from './client';

const sanitizeEmail = (raw) => {
  const e = String(raw ?? '').trim().toLowerCase().slice(0, 120);
  return /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(e) ? e : '';
};
const sanitizeName = (raw) =>
  String(raw ?? '').replace(/[^\w\s.,'&()/-]/g, '').trim().slice(0, 60);

/** Firestore-style friendly messages — never expose raw SDK errors. */
const friendly = (err) => {
  const c = err?.code || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') {
    return 'Invalid email or password.';
  }
  if (c === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead.';
  if (c === 'auth/invalid-email') return 'Enter a valid email address.';
  if (c === 'auth/weak-password') return 'Password is too weak — use 8+ characters with letters and numbers.';
  if (c === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
  if (c === 'auth/network-request-failed') return 'Network error — check your connection and try again.';
  if (c === 'auth/configuration-not-found') return 'Sign-in is temporarily unavailable. Please try again in a few minutes.';
  if (c === 'auth/operation-not-allowed') return 'This sign-in method is not enabled on the project yet.';
  if (c === 'auth/unauthorized-domain') return 'This domain is not authorized for sign-in. Contact support.';
  if (c === 'auth/api-key-not-valid') return 'Authentication is misconfigured. Contact support.';
  if (c === 'auth/popup-blocked' || c === 'auth/popup-blocked-by-browser' || c === 'auth/operation-not-supported-in-this-environment') {
    return 'The sign-in popup was blocked. Allow popups for this site and try again.';
  }
  if (c === 'auth/account-exists-with-different-credential' || c === 'auth/credential-already-in-use') {
    return 'An account already exists with this email. Sign in with your email & password instead.';
  }
  if (c === 'auth/expired-action-code') return 'This link has expired. Request a fresh one below.';
  if (c === 'auth/invalid-action-code') return 'This link is no longer valid. Request a fresh one below.';
  if (c === 'auth/internal-error') return 'Sign-in failed. Please try again in a moment.';
  return 'Something went wrong. Please try again.';
};

/** The app's own origin + /app — so verification/reset links always return
    the user to THIS app instance (localhost in dev, the domain in prod). */
const verifyContinueUrl = () => {
  try {
    const origin = window.location.origin || '';
    return origin.startsWith('http') ? `${origin}/app` : '';
  } catch { return ''; }
};

/** actionCodeSettings for the SDK fallback — WITHOUT this, Firebase's
    default handler has no continue URL and can't send the user back to the
    app after they click the link (the root cause of "link opens but nothing
    happens"). handleCodeInApp:false → Firebase consumes the code on its
    hosted page, verifies the email, then redirects to our /app. */
const sdkVerifySettings = () => {
  const url = verifyContinueUrl();
  return url ? { url, handleCodeInApp: false } : undefined;
};

const toSession = async (user) => {
  const token = await getIdToken(user);
  return {
    uid: user.uid,
    name: user.displayName || '',
    email: (user.email || '').toLowerCase(),
    phone: user.phoneNumber || '',
    emailVerified: !!user.emailVerified,
    isAdmin: false, // server truth — refreshed from GET /me on hydration
    token,
    createdAt: user.metadata?.creationTime || new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
};

export const auth = {
  /** Is there a valid Firebase session? (waits for SDK restore) */
  async hasSession() {
    try {
      await fbAuth.authStateReady();
      return !!fbAuth.currentUser;
    } catch {
      return false;
    }
  },

  /** Sign in with email + password (Firebase Identity Platform). */
  async signIn({ email, password }) {
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) return { ok: false, error: 'Enter a valid email address.' };
    try {
      const cred = await signInWithEmailAndPassword(fbAuth, cleanEmail, String(password || ''));
      const session = await toSession(cred.user);
      await api.saveSession(session);
      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },

  /** Sign in with Google — REDIRECT mode (not popup). Popup failed on real
      browsers: the OAuth dance completed (user picked an account, clicked
      continue) but the popup→parent handoff hung for a long time and then
      bounced the user back to the login card. Redirect navigates the whole
      page to Google and back — no popup, no hidden iframe, works in every
      browser/webview, and is the flow Firebase recommends on mobile.
      The result is picked up on return by completeGoogleRedirect(). */
  async signInWithGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithRedirect(fbAuth, provider);
      return { ok: true, redirect: true }; // page is navigating away
    } catch (err) {
      const c = err?.code || '';
      if (c === 'auth/cancelled-popup-request' || c === 'auth/popup-closed-by-user') {
        return { ok: false, error: '' }; // user cancelled — not an error worth showing
      }
      return { ok: false, error: friendly(err) };
    }
  },

  /** Pick up a Google redirect result — called on the sign-in screen's mount
      after the browser returns from accounts.google.com. Returns
      { handled:false } when there was no pending redirect to complete. */
  async completeGoogleRedirect() {
    try {
      const cred = await getRedirectResult(fbAuth);
      if (!cred || !cred.user) return { ok: false, handled: false };
      const session = await toSession(cred.user);
      await api.saveSession(session);
      return { ok: true, handled: true, session };
    } catch (err) {
      return { ok: false, handled: true, error: friendly(err) };
    }
  },

  /** Create account + sign in. Kept in one step (best UX, matches Firebase). */
  async register({ name, email, password }) {
    const cleanName = sanitizeName(name);
    const cleanEmail = sanitizeEmail(email);
    const pw = String(password || '');
    if (cleanName.length < 2) return { ok: false, error: 'Enter your name.' };
    if (!cleanEmail) return { ok: false, error: 'Enter a valid email address.' };
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
      return { ok: false, error: 'Password needs 8+ characters with letters and numbers.' };
    }
    try {
      const cred = await createUserWithEmailAndPassword(fbAuth, cleanEmail, pw);
      try { await updateProfile(cred.user, { displayName: cleanName }); } catch { /* non-fatal */ }
      // Send the verification email right away — through OUR backend (branded
      // + rate-limited) when it can honor the continue URL; otherwise the SDK
      // path with explicit actionCodeSettings (both carry a link back to the
      // app — the missing piece that made verification links dead-end).
      const continueUrl = verifyContinueUrl();
      try { await api.sendVerificationEmail(continueUrl); }
      catch { try { await sendEmailVerification(cred.user, sdkVerifySettings()); } catch { /* resend available */ } }
      const session = await toSession(cred.user);
      session.name = cleanName;
      await api.saveSession(session);
      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },

  /** Re-send the verification email — through OUR backend (branded email +
      per-user rate limiting); falls back to the Firebase SDK on failure so
      the flow can never dead-end. */
  async sendVerification() {
    const u = fbAuth.currentUser;
    if (!u) return { ok: false, error: 'No active session.' };
    const continueUrl = verifyContinueUrl();
    try {
      await api.sendVerificationEmail(continueUrl);
      return { ok: true };
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') {
        return { ok: false, error: 'Too many requests. Try again in an hour.' };
      }
      try {
        await sendEmailVerification(u, sdkVerifySettings());
        return { ok: true };
      } catch (err2) {
        const c = err2?.code || '';
        if (c === 'auth/too-many-requests') {
          return { ok: false, error: 'Too many requests. Try again in a few minutes.' };
        }
        return { ok: false, error: friendly(err2) };
      }
    }
  },

  /** Consume an in-app verification link (mode=verifyEmail&oobCode=… — only
      reached when the code came to the app directly; the hosted handler
      consumes the standard flow), then reload + force-refresh the token. */
  async applyVerifyCode(oobCode) {
    try {
      if (oobCode) await applyActionCode(fbAuth, oobCode);
      const res = await this.refreshVerified();
      return res;
    } catch (err) {
      return { ok: false, verified: !!fbAuth.currentUser?.emailVerified, error: friendly(err) };
    }
  },

  /** Reload the Firebase user — re-check emailVerified after clicking the link.
      The ID token is FORCE-refreshed: the `email_verified` claim is baked in at
      issue time, so without a fresh token the backend would keep seeing false. */
  async refreshVerified() {
    const u = fbAuth.currentUser;
    if (!u) return { ok: false, verified: false };
    try {
      await fbReload(u);
      const token = await getIdToken(u, true); // force=true → fresh claims
      const session = {
        uid: u.uid,
        name: u.displayName || '',
        email: (u.email || '').toLowerCase(),
        phone: u.phoneNumber || '',
        emailVerified: !!u.emailVerified,
        isAdmin: false,
        token,
        createdAt: u.metadata?.creationTime || new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
      await api.saveSession(session);
      return { ok: true, verified: !!u.emailVerified, session };
    } catch {
      return { ok: false, verified: !!u.emailVerified };
    }
  },

  /** Send a password-reset email — routed through OUR backend so it is
      RATE-LIMITED server-side (per IP + per email) and audit-logged. The
      Firebase SDK's direct call had no limits of its own, which let a
      spammed "forgot password" button drop 10+ emails. Reply is generic
      either way — no account enumeration. */
  async sendPasswordReset(email) {
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) return { ok: false, error: 'Enter a valid email address.' };
    try {
      await api.sendPasswordResetEmail(cleanEmail);
      return { ok: true };
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') {
        return { ok: false, error: 'Too many reset requests. Please wait a few minutes.' };
      }
      // Deliberately identical reply — never reveal whether an account exists.
      return { ok: false, error: 'If an account exists for that email, a reset link is on its way.' };
    }
  },

  /** Sign out everywhere (Firebase + local session cache). */
  async signOut() {
    try { await fbSignOut(fbAuth); } catch { /* already signed out */ }
    await api.clearSession();
  },

  /** Fresh ID token for API calls — Firebase refreshes automatically. */
  async getToken() {
    const u = fbAuth.currentUser;
    if (!u) return '';
    try { return await getIdToken(u); } catch { return ''; }
  },
};

// client.js uses this to stamp a fresh Bearer token on every request.
setTokenGetter(() => auth.getToken());
