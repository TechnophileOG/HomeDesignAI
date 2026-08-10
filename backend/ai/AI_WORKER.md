# KatalogitAI — AI Worker (the GPU box)

> Turns ONE flat-lay photo into **8 fixed catalog poses** of a model wearing the
> garment. This is the *"SDXL/SD1.5 + IP-Adapter + OpenPose ControlNet, self-hosted"*
> plan made concrete. Everything here is **commercially safe** (licenses verified
> 2026-08) and priced to hit **₹1–3 per SKU**.

## How it fits

```
Cloud Run API (katalogit-api)                     GPU box (RunPod/Vast/Modal)
┌─────────────────────────────────────┐          ┌────────────────────────────┐
│ POST /jobs → reserve 3 credits     │          │ FastAPI worker (worker.py) │
│ Cloud Tasks → POST /workers/run-job │  HTTPS   │  • Realistic-Vision SD1.5   │
│  → submitGpuJob():                 │ ───────▶ │  • IP-Adapter (garment)     │
│    • signed GET url (flat-lay)     │  payload │  • OpenPose ControlNet      │
│    • 8 signed PUT urls (outputs)   │          │  • 8 seeded poses           │
│  → pollGpuJob() until done         │ ◀─────── │  → PUT 8 PNGs to signed URLs│
│  → job done + product gallery      │  status  └────────────────────────────┘
└─────────────────────────────────────┘
```

**The security invariant:** the GPU box receives ONLY short-lived signed URLs +
prompt text + a shared secret. It has **no GCP credentials**, cannot read other
stores' photos, cannot touch wallets, cannot mint URLs. All secrets stay in Cloud
Run. This matters for your org: your GCP org blocks service-account key creation,
and this design needs zero keys on the GPU side.

## The model stack (all licenses verified)

| Piece | Model | License | Commercial? |
|---|---|---|---|
| Base | `SG161222/Realistic_Vision_V5.1_noVAE` | CreativeML OpenRAIL-M | ✅ |
| VAE | `stabilityai/sd-vae-ft-mse` | Apache-2.0 | ✅ |
| ControlNet | `lllyasviel/control_v11p_sd15_openpose` | CreativeML OpenRAIL-M | ✅ |
| IP-Adapter | `h94/IP-Adapter` (ip-adapter_sd15.bin) | Apache-2.0 | ✅ |
| Pose conditions | `backend/ai/poses/pose_0..7.png` (rendered, committed) | ours | ✅ |

> ⚠ **Why not SDXL + OpenPose?** The only SDXL OpenPose ControlNets inherit the
> **non-commercial OpenPose license** (same trap as CatVTON). The SDXL tier (optional,
> `AI_MODEL_BASE=stabilityai/stable-diffusion-xl-base-1.0`, `AI_CONTROLNET=diffusers/controlnet-depth-sdxl-1.0`)
> uses depth ControlNet instead — commercial-safe (CC-BY-4.0).

## Cost math — cracking ₹1–3 per SKU (8 photos)

Measured on a 4090 (see research, 2026-08):

| Input | Value |
|---|---|
| SD1.5 512×768 @ 20 steps | ~0.5–0.7 s/image |
| + IP-Adapter + ControlNet overhead | ~1 s/image total |
| **8 images per SKU** | **~8–12 s compute** |
| GPU cost (4090 @ $0.40/hr ≈ ₹33/hr) | ≈ ₹0.10–0.15/SKU compute |
| + download/upload/serialize | ≈ ₹0.2–0.4/SKU |
| **Realistic total** | **≈ ₹0.3–0.8/SKU** ✅ (3–10× under your ₹1–3 budget) |

Even at a "secure" box at $0.69/hr and 2× slower generation: **~₹1.5/SKU** — still inside budget.

### The rules that keep it there

1. **BATCH, never cold-start per SKU.** A GPU that loads models once and processes
   the queue warm does ~100 SKUs/hour. Per-SKU cold starts pay for minutes of idle.
   Cloud Tasks already queues jobs — set the worker's concurrency to drain the queue
   while the box is warm.
2. **Keep the box busy during peak, kill it at night.** RunPod community/Vast at
   $0.13–0.37/hr; a 4090 doing 100 SKUs/hr at $0.25/hr ≈ **₹0.2/SKU**.
3. **Turbo/Lightning levers (later):** 8–12 steps instead of 20 (LCM/Lightning
   LoRAs) → 2–3× faster → ~₹0.15/SKU. Test quality on your roster first.
4. **Upscale on the box** (Real-ESRGAN, free) — 512×768 → 1536×2304 for the
   customer-facing gallery; still one box, no extra GPU.
5. **Retries are refunded, not re-billed** — the API refunds on definitive failure,
   so a bad box never costs the customer twice.

## Deploy the box on GCP (preferred — us-central1-c, ~10 min)

> ⚠ **Prerequisite (5 min, you):** the project's billing account is on the
> **GCP free tier**, which cannot provision GPUs (this is also why Cloud SQL
> and SA keys were blocked). Upgrade once:
> **console.cloud.google.com/billing → select the account → "Upgrade to paid"**
> (add/verify a card; Google may do a small authorization hold).
> Optional, recommended: request **T4 or L4 quota** at
> console.cloud.google.com/iam-admin/quotas (region us-central1, metric
> "NVIDIA T4 GPUs"/"NVIDIA L4 GPUs", amount 1) — usually auto-approved in
> minutes. T4 preemptible ≈ $0.12–0.15/hr, L4 ≈ $0.25–0.35/hr.

```bash
# one-time setup
gcloud auth login && gcloud config set project katalogitai-501916

# generate a shared secret and create the VM (P100 works immediately;
# edit gcp_create_vm.sh GPU_TYPE to nvidia-tesla-t4 / nvidia-l4 after quota)
GPU_TOKEN=$(openssl rand -hex 32)
bash backend/ai/gpu_worker/gcp_create_vm.sh "$GPU_TOKEN"

# watch the install, then grab the VM's external IP
gcloud compute ssh katalogit-gpu --zone=us-central1-c -- tail -f /var/log/katalogit-startup.log
gcloud compute instances describe katalogit-gpu --zone=us-central1-c \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)'

# wire Cloud Run to the box (worker switches from stub → real pipeline)
gcloud run services update katalogit-api --region asia-south1 \
  --update-env-vars GPU_HOST_URL=http://<EXTERNAL_IP>:8000,GPU_AUTH_TOKEN="$GPU_TOKEN"
```

The VM is **preemptible** (≈60–80% cheaper) and **auto-powers-off after
45 minutes idle** — a box nobody uses costs ~₹0. Restart with
`gcloud compute instances start katalogit-gpu --zone=us-central1-c`.

> Security note: the firewall allows :8000 from the internet, protected only
> by the shared secret + signed-URL design. For production, tighten to Cloud
> Run egress IPs or an internal VPC + Cloud Run VPC connector.

---

## Deploy the box (RunPod quickstart — ~20 min)

1. **RunPod** → *Pods* → *Deploy* → template **RunPod PyTorch (CUDA 12.x)** → GPU
   **RTX 4090** (or 3090 to save money) → 25 GB disk.
2. SSH in (or use the web terminal) and run:

```bash
git clone <your-repo> backend/ai && cd backend/ai/gpu_worker   # or scp the folder
docker build -t katalogit-worker .                             # CUDA image (see Dockerfile)
# or run directly (faster to iterate):
pip install -r requirements.txt --index-url https://download.pytorch.org/whl/cu121
export GPU_AUTH_TOKEN="$(openssl rand -hex 32)"
uvicorn worker:app --host 0.0.0.0 --port 8000
```

3. Expose it: RunPod *Expose TCP ports* (gives you a public `https://…runpod.net` URL)
   — or Vast.ai *Expose ports*. The API calls `GPU_HOST_URL` over HTTPS.
4. In Cloud Run, set `GPU_HOST_URL` + `GPU_AUTH_TOKEN` (same secret) via
   `gcloud run services update katalogit-api --region asia-south1 --update-env-vars …`
   → the worker route switches from stub → real pipeline instantly.
5. **First-run:** the box downloads ~5 GB of weights on first job (~2 min), then
   stays warm. `POST {GPU_HOST_URL}/health` returns `{"warm": true}` when loaded.

## Environment (box side)

| Var | Default | Notes |
|---|---|---|
| `GPU_AUTH_TOKEN` | — | **required** — shared secret, must match Cloud Run |
| `AI_MODEL_BASE` | Realistic_Vision_V5.1_noVAE | swap for SDXL for the quality tier |
| `AI_CONTROLNET` | control_v11p_sd15_openpose | SDXL tier: `diffusers/controlnet-depth-sdxl-1.0` |
| `AI_STEPS` | 20 | 8–12 with a Lightning/LCM LoRA |
| `AI_IP_SCALE` | 0.7 | higher = more garment fidelity, less pose freedom |
| `AI_CN_SCALE` | 0.65 | higher = stricter pose, may stiffen fabric |
| `AI_WIDTH`/`AI_HEIGHT` | 512/768 | SD1.5 native portrait |

## Tuning the look

- **Garment drift between poses** → raise `AI_IP_SCALE` (0.75–0.85); add the garment's
  color/print to the prompt (the API already injects `title + colors + category`).
- **Pose too loose** → raise `AI_CN_SCALE`.
- **Fabric too stiff / wrinkles gone** → lower `AI_IP_SCALE`, lower `AI_CN_SCALE` slightly.
- **Realism** → the model roster (pre-generated Indian model templates) matters more
  than any prompt; keep templates fixed so identity is consistent across poses.
- **Hero SKUs** → per-garment LoRA (~20 views, ~₹100–200 of GPU time once) for
  print-perfect fidelity on your top sellers.

## Files

```
backend/ai/
  poses.json             8 fixed poses: id, name, prompt suffix, COCO-17 keypoints
  render_poses.py        pure-stdlib renderer (keypoints → OpenPose condition PNGs)
  poses/pose_0..7.png    the rendered conditions (committed — box needs no renderer)
  gpu_worker/
    worker.py            FastAPI app: /health, /run (async), /run/{id} (poll)
    requirements.txt     Python deps (torch installed from CUDA index, see Dockerfile)
    Dockerfile           CUDA 12 image
  test-orchestrator.mjs  mock-GPU test for the Cloud Run orchestrator
../src/ai-client.js      Cloud Run orchestrator (signs URLs, submits, polls)
../src/routes/jobs.js    worker route: real pipeline when GPU_HOST_URL is set
```

## Security checklist for the box

- [ ] `GPU_AUTH_TOKEN` is long/random, HTTPS-only, never in the repo
- [ ] The box's firewall allows only 443 from Cloud Run (RunPod/Vast egress IPs)
- [ ] The box has no GCP service-account key, no env secrets beyond the token
- [ ] Signed URLs expire in 15 min — a leaked URL is worthless after that
- [ ] Job outputs are `image/png` only; sizes capped on both sides
