# ── MoltClip Unified VPS Container ──
# Everything in one container: HTTP server, Claude Code CLI, Playwright, MCP skills

FROM node:20-bookworm-slim AS base

# System deps: Playwright/Chromium, git, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libgtk-3-0 \
    libxshmfence1 fonts-noto-color-emoji fonts-liberation \
    procps curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# ── Install Claude Code CLI (authenticates via ANTHROPIC_API_KEY env var) ──
RUN npm install -g @anthropic-ai/claude-code

# ── Install Codex CLI (used as MCP server by Claude Code agents) ──
RUN npm install -g @openai/codex

# ── Build MCP skills ──
FROM base AS skills-builder

WORKDIR /build

# Copy skill packages
COPY packages/skills/ packages/skills/
COPY packages/shared/ packages/shared/
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

# Install and build skills
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install
RUN pnpm -r --filter="@moltclip/shared" build 2>/dev/null || true
RUN pnpm -r --filter="./packages/skills/*" build 2>/dev/null || true

# ── Build unified service ──
FROM base AS app-builder

WORKDIR /build

COPY packages/vps/unified/package.json packages/vps/unified/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY packages/vps/unified/ .
RUN pnpm build

# ── Final image ──
FROM base

WORKDIR /app

# Install Playwright Chromium
RUN npx playwright install chromium

# Copy built unified service
COPY --from=app-builder /build/dist ./dist
COPY --from=app-builder /build/node_modules ./node_modules
COPY --from=app-builder /build/package.json .

# Copy built MCP skills
COPY --from=skills-builder /build/packages/skills /app/packages/skills
COPY --from=skills-builder /build/packages/shared /app/packages/shared

# Create non-root user for Claude Code agents (bypass-permissions blocked for root)
RUN groupadd -r moltclip && useradd -r -g moltclip -m -s /bin/bash moltclip

# Create data directories owned by moltclip user
RUN mkdir -p /data/profiles /data/workspaces /data/storage /data/logs \
    && chown -R moltclip:moltclip /data

# Pre-create Claude Code config dir for the moltclip user
RUN mkdir -p /home/moltclip/.claude \
    && chown -R moltclip:moltclip /home/moltclip/.claude

# Verify CLIs are available
RUN claude --version || echo "claude CLI installed"
RUN codex --version || echo "codex CLI installed"

EXPOSE 8800

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:8800/health || exit 1

CMD ["node", "dist/index.js"]
