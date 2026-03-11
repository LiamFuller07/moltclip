// ── Goal Executor ──
// Takes a decomposed plan and executes it, respecting dependency ordering.
// Dispatches independent sub-tasks in parallel, waits for dependents,
// handles retries and escalation.

import pino from "pino";
import pRetry from "p-retry";
import type { Task } from "@moltclip/shared";
import type { Plan, SubTask } from "./planner.js";
import { progressTracker, type SubTaskProgress } from "./progress-tracker.js";
import * as masterClient from "./master-client.js";
import { callSkill } from "./skill-runner.js";
import { config } from "./config.js";

const log = pino({ name: "goal-executor" });

const POLL_INTERVAL_MS = 3_000; // how often to check sub-task completion
const MAX_RETRIES = 1; // retry a failed sub-task once before escalating

// ── Topological helpers ──

/**
 * Return sub-task ids in a valid execution order (topological sort).
 * Tasks with no dependencies appear first.
 */
function topologicalSort(subTasks: SubTask[]): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const graph = new Map<string, SubTask>();

  for (const st of subTasks) {
    graph.set(st.id, st);
  }

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency detected involving "${id}"`);
    }
    visiting.add(id);
    const st = graph.get(id);
    if (st) {
      for (const dep of st.dependencies) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const st of subTasks) {
    visit(st.id);
  }

  return order;
}

/**
 * Get sub-tasks that are ready to dispatch: all dependencies completed.
 */
function getReadyTasks(
  plan: Plan,
  tracker: ReturnType<typeof progressTracker.get>,
): SubTask[] {
  if (!tracker) return [];

  const ready: SubTask[] = [];
  for (const st of plan.subTasks) {
    const sp = tracker.subTasks.get(st.id);
    if (!sp || sp.state !== "pending") continue;

    // Check all dependencies are completed
    const depsReady = st.dependencies.every((depId) => {
      const depSp = tracker.subTasks.get(depId);
      return depSp?.state === "completed";
    });

    if (depsReady) {
      ready.push(st);
    }
  }
  return ready;
}

// ── Executor ──

export interface GoalExecutorResult {
  goalId: string;
  status: "completed" | "failed" | "partial";
  results: Record<string, Record<string, unknown> | null>;
  errors: string[];
}

/**
 * Execute a decomposed goal plan.
 *
 * @param goalId - Unique identifier for this goal execution
 * @param goal   - The original goal text
 * @param plan   - The decomposed plan from the planner
 * @param abort  - AbortSignal for cancellation
 */
export async function executeGoal(
  goalId: string,
  goal: string,
  plan: Plan,
  abort: AbortSignal,
): Promise<GoalExecutorResult> {
  // Validate dependency graph (throws on circular deps)
  topologicalSort(plan.subTasks);

  // Start tracking
  progressTracker.start(goalId, goal, plan);

  log.info({ goalId, subTasks: plan.subTasks.length }, "starting goal execution");

  // Main execution loop — backpressure-aware (no setInterval)
  while (!abort.aborted) {
    const tracker = progressTracker.get(goalId);
    if (!tracker) break;

    // Check if goal is done
    if (tracker.status !== "running") break;

    // Find tasks ready to dispatch
    const readyTasks = getReadyTasks(plan, tracker);

    // Dispatch all ready tasks
    for (const st of readyTasks) {
      if (abort.aborted) break;

      try {
        await dispatchSubTask(goalId, st);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ goalId, subTaskId: st.id, err: msg }, "failed to dispatch sub-task");
        progressTracker.markFailed(goalId, st.id, `Dispatch error: ${msg}`);
      }
    }

    // Poll running sub-tasks for completion
    await pollRunningSubTasks(goalId);

    // Wait before next iteration (backpressure)
    await sleep(POLL_INTERVAL_MS, abort);
  }

  // Collect final state
  const tracker = progressTracker.get(goalId);
  const results: Record<string, Record<string, unknown> | null> = {};
  const errors: string[] = [];

  if (tracker) {
    for (const [id, sp] of tracker.subTasks) {
      results[id] = sp.result;
      if (sp.error) errors.push(`${id}: ${sp.error}`);
    }
  }

  const finalStatus = tracker?.status === "running" ? "failed" : (tracker?.status ?? "failed");

  log.info({ goalId, status: finalStatus, errorCount: errors.length }, "goal execution complete");

  // Clean up tracker
  progressTracker.remove(goalId);

  return {
    goalId,
    status: finalStatus as "completed" | "failed" | "partial",
    results,
    errors,
  };
}

// ── Sub-task dispatch ──

async function dispatchSubTask(goalId: string, st: SubTask): Promise<void> {
  log.info({ goalId, subTaskId: st.id, type: st.type }, "dispatching sub-task");

  // Create a task on the Master Worker, which will route it to a VPS controller
  const task = await pRetry(
    () =>
      masterClient.createTask({
        type: st.browserNeeded ? "browser" : "code",
        payload: {
          prompt: st.prompt,
          adapterType: st.adapterType,
          browserNeeded: st.browserNeeded,
          orchestratorGoalId: goalId,
          orchestratorSubTaskId: st.id,
        },
      }),
    { retries: 2 },
  );

  progressTracker.markRunning(goalId, st.id, task.id);
}

// ── Poll for completion ──

async function pollRunningSubTasks(goalId: string): Promise<void> {
  const tracker = progressTracker.get(goalId);
  if (!tracker) return;

  for (const [subTaskId, sp] of tracker.subTasks) {
    if (sp.state !== "running" || !sp.masterTaskId) continue;

    let task: Task | null;
    try {
      task = await masterClient.getTask(sp.masterTaskId);
    } catch (err) {
      log.warn(
        { goalId, subTaskId, masterTaskId: sp.masterTaskId, err },
        "failed to poll sub-task status",
      );
      continue;
    }

    if (!task) {
      log.warn({ goalId, subTaskId, masterTaskId: sp.masterTaskId }, "task not found on master");
      continue;
    }

    if (task.status === "completed") {
      progressTracker.markCompleted(goalId, subTaskId, task.result ?? {});
    } else if (task.status === "failed") {
      // Retry logic
      if (sp.retryCount < MAX_RETRIES) {
        log.info(
          { goalId, subTaskId, retryCount: sp.retryCount },
          "retrying failed sub-task",
        );
        progressTracker.markRetrying(goalId, subTaskId);
      } else {
        const error = task.error || "Sub-task failed (unknown reason)";
        progressTracker.markFailed(goalId, subTaskId, error);

        // Attempt escalation via human-escalation skill if available
        await attemptEscalation(goalId, subTaskId, error);
      }
    }
    // "queued" | "assigned" | "running" → still in progress, keep waiting
  }
}

// ── Escalation ──

async function attemptEscalation(
  goalId: string,
  subTaskId: string,
  error: string,
): Promise<void> {
  if (!config.skillPaths.humanEscalation) {
    log.warn({ goalId, subTaskId }, "no human-escalation skill path configured — skipping escalation");
    return;
  }

  try {
    log.info({ goalId, subTaskId }, "escalating failed sub-task via human-escalation skill");
    await callSkill(config.skillPaths.humanEscalation, "blockade_check", {
      task_description: `Goal ${goalId}, sub-task ${subTaskId}`,
      blockade_description: error,
      attempts: [error, `Retry exhausted after ${MAX_RETRIES} attempt(s)`],
    });
  } catch (err) {
    log.error(
      { goalId, subTaskId, err: err instanceof Error ? err.message : String(err) },
      "escalation skill invocation failed",
    );
  }
}

// ── Sleep with abort support ──

function sleep(ms: number, abort: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abort.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    abort.addEventListener("abort", onAbort, { once: true });
  });
}
