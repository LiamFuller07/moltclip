#!/usr/bin/env bash
set -euo pipefail

echo "=== Deploying MoltClip Workers ==="

cd "$(dirname "$0")/.."

echo "[1/4] Deploying Master Worker..."
cd packages/workers/master
pnpm deploy
cd ../../..

echo "[2/4] Deploying Identity Worker..."
cd packages/workers/identity
pnpm deploy
cd ../../..

echo "[3/4] Deploying Payment Worker..."
cd packages/workers/payment
pnpm deploy
cd ../../..

echo "[4/4] Deploying Session Worker..."
cd packages/workers/session
pnpm deploy
cd ../../..

echo ""
echo "=== All Workers Deployed ==="
