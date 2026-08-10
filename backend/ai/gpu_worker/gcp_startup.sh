#!/bin/bash
# KatalogitAI — GPU VM startup script (GCP).
# Used with: gcloud compute instances create katalogit-gpu \
#   --zone=asia-south1-a --machine-type=n1-standard-4 \
#   --accelerator=type=nvidia-tesla-p100,count=1 \
#   --maintenance-policy=TERMINATE --preemptible \
#   --image-family=pytorch-2-9-cu129-ubuntu-2204-nvidia-580 \
#   --image-project=deeplearning-platform-release \
#   --boot-disk-size=60GB --tags=katalogit-gpu \
#   --metadata-from-file=startup-script=gcp_startup.sh \
#   --metadata=gpu-auth-token=CHANGE_ME
set -x
exec > /var/log/katalogit-startup.log 2>&1

BUNDLE="katalogit-gpu-worker-v1.tar.gz"
BUCKET="katalogit-processed"
WORKDIR="/opt/katalogit-worker"

# ── 1. secrets + bundle (dependency-free: metadata token + curl) ─────────
AUTH_TOKEN=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/gpu-auth-token" | tr -d '\n')
echo "auth token len: ${#AUTH_TOKEN}"

ACCESS=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $ACCESS" \
  -o /tmp/worker.tar.gz \
  "https://storage.googleapis.com/${BUCKET}/_internal/${BUNDLE}"
mkdir -p "$WORKDIR"
tar -xzf /tmp/worker.tar.gz -C "$WORKDIR"
cd "$WORKDIR/gpu_worker" || exit 1

# ── 2. torch sanity on the GPU (P100 = Pascal sm_60) ─────────────────────
if ! python3 - <<'PY'
import torch
print("torch", torch.__version__, "cuda_available", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device", torch.cuda.get_device_name(0), "cap", torch.cuda.get_device_capability(0))
    a = torch.rand(1024, 1024, device="cuda"); b = a @ a
    torch.cuda.synchronize(); print("cuda matmul OK")
else:
    raise SystemExit("CUDA NOT AVAILABLE")
PY
then
  echo "downgrading torch to a Pascal-supported build (cu121)..."
  python3 -m pip install --no-cache-dir torch==2.1.2 torchvision==0.16.2 \
    --index-url https://download.pytorch.org/whl/cu121
fi

# ── 3. worker deps ───────────────────────────────────────────────────────
python3 -m pip install --no-cache-dir -r requirements.txt

# ── 4. preload the model (first real job then starts instantly) ──────────
export GPU_AUTH_TOKEN="$AUTH_TOKEN"
export HEARTBEAT_FILE=/var/log/katalogit-heartbeat
python3 - <<'PY' || echo "PRELOAD FAILED (non-fatal) — first real job will load instead"
from worker import _load_pipe
p = _load_pipe()
print("pipe loaded:", type(p).__name__)
PY

# ── 5. run the worker as a service ───────────────────────────────────────
cat > /etc/systemd/system/katalogit-worker.service <<EOF
[Unit]
Description=KatalogitAI GPU Worker
After=network-online.target
[Service]
Environment=GPU_AUTH_TOKEN=$AUTH_TOKEN
Environment=HEARTBEAT_FILE=/var/log/katalogit-heartbeat
WorkingDirectory=$WORKDIR/gpu_worker
ExecStart=/usr/bin/python3 -m uvicorn worker:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable katalogit-worker
systemctl start katalogit-worker
touch /var/log/katalogit-heartbeat

# ── 6. idle auto-poweroff (cost guard: ~₹0 if nobody uses it) ────────────
cat > /opt/katalogit-worker/idle-shutdown.sh <<'EOF'
#!/bin/bash
HB=/var/log/katalogit-heartbeat
if [ -f "$HB" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$HB") ))
  if [ "$AGE" -gt 2700 ]; then  # 45 min without a /health or /run hit
    echo "$(date) idle ${AGE}s — powering off" >> /var/log/katalogit-startup.log
    /sbin/poweroff
  fi
fi
EOF
chmod +x /opt/katalogit-worker/idle-shutdown.sh
printf '*/10 * * * * root /opt/katalogit-worker/idle-shutdown.sh\n' > /etc/cron.d/katalogit-idle
chmod 644 /etc/cron.d/katalogit-idle

echo "STARTUP DONE — worker on :8000"
