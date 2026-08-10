# ⚡ Quick Reference — KatalogitAI Website

## 🎯 What You Have Now

A functional, mobile-responsive landing page for Indian retail sellers with:

### ✨ Animations
- Camera-snap preloader (1.8s)
- Typing hero with rotating value propositions
- Infinite right-to-left brand carousel
- Smooth fade-in scroll animations

### 🔐 Real, working flows
- **Auth modal** — real Firebase Authentication (email/password + Google).
  New accounts get a verification email; the dashboard enforces verified
  emails server-side.
- **Contact form** — POSTs to the Cloud Run API
  (`POST /api/v1/public/leads`), which rate-limits per IP, drops honeypot
  bots, sanitizes every field, and stores the lead in Firestore. Leads show
  up in the app's **Admin Console → Leads** tab. No fake "message sent".

### 🔍 SEO
- Meta tags, Open Graph, Twitter Cards
- Structured Data (Organization + SoftwareApplication — no fabricated ratings)

### 📁 Files
```
website/
├── index.html   ← Main page (honest copy, no fabricated claims/media)
├── styles.css   ← All styling + animations
├── auth.js      ← Firebase auth modal (shared project with the app)
└── script.js    ← Preloader, typing, nav, contact form → real API
```

## 📞 Contact info
- Phone: +91 97182 82638
- Email: hello@katalogit.ai

## ✅ Pre-Launch Checklist
- [ ] Deploy the backend first (`gcloud run deploy katalogit-api …`) — the
      contact form and auth both depend on it
- [ ] Test all links work
- [ ] Test phone links on mobile
- [ ] Test the contact form end-to-end (submit → see the lead in Admin Console)
- [ ] Point the domain (katalogit.ai) here with HTTPS
- [ ] Monitor the first week
