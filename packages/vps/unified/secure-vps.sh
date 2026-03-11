#!/usr/bin/env bash
# ── MoltClip VPS Security Hardening ──
# Run on the VPS after initial setup. Locks down SSH, firewall, etc.
set -euo pipefail

echo "=== MoltClip VPS Security Hardening ==="

# Must run as root
if [ "$EUID" -ne 0 ]; then
  echo "Run as root: sudo bash secure-vps.sh"
  exit 1
fi

# 1. System updates
echo "[1/8] Updating system..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Create non-root user for moltclip
echo "[2/8] Creating moltclip user..."
if ! id moltclip &>/dev/null; then
  useradd -m -s /bin/bash -G docker moltclip
  echo "moltclip user created"
else
  usermod -aG docker moltclip
  echo "moltclip user already exists, added to docker group"
fi

# 3. SSH hardening
echo "[3/8] Hardening SSH..."
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak

# Disable password auth, root login, use only key auth
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^#\?ChallengeResponseAuthentication.*/ChallengeResponseAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

# Change SSH port to reduce noise
sed -i 's/^#\?Port.*/Port 2222/' /etc/ssh/sshd_config

systemctl restart sshd
echo "SSH hardened: key-only auth, port 2222, no root login"

# 4. Firewall (UFW)
echo "[4/8] Configuring firewall..."
apt-get install -y -qq ufw

ufw default deny incoming
ufw default allow outgoing
ufw allow 2222/tcp comment 'SSH'
# NO port 8800 exposed — Cloudflare Tunnel handles external access
# Only localhost can reach the app
ufw --force enable
echo "Firewall: deny all incoming except SSH (2222). App only via Cloudflare Tunnel."

# 5. Fail2ban
echo "[5/8] Installing fail2ban..."
apt-get install -y -qq fail2ban

cat > /etc/fail2ban/jail.local << 'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = 2222
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
JAIL

systemctl enable --now fail2ban
echo "Fail2ban: 3 attempts then 1h ban"

# 6. Secure data directories
echo "[6/8] Securing data directories..."
mkdir -p /data/{profiles,workspaces,storage,logs}
chown -R moltclip:moltclip /data
chmod -R 750 /data

# 7. Docker daemon hardening
echo "[7/8] Hardening Docker..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'DOCKERCONF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "no-new-privileges": true,
  "userland-proxy": false
}
DOCKERCONF

systemctl restart docker

# 8. Automatic security updates
echo "[8/8] Enabling automatic security updates..."
apt-get install -y -qq unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO

echo ""
echo "=== Security hardening complete ==="
echo ""
echo "Summary:"
echo "  - SSH: key-only, port 2222, no root login"
echo "  - Firewall: deny all except SSH (2222)"
echo "  - Fail2ban: 3 attempts = 1h ban"
echo "  - Docker: no-new-privileges, log rotation"
echo "  - Auto security updates enabled"
echo "  - Data dirs owned by moltclip:moltclip (750)"
echo ""
echo "IMPORTANT: Port 8800 is NOT open to the internet."
echo "Use Cloudflare Tunnel for external access."
echo ""
echo "Next: switch to moltclip user and deploy:"
echo "  su - moltclip"
echo "  cd /opt/moltclip/packages/vps/unified"
echo "  docker compose up -d"
