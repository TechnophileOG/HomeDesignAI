import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

// ─────────────────────────────────────────────────────────────────────────────
// Two sites, one origin:
//   • the LANDING PAGE lives in website/ and is served at `/`  (katalogit.ai)
//   • the APP (this Vite build) lives at `/app/`               (katalogit.ai/app)
// The landing page's "Sign In" runs the REAL auth workflow (Firebase) and
// redirects to /app — the same origin shares the Firebase session.
// ─────────────────────────────────────────────────────────────────────────────

// Production Content-Security-Policy (the APP).
//  - 'self'            → all app assets served from same origin
//  - 'unsafe-inline'   → required for React inline `style={{}}` props
//  - fonts.googleapis.com / fonts.gstatic.com → Google Fonts
//  - data:/blob:       → canvas captures (toDataURL) and camera previews
//  - connect-src       → our Cloud Run API + Firebase Auth + GCS photos + Razorpay
//  - https://checkout.razorpay.com → payment modal (script/frame/style)
//  - https://www.google.com (frame) → optional store-location map embed (no
//    API key, ₹0). Geocoding is PROXIED through our API — the browser never
//    calls a geocoder directly, so no geocoder domain is in connect-src.
//  - frame-ancestors 'none' → clickjacking protection (header-only: enforced via
//    vite preview headers, public/_headers and vercel.json, NOT via this meta).
//  - https://apis.google.com + https://accounts.google.com → Firebase Auth
//    Google sign-in. The popup opens accounts.google.com; the auth iframe on
//    OUR origin loads https://apis.google.com/js/api.js. Without these, the
//    CSP blocks the bridge script and Google sign-in fails with a generic
//    "Sign-in failed" (the exact bug this list fixes).
//  - https://katalogitai-501916.firebaseapp.com / .web.app → the Firebase
//    authDomain. Both the popup handoff and REDIRECT sign-in load a hidden
//    iframe there to complete the OAuth exchange; blocking it makes the
//    sign-in hang after the user picks their Google account.
const API_AND_FIREBASE = 'https://*.run.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://storage.googleapis.com https://checkout.razorpay.com';
const GOOGLE_AUTH = 'https://apis.google.com https://accounts.google.com';
const FIREBASE_AUTH_DOMAIN = 'https://katalogitai-501916.firebaseapp.com https://katalogitai-501916.web.app';
const APP_CSP = [
  "default-src 'self'",
  `script-src 'self' https://checkout.razorpay.com https://apis.google.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://checkout.razorpay.com`,
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: https://storage.googleapis.com https://www.gstatic.com https://ssl.gstatic.com`,
  "media-src 'self' blob:",
  `connect-src 'self' ${API_AND_FIREBASE} ${GOOGLE_AUTH} wss: ws:`,
  `frame-src https://checkout.razorpay.com https://www.google.com ${GOOGLE_AUTH} ${FIREBASE_AUTH_DOMAIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

// CSP for the LANDING PAGE (website/). It loads Firebase from gstatic and
// Font Awesome from cdnjs — a different, tighter-but-sufficient policy.
const LANDING_CSP = [
  "default-src 'self'",
  `script-src 'self' https://www.gstatic.com https://apis.google.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
  `img-src 'self' data: blob: https://www.gstatic.com https://ssl.gstatic.com`,
  `connect-src 'self' ${API_AND_FIREBASE} ${GOOGLE_AUTH}`,
  `frame-src https://accounts.google.com https://apis.google.com ${FIREBASE_AUTH_DOMAIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const SHARED_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
}

// Injects the CSP <meta> tag ONLY into production builds.
// (Dev must stay CSP-light so Vite's inline HMR / React-Refresh preambles work.)
function injectCspMeta() {
  return {
    name: 'inject-csp-meta',
    apply: 'build', // production build only
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: APP_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
}

// Serves the LANDING PAGE (website/) at `/` — dev AND preview. The app keeps
// serving at /app (Vite's SPA fallback). Only the 5 landing files are
// intercepted; everything else falls through to Vite untouched.
function serveLandingPage() {
  const websiteRoot = path.resolve(__dirname, 'website')
  const serve = (server) => {
    server.middlewares.use((req, res, next) => {
      const url = (req.url || '').split('?')[0]
      // The app lives at /app/ — a bare /app (no trailing slash, which the
      // landing page's auth redirects use) would hit Vite's "public base URL"
      // 404 page. Normalize it the way Vite would for a base path.
      if (url === '/app') {
        res.statusCode = 302
        res.setHeader('Location', '/app/')
        res.end()
        return
      }
      const isRoot = url === '/' || url === '/index.html'
      // Legal/help pages live in website/ too (Settings + landing footer link them).
      const legalPages = { '/terms': 'terms.html', '/privacy': 'privacy.html', '/data': 'data.html' }
      const landingFiles = ['/styles.css', '/auth.js', '/script.js', '/index.html']
      const legalTarget = legalPages[url]
      if (!isRoot && !landingFiles.includes(url) && !legalTarget) return next()
      const file = legalTarget ? legalTarget : (isRoot ? 'index.html' : url.slice(1))
      const abs = path.join(websiteRoot, file)
      if (!abs.startsWith(websiteRoot) || !fs.existsSync(abs)) return next()
      const ext = path.extname(abs).toLowerCase()
      res.statusCode = 200
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      for (const [k, v] of Object.entries(SHARED_SECURITY_HEADERS)) res.setHeader(k, v)
      res.setHeader('Content-Security-Policy', LANDING_CSP)
      res.end(fs.readFileSync(abs))
    })
  }
  return {
    name: 'serve-landing-page',
    configureServer: serve,          // dev
    configurePreviewServer: serve,   // `vite preview` (built assets)
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/app/',
  plugins: [react(), injectCspMeta(), serveLandingPage()],
  server: {
    headers: {
      ...SHARED_SECURITY_HEADERS,
      // Dev HMR needs the WebSocket; keep script-src relaxed for React-Refresh.
      // Google OAuth domains included so Google sign-in works in dev too.
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://checkout.razorpay.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://storage.googleapis.com https://www.gstatic.com https://ssl.gstatic.com; media-src 'self' blob:; connect-src 'self' ws: wss: ${API_AND_FIREBASE} ${GOOGLE_AUTH}; frame-src https://checkout.razorpay.com https://www.google.com ${GOOGLE_AUTH} ${FIREBASE_AUTH_DOMAIN}; object-src 'none'; base-uri 'self'; form-action 'self'`,
    },
  },
  preview: {
    headers: {
      ...SHARED_SECURITY_HEADERS,
      'Content-Security-Policy': APP_CSP,
    },
  },
})
