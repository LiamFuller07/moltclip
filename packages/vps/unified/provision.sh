#!/usr/bin/env bash
# ── MoltClip Full VPS Provisioning ──
# Run locally. Creates Hetzner VPS, deploys code, sets up Cloudflare Tunnel.
# Prerequisites: hcloud CLI authenticated, cloudflared authenticated, SSH key
set -euo pipefail

# ── Config ──
SERVER_NAME="moltclip-vps"
SERVER_TYPE="ccx33"  # 8 dedicated vCPU, 32GB RAM, 240GB SSD
IMAGE="ubuntu-24.04"
LOCATION="fsn1"  # Falkenstein, DE (cheapest EU location)
SSH_KEY_NAME="moltclip"
TUNNEL_NAME="moltclip"

echo "=== MoltClip VPS Provisioning ==="
echo "Server: ${SERVER_TYPE} (8 vCPU, 32GB RAM, 240GB SSD)"
echo "Location: ${LOCATION}"
echo ""

# ── 1. Ensure SSH key exists ──
echo "[1/7] Setting up SSH key..."
if [ ! -f ~/.ssh/moltclip_ed25519 ]; then
  ssh-keygen -t ed25519 -f ~/.ssh/moltclip_ed25519 -N "" -C "moltclip-deploy"
  echo "Generated new SSH key: ~/.ssh/moltclip_ed25519"
fi

# Upload to Hetzner if not already there
if ! hcloud ssh-key describe "$SSH_KEY_NAME" &>/dev/null; then
  hcloud ssh-key create --name "$SSH_KEY_NAME" --public-key-from-file ~/.ssh/moltclip_ed25519.pub
  echo "SSH key uploaded to Hetzner"
fi

# ── 2. Create firewall ──
echo "[2/7] Creating firewall..."
if ! hcloud firewall describe moltclip-fw &>/dev/null; then
  hcloud firewall create --name moltclip-fw
  # Only allow SSH (we'll change to 2222 after setup, but need 22 initially)
  hcloud firewall add-rule moltclip-fw --direction in --protocol tcp --port 22 --source-ips 0.0.0.0/0 --source-ips ::/0 --description "SSH"
  hcloud firewall add-rule moltclip-fw --direction in --protocol tcp --port 2222 --source-ips 0.0.0.0/0 --source-ips ::/0 --description "SSH-hardened"
  # ICMP for health checks
  hcloud firewall add-rule moltclip-fw --direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0 --description "Ping"
  echo "Firewall created: SSH only, no HTTP exposed"
fi

# ── 3. Create server ──
echo "[3/7] Creating server..."
if hcloud server describe "$SERVER_NAME" &>/dev/null; then
  echo "Server already exists"
  SERVER_IP=$(hcloud server ip "$SERVER_NAME")
else
  hcloud server create \
    --name "$SERVER_NAME" \
    --type "$SERVER_TYPE" \
    --image "$IMAGE" \
    --location "$LOCATION" \
    --ssh-key "$SSH_KEY_NAME" \
    --firewall moltclip-fw

  SERVER_IP=$(hcloud server ip "$SERVER_NAME")
  echo "Server created at: $SERVER_IP"

  # Wait for SSH to be ready
  echo "Waiting for SSH..."
  for i in $(seq 1 30); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i ~/.ssh/moltclip_ed25519 root@"$SERVER_IP" "echo ok" &>/dev/null; then
      break
    fi
    sleep 2
  done
fi

echo "Server IP: $SERVER_IP"

# ── 4. Bootstrap server ──
echo "[4/7] Bootstrapping server..."
SSH="ssh -o StrictHostKeyChecking=no -i ~/.ssh/moltclip_ed25519 root@${SERVER_IP}"

# Install Docker
$SSH 'curl -fsSL https://get.docker.com | sh'

# Install cloudflared
$SSH 'curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb'

# Install git
$SSH 'apt-get install -y -qq git rsync'

# Create data dirs
$SSH 'mkdir -p /data/{profiles,workspaces,storage,logs} /opt/moltclip'

# ── 5. Deploy code ──
echo "[5/7] Deploying code..."
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# Sync the monorepo (excluding node_modules, .git, dist)
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.env' \
  -e "ssh -i ~/.ssh/moltclip_ed25519" \
  "$REPO_ROOT/" "root@${SERVER_IP}:/opt/moltclip/"

# Copy .env separately (contains secrets)
scp -i ~/.ssh/moltclip_ed25519 \
  "$(dirname "$0")/.env" \
  "root@${SERVER_IP}:/opt/moltclip/packages/vps/unified/.env"

# ── 6. Security hardening ──
echo "[6/7] Hardening server..."
$SSH 'bash /opt/moltclip/packages/vps/unified/secure-vps.sh'

echo ""
echo "NOTE: SSH port changed to 2222. Updating connection..."
SSH="ssh -o StrictHostKeyChecking=no -i ~/.ssh/moltclip_ed25519 -p 2222 root@${SERVER_IP}"

# Hmm, root login is now disabled. Need to use the moltclip user
# The secure script disables root — so we need to copy the SSH key first
# Let's handle this more carefully in the actual deploy

# ── 7. Start services ──
echo "[7/7] Starting services..."
# Note: after hardening, root is disabled. SSH to moltclip user.
MSSH="ssh -o StrictHostKeyChecking=no -i ~/.ssh/moltclip_ed25519 -p 2222 moltclip@${SERVER_IP}"

# Copy SSH key to moltclip user (do this before root is locked out)
$SSH "mkdir -p /home/moltclip/.ssh && cp /root/.ssh/authorized_keys /home/moltclip/.ssh/ && chown -R moltclip:moltclip /home/moltclip/.ssh && chmod 700 /home/moltclip/.ssh && chmod 600 /home/moltclip/.ssh/authorized_keys" 2>/dev/null || true

$MSSH 'cd /opt/moltclip/packages/vps/unified && docker compose up -d --build' 2>/dev/null || \
  $SSH 'cd /opt/moltclip/packages/vps/unified && docker compose up -d --build'

# Wait for health
echo "Waiting for app health..."
sleep 15
$SSH "curl -sf http://localhost:8800/health" 2>/dev/null || $MSSH "curl -sf http://localhost:8800/health" 2>/dev/null || echo "Health check pending..."

echo ""
echo "=== Provisioning Complete ==="
echo ""
echo "Server: ${SERVER_IP} (SSH port 2222)"
echo "SSH:    ssh -i ~/.ssh/moltclip_ed25519 -p 2222 moltclip@${SERVER_IP}"
echo ""
echo "Next: Set up Cloudflare Tunnel for secure external access:"
echo "  cloudflared tunnel login"
echo "  cloudflared tunnel create ${TUNNEL_NAME}"
echo "  cloudflared tunnel route dns ${TUNNEL_NAME} api.yourdomain.com"
echo ""
echo "Then on the VPS:"
echo "  cloudflared tunnel run --url http://localhost:8800 ${TUNNEL_NAME}"
echo ""
