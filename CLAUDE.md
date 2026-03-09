# MoltClip

Scalable AI agent infrastructure on Cloudflare Workers + VPS.

## Architecture

- **Edge (Cloudflare Workers)**: Master orchestrator, identity, payment, session workers
- **VPS (Docker Compose)**: Controller, browser pool (Playwright), agent pool (Claude Code/Codex)
- **MCP Servers**: Identity, payment, browser, sync - used by Claude Code instances on VPS

## Monorepo Structure

```
packages/
  shared/           - Types, protocol, constants (used by all packages)
  workers/
    master/          - CF Master Worker (Hono) - task routing, VPS registry, heartbeat
    identity/        - CF Identity Worker - AgentMail, credential vault
    payment/         - CF Payment Worker - Privacy.com, Stripe, approval gates
    session/         - CF Session Worker - browser profile registry
  vps/
    controller/      - VPS controller (Express, port 8800) - browser pool, agent pool
    mcp-servers/     - MCP servers for Claude Code instances
    docker-compose.yml
    bootstrap.sh
  cli/               - CLI for managing the system
```

## Development

```bash
pnpm install
pnpm build           # Build all packages
pnpm dev             # Dev mode (all packages in parallel)
```

## Deploy Workers

```bash
cd packages/workers/master && pnpm deploy
cd packages/workers/identity && pnpm deploy
cd packages/workers/payment && pnpm deploy
cd packages/workers/session && pnpm deploy
```

## Key Patterns

- Backpressure-aware async loops (no setInterval for polling)
- Browser profiles persist via Chromium --user-data-dir
- Credentials encrypted with AES-256-GCM in CF KV
- R2 for durable state, KV for fast lookups
- Shared secret auth between Master Worker and VPS controllers
