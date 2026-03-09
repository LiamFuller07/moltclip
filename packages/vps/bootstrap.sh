#!/usr/bin/env bash
set -euo pipefail

# MoltClip VPS Bootstrap Script
# Run on a fresh Ubuntu 22.04+ VPS to set up the moltclip stack.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/liamfuller07/moltclip/main/packages/vps/bootstrap.sh | bash
#
# Or:
#   ssh root@your-vps 'bash -s' < bootstrap.sh

echo "=== MoltClip VPS Bootstrap ==="
echo ""

# 1. System updates
echo "[1/7] Updating system..."
apt-get update -qq
apt-get upgrade -y -qq

# 2. Install Docker
echo "[2/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# 3. Install Docker Compose
echo "[3/7] Verifying Docker Compose..."
docker compose version || {
  echo "Docker Compose plugin not found, installing..."
  apt-get install -y docker-compose-plugin
}

# 4. Install Node.js 20
echo "[4/7] Installing Node.js 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  corepack enable
fi

# 5. Create data directories
echo "[5/7] Creating data directories..."
mkdir -p /data/{profiles,workspaces,credentials,backups}
mkdir -p /opt/moltclip

# 6. Firewall setup
echo "[6/7] Configuring firewall..."
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   # SSH
  ufw allow 8800/tcp # Controller (restrict to Tailscale/CF Tunnel in production)
  ufw --force enable
fi

# 7. Install Fail2ban
echo "[7/7] Installing Fail2ban..."
apt-get install -y -qq fail2ban
systemctl enable fail2ban
systemctl start fail2ban

echo ""
echo "=== Bootstrap Complete ==="
echo ""
echo "Next steps:"
echo "  1. Clone the moltclip repo to /opt/moltclip/"
echo "     git clone https://github.com/liamfuller07/moltclip.git /opt/moltclip"
echo ""
echo "  2. Configure environment:"
echo "     cp /opt/moltclip/.env.example /opt/moltclip/packages/vps/.env"
echo "     nano /opt/moltclip/packages/vps/.env"
echo ""
echo "  3. Start the stack:"
echo "     cd /opt/moltclip/packages/vps"
echo "     docker compose up -d"
echo ""
echo "  4. Install Cloudflare Tunnel (recommended):"
echo "     curl -fsSL https://pkg.cloudflare.com/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb"
echo "     dpkg -i /tmp/cloudflared.deb"
echo "     cloudflared tunnel login"
echo "     cloudflared tunnel create moltclip-vps"
echo ""
echo "  5. Register VPS with Master Worker:"
echo "     curl -X POST https://your-master-worker.workers.dev/api/vps/register \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"host\": \"http://localhost:8800\", \"region\": \"eu\", \"provider\": \"contabo\", \"maxBrowsers\": 10, \"maxAgentInstances\": 6}'"
