// ── Goal Decomposition via Claude API ──
// Takes a high-level goal and produces an ordered list of sub-tasks
// with dependency edges, adapter types, and concrete prompts.

import Anthropic from "@anthropic-ai/sdk";
import pino from "pino";
import { config } from "./config.js";

const log = pino({ name: "planner" });

// ── Types ──

export type SubTaskType = "code" | "browser" | "research";

export interface SubTask {
  /** Unique id within the plan (e.g., "st_1") */
  id: string;
  /** Human-readable description */
  description: string;
  /** Category of work */
  type: SubTaskType;
  /** Sub-task ids that must complete before this one starts */
  dependencies: string[];
  /** Which adapter runs this sub-task */
  adapterType: "claude_local" | "codex";
  /** The actual prompt given to the sub-agent */
  prompt: string;
  /** Whether a browser instance is needed */
  browserNeeded: boolean;
}

export interface Plan {
  goalSummary: string;
  subTasks: SubTask[];
}

// ── Planning prompt ──

const PLANNING_SYSTEM_PROMPT = `You are a task planner for an AI agent orchestration system called MoltClip.
Your job is to decompose a high-level goal into concrete, ordered sub-tasks that can be dispatched to sub-agents.

Each sub-task will be executed by either a "claude_local" agent (Claude Code CLI — good for code, file editing, research, analysis)
or a "codex" agent (OpenAI Codex CLI — good for code generation, bulk refactors).

Rules:
1. Produce between 1 and ${config.maxSubTasksPerGoal} sub-tasks.
2. Each sub-task must have a unique id like "st_1", "st_2", etc.
3. Dependencies must reference valid sub-task ids from the same plan.
4. A sub-task with no dependencies can run immediately (in parallel with other root tasks).
5. Set browserNeeded=true only if the sub-task requires navigating a website (e.g., signing up, scraping).
6. Each sub-task prompt should be self-contained — the sub-agent won't have context from other tasks unless you include it in the prompt.
7. Prefer claude_local for most tasks. Use codex only for large-scale code generation.

Respond with ONLY valid JSON matching this schema (no markdown, no commentary):
{
  "goalSummary": "string — one-sentence summary of the goal",
  "subTasks": [
    {
      "id": "st_1",
      "description": "string — what this sub-task accomplishes",
      "type": "code" | "browser" | "research",
      "dependencies": [],
      "adapterType": "claude_local" | "codex",
      "prompt": "string — the full prompt to give the sub-agent",
      "browserNeeded": false
    }
  ]
}`;

// ── Client ──

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

// ── Plan a goal ──

export async function planGoal(
  goal: string,
  context?: string,
): Promise<Plan> {
  const anthropic = getClient();

  const userMessage = context
    ? `Goal: ${goal}\n\nAdditional context:\n${context}`
    : `Goal: ${goal}`;

  log.info({ goal: goal.slice(0, 120) }, "planning goal decomposition");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: PLANNING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  // Extract text content from the response
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Planner returned no text content");
  }

  const raw = textBlock.text.trim();

  // Parse JSON — strip markdown fences if Claude wrapped it
  let jsonStr = raw;
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let plan: Plan;
  try {
    plan = JSON.parse(jsonStr) as Plan;
  } catch (err) {
    log.error({ raw: raw.slice(0, 500) }, "failed to parse planner JSON");
    throw new Error(`Planner returned invalid JSON: ${(err as Error).message}`);
  }

  // Validate
  if (!plan.subTasks || !Array.isArray(plan.subTasks) || plan.subTasks.length === 0) {
    throw new Error("Plan contains no sub-tasks");
  }

  if (plan.subTasks.length > config.maxSubTasksPerGoal) {
    log.warn(
      { count: plan.subTasks.length, max: config.maxSubTasksPerGoal },
      "plan exceeds max sub-tasks, truncating",
    );
    plan.subTasks = plan.subTasks.slice(0, config.maxSubTasksPerGoal);
  }

  // Validate dependency references
  const ids = new Set(plan.subTasks.map((st) => st.id));
  for (const st of plan.subTasks) {
    for (const dep of st.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(
          `Sub-task "${st.id}" depends on unknown task "${dep}"`,
        );
      }
    }
    // Prevent self-dependency
    if (st.dependencies.includes(st.id)) {
      throw new Error(`Sub-task "${st.id}" depends on itself`);
    }
  }

  log.info(
    { goalSummary: plan.goalSummary, subTaskCount: plan.subTasks.length },
    "goal decomposed",
  );

  return plan;
}
