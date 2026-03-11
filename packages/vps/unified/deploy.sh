#!/usr/bin/env bash
# ── MoltClip VPS Deploy Script ──
# Deploys the unified service to a fresh VPS.
# Run on the VPS: curl -sL <url>/deploy.sh | bash
set -euo pipefail

echo "=== MoltClip Unified VPS Setup ==="

# 1. Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  sudo systemctl enable --now docker
fi

# 2. Install docker-compose plugin if not present
if ! docker compose version &>/dev/null; then
  echo "Installing Docker Compose..."
  sudo apt-get update && sudo apt-get install -y docker-compose-plugin
fi

# 3. Install Cloudflare Tunnel (cloudflared) for secure access
if ! command -v cloudflared &>/dev/null; then
  echo "Installing cloudflared..."
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
  sudo dpkg -i /tmp/cloudflared.deb
  rm /tmp/cloudflared.deb
fi

# 4. Create data directories
sudo mkdir -p /data/{profiles,workspaces,storage,logs}
sudo chown -R "$USER:$USER" /data

# 5. Clone or update repo
if [ -d /opt/moltclip ]; then
  echo "Updating repo..."
  cd /opt/moltclip && git pull
else
  echo "Cloning repo..."
  sudo mkdir -p /opt/moltclip
  sudo chown "$USER:$USER" /opt/moltclip
  git clone https://github.com/your-org/moltclip.git /opt/moltclip
fi

cd /opt/moltclip/packages/vps/unified

# 6. Check .env exists
if [ ! -f .env ]; then
  echo ""
  echo "ERROR: .env file not found!"
  echo "Copy .env.example to .env and fill in your keys:"
  echo "  cp .env.example .env"
  echo "  nano .env"
  echo ""
  exit 1
fi

# 7. Build and start
echo "Building containers..."
docker compose build --no-cache

echo "Starting services..."
docker compose up -d

# 8. Wait for health
echo "Waiting for services..."
sleep 10

if curl -sf http://localhost:8800/health | python3 -m json.tool; then
  echo ""
  echo "=== MoltClip is running! ==="
  echo "  Health: http://localhost:8800/health"
  echo ""
  echo "Next steps:"
  echo "  1. Set up Cloudflare Tunnel: cloudflared tunnel login"
  echo "  2. Create tunnel: cloudflared tunnel create moltclip"
  echo "  3. Route tunnel: cloudflared tunnel route dns moltclip api.yourdomain.com"
  echo "  4. Run tunnel: cloudflared tunnel run --url http://localhost:8800 moltclip"
  echo ""
else
  echo "WARNING: Health check failed. Check logs:"
  echo "  docker compose logs app"
fi
