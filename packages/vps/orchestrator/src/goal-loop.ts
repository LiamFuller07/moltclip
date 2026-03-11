// ── Main Goal Polling Loop ──
// Polls the Master Worker for tasks assigned to the orchestrator agent.
// Uses a backpressure-aware async loop (NOT setInterval).
// Respects maxConcurrentGoals.

import pino from "pino";
import type { Task } from "@moltclip/shared";
import { config } from "./config.js";
import * as masterClient from "./master-client.js";
import { planGoal } from "./planner.js";
import { executeGoal, type GoalExecutorResult } from "./goal-executor.js";
import { progressTracker } from "./progress-tracker.js";

const log = pino({ name: "goal-loop" });

// ── State ──

/** Map of goalId → { abort controller, result promise } */
const activeGoals = new Map<
  string,
  { controller: AbortController; promise: Promise<GoalExecutorResult> }
>();

let running = false;
let shutdownRequested = false;

// ── Public API ──

/**
 * Start the main goal-polling loop.
 *
 * @param orchestratorAgentId - The agent ID this orchestrator registered as
 */
export async function startGoalLoop(orchestratorAgentId: string): Promise<void> {
  if (running) {
    log.warn("goal loop already running");
    return;
  }

  running = true;
  log.info({ agentId: orchestratorAgentId, pollIntervalMs: config.pollIntervalMs }, "goal loop started");

  // Backpressure-aware async loop
  while (!shutdownRequested) {
    try {
      await pollAndDispatch(orchestratorAgentId);
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "error in goal loop iteration",
      );
    }

    // Wait before next poll (backpressure — delay comes AFTER work)
    if (!shutdownRequested) {
      await sleep(config.pollIntervalMs);
    }
  }

  running = false;
  log.info("goal loop stopped");
}

/**
 * Request graceful shutdown of the goal loop.
 * Waits for all active goals to finish or be cancelled.
 */
export async function stopGoalLoop(): Promise<void> {
  shutdownRequested = true;

  // Abort all active goal executions
  for (const [goalId, { controller }] of activeGoals) {
    log.info({ goalId }, "aborting active goal");
    controller.abort();
  }

  // Wait for all active goals to settle
  const promises = [...activeGoals.values()].map(({ promise }) =>
    promise.catch(() => {}),
  );
  await Promise.allSettled(promises);

  activeGoals.clear();
  log.info("all active goals settled");
}

// ── Internal ──

async function pollAndDispatch(orchestratorAgentId: string): Promise<void> {
  // Don't poll if we're at capacity
  if (activeGoals.size >= config.maxConcurrentGoals) {
    log.debug(
      { active: activeGoals.size, max: config.maxConcurrentGoals },
      "at goal capacity, skipping poll",
    );
    return;
  }

  // Fetch queued tasks assigned to this orchestrator
  let tasks: Task[];
  try {
    tasks = await masterClient.listTasks({
      agentId: orchestratorAgentId,
      status: "queued",
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to poll master for tasks",
    );
    return;
  }

  if (tasks.length === 0) return;

  // Sort by priority (highest first) and take what we can fit
  tasks.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const slots = config.maxConcurrentGoals - activeGoals.size;
  const batch = tasks.slice(0, slots);

  for (const task of batch) {
    if (shutdownRequested) break;

    const goal = extractGoal(task);
    if (!goal) {
      log.warn({ taskId: task.id }, "task has no goal in payload — skipping");
      continue;
    }

    // Don't double-execute
    if (activeGoals.has(task.id)) continue;

    log.info({ taskId: task.id, goal: goal.slice(0, 120) }, "starting goal execution");
    launchGoal(task.id, goal, task.payload.context as string | undefined);
  }
}

function extractGoal(task: Task): string | null {
  // The task payload should contain a "goal" field
  if (typeof task.payload?.goal === "string" && task.payload.goal.length > 0) {
    return task.payload.goal;
  }
  // Fallback: use prompt field
  if (typeof task.payload?.prompt === "string" && task.payload.prompt.length > 0) {
    return task.payload.prompt;
  }
  return null;
}

function launchGoal(goalId: string, goal: string, context?: string): void {
  const controller = new AbortController();

  const promise = (async (): Promise<GoalExecutorResult> => {
    try {
      // Step 1: Decompose the goal into sub-tasks
      const plan = await planGoal(goal, context);

      // Step 2: Execute the plan
      const result = await executeGoal(goalId, goal, plan, controller.signal);

      // Step 3: Report completion to Master Worker
      await reportGoalResult(goalId, result);

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ goalId, err: msg }, "goal execution failed");

      // Report failure
      const failResult: GoalExecutorResult = {
        goalId,
        status: "failed",
        results: {},
        errors: [msg],
      };
      await reportGoalResult(goalId, failResult).catch(() => {});
      return failResult;
    } finally {
      activeGoals.delete(goalId);
    }
  })();

  activeGoals.set(goalId, { controller, promise });
}

async function reportGoalResult(
  goalId: string,
  result: GoalExecutorResult,
): Promise<void> {
  try {
    // Update the original task with the result
    // The master worker stores results when we create a task progress update
    // For now, create a completion task that references the goal
    await masterClient.createTask({
      type: "custom",
      payload: {
        type: "goal_result",
        goalId,
        status: result.status,
        results: result.results,
        errors: result.errors,
      },
    });

    log.info({ goalId, status: result.status }, "goal result reported to master");
  } catch (err) {
    log.error(
      { goalId, err: err instanceof Error ? err.message : String(err) },
      "failed to report goal result",
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
