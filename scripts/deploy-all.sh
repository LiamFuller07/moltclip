#!/usr/bin/env bash
set -euo pipefail

echo "=== Deploying MoltClip Workers ==="

cd "$(dirname "$0")/.."

echo "[1/5] Deploying Master Worker..."
cd packages/workers/master
pnpm deploy
cd ../../..

echo "[2/5] Deploying Identity Worker..."
cd packages/workers/identity
pnpm deploy
cd ../../..

echo "[3/5] Deploying Payment Worker..."
cd packages/workers/payment
pnpm deploy
cd ../../..

echo "[4/5] Deploying Session Worker..."
cd packages/workers/session
pnpm deploy
cd ../../..

echo "[5/5] Deploying Harness Worker..."
cd packages/workers/harness
pnpm deploy
cd ../../..

echo ""
echo "=== All Workers Deployed ==="
