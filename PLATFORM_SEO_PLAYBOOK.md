# KatalogitAI — Platform SEO & Psychology Playbook (the "Beat Every Human" report)

> **What this is:** every ranking mechanic, content rule, psychology factor, and
> insider detail for Amazon, Flipkart, Meesho, Myntra, and Alibaba — researched
> from platform docs, peer-reviewed papers, and seller-portal sources (verified
> Jul/Aug 2026) — distilled into (a) what the seller must say, (b) why it works
> psychologically, and (c) the exact requirements our unified AI spec must emit.
>
> **How it plugs in:** `MULTIPLATFORM_PIPELINE_HLD.md` defines the architecture
> (one VLM pass → Canonical Product Master → deterministic per-platform templates).
> This doc defines **what the VLM must extract and what the templates must write** —
> the "one great prompt" spec. Companion: `AI_PIPELINE_PLAN.md` (image model).

---

## PART 0 — The paradigm shift (read this first)

**Every platform is moving from keyword matching to intent understanding.**
Amazon's own peer-reviewed paper (SIGMOD-Companion 2024) describes **COSMO** — a
commonsense knowledge graph with **6.3M nodes, 29M edges, 18 categories** mined
from 1.87M search-buy and 3.14M co-buy pairs. It powers Amazon's refinement tiles
(+0.7% sales = hundreds of millions, +8% navigation engagement) and feeds the AI
shopping assistant (Rufus: 300M customers, ~$12B attributed sales, 60% higher
purchase completion).

**The one-sentence secret:** *Keywords get you into the pool; intent signals get
you recommended.* A listing that communicates *who it's for, what it solves, when
and where it's used, and what it pairs with* outranks one that repeats keywords —
even if the keyword never appears.

Our product's entire moat: **a human writing one listing won't encode 10–15 intent
relations per product. Our pipeline does it for ₹2.** That's the "outperform a
normal human" claim, made concrete.

---

## PART 1 — AMAZON (the flagship)

### 1.1 Ranking stack (three layers, verified 2026)

| Layer | What it is | What it rewards |
|---|---|---|
| **A9** (keyword engine) | Matches title/bullets/backend against the query | Keywords in the right fields → gets you into the candidate pool |
| **COSMO** (knowledge graph) | Intent understanding from shopper behavior | Structured intent signals → gets you *recommended* |
| **Performance flywheel** | CTR, conversion, sales velocity, reviews | Listings that earn clicks and sales rank higher; ads seed it |

There is **no "A10"** — that's a seller-community myth. The observed "changes" are
COSMO's integration into search. Optimize for the real stack, not the rumor.

### 1.2 The 15 COSMO relations — our content checklist

```
FUNCTIONAL          AUDIENCE            CONTEXT             CLASSIFICATION      COMPLEMENTARY
Used_For_Func       Used_For_Audience   Used_For_Event      Used_As             Used_With
Used_To             Used_By             Used_On             Is_A                xInterested_In
Capable_Of          xIs_A               Used_In_Location                        xWant
                                        Used_In_Body
```

**Working example — a cotton kurti:**
- `Used_For_Func`: breathable comfort · `Used_To`: office wear · `Capable_Of`: all-day wrinkle-free
- `Used_For_Audience`: working women · `Used_By`: college students · `xIs_A`: plus-size friendly
- `Used_For_Event`: festive · `Used_On`: summer · `Used_In_Location`: office, home, travel · `Used_In_Body`: soft on skin
- `Used_As`: casual ethnic wear · `Is_A`: A-line kurti
- `Used_With`: leggings, jhumkas · `xInterested_In`: sustainable fabrics · `xWant`: look slim without tight clothes

**Rule:** the VLM spec must output 10–15 of these per product. Templates map them
into bullets (Amazon), description (Flipkart), and attributes (Meesho) — whichever
platform's schema accepts them.

### 1.3 Content rules (the 2026 earthquake — live July 27, 2026)

1. **Titles capped at 75 characters.** This is *the* edge right now — most sellers
   haven't adapted; Amazon's AI is rewriting over-length titles for them (losing
   their keyword strategy + brand voice). **Our product = "rewrite your catalog
   before Amazon's AI does, keeping your winning keywords."** That's a sellable,
   urgent wedge for the Amazon-crawling sales pitch.
2. **Item Highlights field** — new structured attribute slot; use it for the top
   4–5 COSMO intent signals.
3. **Bullets:** ≤1000 chars each, 5 bullets max; lead with benefit, then feature.
4. **Backend search terms:** 250 *bytes* (not chars) — this is where vernacular +
   misspelling + synonym coverage goes. Budget it carefully (Hinglish eats bytes).
5. **Images:** main = pure white RGB(255,255,255), ≥1000px (1600+ for zoom), **85%
   fill**, no text/logo/mannequin, standing model for adult apparel; up to 8 more.
   AI-generated people → `contains-synthetic-performer` XMP tag (see HLD §4.3).
6. **A+ Content:** brand story + comparison chart + lifestyle — the conversion layer.
7. **ASIN creation (June 1, 2026):** branded ASIN creation now requires Brand
   Registry reseller role; unauthorized/duplicate/variation-stuffed listings get
   30-day deactivation notices. Legit catalog creation is now a *branded* activity.
8. **SP-API is now FREE** (fees cancelled May 12, 2026) — one-click programmatic
   publish is genuinely viable. No bots, no ToS risk.

### 1.4 Psychology (why each element converts)

- **Title = the ad.** Front-load the highest-intent keyword + brand + primary
  differentiator in the first 40 chars (truncation point on mobile). 75 chars
  forces discipline: brand + type + key attribute only.
- **First image = the thumbnail that wins the click.** White bg + product at 85%
  fill + real scale/color beats lifestyle shots for CTR on search results; lifestyle
  belongs in images 2–7.
- **Bullets = answers, not features.** Each bullet should answer "so what?"
  (100% cotton → *breathable, skin-soft, all-day comfort*). Pain-point →
  benefit → proof structure.
- **Price anchoring:** show the pack/MRP comparison; shoppers on Amazon compare —
  give them the frame.
- **Reviews are the final salesperson:** ask-for-review inserts + Q&A seeding are
  the conversion multipliers after the listing itself.

---

## PART 2 — FLIPKART

### 2.1 Ranking mechanics
- **Six-level QC pipeline** — image QC is gate #1. Clean listings move faster to
  **F-Assured** (the delivery-promise badge that gates visibility in most category
  searches). F-Assured is the #1 organic ranking lever — get it, rank.
- **Seller tiers:** Bronze (15-day payout) → Silver (10-day) → Gold (7-day +
  dedicated manager). Qualification: 6,000+ units or ₹50L sales in 90 days,
  cancellation <0.15%, dispatch-breach <1%. Tier feeds visibility and trust.

### 2.2 Content rules
- Main image: 1000×1000, pure white, 80–85% fill, no watermarks/MRP stickers/
  borders. 4–13 images (apparel 4–8).
- Title: no hard cap (unlike Amazon) — keyword-first, brand + type + attributes.
- Big Billion Days (late Sept, ~Sep 23–Oct 1, 2026): catalog refresh peaks 2–3
  weeks prior — our seasonal push window.

### 2.3 Psychology
- **Flipkart shoppers are value+trust seekers** — they cross-check prices and
  seller ratings. Highlight: price anchoring, genuine MRP-off framing (no fake
  discounts — Flipkart penalizes inflated MRP), F-Assured badges, fast dispatch.
- **Tier-2/3 trust language:** clarity beats cleverness. Plain benefit bullets,
  honest measurements, size-chart-first.

---

## PART 3 — MEESHO (the most different, and the most rewarding to get right)

### 3.1 The platform's true nature
- **Reseller-first social commerce.** ~90% of sellers run everything from the
  Android Supplier app. Tier-2/3/4 customer base (41% tier-2, 24% tier-4).
- **Vernacular is the secret weapon.** Meesho's search understands colloquial
  Hindi/Hinglish and now 8+ regional languages. **Keywords must include Romanized
  Hindi product terms**: *jhumka earrings, bandhani dupatta, chikankari kurta,
  kolhapuri chappal, salwar suit, anarkali, palazzo, co-ord set* — plus spelling
  variants. This is where a human listing fails and our keyword engine wins.
- **NDD (Next Day Dispatch):** suppliers with fast dispatch get up to ~12% more
  customer interest — bake dispatch-speed framing into copy where true.

### 3.2 Content rules (the strict ones)
- **The no-logo rule:** NO brand logos, watermarks, promo text, or price tags on
  primary images — *for anyone, any seller.* It's a consequence of the reseller
  model (the reseller is the "brand" to her customer). The #1 cross-post killer.
- Title: **50–120 characters**, clean keyword-focused, no ALL CAPS/symbols.
  Pattern: `color + productType + material + style + feature` (e.g., "Navy Women's
  Cotton Printed Kurti Regular Fit Casual Wear").
- Image: 1000×1000, pure white/light neutral, 70–80% fill, 3–8 images, **size
  chart mandatory for apparel**.
- **Duplicate-image detection** catches naive cross-posts from Amazon — needs
  meaningful variation (crop/canvas/background tone). We comply via Render Engine
  variants (different fill %, background tone, framing) — never evasion.
- Terminology: it's **"catalog"** (कैटलॉग), not "listing" — use their vocabulary
  in any seller-facing copy.
- 2026: stricter image QC, automated duplicate detection, mandatory size charts,
  penalties for fake MRP/misleading discounts.

### 3.3 Psychology
- **Value + trust in the reseller chain.** The reseller forwards your catalog on
  WhatsApp to her customer — the image *is* the salesperson. Main image must look
  great at WhatsApp-forward size and tell the value story instantly.
- **Price-led buying:** highlight affordable price + NDD + return ease.
- **No-English-first customers:** simple Hindi-friendly descriptions; Romanized
  Hindi keywords; avoid anglicized jargon.

---

## PART 4 — MYNTRA (fashion-first, the visual bar)

### 4.1 Ranking mechanics
- **Catalog quality + brand approval.** Indie D2C labels wait weeks for approval;
  curated brands breeze through. Clean, spec-perfect catalogs clear faster.
- **EORS calendar:** End of Reason Sale — late Jan–Feb (winter) and late Jun–Jul
  (summer). Catalog refresh peaks the two weeks before; our seasonal push window.

### 4.2 Content rules
- **3:4 portrait** (1080×1440 min, 1500×2000 target), white/soft-neutral, 80–90%
  fill, JPEG sRGB, 500KB–1MB.
- **Gender-matched models mandatory** for most apparel (women's wear → female
  model). Garments must look "well-fitted and ironed" — Myntra rejects visibly
  wrinkled or poorly-sized samples more than any Indian marketplace.
- Size charts = hard gate for every apparel SKU.
- **AI-model imagery = grey area** (no formal policy; tolerated in secondary/
  context shots, risky as primary hero). Strategy: real flat-lay as hero, AI poses
  as images 2+.

### 4.3 Psychology
- **Fashion-forward language:** fit, drape, occasion, styling suggestions ("pairs
  with"), trend terms. Myntra shoppers buy aspiration + outfit-coordination, not
  just a garment.
- **The model matters:** gender-matched, well-fitted models are the conversion
  engine — exactly what our pipeline produces (with modesty profiles for ethnic
  wear).

---

## PART 5 — ALIBABA (B2B, different game)

### 5.1 Ranking mechanics
- **PIS (Product Information Score)** is the gate — poor-quality or exaggerated
  listings drag it down; **Premium status at PIS 4+** unlocks visibility tiers.
- P4P (pay-per-click) ads are the accelerator on top of organic PIS quality.

### 5.2 Content rules
- 3:4 portrait, clean backgrounds, accurate specifications (B2B buyers need
  measurements, MOQ, materials, certifications).
- No exaggerated claims — B2B buyers are procurement professionals; accuracy
  builds the PIS score.

### 5.3 Psychology
- **B2B = specification-first.** Every attribute filled, honest imagery, MOQ and
  lead-time clarity. Trust signals (verified supplier, trade assurance) matter
  more than marketing copy.

---

## PART 6 — THE UNIFIED SPEC (the "one great prompt")

The VLM gets **one system prompt** with three jobs, and outputs **one JSON**:

```json
{
  "job": "analyze + extract + classify",
  "input": "flat-lay photo(s)",
  "mustOutput": {
    "garmentFacts": { "type", "fabric", "color", "pattern", "fit", "sleeve",
                      "neck", "occasion", "care", "measurements" },
    "modestyProfile": "drape | loose | fitted",
    "genderFit": "women | men | kids | unisex",
    "poseSelection": "from FIXED roster only, filtered by modestyProfile",
    "cosmoRelations": ["10-15 of: Used_For_Func, Used_To, Capable_Of, ... xWant"],
    "keywords": { "primary", "longTail", "vernacularHinglish", "misspellings", "synonyms" },
    "useCases": ["office", "festive", "daily"],
    "styleSuggestions": ["pairs with leggings", "styling tip for Myntra"],
    "complianceFlags": { "aiPerson": true, "logoFree": true, "sizeChartRequired": true },
    "confidence": 0-1,
    "uncertainFields": ["list what it could not determine"]
  }
}
```

**Design rules (non-negotiable):**
1. The VLM **never writes platform text** — it extracts facts + intent signals.
   Platform text = deterministic templates (HLD §4.2). This keeps Amazon's 75-char
   rule, Meesho's 50–120, Myntra's fashion language, and Flipkart's keyword-first
   style all correct by construction.
2. The VLM **never writes SD prompts** — it outputs the structured spec; code
   builds safe, modesty-filtered prompts.
3. **Confidence + uncertainFields** feed the review UI: "we couldn't determine the
   fabric — please confirm" instead of guessing (guessing = misrepresentation =
   platform ban risk).
4. **Vernacular is a first-class output** (Meesho), not an afterthought.
5. **COSMO relations are mandatory output** (Amazon) — 10–15 per product, mapped
   into whatever fields each platform accepts.

**Model choice (locked):** Gemini Flash-class for this pass (reads the image
directly, near-free, no GPU contention). Image generation stays self-hosted on the
GPU. Upgrade path later: quantized 7B–8B on the GPU's idle gaps.

---

## PART 7 — THE SELLABLE INSIGHTS (your pitch ammunition)

1. **"Amazon is rewriting your catalog right now"** — 75-char titles went live
   July 27, 2026; most sellers haven't adapted; Amazon's AI rewrite loses their
   keywords + voice. Urgent, time-boxed rescue campaign.
2. **COSMO intent relations** — 10–15 per product, executed deterministically.
   No human does this for ₹2. That's the "outperform the human" USP.
3. **Vernacular keywords** (Meesho) — Romanized Hindi/regional terms + spelling
   variants. Humans miss this; engines do it in bulk.
4. **Modesty-aware generation** — saree/kurti/salwar poses that never exaggerate
   the figure. No competitor tool talks about this. It's trust + compliance + a
   category-defining feature for Indian ethnic wear.
5. **Compliance built-in** — XMP tagging, no-logo exports, gender-fit, size
   charts, honest accuracy — sellers never get banned by an AI image again.
6. **Free SP-API publish** — one-click Amazon publishing, programmatic, legal.

---

## SOURCES (verified Jul/Aug 2026)

- Amazon COSMO paper (SIGMOD-Companion 2024, Amazon Science) + ZonGuru COSMO guide
- Amazon Seller Central announcements: 75-char titles/Item Highlights (Jul 27, 2026),
  ASIN creation rules (Jun 1, 2026), AI-person tagging (Jul 23, 2026), SP-API fee
  cancellation (May 12, 2026)
- Amazon Product Image Guide (checked Jul 31, 2026) + Pikes.ai 2026 platform-rules
  roundup (AI-image policy, verified Jul 31, 2026)
- CNBC / EcomCrew / Five Star Commerce on the AI-person tag
- remove-bg.io 2026 Indian-marketplace seller image guide (Flipkart/Myntra/Meesho/
  Nykaa/Ajio specs)
- Lohar Studio Meesho Listing Guidelines 2026; EcomShadow Meesho keyword research
  2026; ET Retail on Meesho tier-2/4 penetration
- Flipkart Seller Hub blog; inriver Alibaba product-data requirements
