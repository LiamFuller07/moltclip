import pino from "pino";
import { browserPool } from "./browser-pool.js";
import { agentPool } from "./agent-pool.js";
import { sql } from "../db.js";

const log = pino({ name: "task-runner" });

interface ActiveTask {
  taskId: string;
  agentId: string;
  type: string;
  browserSlotId: string | null;
  agentInstanceId: string | null;
}

const activeTasks = new Map<string, ActiveTask>();

export const taskRunner = {
  accept(message: {
    taskId: string;
    agentId: string;
    adapterType?: string;
    payload: Record<string, unknown>;
    browserProfileId: string | null;
  }): boolean {
    if (activeTasks.has(message.taskId)) return false;

    const task: ActiveTask = {
      taskId: message.taskId,
      agentId: message.agentId,
      type: (message.payload.type as string) || "code",
      browserSlotId: null,
      agentInstanceId: null,
    };

    activeTasks.set(message.taskId, task);
    this.execute(task, message).catch((err) => {
      log.error({ err, taskId: task.taskId }, "task failed");
      this.complete(task.taskId, "failed", null, String(err));
    });

    return true;
  },

  async execute(task: ActiveTask, message: any): Promise<void> {
    log.info({ taskId: task.taskId, type: task.type }, "executing task");

    // Mark as running in DB
    await sql`UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = ${task.taskId}`;

    if (task.type === "browser" && message.browserProfileId) {
      const slot = await browserPool.launch({
        profileId: message.browserProfileId,
        agentId: task.agentId,
        service: (message.payload.service as string) || "default",
      });
      if (!slot) {
        await this.complete(task.taskId, "failed", null, "No browser slots");
        return;
      }
      task.browserSlotId = slot.id;
    }

    const prompt = (message.payload.prompt as string) || JSON.stringify(message.payload);
    const MAX_STDOUT = 10 * 1024 * 1024; // 10MB
    let stdout = "";
    let stdoutTruncated = false;

    const instanceId = await agentPool.spawn({
      agentId: task.agentId,
      taskId: task.taskId,
      adapterType: message.adapterType || "claude_local",
      prompt,
      onLog: (stream, chunk) => {
        if (stream === "stdout" && !stdoutTruncated) {
          stdout += chunk;
          if (stdout.length > MAX_STDOUT) {
            stdoutTruncated = true;
            log.warn({ taskId: task.taskId }, "stdout exceeded 10MB, truncating");
          }
        }
        if (stream === "stderr" && chunk.trim()) {
          log.info({ taskId: task.taskId, stderr: chunk.trim().slice(0, 1000) }, "agent stderr");
        }
      },
      onExit: async (code) => {
        try {
          if (task.browserSlotId) {
            try { await browserPool.close(task.browserSlotId); } catch (err) {
              log.error({ err, taskId: task.taskId }, "failed to close browser slot");
            }
          }
          const status = code === 0 ? "completed" : "failed";
          const result = tryParseJson(stdout);
          await this.complete(task.taskId, status, result, code !== 0 ? `Exit ${code}` : null);
        } catch (err) {
          log.error({ err, taskId: task.taskId }, "failed to record task completion");
        } finally {
          activeTasks.delete(task.taskId);
        }
      },
    });

    if (!instanceId) {
      if (task.browserSlotId) await browserPool.close(task.browserSlotId);
      await this.complete(task.taskId, "failed", null, "No agent slots");
      activeTasks.delete(task.taskId);
    } else {
      task.agentInstanceId = instanceId;
    }
  },

  async complete(taskId: string, status: string, result: any, error: string | null): Promise<void> {
    await sql`
      UPDATE tasks SET status = ${status}, result = ${result ? sql.json(result) : null}, error = ${error}, completed_at = NOW()
      WHERE id = ${taskId}
    `;
    log.info({ taskId, status, error }, "task completed");
  },

  async stop(taskId: string): Promise<void> {
    const task = activeTasks.get(taskId);
    if (!task) return;
    if (task.agentInstanceId) await agentPool.kill(task.agentInstanceId);
    if (task.browserSlotId) await browserPool.close(task.browserSlotId);
    activeTasks.delete(taskId);
    await this.complete(taskId, "cancelled", null, "stopped");
  },

  async drainAll(): Promise<void> {
    await Promise.allSettled([...activeTasks.keys()].map((id) => this.stop(id)));
  },

  getActiveTasks() { return [...activeTasks.keys()]; },
};

function tryParseJson(str: string): any {
  try { return JSON.parse(str); } catch { return str ? { rawOutput: str } : null; }
}
