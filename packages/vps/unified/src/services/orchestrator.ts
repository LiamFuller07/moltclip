import Anthropic from "@anthropic-ai/sdk";
import pino from "pino";
import { env } from "../env.js";
import { sql } from "../db.js";
import { taskRunner } from "./task-runner.js";

const log = pino({ name: "orchestrator" });

let running = false;
let abortController: AbortController | null = null;

const PLANNING_PROMPT = `You are the lead orchestrator for MoltClip — an autonomous AI system that creates and operates businesses with zero human intervention.

You decompose high-level goals into concrete sub-tasks for Claude Code CLI agents. Each agent runs autonomously with full capabilities:

## Agent Capabilities
- **Bash**: Run any shell command — Node.js scripts, curl, git, file operations
- **Playwright**: Write and execute browser automation scripts (navigate sites, fill forms, create accounts, take screenshots). Chromium is pre-installed.
- **File System**: Read, write, create any files in their workspace
- **MCP Tools**: Each agent has access to these tools:
  - codex: Spawn parallel Codex instances for read-only analysis
  - grok-research: Real-time research via Grok API (modes: cold, weakness, synthesis, tool_discovery)
  - harness-review: 3-stage log + codebase analysis pipeline
  - self-review: Score work, research weaknesses, iterate until quality ≥9
  - human-escalation: Blockade detection + multi-channel outreach (absolute last resort after 5-round software search)

## Rules
- Use "claude_local" adapter for all tasks (full Claude Code CLI with tools). Only use "codex" for pure read-only analysis.
- Write detailed, self-contained prompts. Each agent runs independently — include all context it needs.
- For tasks that depend on previous results, note what data to expect from dependencies.
- Produce 1-${env.maxSubTasksPerGoal} sub-tasks. Use dependencies to sequence work that requires prior results.
- Agents can run Playwright scripts via bash — no special browser mode needed.
- Every prompt should end with: "Output your result as structured JSON."

Respond with ONLY valid JSON:
{
  "goalSummary": "string",
  "subTasks": [
    { "id": "st_1", "description": "short description", "type": "code|research|browser",
      "dependencies": [], "adapterType": "claude_local",
      "prompt": "detailed self-contained prompt for the agent" }
  ]
}`;

async function planGoal(goal: string, context?: string) {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const userMsg = context ? `Goal: ${goal}\n\nContext:\n${context}` : `Goal: ${goal}`;

  const res = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: PLANNING_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Planner returned no text");

  let json = text.text.trim();
  if (json.startsWith("```")) json = json.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

  return JSON.parse(json);
}

async function pollAndExecute(): Promise<void> {
  // Find pending tasks that are goals (need decomposition)
  const goals = await sql`
    SELECT * FROM tasks
    WHERE status = 'pending' AND (payload->>'isGoal')::boolean = true
    ORDER BY priority DESC, created_at
    LIMIT ${env.maxConcurrentGoals}
  `;

  for (const goal of goals) {
    try {
      log.info({ taskId: goal.id }, "decomposing goal");
      await sql`UPDATE tasks SET status = 'planning' WHERE id = ${goal.id}`;

      const plan = await planGoal(
        (goal.payload as any).goal || (goal.payload as any).prompt || "",
        (goal.payload as any).context,
      );

      log.info({ taskId: goal.id, subTasks: plan.subTasks.length }, "goal decomposed");

      // Create sub-tasks
      for (const st of plan.subTasks) {
        const subId = `task_${crypto.randomUUID().slice(0, 12)}`;
        await sql`
          INSERT INTO tasks (id, agent_id, status, payload)
          VALUES (${subId}, ${goal.agent_id}, 'pending', ${sql.json({
            prompt: st.prompt,
            type: st.type,
            parentGoalId: goal.id,
            subTaskId: st.id,
            adapterType: st.adapterType,
            dependencies: st.dependencies,
          })})
        `;
      }

      await sql`UPDATE tasks SET status = 'decomposed', result = ${sql.json(plan)} WHERE id = ${goal.id}`;
    } catch (err) {
      log.error({ err, taskId: goal.id }, "goal decomposition failed");
      await sql`UPDATE tasks SET status = 'failed', error = ${String(err)} WHERE id = ${goal.id}`;
    }
  }

  // Check for completed goals (all sub-tasks done)
  const decomposed = await sql`
    SELECT id FROM tasks
    WHERE status = 'decomposed' AND (payload->>'isGoal')::boolean = true
  `;

  for (const goal of decomposed) {
    const subTasks = await sql`
      SELECT status, result, error FROM tasks
      WHERE (payload->>'parentGoalId') = ${goal.id}
    `;
    if (subTasks.length === 0) continue;

    const allDone = subTasks.every((s: any) => s.status === "completed" || s.status === "failed");
    if (!allDone) continue;

    const failed = subTasks.filter((s: any) => s.status === "failed");
    const status = failed.length === subTasks.length ? "failed" : "completed";
    const results = subTasks.map((s: any) => s.result).filter(Boolean);

    await sql`
      UPDATE tasks SET status = ${status}, result = ${sql.json({ subTaskResults: results })}, completed_at = NOW()
      WHERE id = ${goal.id}
    `;
    log.info({ goalId: goal.id, status, total: subTasks.length, failed: failed.length }, "goal completed");
  }

  // Find ready sub-tasks and dispatch
  const ready = await sql`
    SELECT * FROM tasks
    WHERE status = 'pending'
    AND (payload->>'isGoal')::boolean IS NOT TRUE
    ORDER BY priority DESC, created_at
    LIMIT 5
  `;

  for (const task of ready) {
    const payload = task.payload as any;

    // Check dependencies and collect their results
    if (payload.dependencies && payload.dependencies.length > 0) {
      const parentGoalId = payload.parentGoalId;
      if (parentGoalId) {
        const deps = await sql`
          SELECT status, result, (payload->>'subTaskId') as sub_id FROM tasks
          WHERE (payload->>'parentGoalId') = ${parentGoalId}
          AND (payload->>'subTaskId') = ANY(${payload.dependencies})
        `;
        const allDone = deps.every((d: any) => d.status === "completed");
        if (!allDone) continue;

        // Inject dependency results into the prompt
        const depResults = deps.map((d: any) => `[Result from ${d.sub_id}]: ${typeof d.result === 'string' ? d.result : JSON.stringify(d.result)}`).join("\n\n");
        if (depResults) {
          payload.prompt = `${payload.prompt}\n\n## Results from previous tasks:\n${depResults}`;
        }
      }
    }

    taskRunner.accept({
      taskId: task.id as string,
      agentId: (task.agent_id as string) || "",
      adapterType: payload.adapterType || "claude_local",
      payload,
      browserProfileId: null,
    });
  }
}

export const orchestrator = {
  start(): void {
    if (running) return;
    running = true;
    abortController = new AbortController();
    log.info("orchestrator started");
    this.loop();
  },

  async loop(): Promise<void> {
    while (running) {
      try {
        await pollAndExecute();
      } catch (err) {
        log.error({ err }, "orchestrator poll error");
      }
      // Backpressure-aware delay
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, env.orchestratorPollMs);
        abortController?.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
  },

  stop(): void {
    running = false;
    abortController?.abort();
    log.info("orchestrator stopped");
  },
};
