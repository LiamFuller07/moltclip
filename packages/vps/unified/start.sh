#!/usr/bin/env bash
# ── MoltClip Container Startup ──
# Start Node app FIRST (binds to port 8800 immediately for CF Containers).
# Postgres and Redis start in background — the app waits for them with retry logic.
# NOTE: No "set -euo pipefail" — we want resilience over strictness in containers.

echo "=== MoltClip Container Starting ==="
echo "Date: $(date)"
echo "Hostname: $(hostname)"
echo "Working directory: $(pwd)"

# Log environment (redact secrets)
echo "=== Environment Check ==="
echo "PORT=${PORT:-not set}"
echo "CONTROLLER_SECRET=${CONTROLLER_SECRET:+[SET]}"
echo "API_KEY=${API_KEY:+[SET]}"
echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:+[SET]}"
echo "ENCRYPTION_KEY=${ENCRYPTION_KEY:+[SET]}"
echo "DATABASE_URL=${DATABASE_URL:-not set}"
echo "REDIS_URL=${REDIS_URL:-not set}"
echo "NODE_VERSION=$(node --version 2>/dev/null || echo 'node not found')"

# Ensure data directories with correct permissions
mkdir -p /data/profiles /data/workspaces /data/storage /data/logs
chmod 777 /data/logs

# ── Start Postgres in background (non-blocking) ──
PG_CTL=$(find /usr/lib/postgresql -name pg_ctl -type f 2>/dev/null | head -1)
INITDB=$(find /usr/lib/postgresql -name initdb -type f 2>/dev/null | head -1)
PG_DATA="/var/lib/postgresql/data"
if [ -n "$PG_CTL" ]; then
  # Fix permissions
  chown -R postgres:postgres "$PG_DATA" /var/run/postgresql 2>/dev/null || true
  chmod 700 "$PG_DATA" 2>/dev/null || true
  # Remove stale PID file if exists (from unclean shutdown)
  rm -f "$PG_DATA/postmaster.pid" 2>/dev/null || true

  # Initialize DB if volume is empty (first run with mounted volume)
  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    echo "No PG_VERSION found — initializing database cluster..."
    su -s /bin/sh postgres -c "$INITDB -D $PG_DATA"
    # Start temporarily to create user/database
    su -s /bin/sh postgres -c "$PG_CTL -D $PG_DATA -l /data/logs/postgres-init.log start"
    sleep 2
    su -s /bin/sh postgres -c "psql --command \"CREATE USER moltclip WITH PASSWORD 'moltclip';\"" || true
    su -s /bin/sh postgres -c "psql --command \"CREATE DATABASE moltclip OWNER moltclip;\"" || true
    su -s /bin/sh postgres -c "psql --command \"ALTER USER moltclip CREATEDB;\"" || true
    su -s /bin/sh postgres -c "$PG_CTL -D $PG_DATA stop"
    sleep 1
    echo "Database initialized successfully"
  fi

  echo "Starting PostgreSQL (background)..."
  su -s /bin/sh postgres -c "$PG_CTL -D $PG_DATA -l /data/logs/postgres.log start" &
  PG_PID=$!
  wait $PG_PID 2>/dev/null
  PG_EXIT=$?
  if [ "$PG_EXIT" -ne 0 ]; then
    echo "WARNING: PostgreSQL start exited with code $PG_EXIT"
    cat /data/logs/postgres.log 2>/dev/null | tail -20 || echo "  (no log file)"
  else
    echo "PostgreSQL started successfully"
  fi
else
  echo "WARNING: pg_ctl not found, skipping PostgreSQL"
fi

# ── Start Redis in background (non-blocking) ──
if command -v redis-server >/dev/null 2>&1; then
  chown -R redis:redis /var/run/redis 2>/dev/null || true
  mkdir -p /var/log/redis && chown -R redis:redis /var/log/redis 2>/dev/null || true
  echo "Starting Redis (background)..."
  su -s /bin/sh redis -c "redis-server /etc/redis/redis.conf --daemonize yes --logfile /data/logs/redis.log" || echo "WARNING: Redis failed to start"
else
  echo "WARNING: redis-server not found, skipping Redis"
fi

# ── Start Node app immediately (binds to 0.0.0.0:8800 right away) ──
# The app's waitForDatabase() retries postgres connection up to 60s.
echo "=== Starting MoltClip unified service ==="
echo "Looking for /app/dist/index.js..."
if [ -f /app/dist/index.js ]; then
  echo "Found! Starting Node.js app..."
  cd /app
  exec node dist/index.js
else
  echo "ERROR: /app/dist/index.js not found!"
  echo "Contents of /app:"
  ls -la /app/ 2>/dev/null || echo "  /app does not exist"
  echo "Contents of /app/dist:"
  ls -la /app/dist/ 2>/dev/null || echo "  /app/dist does not exist"
  # Keep container alive for debugging
  echo "Falling back to placeholder HTTP server on port 8800..."
  node -e "
    const http = require('http');
    const s = http.createServer((req, res) => {
      res.writeHead(503, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({error: 'dist/index.js not found', status: 'startup_failed'}));
    });
    s.listen(8800, '0.0.0.0', () => console.log('Placeholder listening on 0.0.0.0:8800'));
  "
fi
