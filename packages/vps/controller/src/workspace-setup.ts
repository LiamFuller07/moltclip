import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";

const log = pino({ name: "workspace-setup" });

const SKILLS_DIR = process.env.SKILLS_DIR || "/app/packages/skills";

/**
 * Ensure agent workspace exists with proper MCP configuration.
 * Creates .mcp.json so Claude Code instances can discover skills.
 */
export async function ensureWorkspace(workspacePath: string, agentId: string): Promise<void> {
  // Create workspace dir
  await mkdir(workspacePath, { recursive: true });

  // Create .mcp.json for Claude Code MCP skill discovery
  const mcpConfig = {
    mcpServers: {
      "grok-research": {
        command: "node",
        args: [join(SKILLS_DIR, "grok-research/dist/index.js")],
        env: {
          XAI_API_KEY: process.env.XAI_API_KEY || "",
        },
      },
      "harness-review": {
        command: "node",
        args: [join(SKILLS_DIR, "harness-review/dist/index.js")],
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        },
      },
      "human-escalation": {
        command: "node",
        args: [join(SKILLS_DIR, "human-escalation/dist/index.js")],
        env: {
          XAI_API_KEY: process.env.XAI_API_KEY || "",
          X_BEARER_TOKEN: process.env.X_BEARER_TOKEN || "",
          GITHUB_TOKEN: process.env.GITHUB_TOKEN || "",
          IDENTITY_WORKER_URL: process.env.IDENTITY_WORKER_URL || "",
        },
      },
      "self-review": {
        command: "node",
        args: [join(SKILLS_DIR, "self-review/dist/index.js")],
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          XAI_API_KEY: process.env.XAI_API_KEY || "",
          FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY || "",
        },
      },
    },
  };

  const mcpPath = join(workspacePath, ".mcp.json");

  // Only write if doesn't exist or needs updating
  try {
    await access(mcpPath);
    log.debug({ agentId }, "workspace .mcp.json already exists");
  } catch {
    await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
    log.info({ agentId, workspacePath }, "created workspace with MCP skill config");
  }

  // Create CLAUDE.md with agent context
  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  try {
    await access(claudeMdPath);
  } catch {
    const claudeMd = `# MoltClip Agent

Agent ID: ${agentId}

## Available MCP Skills

- **grok-research**: Real-time research via Grok API (modes: cold, weakness, synthesis, tool_discovery)
- **harness-review**: 3-stage log + codebase analysis pipeline
- **human-escalation**: Blockade detection (types A-D) + multi-channel outreach
- **self-review**: Iterative improvement loop with scoring

## Workflow

1. When stuck, use \`blockade_check\` to detect the type of blocker
2. Use \`grok_research\` for real-time information gathering
3. After completing work, use \`run_self_review_and_iterate\` to improve quality
4. Report progress via the sync MCP server

## Environment

This workspace is managed by the MoltClip orchestrator. Your task details are provided in the prompt.
`;
    await writeFile(claudeMdPath, claudeMd);
  }
}
