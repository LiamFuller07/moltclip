import type { Env } from "./index.js";
import { vpsRegistry } from "./vps-registry.js";
import { taskQueue } from "./task-queue.js";

/**
 * Heartbeat runs every 5 minutes via CF Cron.
 *
 * 1. Health-check all registered VPS nodes
 * 2. Mark unhealthy nodes after 3 consecutive failures
 * 3. Route queued tasks to available VPS nodes
 * 4. Clean up old completed tasks
 */
export const heartbeat = {
  async tick(env: Env): Promise<void> {
    console.log("[heartbeat] tick started");

    const nodes = await vpsRegistry.list(env);
    if (nodes.length === 0) {
      console.log("[heartbeat] no VPS nodes registered, skipping");
      return;
    }

    // 1. Health-check all nodes
    await Promise.allSettled(
      nodes.map((node) => this.checkNode(env, node)),
    );

    // 2. Route queued tasks
    await this.routeTasks(env);

    // 3. Cleanup old tasks
    const cleaned = await taskQueue.cleanup(env);
    if (cleaned > 0) {
      console.log(`[heartbeat] cleaned ${cleaned} old tasks`);
    }

    console.log("[heartbeat] tick completed");
  },

  async checkNode(
    env: Env,
    node: { id: string; host: string },
  ): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(`${node.host}/health`, {
        headers: { Authorization: `Bearer ${env.CONTROLLER_SECRET}` },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.log(`[heartbeat] node ${node.id} returned ${res.status}`);
        await vpsRegistry.markUnhealthy(env, node.id);
        return;
      }

      const report = await res.json() as any;
      await vpsRegistry.updateHealth(env, node.id, {
        capacity: report.capacity,
        activeTasks: report.activeTasks || [],
      });
    } catch (err) {
      console.log(`[heartbeat] node ${node.id} unreachable: ${err}`);
      await vpsRegistry.markUnhealthy(env, node.id);
    }
  },

  async routeTasks(env: Env): Promise<void> {
    const queued = await taskQueue.getQueuedByPriority(env);
    if (queued.length === 0) return;

    const nodes = await vpsRegistry.list(env);

    for (const task of queued) {
      const needsBrowser = task.type === "browser";
      const targetNode = vpsRegistry.selectNode(nodes, { needsBrowser });

      if (!targetNode) {
        console.log(`[heartbeat] no available node for task ${task.id}`);
        continue;
      }

      try {
        // Send task to VPS controller
        const res = await fetch(`${targetNode.host}/task`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.CONTROLLER_SECRET}`,
          },
          body: JSON.stringify({
            type: "assign_task",
            taskId: task.id,
            agentId: task.agentId,
            payload: task.payload,
            browserProfileId: null,
          }),
        });

        if (res.ok) {
          await taskQueue.updateStatus(env, task.id, {
            status: "assigned",
            vpsNodeId: targetNode.id,
            startedAt: new Date().toISOString(),
          });
          console.log(`[heartbeat] routed task ${task.id} to node ${targetNode.id}`);
        } else {
          console.log(`[heartbeat] failed to route task ${task.id}: ${res.status}`);
        }
      } catch (err) {
        console.log(`[heartbeat] error routing task ${task.id}: ${err}`);
      }
    }
  },
};
