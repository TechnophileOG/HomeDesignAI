#!/bin/bash
# KatalogitAI — create the GPU VM on GCP (run AFTER the billing account is
# upgraded to PAID — free-tier billing cannot provision GPUs).
#
#   gcloud auth login && gcloud config set project katalogitai-501916
#   bash gcp_create_vm.sh <GPU_AUTH_TOKEN>
#
# GPU options (quotas as of 2026-08 — P100 usable immediately, T4/L4 after a
# quota request; see AI_WORKER.md §GCP):
#   P100 (16GB): nvidia-tesla-p100  in us-central1-c (quota already granted)
#   T4   (16GB): nvidia-tesla-t4    after quota request (cheaper + faster)
#   L4   (24GB): nvidia-l4          after quota request (best, SDXL-ready)
set -euo pipefail

PROJECT="katalogitai-501916"
ZONE="us-central1-c"
GPU_TYPE="nvidia-tesla-p100"
MACHINE="n1-standard-4"
TOKEN="${1:?usage: gcp_create_vm.sh <GPU_AUTH_TOKEN>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# 1) Re-upload the worker bundle (keeps the VM image in sync with the repo).
cd "$(dirname "$0")/.."   # backend/ai
tar -czf /tmp/katalogit-gpu-worker.tar.gz gpu_worker poses.json poses
gsutil cp /tmp/katalogit-gpu-worker.tar.gz \
  "gs://katalogit-processed/_internal/katalogit-gpu-worker-v1.tar.gz"

# 2) Firewall (idempotent): allow Cloud Run's worker to reach :8000.
gcloud compute firewall-rules create allow-katalogit-worker \
  --project="$PROJECT" --direction=INGRESS --priority=1000 --network=default \
  --action=ALLOW --rules=tcp:8000 --source-ranges=0.0.0.0/0 \
  --target-tags=katalogit-gpu \
  || echo "(firewall rule exists)"

# 3) Create the preemptible GPU VM (auto-powers-off after 45 min idle).
gcloud compute instances create katalogit-gpu \
  --project="$PROJECT" --zone="$ZONE" \
  --machine-type="$MACHINE" \
  --accelerator="type=${GPU_TYPE},count=1" \
  --maintenance-policy=TERMINATE --preemptible \
  --image-family=pytorch-2-9-cu129-ubuntu-2204-nvidia-580 \
  --image-project=deeplearning-platform-release \
  --boot-disk-size=100GB --boot-disk-type=pd-standard \
  --tags=katalogit-gpu \
  --metadata-from-file=startup-script="$HERE/gcp_startup.sh" \
  --metadata="gpu-auth-token=${TOKEN}"

echo
echo "VM creating… watch install:"
echo "  gcloud compute ssh katalogit-gpu --zone=$ZONE --project=$PROJECT -- tail -f /var/log/katalogit-startup.log"
echo "When STARTUP DONE appears, wire Cloud Run:"
echo "  gcloud run services update katalogit-api --region asia-south1 --project=$PROJECT \\"
echo "    --update-env-vars GPU_HOST_URL=http://<VM_EXTERNAL_IP>:8000,GPU_AUTH_TOKEN=${TOKEN}"
