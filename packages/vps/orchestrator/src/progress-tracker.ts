// ── Goal Execution Progress Tracker ──
// In-memory state for active goals, with periodic snapshot persistence.

import pino from "pino";
import type { Plan, SubTask } from "./planner.js";

const log = pino({ name: "progress-tracker" });

// ── Types ──

export type SubTaskState = "pending" | "running" | "completed" | "failed" | "skipped";

export interface SubTaskProgress {
  subTask: SubTask;
  state: SubTaskState;
  masterTaskId: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
}

export interface GoalProgress {
  goalId: string;
  goal: string;
  plan: Plan;
  subTasks: Map<string, SubTaskProgress>;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed" | "partial";
  errors: string[];
}

// ── Tracker ──

const activeGoals = new Map<string, GoalProgress>();

export const progressTracker = {
  /**
   * Begin tracking a new goal.
   */
  start(goalId: string, goal: string, plan: Plan): GoalProgress {
    const subTasks = new Map<string, SubTaskProgress>();
    for (const st of plan.subTasks) {
      subTasks.set(st.id, {
        subTask: st,
        state: "pending",
        masterTaskId: null,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        retryCount: 0,
      });
    }

    const progress: GoalProgress = {
      goalId,
      goal,
      plan,
      subTasks,
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      errors: [],
    };

    activeGoals.set(goalId, progress);
    log.info({ goalId, subTaskCount: plan.subTasks.length }, "tracking goal");
    return progress;
  },

  /**
   * Mark a sub-task as dispatched (running).
   */
  markRunning(goalId: string, subTaskId: string, masterTaskId: string): void {
    const sp = this.getSubTask(goalId, subTaskId);
    if (!sp) return;
    sp.state = "running";
    sp.masterTaskId = masterTaskId;
    sp.startedAt = new Date().toISOString();
  },

  /**
   * Mark a sub-task as completed with a result.
   */
  markCompleted(
    goalId: string,
    subTaskId: string,
    result: Record<string, unknown>,
  ): void {
    const sp = this.getSubTask(goalId, subTaskId);
    if (!sp) return;
    sp.state = "completed";
    sp.result = result;
    sp.completedAt = new Date().toISOString();

    // Check if all sub-tasks are done
    this.checkGoalCompletion(goalId);
  },

  /**
   * Mark a sub-task as failed.
   */
  markFailed(goalId: string, subTaskId: string, error: string): void {
    const gp = activeGoals.get(goalId);
    if (!gp) return;
    const sp = gp.subTasks.get(subTaskId);
    if (!sp) return;

    sp.state = "failed";
    sp.error = error;
    sp.completedAt = new Date().toISOString();
    gp.errors.push(`${subTaskId}: ${error}`);

    // Skip dependents of this failed task
    for (const [id, stp] of gp.subTasks) {
      if (stp.state === "pending" && stp.subTask.dependencies.includes(subTaskId)) {
        stp.state = "skipped";
        stp.error = `Skipped: dependency "${subTaskId}" failed`;
        stp.completedAt = new Date().toISOString();
        log.info({ goalId, subTaskId: id }, "sub-task skipped due to dependency failure");
      }
    }

    this.checkGoalCompletion(goalId);
  },

  /**
   * Increment retry count for a sub-task and reset it to pending.
   */
  markRetrying(goalId: string, subTaskId: string): void {
    const sp = this.getSubTask(goalId, subTaskId);
    if (!sp) return;
    sp.retryCount += 1;
    sp.state = "pending";
    sp.error = null;
    sp.masterTaskId = null;
    sp.startedAt = null;
    sp.completedAt = null;
  },

  /**
   * Get the current progress for a goal.
   */
  get(goalId: string): GoalProgress | undefined {
    return activeGoals.get(goalId);
  },

  /**
   * Remove a completed/failed goal from tracking.
   */
  remove(goalId: string): void {
    activeGoals.delete(goalId);
  },

  /**
   * Get a count of actively tracked goals.
   */
  activeCount(): number {
    return activeGoals.size;
  },

  /**
   * Get a serializable snapshot of all active goals for reporting.
   */
  snapshot(): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const [, gp] of activeGoals) {
      const subTaskStates: Record<string, unknown> = {};
      for (const [id, sp] of gp.subTasks) {
        subTaskStates[id] = {
          state: sp.state,
          masterTaskId: sp.masterTaskId,
          error: sp.error,
          retryCount: sp.retryCount,
        };
      }
      result.push({
        goalId: gp.goalId,
        goal: gp.goal,
        status: gp.status,
        startedAt: gp.startedAt,
        completedAt: gp.completedAt,
        errors: gp.errors,
        subTasks: subTaskStates,
      });
    }
    return result;
  },

  // ── Internal ──

  getSubTask(goalId: string, subTaskId: string): SubTaskProgress | null {
    const gp = activeGoals.get(goalId);
    if (!gp) {
      log.warn({ goalId }, "goal not found in tracker");
      return null;
    }
    const sp = gp.subTasks.get(subTaskId);
    if (!sp) {
      log.warn({ goalId, subTaskId }, "sub-task not found in tracker");
      return null;
    }
    return sp;
  },

  checkGoalCompletion(goalId: string): void {
    const gp = activeGoals.get(goalId);
    if (!gp) return;

    const states = [...gp.subTasks.values()].map((sp) => sp.state);

    // Still has pending or running tasks → not done yet
    if (states.includes("pending") || states.includes("running")) return;

    // All finished — determine final status
    const allCompleted = states.every((s) => s === "completed");
    const anyFailed = states.some((s) => s === "failed");

    if (allCompleted) {
      gp.status = "completed";
    } else if (anyFailed) {
      // Some completed, some failed/skipped
      const completedCount = states.filter((s) => s === "completed").length;
      gp.status = completedCount > 0 ? "partial" : "failed";
    } else {
      // All skipped (unlikely)
      gp.status = "failed";
    }

    gp.completedAt = new Date().toISOString();
    log.info(
      { goalId, status: gp.status, errors: gp.errors.length },
      "goal execution finished",
    );
  },
};
