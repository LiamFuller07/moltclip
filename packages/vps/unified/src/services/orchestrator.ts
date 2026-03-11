import Anthropic from "@anthropic-ai/sdk";
import pino from "pino";
import { env } from "../env.js";
import { sql } from "../db.js";
import { taskRunner } from "./task-runner.js";

const log = pino({ name: "orchestrator" });

let running = false;
let abortController: AbortController | null = null;

const PLANNING_PROMPT = `You are a task planner for MoltClip, an AI agent orchestration system.
Decompose the goal into concrete sub-tasks for sub-agents.

Each sub-task runs on either "claude_local" (Claude Code CLI) or "codex" (OpenAI Codex CLI).
Set browserNeeded=true only for tasks requiring website navigation.
Produce 1-${env.maxSubTasksPerGoal} sub-tasks. Dependencies reference other sub-task ids.

Respond with ONLY valid JSON:
{
  "goalSummary": "string",
  "subTasks": [
    { "id": "st_1", "description": "string", "type": "code|browser|research",
      "dependencies": [], "adapterType": "claude_local|codex",
      "prompt": "full prompt for sub-agent", "browserNeeded": false }
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
          VALUES (${subId}, ${goal.agent_id}, 'pending', ${JSON.stringify({
            prompt: st.prompt,
            type: st.type,
            parentGoalId: goal.id,
            subTaskId: st.id,
            adapterType: st.adapterType,
            browserNeeded: st.browserNeeded,
            dependencies: st.dependencies,
          })})
        `;
      }

      await sql`UPDATE tasks SET status = 'decomposed', result = ${JSON.stringify(plan)} WHERE id = ${goal.id}`;
    } catch (err) {
      log.error({ err, taskId: goal.id }, "goal decomposition failed");
      await sql`UPDATE tasks SET status = 'failed', error = ${String(err)} WHERE id = ${goal.id}`;
    }
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

    // Check dependencies
    if (payload.dependencies && payload.dependencies.length > 0) {
      const parentGoalId = payload.parentGoalId;
      if (parentGoalId) {
        const deps = await sql`
          SELECT status FROM tasks
          WHERE (payload->>'parentGoalId') = ${parentGoalId}
          AND (payload->>'subTaskId') = ANY(${payload.dependencies})
        `;
        const allDone = deps.every((d: any) => d.status === "completed");
        if (!allDone) continue; // Dependencies not ready
      }
    }

    taskRunner.accept({
      taskId: task.id as string,
      agentId: (task.agent_id as string) || "",
      adapterType: payload.adapterType || "claude_local",
      payload,
      browserProfileId: payload.browserNeeded ? `prf_${crypto.randomUUID().slice(0, 8)}` : null,
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
