# KatalogitAI — Multi-Platform Content Pipeline (HLD)

> **Question answered here:** A seller's product must appear on Amazon, Flipkart,
> Meesho, Myntra (and maybe Alibaba/Instagram) — each with *different* image specs,
> *different* text rules, and *different* compliance rules. How do we serve ALL of
> them from ONE flat-lay photo without running the AI model N times?
>
> **The answer:** *one expensive pass per SKU* (images + a canonical product
> master), then *free deterministic renders* for every platform. Text is tailored
> per platform; images are cropped/reframed per platform — never regenerated.
>
> Companion docs: `HLD_LLD.md` (whole system), `AI_PIPELINE_PLAN.md` (the image
> model), `BACKEND_ARCHITECTURE.md` (queue + credits). Status: **design — not yet
> implemented.**

---

## 1. The problem, precisely

| Platform | Aspect | Min size | Fill | Background | Image count | Text rules |
|---|---|---|---|---|---|---|
| **Amazon** (main img) | 1:1 | ≥1000px (1600+ best) | 85% | pure white RGB 255,255,255 | 1 + up to 8 | Title ≤ **75 chars** (Jul 2026); backend keywords 250 bytes |
| **Flipkart** | 1:1 | 1000×1000 | 80–85% | pure white | 4–8 (apparel) | Title ~ no hard cap, keyword-first |
| **Meesho** | 1:1 | 1000×1000 | 70–80% | pure white / light neutral | 3–8 + **size chart mandatory** | Title 50–120 chars, keyword-focused |
| **Myntra** | **3:4** | 1080×1440 (1500×2000 target) | 80–90% | white / soft neutral | full-length, gender-matched | Fashion-forward language |
| **Alibaba** | 3:4 | 1080+ | clean | clean bg | 3+ | PIS quality score |
| **Instagram** | 1:1 / 4:5 | 1080 | — | lifestyle ok | 1–3 | marketing copy |

**Naive approach:** run the model once per platform → GPU cost × N, inconsistent
garment between platforms, and 6 separate AI runs to pay for. **Killed.**

**Correct approach:** run the expensive pipeline **once**, produce a *canonical
master*, then let cheap deterministic functions produce each platform's pack.

---

## 2. Architecture principle — canonical master + deterministic render

```
FLAT-LAY PHOTO (one, from the seller's phone)
   │
   ├── PASS 1 — EXPENSIVE, ONCE PER SKU ──────────────────────────────┐
   │    Image Engine (GPU worker, EXISTS)                             │
   │      → 8 posed model photos (master set, neutral studio)         │
   │    Content Engine (multimodal LLM, NEW)                          │
   │      → Canonical Product Master (CPM) JSON — one pass, cached    │
   └──────────────────────────────────────────────────────────────────┘
                            │
                            ▼
              CANONICAL PRODUCT MASTER (CPM)
              one JSON: facts, attributes, keywords, relations
                            │
   ┌────────────────────────┼──────────────────────────────┐
   ▼ PASS 2 — FREE, DETERMINISTIC, CPU ONLY (run 1000s of times) ▼
   │                                                         │
   Render Engine              Template Engine               Compliance Engine
   (image variants)           (text variants)               (tags + checks)
   ├ Amazon: 1:1, 85%, white  ├ Amazon: ≤75-char title      ├ XMP contains-synthetic-
   ├ Flipkart: 1:1, 80-85%    ├ Flipkart: keyword title     │   performer (AI people)
   ├ Meesho: 1:1, 70-80%,     ├ Meesho: 50-120 title        ├ Meesho logo-strip + var.
   │   logo-free, size chart  ├ Myntra: 3:4 gender language ├ Myntra: AI = secondary
   ├ Myntra: 3:4, 80-90%      ├ Alibaba: PIS-friendly       ├ size-chart renderer
   ├ Alibaba: 3:4             └ Instagram: marketing copy   └ per-platform QC checks
   └ Instagram: 1:1 / 4:5                                       (white-point, fill %)
                            │
                            ▼
        PER-PLATFORM EXPORT PACKS (stored in GCS, per platform)
        Amazon-pack / Flipkart-pack / Meesho-pack / Myntra-pack …
        → Review Center shows one tab per platform → approve → publish
```

**Cost invariant:** `GPU passes = 1` and `LLM passes = 1` per SKU, **no matter how
many platforms the seller publishes to.** Seller on 6 platforms pays the same as
seller on 1.

---

## 3. Pass 1 — expensive, once

### 3.1 Image Engine (already built — `backend/ai/gpu_worker/worker.py`)
- SDXL/SD1.5 + IP-Adapter (garment lock) + OpenPose ControlNet → 8 fixed poses.
- Seed = FNV-1a(storeId:productId:poseId) → deterministic, retry-safe.
- **Output:** the *master pose set* — neutral studio framing, no platform-specific
  crops. Platform framing happens in Pass 2, never in the model.

### 3.2 Content Engine (new — one multimodal LLM pass per SKU)
Inputs: flat-lay photo(s) + optional seller notes. Output: the **Canonical Product
Master** (below). This is the *only* text inference per SKU. Cache the CPM on the
product record so re-renders never re-run the LLM.

### 3.3 Canonical Product Master — the schema

```json
{
  "sku": "KUR-NAV-001",
  "category": "apparel",
  "productType": "Women's Cotton Printed Kurti",
  "attributes": {
    "fabric": "cotton", "fit": "regular", "color": "navy",
    "pattern": "printed", "sleeve": "3/4", "neck": "round",
    "occasion": "casual", "care": "machine wash cold",
    "measurements": { "S": "...", "M": "...", "L": "...", "XL": "..." }
  },
  "fabricHandfeel": "soft breathable 100% cotton",
  "useCases": ["daily wear", "office", "festive casual"],
  "keywords": {
    "primary": ["cotton kurti", "printed kurti for women"],
    "longTail": ["navy blue printed cotton kurti", "kurti for office wear women"],
    "intent": ["kurti under 500", "kurti for college"]
  },
  "cosmoRelations": [
    { "relation": "occasion", "object": "festival" },
    { "relation": "material", "object": "cotton" },
    { "relation": "style", "object": "a-line" },
    { "relation": "season", "object": "summer" }
  ],
  "compliance": {
    "genderFit": "women",
    "sizeChartRequired": true,
    "logoFree": true,
    "aiPerson": true
  },
  "platformPriority": ["amazon", "flipkart", "meesho", "myntra"]
}
```

Everything in Pass 2 reads only this object. If the seller edits any fact, we
update the CPM (cheap re-edit), never re-run the model.

---

## 4. Pass 2 — free, deterministic, CPU-only

### 4.1 Render Engine (image variants)
Pure geometry/color ops — `sharp` (libvips, npm) or ImageMagick, running **in the
existing Cloud Run container on CPU** (no GPU, no extra VM bill). Per platform:

- **Amazon main:** center-crop to 1:1, resize ≥1600, **pure-white flood**
  (RGB 255,255,255), verify **85% fill** by product bounding box.
- **Flipkart:** 1:1 1000×1000, white, 80–85% fill.
- **Meesho:** 1:1 1000×1000, white, **70–80% fill**, **logo-strip pass** (we never
  add logos, but a real brand logo in the flat-lay must be removed/blurred), plus a
  deliberately *different crop/background tone* from the Amazon/Flipkart variants →
  passes Meesho's duplicate-image detection **compliantly** (variation, not evasion).
- **Myntra:** 3:4 1500×2000 crop, soft-neutral bg, gender-matched model framing.
- **Size chart:** rendered deterministically from `measurements` (SVG → PNG) —
  mandatory for Meesho + Myntra apparel. Near-zero cost.
- **Instagram:** 1:1 marketing crop + 4:5 story crop.

Background purity: if the generated pose's background isn't pure white, strip it
with **rembg** (u2net, CPU ~1s/image) or a sharp-based flood when the bg is already
near-white. Deterministic, unit-testable, runs on the API server.

### 4.2 Template Engine (text variants) — how it works

Each platform is a **pure function** `f_platform(CPM) → string`, unit-tested against
that platform's char limits. No LLM involved — this is why it's free:

```js
// Amazon — hard cap 75 chars (new July 2026 rule)
function amazonTitle(cpm) {
  const t = `${cpm.productType} ${attr(cpm,'color')} ${attr(cpm,'pattern')} ${attr(cpm,'fabric')} ${attr(cpm,'fit')}`;
  return enforceMax(t, 75);          // truncate smartly, keep keywords, never split words mid-token
}

// Meesho — 50–120 chars, keyword-first, no symbols
function meeshoTitle(cpm) {
  const t = `${cpm.attributes.color} ${cpm.productType} ${attr(cpm,'pattern')} ${attr(cpm,'fabric')} ${attr(cpm,'fit')} wear`;
  return enforceRange(t, 50, 120);
}

// Myntra — fashion-forward, gender + fit language, no hard cap
function myntraTitle(cpm) {
  return `${cpm.compliance.genderFit === 'women' ? "Women's" : "Men's"} ${attr(cpm,'fit')} ${cpm.productType} in ${attr(cpm,'color')} ${attr(cpm,'pattern')}`;
}
```

Worked example for the kurti CPM above:

| Platform | Rendered title | Length |
|---|---|---|
| Amazon | `Women's Cotton Printed Kurti Navy A-Line Regular Fit Casual` | ≤75 ✅ |
| Meesho | `Navy Women's Cotton Printed Kurti Regular Fit Casual Wear` | 50–120 ✅ |
| Flipkart | `Women's Cotton Printed Kurti Navy Blue Regular Fit Office Wear Kurti` | ✅ |
| Myntra | `Women's Regular Fit Cotton Printed Kurti in Navy Blue Casual` | ✅ |

Description/bullets/backend-keywords work the same way: per-platform **template
functions** over the CPM (Amazon bullets ≤1000 chars each, backend keywords ≤250
bytes, Meesho benefit-driven bullets, Myntra fabric/fit/care focus). COSMO relation
types (occasion/material/style/season) get injected into whichever platform's
schema supports them — that's our "outrank the human" lever, executed as
deterministic templates, not extra LLM calls.

**Optional polish (seller opt-in, not default):** one LLM call that emits all 5
platform variants in a *single response* — still 1 inference, gives the flavor of
per-platform copywriting at template cost. The seller picks "template mode" (free,
instant) vs "writer mode" (1 cheap call).

### 4.3 Compliance Engine (the "no one gets banned" layer)

| Rule | Platform | Implementation |
|---|---|---|
| AI-generated people → XMP tag | Amazon (worldwide stores) | Write `contains-synthetic-performer` into XMP `dc:subject` on every export with an AI model; verify on the *shipped* file (metadata survives re-encode). Amazon adds the shopper disclosure itself. |
| No logos/watermarks on main image | Meesho (+ Amazon main) | logo-strip pass in Render Engine |
| Meaningful variation vs other platforms | Meesho duplicate detector | different crop/fill/background tone per platform (already in Render Engine) |
| AI models = secondary, real flat-lay = hero | Myntra (grey area) | export pack orders hero = flat-lay/approved shot, AI poses as images 2+ |
| Size chart present | Meesho + Myntra apparel | deterministic renderer from CPM measurements |
| White point + fill % verified | Amazon/Flipkart main images | automated QC check before the pack is "ready" (reject → auto-fix with rembg/flood) |

**The tag decision (settled):** always tag. It is metadata only — Amazon does not
demote or de-rank tagged images, and the disclosure badge appears "where
applicable" (may not even show in every marketplace). The real risk is the
**inverse**: an untagged AI person that Amazon's detector catches → image removed →
**listing suppressed from search** — the expensive outcome. Plus NY law fines
($1K/$5K) and FTC enforcement ($53,088/violation). Tagging is insurance, free, and
invisible to ranking. (See research below.)

---

## 5. Cost model (why this keeps the margin)

| Step | Where it runs | Cost per SKU |
|---|---|---|
| Image Engine (8 poses) | GPU box (rented) | ~₹3–7 (existing) |
| Content Engine (1 LLM pass) | managed/self-hosted cheap model | a few paise |
| Render + Template + Compliance (all platforms at once) | **CPU on existing Cloud Run** | ~₹0 |
| Naive alternative (model × 6 platforms) | GPU × 6 | ~₹18–42 ❌ |

---

## 6. Queue orchestration (extends existing jobs flow)

```
POST /jobs (type: 'shoot' | 'shoot+content')
  → reserve credits (idempotent, exactly-once)
  → Cloud Tasks: GPU worker renders 8 poses (PASS 1a)
  → on success: Content Engine runs once → CPM saved on product (PASS 1b)
  → Render + Template + Compliance run → export packs written to
       katalogit-processed/packs/{storeId}/{productId}/{platform}/
  → job 'done'; Review Center shows per-platform tabs
```

Re-render of a single platform (after a seller edit) re-runs only Pass 2 — free.
Regenerate of images re-runs only Pass 1a. Nothing ever runs the full chain twice.

---

## 7. Build phases (execution plan)

- **Phase A — Template Engine + CPM schema (NOW, no AI needed):** define CPM,
  write the `f_platform()` functions with unit tests against char limits. Seed the
  CPM from a manual form/seller input so the engine is real before the LLM exists.
- **Phase B — Render Engine (NOW, CPU):** sharp-based per-platform crops,
  white-point/85%-fill QC, rembg fallback, size-chart renderer.
- **Phase C — Compliance Engine (NOW):** XMP tagging on export, logo-strip,
  Myntra hero ordering, variation guarantee.
- **Phase D — Content Engine:** wire the multimodal LLM (when the model is
  finalised) to fill the CPM automatically from the flat-lay.
- **Phase E — Publish adapters:** Amazon SP-API (**free since May 2026**),
  Flipkart Seller API, Meesho bulk upload, Myntra partner portal.

Phases A–C are buildable today without the AI model — that's the point: the whole
multi-platform layer is decoupled from Pass 1.

---

## 8. Open decisions for you

1. **Meesho — settled, no evasion:** invisible noise to fool the duplicate detector
   is a ban risk (and dishonest). Compliant variation (different crop/fill/background
   tone) achieves the same result with zero risk, and it's already in the Render
   Engine. No extra credits charged — it's a free render, not a new shoot.
2. **Amazon tag — settled, always tag** (see §4.3). No reach penalty.
3. **Myntra hero — settled:** real flat-lay as hero image, AI poses as secondary.
4. **"Writer mode" opt-in:** one LLM call emitting all platform variants at once —
   in or out of v1?
5. **Publish automation in v1, or "download packs + paste"?** SP-API makes Amazon
   fully programmatic; the other platforms may start as export-then-upload.

---

## 9. Research sources (AI-image policy, verified Jul/Aug 2026)

- Amazon Seller Central announcement (Jul 23, 2026) + help page: `contains-
  synthetic-performer` XMP tag, applies to **worldwide stores**, new uploads only,
  no retroactive requirement. (CNBC; Five Star Commerce; EcomCrew)
- Amazon Product Image Guide (checked Jul 31, 2026): no prohibition on AI-generated
  product imagery; only people need the tag; main-image spec = pure white 255,
  85% fill, no mannequin, standing model for apparel. (Pikes.ai)
- Drivers: NY SB8420A (effective Jun 9, 2026 — $1K/$5K), EU AI Act (Aug 2, 2026),
  FTC AI enforcement unit (Jan 2026, penalties up to $53,088/violation).
- Google Shopping (future): strictest — IPTC `DigitalSourceTypeTrainedAlgorithmicMedia`
  on *every* AI image + `structured_title` for AI copy; metadata stripped by CDNs
  silently → audit shipped files.
- Flipkart/Myntra/Meesho image specs: remove-bg.io 2026 seller guide (Meesho
  no-logo rule, Myntra 3:4 + gender-matched models, Flipkart 1000×1000 + F-Assured).
