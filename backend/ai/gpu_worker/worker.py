"""KatalogitAI — GPU worker: flat-lay photo → 8 fixed catalog poses.

Runs on a rented GPU box (RunPod / Vast.ai / any 24GB CUDA machine). It is a
*stateless compute box*: the Cloud Run API hands it a job containing ONLY
short-lived signed URLs (garment in, outputs out) plus prompt config, and a
shared secret. No GCP credentials ever touch this box — the API keeps every
secret server-side, and this box cannot mint URLs, read other stores' photos,
or touch wallets.

Model stack (all commercially safe — verified licenses):
  • base       SG161222/Realistic_Vision_V5.1_noVAE   (CreativeML OpenRAIL-M)
  • VAE        stabilityai/sd-vae-ft-mse              (Apache-2.0)
  • ControlNet lllyasviel/control_v11p_sd15_openpose  (CreativeML OpenRAIL-M)
  • IP-Adapter h94/IP-Adapter (ip-adapter_sd15.bin)   (Apache-2.0)

Determinism: seed = FNV-1a(seedBase + poseId) — the same product+pose always
renders identically (no fresh-request quality shuffle). Garment identity is
locked by IP-Adapter; pose by the OpenPose ControlNet condition.

Endpoints:
  POST /health            → { ok, model }
  POST /run               → submits a job, returns { jobId }   (async)
  GET  /run/{jobId}       → { status: queued|running|done|failed, outputs, error }
"""
import asyncio
import base64
import hashlib
import io
import json
import os
import time
import uuid

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

# ── config (env, injected by the box operator) ───────────────────────────
AUTH_TOKEN = os.environ.get("GPU_AUTH_TOKEN", "")
MODEL_BASE = os.environ.get("AI_MODEL_BASE", "SG161222/Realistic_Vision_V5.1_noVAE")
VAE = os.environ.get("AI_VAE", "stabilityai/sd-vae-ft-mse")
CONTROLNET = os.environ.get("AI_CONTROLNET", "lllyasviel/control_v11p_sd15_openpose")
IP_REPO = os.environ.get("AI_IP_ADAPTER_REPO", "h94/IP-Adapter")
IP_SUBFOLDER = os.environ.get("AI_IP_ADAPTER_SUBFOLDER", "models")
IP_WEIGHT = os.environ.get("AI_IP_ADAPTER_WEIGHT", "ip-adapter_sd15.bin")
STEPS = int(os.environ.get("AI_STEPS", "20"))
CFG = float(os.environ.get("AI_CFG", "7.0"))
IP_SCALE = float(os.environ.get("AI_IP_SCALE", "0.7"))
CN_SCALE = float(os.environ.get("AI_CN_SCALE", "0.65"))
WIDTH = int(os.environ.get("AI_WIDTH", "512"))
HEIGHT = int(os.environ.get("AI_HEIGHT", "768"))
MAX_GARMENT_BYTES = 20 * 1024 * 1024
# When set, every /health + /run/{id} hit touches this file (idle auto-shutdown).
HEARTBEAT_FILE = os.environ.get("HEARTBEAT_FILE", "")
# Local/test mode: allow http://127.0.0.1 garment/output URLs (no signed URLs).
ALLOW_LOCAL_URLS = os.environ.get("ALLOW_LOCAL_URLS", "") == "1"


def _heartbeat():
    if HEARTBEAT_FILE:
        try:
            with open(HEARTBEAT_FILE, "a"):
                os.utime(HEARTBEAT_FILE, None)
        except OSError:
            pass

# Negative prompt — Realistic Vision's recommended default + pose/hands fixes.
NEGATIVE = (
    "(deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, "
    "cartoon, drawing, anime:1.4), text, close up, cropped, out of frame, worst "
    "quality, low quality, jpeg artifacts, ugly, duplicate, morbid, mutilated, "
    "extra fingers, mutated hands, poorly drawn hands, poorly drawn face, "
    "mutation, deformed, blurry, bad anatomy, bad proportions, cloned face, "
    "disfigured, gross proportions, malformed limbs, missing arms, missing legs, "
    "extra arms, extra legs, fused fingers, too many fingers, long neck, watermark"
)
STYLE = (
    "studio product photography, soft studio lighting, seamless light gray "
    "background, professional e-commerce catalog, sharp focus, 4k, high detail, "
    "photorealistic"
)

HERE = os.path.dirname(os.path.abspath(__file__))
POSE_DIR = os.path.join(os.path.dirname(HERE), "poses")

app = FastAPI(title="KatalogitAI GPU Worker")

# in-memory job registry (this box is ephemeral by design — the API polls and
# refunds on failure; jobs do not need to survive a reboot)
JOBS = {}
_pipe = None
# The diffusers pipeline is NOT thread-safe — serialize ALL generation.
_gen_semaphore = asyncio.Semaphore(1)

MAX_POSES = 8
MAX_DIM = 1024


class RunRequest(BaseModel):
    jobId: str
    seedBase: str                 # e.g. "{storeId}:{productId}"
    prompt: str                   # full positive prompt (model + garment + style)
    negativePrompt: str = NEGATIVE
    garmentUrl: str               # signed GET URL (15 min)
    poses: list                   # [{ poseId, seed, outputUrl }] outputUrl = signed PUT
    width: int = WIDTH
    height: int = HEIGHT


def _safe_compare(a: str, b: str) -> bool:
    return hashlib.sha256(a.encode()).digest() == hashlib.sha256(b.encode()).digest()


def _fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def _pick_device():
    """CUDA → gpu, MPS → mps (Mac), else CPU. Works on any box."""
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_pipe():
    """Load the pipeline once, keep it warm. Returns (pipe, device)."""
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch
    from diffusers import AutoencoderKL, ControlNetModel, StableDiffusionControlNetPipeline

    device = _pick_device()
    torch_dtype = torch.float16 if device != "cpu" else torch.float32
    controlnet = ControlNetModel.from_pretrained(CONTROLNET, torch_dtype=torch_dtype)
    vae = AutoencoderKL.from_pretrained(VAE, torch_dtype=torch_dtype)
    pipe = StableDiffusionControlNetPipeline.from_pretrained(
        MODEL_BASE,
        controlnet=controlnet,
        vae=vae,
        torch_dtype=torch_dtype,
        safety_checker=None,
        requires_safety_checker=False,
    )
    pipe.load_ip_adapter(IP_REPO, subfolder=IP_SUBFOLDER, weight_name=IP_WEIGHT)
    pipe.set_ip_adapter_scale(IP_SCALE)
    pipe = pipe.to(device)
    if device == "cuda":
        pipe.enable_model_cpu_offload()   # fits a 24GB card with headroom
    else:
        # ⚠ Do NOT enable_attention_slicing(): IP-Adapter hands the attention
        # processors a (text_embeds, image_embeds) TUPLE; slicing replaces them
        # with SlicedAttnProcessor which crashes with "'tuple' object has no
        # attribute 'shape'".
        # Sequential CPU offload keeps only the active module on-device — on
        # Apple Silicon CPU↔GPU share one memory pool so this is nearly free,
        # and it fits the 8GB M1 (MPS OOMs with the full ~6GB stack resident).
        pipe.enable_sequential_cpu_offload()
        pipe.enable_vae_slicing()
        pipe.enable_vae_tiling()
    _pipe = pipe
    return pipe


async def _download(url: str, cap: int) -> bytes:
    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("GET", url) as r:
            r.raise_for_status()
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > cap:
                    raise HTTPException(413, "garment too large")
            return bytes(buf)


async def _upload_put(url: str, data: bytes, content_type: str):
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.put(url, content=data, headers={"Content-Type": content_type})
        r.raise_for_status()


def _render_pose(pipe, garment_pil, pose_pil, prompt, negative, seed, width, height):
    import torch

    gen = torch.Generator(device="cpu").manual_seed(seed)
    out = pipe(
        prompt=prompt,
        negative_prompt=negative,
        image=pose_pil.resize((width, height)),
        ip_adapter_image=garment_pil.resize((width, height)),
        num_inference_steps=STEPS,
        guidance_scale=CFG,
        controlnet_conditioning_scale=CN_SCALE,
        generator=gen,
        width=width,
        height=height,
    ).images[0]
    return out


async def _run_job(job_id: str, req: RunRequest):
    JOBS[job_id] = {"status": "running", "outputs": [], "error": None, "startedAt": time.time()}
    try:
        # ONE generation at a time — the diffusers pipe is not thread-safe.
        async with _gen_semaphore:
            pipe = await asyncio.to_thread(_load_pipe)

            garment_bytes = await _download(req.garmentUrl, MAX_GARMENT_BYTES)
            from PIL import Image
            garment = Image.open(io.BytesIO(garment_bytes)).convert("RGB")

            outputs = []
            for pose in req.poses:
                pose_id = pose["poseId"]
                seed = int(pose.get("seed") or _fnv1a(req.seedBase + ":" + pose_id))
                pose_img = Image.open(os.path.join(POSE_DIR, "pose_{}.png".format(pose["index"]))).convert("RGB")
                rendered = await asyncio.to_thread(
                    _render_pose, pipe, garment, pose_img,
                    req.prompt + " " + pose["prompt"], req.negativePrompt,
                    seed, req.width, req.height,
                )
                buf = io.BytesIO()
                rendered.save(buf, "PNG")
                await _upload_put(pose["outputUrl"], buf.getvalue(), "image/png")
                outputs.append({"poseId": pose_id, "bytes": buf.tell()})

            JOBS[job_id].update({"status": "done", "outputs": outputs})
    except Exception as err:  # noqa: BLE001 — record failure; the API polls & refunds
        JOBS[job_id].update({"status": "failed", "error": str(err)[:500]})


def _check_auth(x_auth_token: str | None):
    if not AUTH_TOKEN or not x_auth_token or not _safe_compare(x_auth_token, AUTH_TOKEN):
        raise HTTPException(403, "Forbidden")


def _validate_request(req: RunRequest):
    """Resource-abuse clamps — the payload comes over the network."""
    if not (1 <= len(req.poses) <= MAX_POSES):
        raise HTTPException(400, "poses must be 1..{} items".format(MAX_POSES))
    if not (256 <= req.width <= MAX_DIM and 256 <= req.height <= MAX_DIM):
        raise HTTPException(400, "dimensions must be 256..{}".format(MAX_DIM))
    if not (0 < len(req.jobId) <= 64 and 0 < len(req.seedBase) <= 128):
        raise HTTPException(400, "bad jobId/seedBase")
    if not _url_ok(req.garmentUrl):
        raise HTTPException(400, "garmentUrl must be https")
    for p in req.poses:
        idx = p.get("index")
        if not isinstance(idx, int) or not (0 <= idx < 8):
            raise HTTPException(400, "pose index must be 0..7")
        if not _url_ok(str(p.get("outputUrl", ""))):
            raise HTTPException(400, "outputUrl must be https")


def _url_ok(url: str) -> bool:
    if url.startswith("https://"):
        return True
    if ALLOW_LOCAL_URLS and url.startswith(("http://127.0.0.1", "http://localhost")):
        return True
    return False


@app.get("/health")
async def health():
    _heartbeat()
    return {"ok": True, "model": MODEL_BASE, "warm": _pipe is not None, "ts": time.time()}


@app.post("/run")
async def run(req: RunRequest, x_auth_token: str | None = Header(default=None)):
    _check_auth(x_auth_token)
    _validate_request(req)
    job_id = req.jobId or str(uuid.uuid4())
    JOBS[job_id] = {"status": "queued", "outputs": [], "error": None, "startedAt": time.time()}
    asyncio.create_task(_run_job(job_id, req))
    return {"jobId": job_id, "status": "queued"}


@app.get("/run/{job_id}")
async def status(job_id: str, x_auth_token: str | None = Header(default=None)):
    _check_auth(x_auth_token)
    _heartbeat()
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
