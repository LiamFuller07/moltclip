#!/usr/bin/env bash
set -euo pipefail

# MoltClip Cloudflare Resource Provisioning
# Creates R2 bucket, KV namespaces, and D1 database.
#
# Usage:
#   ./scripts/setup-cloudflare.sh
#
# Prerequisites:
#   - wrangler CLI installed (npm i -g wrangler)
#   - Authenticated (wrangler login)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
header(){ echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# ── 1. Verify wrangler ──

header "Checking Prerequisites"

if ! command -v wrangler &>/dev/null; then
  fail "wrangler CLI not found. Install with: npm i -g wrangler"
fi

info "Verifying wrangler authentication..."
if ! wrangler whoami 2>/dev/null | grep -q "Account ID"; then
  fail "wrangler not authenticated. Run: wrangler login"
fi
ok "wrangler authenticated"

# ── 2. Create R2 Bucket ──

header "R2 Bucket"

R2_BUCKET="moltclip-state"
if wrangler r2 bucket list 2>/dev/null | grep -q "$R2_BUCKET"; then
  ok "R2 bucket '$R2_BUCKET' already exists"
else
  info "Creating R2 bucket '$R2_BUCKET'..."
  wrangler r2 bucket create "$R2_BUCKET"
  ok "R2 bucket '$R2_BUCKET' created"
fi

# ── 3. Create KV Namespaces ──

header "KV Namespaces"

KV_NAMES=(KV_AGENTS KV_PROFILES KV_SESSIONS KV_CREDENTIALS KV_WALLETS KV_HARNESS)

declare -A KV_IDS

for ns in "${KV_NAMES[@]}"; do
  # Check if namespace already exists
  existing_id=$(wrangler kv:namespace list 2>/dev/null | grep -A1 "\"title\": \".*${ns}\"" | grep '"id"' | sed 's/.*"id": "\(.*\)".*/\1/' || true)
  if [[ -n "$existing_id" ]]; then
    ok "$ns already exists (ID: $existing_id)"
    KV_IDS[$ns]="$existing_id"
  else
    info "Creating KV namespace '$ns'..."
    output=$(wrangler kv:namespace create "$ns" 2>&1)
    # Extract the ID from wrangler output
    ns_id=$(echo "$output" | grep -oP '"id":\s*"\K[^"]+' || echo "$output" | grep -oE '[a-f0-9]{32}' | head -1 || true)
    if [[ -n "$ns_id" ]]; then
      ok "$ns created (ID: $ns_id)"
      KV_IDS[$ns]="$ns_id"
    else
      warn "$ns created but could not parse ID. Output:"
      echo "$output"
      KV_IDS[$ns]="<check wrangler dashboard>"
    fi
  fi
done

# ── 4. Create D1 Database ──

header "D1 Database"

D1_NAME="moltclip-harness"
D1_ID=""

existing_d1=$(wrangler d1 list 2>/dev/null | grep "$D1_NAME" || true)
if [[ -n "$existing_d1" ]]; then
  D1_ID=$(echo "$existing_d1" | grep -oE '[a-f0-9-]{36}' | head -1 || true)
  ok "D1 database '$D1_NAME' already exists (ID: $D1_ID)"
else
  info "Creating D1 database '$D1_NAME'..."
  output=$(wrangler d1 create "$D1_NAME" 2>&1)
  D1_ID=$(echo "$output" | grep -oE '[a-f0-9-]{36}' | head -1 || true)
  if [[ -n "$D1_ID" ]]; then
    ok "D1 database '$D1_NAME' created (ID: $D1_ID)"
  else
    warn "D1 database created but could not parse ID. Output:"
    echo "$output"
    D1_ID="<check wrangler dashboard>"
  fi
fi

# ── 5. Generate Encryption Key ──

header "Encryption Key"

ENCRYPTION_KEY=$(openssl rand -base64 32)
ok "Generated ENCRYPTION_KEY (save this — it cannot be recovered)"
echo -e "  ${BOLD}$ENCRYPTION_KEY${NC}"

# ── 6. Print Instructions ──

header "Next Steps"

echo -e "${BOLD}Step 1: Fill in KV namespace IDs in wrangler.jsonc files${NC}"
echo ""
echo "  File: packages/workers/master/wrangler.jsonc"
echo "    KV_AGENTS    → id: \"${KV_IDS[KV_AGENTS]:-<not found>}\""
echo "    KV_PROFILES  → id: \"${KV_IDS[KV_PROFILES]:-<not found>}\""
echo "    KV_SESSIONS  → id: \"${KV_IDS[KV_SESSIONS]:-<not found>}\""
echo ""
echo "  File: packages/workers/identity/wrangler.jsonc"
echo "    KV_CREDENTIALS → id: \"${KV_IDS[KV_CREDENTIALS]:-<not found>}\""
echo ""
echo "  File: packages/workers/payment/wrangler.jsonc"
echo "    KV_WALLETS → id: \"${KV_IDS[KV_WALLETS]:-<not found>}\""
echo ""
echo "  File: packages/workers/session/wrangler.jsonc"
echo "    KV_PROFILES → id: \"${KV_IDS[KV_PROFILES]:-<not found>}\""
echo ""
echo "  File: packages/workers/harness/wrangler.jsonc"
echo "    KV_HARNESS     → id: \"${KV_IDS[KV_HARNESS]:-<not found>}\""
echo "    database_id    → \"${D1_ID:-<not found>}\""
echo ""

echo -e "${BOLD}Step 2: Apply D1 schema${NC}"
echo ""
echo "  wrangler d1 execute $D1_NAME --file=packages/workers/harness/src/d1-schema.sql"
echo ""

echo -e "${BOLD}Step 3: Set worker secrets${NC}"
echo ""
echo "  Each secret must be set from the corresponding worker directory."
echo "  Run: wrangler secret put <NAME>"
echo ""
echo "  ┌─────────────────────────────────────────────────────────────────────┐"
echo "  │ Secret                  │ Worker Directory                         │"
echo "  ├─────────────────────────┼──────────────────────────────────────────┤"
echo "  │ CONTROLLER_SECRET       │ packages/workers/master                  │"
echo "  │ API_KEY                 │ packages/workers/master                  │"
echo "  │ AGENTMAIL_API_KEY       │ packages/workers/identity                │"
echo "  │ AGENTMAIL_DOMAIN        │ packages/workers/identity                │"
echo "  │ ENCRYPTION_KEY          │ packages/workers/identity                │"
echo "  │ PRIVACY_API_KEY         │ packages/workers/payment                 │"
echo "  │ STRIPE_SECRET_KEY       │ packages/workers/payment                 │"
echo "  │ APPROVAL_THRESHOLD_CENTS│ packages/workers/payment                 │"
echo "  │ XAI_API_KEY             │ packages/workers/harness                 │"
echo "  │ FIRECRAWL_API_KEY       │ packages/workers/harness                 │"
echo "  │ X_BEARER_TOKEN          │ packages/workers/harness                 │"
echo "  │ GITHUB_TOKEN            │ packages/workers/harness                 │"
echo "  │ CONTROLLER_SECRET       │ packages/workers/harness                 │"
echo "  └─────────────────────────┴──────────────────────────────────────────┘"
echo ""
echo "  Example:"
echo "    cd packages/workers/identity"
echo "    echo \"$ENCRYPTION_KEY\" | wrangler secret put ENCRYPTION_KEY"
echo ""

echo -e "${BOLD}Step 4: Deploy workers${NC}"
echo ""
echo "  ./scripts/deploy-all.sh"
echo ""

echo -e "${GREEN}═══ Cloudflare Setup Complete ═══${NC}"
