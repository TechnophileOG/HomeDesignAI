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
  signInWithPopup,
  GoogleAuthProvider,
  sendEmailVerification,
  reload as fbReload,
  signOut as fbSignOut,
  updateProfile,
  getIdToken,
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
  if (c === 'auth/operation-not-allowed') return 'Email/password sign-in is not enabled yet. Contact support.';
  if (c === 'auth/unauthorized-domain') return 'This domain is not authorized for sign-in. Contact support.';
  if (c === 'auth/api-key-not-valid') return 'Authentication is misconfigured. Contact support.';
  if (c === 'auth/internal-error') return 'Sign-in failed. Please try again in a moment.';
  return 'Something went wrong. Please try again.';
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

  /** Sign in with Google (popup). Provider must be enabled in the Firebase
      console (it is — you enabled it). First-timers get an account created. */
  async signInWithGoogle() {
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(fbAuth, provider);
      const session = await toSession(cred.user);
      await api.saveSession(session);
      return { ok: true, session };
    } catch (err) {
      const c = err?.code || '';
      if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') {
        return { ok: false, error: '' }; // user cancelled — not an error worth showing
      }
      return { ok: false, error: friendly(err) };
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
      // + rate-limited); falls back to the Firebase SDK if the route is down.
      try { await api.sendVerificationEmail(); }
      catch { try { await sendEmailVerification(cred.user); } catch { /* resend available */ } }
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
    try {
      await api.sendVerificationEmail();
      return { ok: true };
    } catch (err) {
      if (err?.code === 'RATE_LIMITED') {
        return { ok: false, error: 'Too many requests. Try again in an hour.' };
      }
      try {
        await sendEmailVerification(u);
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
