import pino from "pino";
import { browserPool } from "./browser-pool.js";
import { agentPool } from "./agent-pool.js";

const log = pino({ name: "task-runner" });

interface ActiveTask {
  taskId: string;
  agentId: string;
  type: string;
  browserSlotId: string | null;
  agentInstanceId: string | null;
  startedAt: Date;
}

const activeTasks = new Map<string, ActiveTask>();

// Master Worker callback URL (set via env)
const MASTER_URL = process.env.MASTER_WORKER_URL || "";
const CONTROLLER_SECRET = process.env.CONTROLLER_SECRET || "";

export const taskRunner = {
  /**
   * Accept a task from the Master Worker.
   * Returns false if at capacity.
   */
  accept(message: {
    taskId: string;
    agentId: string;
    adapterType?: string;
    payload: Record<string, unknown>;
    browserProfileId: string | null;
  }): boolean {
    if (activeTasks.has(message.taskId)) {
      log.warn({ taskId: message.taskId }, "task already active");
      return false;
    }

    const task: ActiveTask = {
      taskId: message.taskId,
      agentId: message.agentId,
      type: (message.payload.type as string) || "code",
      browserSlotId: null,
      agentInstanceId: null,
      startedAt: new Date(),
    };

    activeTasks.set(message.taskId, task);

    // Execute asynchronously (don't block the HTTP response)
    this.execute(task, message).catch((err) => {
      log.error({ err, taskId: task.taskId }, "task execution failed");
      this.reportCompletion(task.taskId, "failed", null, String(err));
    });

    return true;
  },

  async execute(
    task: ActiveTask,
    message: {
      taskId: string;
      agentId: string;
      adapterType?: string;
      payload: Record<string, unknown>;
      browserProfileId: string | null;
    },
  ): Promise<void> {
    log.info({ taskId: task.taskId, type: task.type }, "executing task");

    // If task needs a browser, launch one
    if (task.type === "browser" && message.browserProfileId) {
      const slot = await browserPool.launch({
        profileId: message.browserProfileId,
        agentId: task.agentId,
        service: (message.payload.service as string) || "default",
      });

      if (!slot) {
        await this.reportCompletion(task.taskId, "failed", null, "No browser slots available");
        return;
      }

      task.browserSlotId = slot.id;
    }

    // Spawn Claude Code / Codex to handle the task
    const prompt = (message.payload.prompt as string) || JSON.stringify(message.payload);
    const adapterType = message.adapterType || "claude_local";
    let stdout = "";

    const instanceId = await agentPool.spawn({
      agentId: task.agentId,
      taskId: task.taskId,
      adapterType,
      prompt,
      onLog: (stream, chunk) => {
        if (stream === "stdout") stdout += chunk;
      },
      onExit: async (code, signal) => {
        // Clean up browser if we launched one
        if (task.browserSlotId) {
          await browserPool.close(task.browserSlotId);
        }

        const status = code === 0 ? "completed" : "failed";
        const result = tryParseJson(stdout);
        const error = code !== 0 ? `Exit code: ${code}, signal: ${signal}` : null;

        await this.reportCompletion(task.taskId, status, result, error);
        activeTasks.delete(task.taskId);
      },
    });

    if (!instanceId) {
      if (task.browserSlotId) {
        await browserPool.close(task.browserSlotId);
      }
      await this.reportCompletion(task.taskId, "failed", null, "No agent slots available");
      activeTasks.delete(task.taskId);
    } else {
      task.agentInstanceId = instanceId;
    }
  },

  /**
   * Stop a running task.
   */
  async stop(taskId: string, reason: string): Promise<void> {
    const task = activeTasks.get(taskId);
    if (!task) return;

    log.info({ taskId, reason }, "stopping task");

    if (task.agentInstanceId) {
      await agentPool.kill(task.agentInstanceId);
    }
    if (task.browserSlotId) {
      await browserPool.close(task.browserSlotId);
    }

    activeTasks.delete(taskId);
    await this.reportCompletion(taskId, "cancelled" as any, null, reason);
  },

  /**
   * Drain all tasks (for graceful shutdown).
   */
  async drainAll(): Promise<void> {
    const ids = [...activeTasks.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id, "shutdown")));
  },

  /**
   * Report task completion back to Master Worker.
   */
  async reportCompletion(
    taskId: string,
    status: string,
    result: Record<string, unknown> | null,
    error: string | null,
  ): Promise<void> {
    if (!MASTER_URL) {
      log.info({ taskId, status, error }, "task completed (no master URL configured)");
      return;
    }

    try {
      await fetch(`${MASTER_URL}/api/tasks/${taskId}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONTROLLER_SECRET}`,
        },
        body: JSON.stringify({
          type: "task_progress",
          taskId,
          status,
          result,
          error,
        }),
      });
    } catch (err) {
      log.error({ err, taskId }, "failed to report task completion");
    }
  },

  getActiveTasks(): string[] {
    return [...activeTasks.keys()];
  },
};

function tryParseJson(str: string): Record<string, unknown> | null {
  try {
    return JSON.parse(str);
  } catch {
    return str ? { rawOutput: str } : null;
  }
}
