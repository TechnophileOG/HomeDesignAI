# KatalogitAI GPU worker image — build & push to a registry, then deploy on a
# RunPod / Vast.ai / Modal GPU (24GB+ VRAM recommended).
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3.11-venv python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
# CUDA wheel index — install torch first so the resolver pins CUDA builds.
RUN pip3 install --no-cache-dir --index-url https://download.pytorch.org/whl/cu121 \
      torch==2.4.1 torchvision==0.19.1 && \
    pip3 install --no-cache-dir -r requirements.txt

COPY worker.py .
COPY ../poses.json /app/poses.json
COPY ../poses /app/poses

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000"]
