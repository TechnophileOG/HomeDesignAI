import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production Content-Security-Policy.
//  - 'self'            → all app assets served from same origin
//  - 'unsafe-inline'   → required for React inline `style={{}}` props
//  - fonts.googleapis.com / fonts.gstatic.com → Google Fonts (index.css @import)
//  - data:/blob:       → canvas captures (toDataURL) and camera previews
//  - connect-src       → our Cloud Run API + Firebase Auth + GCS photos + Razorpay
//  - https://checkout.razorpay.com → payment modal (script/frame/style)
//  - frame-ancestors 'none' → clickjacking protection (header-only: enforced via
//    vite preview headers, public/_headers and vercel.json, NOT via this meta).
const API_AND_FIREBASE = 'https://*.run.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://storage.googleapis.com https://checkout.razorpay.com';
const PROD_CSP = [
  "default-src 'self'",
  `script-src 'self' https://checkout.razorpay.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://checkout.razorpay.com`,
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: https://storage.googleapis.com`,
  "media-src 'self' blob:",
  `connect-src 'self' ${API_AND_FIREBASE} wss: ws:`,
  `frame-src https://checkout.razorpay.com`,
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
            attrs: { 'http-equiv': 'Content-Security-Policy', content: PROD_CSP },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), injectCspMeta()],
  server: {
    headers: {
      ...SHARED_SECURITY_HEADERS,
      // Dev HMR needs the WebSocket; keep script-src relaxed for React-Refresh.
      'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://checkout.razorpay.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://storage.googleapis.com; media-src 'self' blob:; connect-src 'self' ws: wss: ${API_AND_FIREBASE}; frame-src https://checkout.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'`,
    },
  },
  preview: {
    headers: {
      ...SHARED_SECURITY_HEADERS,
      'Content-Security-Policy': PROD_CSP,
    },
  },
})
