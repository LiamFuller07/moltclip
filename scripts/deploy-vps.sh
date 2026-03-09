#!/usr/bin/env bash
set -euo pipefail

# Deploy MoltClip to a VPS
# Usage: ./scripts/deploy-vps.sh <vps-host> [ssh-user]

VPS_HOST="${1:?Usage: deploy-vps.sh <vps-host> [ssh-user]}"
SSH_USER="${2:-root}"

echo "=== Deploying MoltClip to ${SSH_USER}@${VPS_HOST} ==="

# 1. Copy repo to VPS
echo "[1/4] Syncing code..."
rsync -avz --exclude node_modules --exclude .git --exclude dist \
  . "${SSH_USER}@${VPS_HOST}:/opt/moltclip/"

# 2. Run bootstrap if needed
echo "[2/4] Running bootstrap..."
ssh "${SSH_USER}@${VPS_HOST}" 'bash /opt/moltclip/packages/vps/bootstrap.sh' 2>/dev/null || true

# 3. Build and start
echo "[3/4] Building and starting stack..."
ssh "${SSH_USER}@${VPS_HOST}" 'cd /opt/moltclip/packages/vps && docker compose up -d --build'

# 4. Verify
echo "[4/4] Verifying..."
sleep 3
ssh "${SSH_USER}@${VPS_HOST}" 'curl -s http://localhost:8800/health | python3 -m json.tool' || echo "Controller not responding yet, may need a moment..."

echo ""
echo "=== VPS Deployment Complete ==="
echo "Controller: http://${VPS_HOST}:8800"
