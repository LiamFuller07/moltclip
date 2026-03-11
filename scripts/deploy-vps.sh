#!/usr/bin/env bash
set -euo pipefail

# Deploy MoltClip to a VPS
# Usage: ./scripts/deploy-vps.sh <vps-host> [ssh-user]
#   or:  VPS_HOST=1.2.3.4 ./scripts/deploy-vps.sh

VPS_HOST="${1:-${VPS_HOST:-}}"
SSH_USER="${2:-${SSH_USER:-root}}"

if [[ -z "$VPS_HOST" ]]; then
  echo "Usage: deploy-vps.sh <vps-host> [ssh-user]"
  echo "   or: VPS_HOST=1.2.3.4 deploy-vps.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REMOTE_DIR="/opt/moltclip"

echo "=== Deploying MoltClip to ${SSH_USER}@${VPS_HOST} ==="
echo ""

# 1. Copy repo to VPS
echo "[1/5] Syncing code to ${REMOTE_DIR}..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude '*.env' \
  --exclude '.env*' \
  "$PROJECT_ROOT/" "${SSH_USER}@${VPS_HOST}:${REMOTE_DIR}/"
echo ""

# 2. Run bootstrap if needed
echo "[2/5] Running bootstrap (idempotent)..."
ssh "${SSH_USER}@${VPS_HOST}" "bash ${REMOTE_DIR}/packages/vps/bootstrap.sh" 2>/dev/null || true
echo ""

# 3. Build containers
echo "[3/5] Building containers..."
ssh "${SSH_USER}@${VPS_HOST}" "cd ${REMOTE_DIR}/packages/vps && docker compose build"
echo ""

# 4. Start/restart stack
echo "[4/5] Starting stack..."
ssh "${SSH_USER}@${VPS_HOST}" "cd ${REMOTE_DIR}/packages/vps && docker compose up -d"
echo ""

# 5. Verify controller health
echo "[5/5] Verifying controller on port 8800..."
MAX_RETRIES=5
RETRY_DELAY=3
HEALTHY=false

for i in $(seq 1 $MAX_RETRIES); do
  if ssh "${SSH_USER}@${VPS_HOST}" "curl -sf http://localhost:8800/health" 2>/dev/null; then
    HEALTHY=true
    break
  fi
  echo "  Attempt $i/$MAX_RETRIES — waiting ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

echo ""
if $HEALTHY; then
  echo "=== VPS Deployment Successful ==="
  echo "Controller: http://${VPS_HOST}:8800"
  echo ""
  echo "Check logs:  ssh ${SSH_USER}@${VPS_HOST} 'cd ${REMOTE_DIR}/packages/vps && docker compose logs -f'"
  echo "Restart:     ssh ${SSH_USER}@${VPS_HOST} 'systemctl restart moltclip'"
else
  echo "=== WARNING: Controller not responding ==="
  echo ""
  echo "The stack was started but the health check did not pass."
  echo "Debug with:"
  echo "  ssh ${SSH_USER}@${VPS_HOST} 'cd ${REMOTE_DIR}/packages/vps && docker compose logs'"
  echo "  ssh ${SSH_USER}@${VPS_HOST} 'cd ${REMOTE_DIR}/packages/vps && docker compose ps'"
  exit 1
fi
