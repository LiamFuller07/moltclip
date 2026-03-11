# MoltClip

Scalable AI agent infrastructure on Cloudflare Workers + VPS with self-evolving capabilities.

## Architecture

- **Edge (Cloudflare Workers)**: Master orchestrator, identity, payment, session, harness workers
- **VPS (Docker Compose)**: Controller, browser pool (Playwright), agent pool (Claude Code/Codex)
- **MCP Skills**: Grok research, harness review, human escalation, self-review - used by Claude Code instances
- **MCP Servers**: Identity, payment, browser, sync - VPS-side agent tools
- **Harness Worker**: Self-evolving meta-intelligence (X monitor, blog monitor, synthesis pipeline)

## Monorepo Structure

```
packages/
  shared/           - Types, protocol, constants (used by all packages)
  workers/
    master/          - CF Master Worker (Hono) - task routing, VPS registry, heartbeat
    identity/        - CF Identity Worker - AgentMail, credential vault
    payment/         - CF Payment Worker - Privacy.com, Stripe, approval gates
    session/         - CF Session Worker - browser profile registry
    harness/         - CF Harness Worker - X monitor, blog monitor, synthesis, dashboard API
  skills/
    grok-research/   - MCP skill: real-time research via Grok API (4 modes)
    harness-review/  - MCP skill: 3-stage log + codebase analysis
    human-escalation/- MCP skill: blockade detection + multi-channel outreach
    self-review/     - MCP skill: iterative improvement loop
  vps/
    controller/      - VPS controller (Express, port 8800) - browser pool, agent pool
    mcp-servers/     - MCP servers for Claude Code instances (browser, identity, payment, sync)
    docker-compose.yml
    bootstrap.sh
  cli/               - CLI for managing the system
```

## Development

```bash
pnpm install
pnpm build           # Build all packages
pnpm dev             # Dev mode (all packages in parallel)
pnpm typecheck       # Type-check all packages
```

## Deploy Workers

```bash
cd packages/workers/master && pnpm deploy
cd packages/workers/identity && pnpm deploy
cd packages/workers/payment && pnpm deploy
cd packages/workers/session && pnpm deploy
cd packages/workers/harness && pnpm deploy
```

## Skill Packages

Each skill is an MCP server (stdio transport) that exposes tools to Claude Code agents:

| Skill | Tool(s) | Purpose |
|-------|---------|---------|
| grok-research | `grok_research` | Real-time X + web research via Grok API (cold/weakness/synthesis/tool_discovery modes) |
| harness-review | `harness_review` | 3-stage pipeline: log analysis → codebase scan → suggestion synthesis |
| human-escalation | `blockade_check`, `escalate` | Detect blockades (A-D), 5-round software search, multi-channel outreach |
| self-review | `run_self_review_and_iterate` | Score output → Grok weakness research → Firecrawl → synthesis → upgrade plan |

## Harness Worker

CF Worker with 4 cron triggers running the self-evolving meta-intelligence layer:

| Cron | Handler | Purpose |
|------|---------|---------|
| `*/30 * * * *` | X Monitor | Search X API v2 for relevant signals |
| `0 */2 * * *` | Blog Monitor | Crawl tech blogs for updates via Firecrawl |
| `0 */4 * * *` | Synthesis Pipeline | S1-S6: collect → analyze → research → score → rank → deploy |
| `0 * * * *` | Log Collector | Collect agent logs from R2, analyze error patterns |

Dashboard API at `/api/harness/` for suggestion management.

## Key Patterns

- Backpressure-aware async loops (no setInterval for polling)
- Browser profiles persist via Chromium --user-data-dir
- Credentials encrypted with AES-256-GCM in CF KV
- R2 for durable state, KV for fast lookups, D1 for structured data
- Shared secret auth between Master Worker and VPS controllers
- MCP skills call external APIs directly (no cross-MCP communication)
- Prompt templates as .md files with {{variable}} interpolation
- Grok API via OpenAI SDK with baseURL override to api.x.ai/v1
