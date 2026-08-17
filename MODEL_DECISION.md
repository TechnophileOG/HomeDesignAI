# MODEL_DECISION.md — KatalogitAI Model Selection (FINAL)

**Date:** Aug 2026 · **Status:** Locked. No more model tinkering until revenue exists.

---

## 1. The decision in one paragraph

Stop generating the human with SD — that's the entire reason results look ugly.
**Buy once, use forever: license 8 real model photos** (front, ¾, side, back,
hands-on-hips, walking, seated, detail — one-time ₹5–15k local shoot or ~$30
stock). Then **FASHN VTON 1.5** pixel-perfectly dresses that same real model in
every garment (Apache-2.0, runs on T4/L4). That's the whole Photoroom/FASHN
secret: *real body + pixel-perfect garment transfer + clean cutout = industry
quality at ₹1–3/SKU.* Pose-driven video (Wan-Animate-2 / Animate Anyone 2) is the
**premium tier** for consistent-model video + exact-pose extraction, added later
when GPU quota lands. Text AI = Gemini Flash (cheap, native multimodal) for
listings/SEO. Qwen-Image 2.0 Lightning = future hero shots + infographics
(text-in-image, which SD can't do at all).

---

## 2. Ranking criteria (my weights, chosen for YOUR business)

| Criterion | Weight | Why |
|---|---|---|
| Realism & garment fidelity | 30% | The product IS the garment. Cut, neckline, print must survive. |
| Native image understanding (reference/editing/try-on) | 25% | Adapters are glue; native conditioning is the only thing that preserves the garment. |
| GPU cost-efficiency (₹/SKU) | 25% | Your whole economics depend on ₹1–3 per 8-photo SKU. |
| Text rendering | 10% | Needed for listing infographics later, not today. |
| Commercial license | 10% | One NC model = lawsuit = end of business. Non-negotiable filter. |

---

## 3. IMAGE MODELS — full ranking

### 3a. General text-to-image (for hero shots, backgrounds, infographics)

| Rank | Model | Realism /30 | Native img-understanding /25 | Cost-efficiency /25 | Text /10 | License /10 | **Score** |
|---|---|---|---|---|---|---|---|
| 1 | **Qwen-Image 2.0 Lightning** (7B, 4-step) | 8.5 | 8.5 | 9.0 | 9.5 | 10 Apache | **8.88** |
| 2 | **Qwen-Image 2.0** (7B, native 2K) | 8.5 | 8.5 | 7.0 | 9.5 | 10 Apache | **8.38** |
| 3 | **FLUX.2 [klein] 4B** (multi-reference, 8GB) | 8.5 | 8.0 | 7.5 | 8.0 | 10 Apache | **8.23** |
| 4 | **Z-Image Turbo** (6B, fastest) | 7.5 | 6.5 | 9.5 | 8.0 | 10 Apache | **8.05** |
| 5 | **Cosmos3-64B** (OpenMDW) | 9.5 | 9.5 | 2.0 | 8.0 | 10 | **7.53** — ❌ needs 80GB+ VRAM. 2027 upgrade only. |
| 6 | **SD 3.5 Large** (ecosystem king) | 7.5 | 7.0 | 7.0 | 7.0 | 8 (<$1M rev) | **7.25** |
| 7 | **FLUX.2 [dev] 32B** | 9.5 | 9.0 | 5.0 | 8.5 | 0 NON-COMMERCIAL | **7.20** — dead for us. |
| 8 | **HunyuanImage 3.0** (100M MAU free) | 8.5 | 8.0 | 3.0 | 7.5 | 8 | **6.85** — needs H100-class, skip. |
| 9 | **SD1.5 + IP-Adapter + ControlNet** (what we ran) | 4.0 | 4.0 | 9.0 | 2.0 | 10 | **5.65** — PROVEN UGLY. Killed. |

### 3b. Virtual try-on specialists (the garment-preservation job — your core)

| Rank | Model | License | Verdict |
|---|---|---|---|
| 1 | **FASHN VTON 1.5** | Apache 2.0 ✅ | Pixel-perfect garment transfer, maskless, native 576×864, T4-runnable. **THE ENGINE.** |
| 2 | **DCI-VTON** | MIT ✅ | Solid backup, permissive. |
| 3 | **Animate Anyone 2 / Wan-Animate-2** | Apache 2.0 ✅ | Try-on + pose-driven VIDEO (see §5). Premium tier. |
| ❌ | IDM-VTON, CatVTON, OOTDiffusion, VITON-HD, StableVITON | CC BY-NC ❌ | Best research results, **illegal to sell with**. Never. |

---

## 4. VIDEO MODELS — full ranking (same criteria + pose control)

| Rank | Model | Realism /30 | Motion+identity /25 | Cost-eff /25 | Pose control /10 | License /10 | **Score** | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | **Wan-Animate-2** (Alibaba, Aug 2026) | 8.5 | 9.0 | 7.0 | 9.0 | 10 Apache | **8.45** | Real-time pose-driven character animation. |
| 2 | **Animate Anyone 2** | 8.5 | 8.5 | 6.5 | 9.0 | 10 Apache | **8.20** | Reference + pose skeleton → exact poses. |
| 3 | **Wan 2.2** (14B/5B, I2V/V2V) | 9.0 | 8.5 | 6.0 | 8.0 | 10 Apache | **8.13** | Best open photorealism + humans. 5B runs on 8GB. |
| 4 | **HunyuanVideo 1.5** (13B) | 8.5 | 9.0 | 6.0 | 6.0 | 10 Apache | **7.90** | Best motion/physics. |
| 5 | **LTXVideo 13B** | 7.5 | 7.5 | 8.0 | 5.0 | 10 Apache | **7.63** | 2–3× faster, stylized. |
| 6 | Kling 2.6 / Veo 3.1 / Sora 2 (hosted) | 9–9.5 | 9–9.5 | 2–3 | 7 | n/a | **~7** | Best quality but $0.10–1/sec — kills ₹1–3/SKU. Pilot-only. |

---

## 5. YES — you can force a video model to output ONLY your poses

Three techniques, ranked by control:

1. **Pose-driven animation (best — you define everything).**
   Feed the model: reference photo (FASHN try-on result) + a pose-skeleton
   video of exactly your 8 poses. The model animates the SAME person through
   exactly those poses; you extract 1 frame per pose timestamp and throw away
   the transitions. **One generation = one consistent model across all 8
   poses** — the identity-drift problem that killed SD is solved for free.
   Models: Animate Anyone 2, UniAnimate-Wan, Wan-Animate-2, One-to-All
   Animation (all Apache-2.0).
   *Cost:* one ~81-frame clip per garment on a 4090/L4 ≈ 3–5 min ≈ ₹1.5–3/SKU.

2. **Wan 2.2 V2V (medium control).** Drive with a video of a model doing the
   poses; the character in the reference image mimics it. Poses = whatever the
   driving video does. Same keyframe-extraction trick.

3. **Turnaround video (least control).** "Model slowly turns 360°" → extract
   every Nth frame, drop blurry frames with a sharpness filter. Works, but
   poses are uncontrolled. Only for product renders, not catalogs.

**The "don't generate useless stuff" principle:** with pose-driven models the
useless frames are the *transitions between your poses* — you sample only the
keyframes at pose timestamps. Resolution is 512–768; upscale with Real-ESRGAN.

---

## 6. THE FINAL PIPELINE (per SKU, target ₹1–3)

```
[Seller photo] → Stage 0: rembg cutout (kills background-print leak)
              → Stage A: VLM analyzer (Gemini Flash) — classify garment
                type, decide pairing ("kurti top → +leggings"), craft command
              → Stage B: FASHN VTON 1.5 try-on onto REAL licensed body-bank
                photo #1..8  (8 fixed poses: front, ¾, side, back, hips,
                walking, seated, detail)
              → Stage C: Real-ESRGAN upscale to 1024–2048
              → Output: 8 images, same real model, pixel-perfect garment

[Premium tier — later, when GPU quota lands]
              → Stage D: Animate Anyone 2 / Wan-Animate-2 on the FASHN
                reference → 8 consistent poses + a 5s model video (Wan 2.2)
```

---

## 7. What changes NOW (stop tinkering)

1. **Kill SD1.5+IPAdapter.** It can't be fixed by prompts — adapter ceiling.
2. **Buy the body bank once** (real model photos, 8 poses) — this is the
   single biggest quality jump, and it costs ₹5–15k one-time, not per SKU.
3. **rembg cutout before everything** — fixes the "print on the backdrop" leak.
4. **Text AI = Gemini Flash** now (₹0.01–0.05/SKU, native multimodal, no GPU).
5. **GPU:** keep validating on Kaggle free T4. When GCP quota lands, FASHN
   self-hosted on L4/T4. Until then, ship the product with everything EXCEPT
   AI image generation working, and use the FASHN hosted API (~₹6/SKU) only for
   paid pilot customers.
6. **Deferred:** Qwen-Image 2.0 Lightning (hero/infographics), Wan 2.2 (video),
   Cosmos3-64B (2027 frontier), seller-platform automation (amazon/flipkart —
   already shelved once, stays shelved).

## 8. Licensing status (all clear for commercial use)

Apache-2.0: FASHN VTON 1.5, Qwen-Image 2.0, Z-Image, FLUX.2 klein, Wan 2.2,
Animate Anyone 2, Wan-Animate-2, UniAnimate. · MIT: DCI-VTON. · OpenMDW 1.1:
Cosmos3. · Stability Community: SD3.5 (<$1M rev). · **Avoid entirely:** FLUX.2
dev, IDM-VTON, CatVTON, OOTDiffusion, VITON-HD (non-commercial licenses).
