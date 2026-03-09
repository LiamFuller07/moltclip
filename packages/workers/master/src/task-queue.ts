import type { Env } from "./index.js";

interface TaskRecord {
  id: string;
  agentId: string | null;
  type: string;
  status: "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled";
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  vpsNodeId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

interface EnqueueInput {
  agentId?: string;
  type: string;
  priority?: number;
  payload: Record<string, unknown>;
}

interface ListFilter {
  status?: string | null;
  agentId?: string | null;
}

const R2_TASKS_KEY = "state/task-queue.json";

export const taskQueue = {
  async list(env: Env, filter?: ListFilter): Promise<TaskRecord[]> {
    const obj = await env.R2.get(R2_TASKS_KEY);
    if (!obj) return [];
    const data = await obj.json<{ tasks: TaskRecord[] }>();
    let tasks = data.tasks;

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.agentId) {
      tasks = tasks.filter((t) => t.agentId === filter.agentId);
    }

    return tasks;
  },

  async get(env: Env, taskId: string): Promise<TaskRecord | null> {
    const tasks = await this.list(env);
    return tasks.find((t) => t.id === taskId) || null;
  },

  async enqueue(env: Env, input: EnqueueInput): Promise<TaskRecord> {
    const tasks = await this.list(env);

    const task: TaskRecord = {
      id: `task_${crypto.randomUUID().slice(0, 12)}`,
      agentId: input.agentId || null,
      type: input.type,
      status: "queued",
      priority: input.priority || 0,
      payload: input.payload,
      result: null,
      vpsNodeId: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
    };

    tasks.push(task);
    await this.save(env, tasks);
    return task;
  },

  async updateStatus(
    env: Env,
    taskId: string,
    update: Partial<Pick<TaskRecord, "status" | "vpsNodeId" | "startedAt" | "completedAt" | "result" | "error">>,
  ): Promise<void> {
    const tasks = await this.list(env);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    Object.assign(task, update);
    await this.save(env, tasks);
  },

  /**
   * Get queued tasks sorted by priority (highest first).
   */
  async getQueuedByPriority(env: Env): Promise<TaskRecord[]> {
    const tasks = await this.list(env, { status: "queued" });
    return tasks.sort((a, b) => b.priority - a.priority);
  },

  /**
   * Clean up old completed/failed tasks (older than 7 days).
   */
  async cleanup(env: Env): Promise<number> {
    const tasks = await this.list(env);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const before = tasks.length;

    const kept = tasks.filter((t) => {
      if (t.status === "completed" || t.status === "failed" || t.status === "cancelled") {
        const ts = new Date(t.completedAt || t.createdAt).getTime();
        return ts > cutoff;
      }
      return true;
    });

    await this.save(env, kept);
    return before - kept.length;
  },

  async save(env: Env, tasks: TaskRecord[]): Promise<void> {
    await env.R2.put(R2_TASKS_KEY, JSON.stringify({ tasks }));
  },
};
