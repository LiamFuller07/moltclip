import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { env } from "../env.js";

// Determine the home directory for Claude Code agents
function getAgentHome(): string {
  if (userInfo().uid === 0) {
    try {
      return execFileSync("getent", ["passwd", "moltclip"], { encoding: "utf-8" })
        .split(":")[5] || "/home/moltclip";
    } catch {
      return "/home/moltclip";
    }
  }
  return userInfo().homedir;
}

const log = pino({ name: "workspace-setup" });

function cleanEnv(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== ""));
}

let globalMcpWritten = false;

export async function ensureWorkspace(workspacePath: string, agentId: string): Promise<void> {
  await mkdir(workspacePath, { recursive: true });

  // Write global MCP config once (all agents share the same home dir)
  if (!globalMcpWritten) {
    const mcpConfig = {
      mcpServers: {
        ...(env.xaiApiKey ? {
          "grok-research": {
            command: "node",
            args: [join(env.skillsDir, "grok-research/dist/index.js")],
            env: { XAI_API_KEY: env.xaiApiKey },
          },
        } : {}),
        "harness-review": {
          command: "node",
          args: [join(env.skillsDir, "harness-review/dist/index.js")],
          env: { ANTHROPIC_API_KEY: env.anthropicApiKey },
        },
        ...(env.xaiApiKey || env.xBearerToken || env.githubToken ? {
          "human-escalation": {
            command: "node",
            args: [join(env.skillsDir, "human-escalation/dist/index.js")],
            env: cleanEnv({
              XAI_API_KEY: env.xaiApiKey,
              X_BEARER_TOKEN: env.xBearerToken,
              GITHUB_TOKEN: env.githubToken,
            }),
          },
        } : {}),
        "self-review": {
          command: "node",
          args: [join(env.skillsDir, "self-review/dist/index.js")],
          env: cleanEnv({
            ANTHROPIC_API_KEY: env.anthropicApiKey,
            XAI_API_KEY: env.xaiApiKey,
            FIRECRAWL_API_KEY: env.firecrawlApiKey,
          }),
        },
        "codex": {
          command: "codex",
          args: ["--mcp"],
          env: { ANTHROPIC_API_KEY: env.anthropicApiKey },
        },
      },
    };

    const agentHome = getAgentHome();
    const claudeDir = join(agentHome, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2));
    globalMcpWritten = true;
    log.info("global MCP config written to ~/.claude/.mcp.json");
  }

  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  await writeFile(claudeMdPath, `# MoltClip Agent

Agent ID: ${agentId}

## You are an autonomous AI agent running inside MoltClip infrastructure.

You have access to the following MCP tools:

- **codex**: Spawn parallel Codex instances for independent tasks (use for read-only analysis, parallel coding)
- **harness-review**: 3-stage log + codebase analysis pipeline
- **self-review**: Iterative improvement loop — score your work, research weaknesses, improve
${env.xaiApiKey ? "- **grok-research**: Real-time research via Grok API (modes: cold, weakness, synthesis, tool_discovery)" : ""}
${env.xaiApiKey || env.githubToken ? "- **human-escalation**: Blockade detection (types A-D) + multi-channel outreach" : ""}

## Workflow

1. Execute the task given to you thoroughly
2. Use \`codex\` MCP for parallel subtasks when beneficial
3. When stuck, use \`blockade_check\` to classify the blocker
4. After completing work, use \`run_self_review_and_iterate\` to improve quality
5. Output your final result as structured JSON
`);

  log.info({ agentId, workspacePath }, "workspace configured");
}
