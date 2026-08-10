/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — Firebase init (Auth)
   ────────────────────────────────────────────────────────────────────────────
   The web API key is PUBLIC BY DESIGN (it only identifies the project to
   Google — anyone can read it from a shipped bundle, so keeping it out of the
   bundle is NOT a secrecy win). What actually protects us:
     • ID tokens are verified server-side (signature + audience) on Cloud Run
     • Firestore/GCS are never accessed directly by the browser — everything
       goes through the API, which derives ownership from the verified token
   Rotation: values are read from build-time env (see .env.example) so they
   can be changed without editing code. The fallbacks below keep dev working
   with zero setup.

   ⚠️ MANUAL CONSOLE STEPS (one-time, cannot be done from code):
     1. Firebase Console → Project → Project settings → Your apps → Web →
        "API key" → Restrict key: HTTP referrers = your production domain
        ONLY (this stops other sites from calling Auth with this key).
     2. Firebase Console → App Check → Enroll the web app (reCAPTCHA
        Enterprise) and enforce it — blocks non-browser callers from using
        Auth/Storage even with a stolen key.
     3. Rotate the key quarterly (Settings → API keys → Regenerate).
   ════════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const env = (name, fallback) => import.meta.env?.[name] || fallback;

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY', 'AIzaSyALahslGJhigEPOcDe3Vtuc_zVzCZnxN6w'), // katalogit-web-client (public)
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN', 'katalogitai-501916.firebaseapp.com'),
  projectId: env('VITE_FIREBASE_PROJECT_ID', 'katalogitai-501916'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET', 'katalogitai-501916.appspot.com'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID', '787935596465'),
  appId: env('VITE_FIREBASE_APP_ID', ''),
};

export const app = initializeApp(firebaseConfig);
export const fbAuth = getAuth(app);
