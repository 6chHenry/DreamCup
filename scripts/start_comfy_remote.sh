#!/usr/bin/env bash
set -euo pipefail

cd /home/ma-user/ai-drama-h3-single

health_check() {
  curl --silent --show-error --fail --max-time 5 \
    http://127.0.0.1:8189/system_stats >/dev/null 2>&1
}

if health_check; then
  echo "[OK] ComfyUI is already running on 127.0.0.1:8189; reusing it."
  echo "[OK] Keeping this SSH session open for port forwarding. Press Ctrl+C to disconnect."
  trap 'exit 0' INT TERM
  while health_check; do
    sleep 15
  done
  echo "[ERROR] The existing ComfyUI service stopped responding." >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:8189 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ERROR] Port 8189 is occupied by a process that is not a healthy ComfyUI service." >&2
  lsof -nP -iTCP:8189 -sTCP:LISTEN >&2
  exit 1
fi

export CUDA_DEVICE_ORDER=PCI_BUS_ID
export CUDA_VISIBLE_DEVICES=GPU-51ca681f-8fc1-f10f-1662-28d595a4e77f
export NVIDIA_VISIBLE_DEVICES="$CUDA_VISIBLE_DEVICES"
export OMP_NUM_THREADS=16
export HF_HUB_DISABLE_TELEMETRY=1
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

exec .venv/bin/python ComfyUI-master/main.py \
  --listen 127.0.0.1 --port 8189 --offline --preview-method none \
  --cache-none --reserve-vram 8 --use-pytorch-cross-attention --disable-auto-launch
