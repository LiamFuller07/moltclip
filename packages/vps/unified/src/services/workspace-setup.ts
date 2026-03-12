import { accessSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { env } from "../env.js";

const log = pino({ name: "workspace-setup" });

function cleanEnv(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== ""));
}

/** Writes MCP config to workspace and returns the file path for --mcp-config */
export async function writeMcpConfig(workspacePath: string): Promise<string> {
  const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};

  // Only add skill servers if their dist/index.js exists (built successfully)
  const skillServers: Array<{
    name: string;
    condition: boolean;
    entryFile: string;
    env: Record<string, string>;
  }> = [
    {
      name: "grok-research",
      condition: !!env.xaiApiKey,
      entryFile: join(env.skillsDir, "grok-research/dist/index.js"),
      env: { XAI_API_KEY: env.xaiApiKey },
    },
    {
      name: "harness-review",
      condition: true,
      entryFile: join(env.skillsDir, "harness-review/dist/index.js"),
      env: { ANTHROPIC_API_KEY: env.anthropicApiKey },
    },
    {
      name: "human-escalation",
      condition: !!(env.xaiApiKey || env.xBearerToken || env.githubToken),
      entryFile: join(env.skillsDir, "human-escalation/dist/index.js"),
      env: cleanEnv({
        XAI_API_KEY: env.xaiApiKey,
        X_BEARER_TOKEN: env.xBearerToken,
        GITHUB_TOKEN: env.githubToken,
      }),
    },
    {
      name: "self-review",
      condition: true,
      entryFile: join(env.skillsDir, "self-review/dist/index.js"),
      env: cleanEnv({
        ANTHROPIC_API_KEY: env.anthropicApiKey,
        XAI_API_KEY: env.xaiApiKey,
        FIRECRAWL_API_KEY: env.firecrawlApiKey,
      }),
    },
  ];

  for (const s of skillServers) {
    if (!s.condition) continue;
    try {
      accessSync(s.entryFile);
      servers[s.name] = { command: "node", args: [s.entryFile], env: s.env };
    } catch {
      log.warn({ skill: s.name, path: s.entryFile }, "skill not built, skipping MCP server");
    }
  }

  // Codex CLI is always available (installed globally)
  servers["codex"] = {
    command: "codex",
    args: ["--mcp"],
    env: { ANTHROPIC_API_KEY: env.anthropicApiKey },
  };

  // Firecrawl MCP for web scraping/crawling
  if (env.firecrawlApiKey) {
    servers["firecrawl"] = {
      command: "npx",
      args: ["-y", "firecrawl-mcp"],
      env: { FIRECRAWL_API_KEY: env.firecrawlApiKey },
    };
  }

  const mcpConfig = { mcpServers: servers };
  log.info({ servers: Object.keys(servers) }, "MCP config generated");

  const configPath = join(workspacePath, "mcp-config.json");
  await writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
  return configPath;
}

export async function ensureWorkspace(workspacePath: string, agentId: string): Promise<void> {
  await mkdir(workspacePath, { recursive: true });

  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  await writeFile(claudeMdPath, `# MoltClip Autonomous Agent

Agent ID: ${agentId}

## You are an autonomous AI agent that creates and operates businesses.

You have FULL access to:

### System Capabilities
- **Bash**: Run any command — Node.js, Python, curl, git, etc.
- **Playwright**: Write and run browser automation scripts. Chromium is installed. Use \`const { chromium } = require("playwright");\` in Node.js scripts.
- **File System**: Read, write, create any files in your workspace.
- **Web Access**: curl, fetch, Firecrawl MCP for structured scraping.

### MCP Tools
- **codex**: Spawn parallel Codex instances for read-only analysis or parallel coding tasks
- **firecrawl**: Web scraping and crawling — extract structured data from any website
- **harness-review**: 3-stage log + codebase analysis pipeline
- **self-review**: Iterative improvement loop — score your work, research weaknesses, improve until quality ≥ 9/10
${env.xaiApiKey ? "- **grok-research**: Real-time research via Grok API (modes: cold, weakness, synthesis, tool_discovery)" : ""}
${env.xaiApiKey || env.githubToken ? "- **human-escalation**: Blockade detection (types A-D) + multi-channel outreach. ABSOLUTE LAST RESORT — exhaust all software solutions first (5-round search)." : ""}

### Principles
1. You are fully autonomous. Do not ask for human help unless every software path has been exhausted.
2. Use Playwright for any web interaction — creating accounts, filling forms, navigating services.
3. Use Firecrawl MCP for scraping and data extraction.
4. Use grok-research for market research and competitive intelligence.
5. After completing work, use self-review to iterate on quality.
6. Always output your final result as structured JSON.
`);

  log.info({ agentId, workspacePath }, "workspace configured");
}
