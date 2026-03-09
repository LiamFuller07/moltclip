import type { Env } from "./index.js";

interface VpsRegistration {
  host: string;
  region: string;
  provider: string;
  maxBrowsers: number;
  maxAgentInstances: number;
}

interface VpsNodeRecord {
  id: string;
  host: string;
  region: string;
  provider: string;
  capacity: {
    maxBrowsers: number;
    usedBrowsers: number;
    maxAgentInstances: number;
    usedAgentInstances: number;
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
  };
  health: "healthy" | "degraded" | "unhealthy" | "offline";
  consecutiveFailures: number;
  lastHeartbeat: string;
  registeredAt: string;
}

const R2_REGISTRY_KEY = "state/vps-registry.json";

export const vpsRegistry = {
  async list(env: Env): Promise<VpsNodeRecord[]> {
    const obj = await env.R2.get(R2_REGISTRY_KEY);
    if (!obj) return [];
    const data = await obj.json<{ nodes: VpsNodeRecord[] }>();
    return data.nodes;
  },

  async register(env: Env, reg: VpsRegistration): Promise<VpsNodeRecord> {
    const nodes = await this.list(env);
    const nodeId = `vps_${crypto.randomUUID().slice(0, 8)}`;

    const node: VpsNodeRecord = {
      id: nodeId,
      host: reg.host,
      region: reg.region,
      provider: reg.provider,
      capacity: {
        maxBrowsers: reg.maxBrowsers,
        usedBrowsers: 0,
        maxAgentInstances: reg.maxAgentInstances,
        usedAgentInstances: 0,
        cpuPercent: 0,
        memoryPercent: 0,
        diskPercent: 0,
      },
      health: "healthy",
      consecutiveFailures: 0,
      lastHeartbeat: new Date().toISOString(),
      registeredAt: new Date().toISOString(),
    };

    nodes.push(node);
    await this.save(env, nodes);
    return node;
  },

  async deregister(env: Env, nodeId: string): Promise<void> {
    const nodes = await this.list(env);
    const filtered = nodes.filter((n) => n.id !== nodeId);
    await this.save(env, filtered);
  },

  async updateHealth(
    env: Env,
    nodeId: string,
    report: {
      capacity: VpsNodeRecord["capacity"];
      activeTasks: string[];
    },
  ): Promise<void> {
    const nodes = await this.list(env);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.capacity = report.capacity;
    node.lastHeartbeat = new Date().toISOString();
    node.consecutiveFailures = 0;

    // Determine health from capacity
    if (node.capacity.cpuPercent > 90 || node.capacity.memoryPercent > 90) {
      node.health = "degraded";
    } else {
      node.health = "healthy";
    }

    await this.save(env, nodes);
  },

  async markUnhealthy(env: Env, nodeId: string): Promise<void> {
    const nodes = await this.list(env);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    node.consecutiveFailures += 1;
    if (node.consecutiveFailures >= 3) {
      node.health = "offline";
    } else {
      node.health = "unhealthy";
    }

    await this.save(env, nodes);
  },

  /**
   * Find the best VPS node for a new task.
   * Prefers healthy nodes with most available capacity.
   */
  selectNode(
    nodes: VpsNodeRecord[],
    requirements?: { needsBrowser?: boolean },
  ): VpsNodeRecord | null {
    const healthy = nodes.filter(
      (n) => n.health === "healthy" || n.health === "degraded",
    );
    if (healthy.length === 0) return null;

    // Sort by available capacity (most available first)
    healthy.sort((a, b) => {
      const aAvail =
        (a.capacity.maxBrowsers - a.capacity.usedBrowsers) +
        (a.capacity.maxAgentInstances - a.capacity.usedAgentInstances);
      const bAvail =
        (b.capacity.maxBrowsers - b.capacity.usedBrowsers) +
        (b.capacity.maxAgentInstances - b.capacity.usedAgentInstances);
      return bAvail - aAvail;
    });

    if (requirements?.needsBrowser) {
      return (
        healthy.find(
          (n) => n.capacity.usedBrowsers < n.capacity.maxBrowsers,
        ) || null
      );
    }

    return healthy[0] || null;
  },

  async save(env: Env, nodes: VpsNodeRecord[]): Promise<void> {
    await env.R2.put(R2_REGISTRY_KEY, JSON.stringify({ nodes }));
  },
};
