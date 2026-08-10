# KatalogitAI — AI Pipeline Plan (Phase 6, the model itself)

> **Question answered here:** How do we turn ONE flat-lay product photo into 4–8
> professional model photos at a cost Indian retailers can actually afford, with
> the SAME garment looking identical across all poses?
>
> Companion: [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) §6 (job queue, credit
> reservation) — this doc decides *which model* the worker runs.
> Status: **IMPLEMENTED** (2026-08) — the worker, 8 fixed poses, signed-URL
> orchestrator, and GPU-box deploy guide live in [`backend/ai/`](backend/ai/)
> (see [`AI_WORKER.md`](backend/ai/AI_WORKER.md)). The Cloud Run API worker route
> switches from stub → real pipeline the moment `GPU_HOST_URL` + `GPU_AUTH_TOKEN`
> are set. Swappable frontend pipeline: `src/api/ai.js`.

---

## 1. The problem, precisely

- One input: a flat-lay / ghost-mannequin photo of a garment (front + optional back).
- Output: 4–8 photos of a model wearing that exact garment in different poses.
- Constraints: **cost per shoot must be ~₹5–20** (a few credits), realistic enough to
  sell on Flipkart/Meesho/Instagram, and the garment (print, color, texture) must NOT
  drift between poses.
- The user's fear is real: **a fresh API call = fresh random result.** Without a
  consistency strategy, pose #2's print density will differ from pose #1's.

---

## 2. The two candidate routes

### Route A — Direct multi-pose image generation (RECOMMENDED)

Generate each pose as its own image, with **consistency controls** locking the garment:

```
flat-lay photo
   │
   ├─▶ Realistic-Vision (SD1.5, OpenRAIL-M) + IP-Adapter (garment lock)
   │        + control_v11p_sd15_openpose ControlNet (fixed poses)  ← v1, 100% legal
   │        └─ zero-shot garment lock — no per-SKU training needed
   │        └─ ⚠ NOT IDM-VTON / CatVTON / OOTDiffusion — ALL non-commercial licensed ❌
   │        └─ ⚠ NO commercially-safe OpenPose ControlNet exists for SDXL (OpenPose
   │           license is non-commercial) — SDXL tier uses depth/canny ControlNet
   │        └─ per-garment LoRA only for hero SKUs (train ~20 images → trigger word)
   │
   └─▶ 8 generations, same model template + same seed family + same garment ref
        → 8 consistent poses
```

**Cost (self-hosted, rented GPU):** ~$0.003–0.01 per image → **8 poses ≈ $0.03–0.10**
($0.25–0.85 ≈ ₹20–70 at managed APIs; self-hosted is a few rupees).

### Route B — Video generation → frame extraction (NOT recommended as primary)

```
flat-lay → I2V model (Veo 3.1 / Kling / Wan 2.2) → 8–12 s video of model turning
→ script extracts 4–8 frames → optional img2img cleanup
```

| Model | ~Cost / 10 s video | Frame quality | Verdict |
|---|---|---|---|
| Google Veo 3.1 | $0.5–1.5 (token-priced) | 4K possible, great physics | Way too expensive for catalog use |
| Kling | ~$0.1–0.3 | good motion, mid texture | Frames need cleanup |
| Runway Gen-4 | ~$1.8/video | great lighting | Expensive, cloud-only |
| Wan 2.2 (open source) | GPU rental only (~$0.01) | 720p native, needs upscale | Cheapest, but motion blur + flicker |

**Why it loses:** you pay for a whole video to get a few frames; every frame inherits
**motion blur**, compression artifacts, and the model's *scene* (backgrounds change
between frames); garments shimmer/flicker between frames; and you still need an img2img
cleanup pass per frame — which is just Route A again with extra steps. It only wins when
the *deliverable is a video* (reels/ads), not catalog stills.

> **Hybrid (the real pro move):** generate ONE perfect anchor image with Route A, then
> optionally feed it to a cheap open-source I2V (Wan) for a promo *reel* later. Catalog
> stills = Route A, always.

---

## 3. The consistency toolkit (your "quality changes every request" fear)

The fix is layered — combine all of these:

| Technique | What it locks | Cost to use |
|---|---|---|
| **Fixed model roster** | Body + face identity: pre-pick 5–10 model templates (Indian skin tones!), keep them forever. Same template = same anatomy across poses. | free |
| **Fixed seed family** | Reproducibility: seed = hash(storeId + productId + poseId). Same request → same result; retry doesn't shuffle quality. | free |
| **IP-Adapter (garment ref)** | Garment colors/print/texture identity injected as image prompt. Zero training. | free (weights) |
| **OpenPose ControlNet** | Pose skeleton → 8 defined poses (front, 3/4, profile, back, sitting, detail…). | free |
| **Per-garment LoRA** | The nuclear option: train ~20 views of the product into a tiny adapter (≈$1–2 or ~20 min on a 4090). Perfect print fidelity for hero products. | $1–3 per garment, once |
| **Img2img refinement** | Fix hands/edges at low denoise (0.25–0.35) after generation. | ~1 extra pass |

**Answer to "will each request look different?":** yes *if* you do nothing. No if you use
model templates + seed hashing + IP-Adapter/LoRA. Deterministic pipeline = consistent
quality per product, reproducible on retry.

---

## 4. Cost math — the whole point

Assumption: the app sells a shoot for **3 credits** (≈ ₹15–30 revenue). Backend cost per
shoot must stay well under that.

| Path | 8-image shoot cost | Notes |
|---|---|---|
| **Self-hosted FLUX.1-dev / SDXL + IP-Adapter + ControlNet** (rented 4090/3090, ~$0.3–0.6/hr, batch) | **$0.03–0.08** (~₹3–7) | ✅ viable, biggest lever |
| Managed open weights (Replicate/fal FLUX dev) | $0.08–0.15 | Viable, no infra |
| Vertex AI Imagen 4 / Gemini | $0.16–0.50 | Quality great, cost eats the margin |
| OpenAI gpt-image-1 | $0.08–0.45 | Same issue |
| **Video route (Veo/Kling)** | **$0.5–2.0** | ❌ kills the margin — 10–60× Route A |

**Conclusion: self-host the open-source stack on rented GPU spot instances.** At Indian
scale the infra cost is a few cents per shoot, leaving real margin. Managed APIs are the
fallback for burst/cold-start only.

---

## 4.5 The business decision — own weights, not per-image APIs

You're right to reject per-image APIs. The math:

| Route | Cost per 8-pose shoot | Who takes a cut |
|---|---|---|
| **Own weights on rented GPUs** (Modal/RunPod) | **$0.03–0.08** (≈ ₹3–7), trending to ~$0.004–0.01/img at scale | Only the GPU renter (~$0.3–0.8/hr, per-second billed, $0 when idle) |
| Managed open-weights API (Replicate/fal) | $0.08–0.15 | Platform margin on every call |
| Vertex Imagen 4 / Gemini / gpt-image-1 | $0.16–0.50 | Google/OpenAI margin on every call |
| **Video route (Veo/Kling)** | **$0.5–2.0** | ❌ |

At 3 credits ≈ ₹15–30 per shoot, an API that costs $0.16–0.50 eats **40–100% of revenue**.
Own weights keep the marginal cost at a few rupees — that **is** the business model.

**"Hosted on a platform" still counts as your own model.** With Modal/RunPod you rent a bare
GPU and run open weights you own — no per-image margin, no model-usage fee, nothing leaves
your control. The only real decision is *where the GPU lives*, not *who owns the model*.

**Why none of the famous open VTON models make it (the trap):**

| Model / dataset | License | Paid product? |
|---|---|---|
| IDM-VTON | CC BY-NC-SA 4.0 | ❌ |
| CatVTON | CC BY-NC-SA 4.0 | ❌ |
| OOTDiffusion | Non-commercial | ❌ |
| VITON-HD / DressCode (training data) | Non-commercial | ❌ can't even *train* on them |

Any of these in a paid app = takedown + lawsuit risk. Build the same capability from
license-safe parts instead: SDXL/SD3.5 + IP-Adapter (garment lock) + OpenPose ControlNet
(fixed poses) — zero-shot, needs no training data at all.

**Why NOT train your own "exactly-6-poses" model (yet):**
- You'd need thousands of paired (flat-lay → model-in-garment) images; every public dataset
  with that pairing is non-commercial, so the weights would be poisoned for commercial use.
- A fine-tune drifts on poses and needs rigid structural conditioning anyway — which is
  exactly what ControlNet pose templates already give you for free.
- Per-garment LoRAs don't scale (a LoRA per SKU × thousands of SKUs). Hero products only.

**The real upgrade path** (when you want to *own* the model): run this pipeline to generate
your own synthetic paired dataset from real catalog shoots, then fine-tune on **your own
data** — your IP, fully commercial. That's the moat you can build later, not day one.

**Multi-view generation (Zero123 / MVDream / Era3D) is the wrong tool** — it reconstructs a
single 3D object for rotatable previews, not a human wearing fabric with correct draping.
It can't do garment physics or model poses.

---

## 5. Recommended concrete stack (IMPLEMENTED in backend/ai/)

1. **Base (commercial-safe only, all licenses verified):**
   - **v1 (shipped):** `SG161222/Realistic_Vision_V5.1_noVAE` (CreativeML OpenRAIL-M)
     + `stabilityai/sd-vae-ft-mse` + `lllyasviel/control_v11p_sd15_openpose` (OpenRAIL-M)
     + `h94/IP-Adapter` ip-adapter_sd15 (Apache-2.0).
   - **Tier-2 (quality, optional):** **SDXL** (OpenRAIL-M) + IP-Adapter sdxl + **depth**
     ControlNet (`diffusers/controlnet-depth-sdxl-1.0`, CC-BY-4.0). ⚠ No commercial-safe
     OpenPose ControlNet exists for SDXL (OpenPose license = non-commercial) — that's why
     v1 uses the SD1.5 openpose model.
   - **Experiment (later):** **SD 3.5 Medium** (Stability community license, free under
     $1M gross revenue). ⚠ **FLUX.1-dev / IDM-VTON / CatVTON / OOTDiffusion are all
     non-commercial** — none may be used in a paid product.
2. **Engine:** self-contained `gpu_worker/worker.py` (FastAPI + diffusers) — no ComfyUI
   dependency. A ComfyUI variant is possible later; diffusers keeps the build deterministic
   and testable.
3. **Fixed roster of ~6–10 Indian model templates** (pre-made, gender + body type mix,
   studio-white backgrounds) — generated once, stored in `katalogit-processed`.
4. **8 standard poses** — `backend/ai/poses.json` + rendered OpenPose condition images
   (`poses/pose_0..7.png`, 512×768).
5. **Seed = FNV-1a(storeId:productId:poseId)** for determinism.
6. **Pipeline per product:** load flat-lay (signed URL) → 8 seeded generations with
   IP-Adapter + ControlNet → results PUT to signed URLs → product gallery updated.
7. **Queue it all in the existing Cloud Tasks `ai-jobs` worker** — credit reserve →
   job → settle/refund, exactly as designed in BACKEND_ARCHITECTURE.md §6. The GPU box
   never sees credentials (signed URLs only).

**Estimated first-build cost:** ~$50–100 of GPU time to assemble the roster + test the
workflow; ongoing ~₹1–3 per shoot (see AI_WORKER.md cost math).

---

## 6. Future ideas worth watching (cheap-consistency frontier)

- **Distilled/turbo models** (SD3.5-large-turbo, FLUX schnell, LCM) — 4-step inference,
  4–8× cheaper per image. Already assumed above.
- **Multi-reference/character-consistency models** (FLUX.1 Kontext-style, Gemini 2.5
  image's multi-turn identity memory) — less code, but per-image API cost.
- **Self-hosted Wan 2.2 I2V** for free promo *videos* (reels) once the stills are done —
  a separate product line, not the catalog path.
- **Retention-aware batching** — keep one warm GPU and batch multiple stores' jobs to
  amortize idle time (Cloud Tasks already queues them).

---

## 7. Decision summary

| Question | Answer |
|---|---|
| Direct multi-pose images, or video→frames? | **Direct images (Route A).** Video is 10–60× costlier per usable still and needs a cleanup pass anyway. |
| Own weights, or per-image API? | **Own weights.** Rent GPUs (Modal at low volume → RunPod/Vast at scale); APIs (Imagen/gpt-image-1) cost $0.16–0.50/shoot and eat 40–100% of a ₹15–30 shoot's revenue. |
| Which model? | **License-safe stack (v1, shipped):** Realistic-Vision SD1.5 + IP-Adapter + `control_v11p_sd15_openpose` on rented 4090s. SDXL tier uses depth ControlNet (no commercial-safe SDXL openpose exists). ⚠ NOT IDM-VTON/CatVTON/OOTDiffusion — all non-commercial. |
| Fine-tune a custom 6-pose model? | **Not yet.** No commercial paired dataset exists; fine-tunes drift on poses. ControlNet pose templates = the same result, zero training. Upgrade path: fine-tune on your own synthetic data later. |
| Multi-view generation? | **Wrong tool** — reconstructs a 3D object, can't do garment draping or model poses. |
| Cheapest without sacrificing quality? | Self-host + fixed model roster + seed hashing + optional LoRA. ~$0.03–0.08 per 8-pose shoot vs $0.5–2.0 for the video route. |
| How to stop quality drift between requests? | Fixed templates + seed = hash(product, pose) + IP-Adapter/LoRA garment lock + img2img cleanup. Deterministic, reproducible, retry-safe. |
| When to use managed APIs? | Cold start / burst / no GPU available — Replicate/fal FLUX dev at $0.08–0.15 per shoot as a temporary fallback. |
