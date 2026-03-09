import { Hono } from "hono";
import { cors } from "hono/cors";
import { vpsRegistry } from "./vps-registry.js";
import { taskQueue } from "./task-queue.js";
import { heartbeat } from "./heartbeat.js";
import { costTracker } from "./cost-tracker.js";

export interface Env {
  // R2
  R2: R2Bucket;
  // KV
  KV_AGENTS: KVNamespace;
  KV_PROFILES: KVNamespace;
  KV_SESSIONS: KVNamespace;
  // Service bindings
  IDENTITY_WORKER: Fetcher;
  PAYMENT_WORKER: Fetcher;
  SESSION_WORKER: Fetcher;
  // Secrets
  CONTROLLER_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ──

app.use("*", cors());

app.use("/api/*", async (c, next) => {
  // TODO: Add Zero Trust / auth validation
  await next();
});

// ── Health ──

app.get("/health", (c) => {
  return c.json({
    service: "moltclip-master",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ── VPS Registry ──

app.get("/api/vps", async (c) => {
  const nodes = await vpsRegistry.list(c.env);
  return c.json({ nodes });
});

app.post("/api/vps/register", async (c) => {
  const body = await c.req.json();
  const node = await vpsRegistry.register(c.env, body);
  return c.json({ node }, 201);
});

app.delete("/api/vps/:nodeId", async (c) => {
  const nodeId = c.req.param("nodeId");
  await vpsRegistry.deregister(c.env, nodeId);
  return c.json({ ok: true });
});

// ── Agents ──

app.get("/api/agents", async (c) => {
  const agents = await listAgents(c.env);
  return c.json({ agents });
});

app.post("/api/agents", async (c) => {
  const body = await c.req.json();
  const agent = await createAgent(c.env, body);
  return c.json({ agent }, 201);
});

app.get("/api/agents/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const agent = await getAgent(c.env, agentId);
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({ agent });
});

// ── Tasks ──

app.post("/api/tasks", async (c) => {
  const body = await c.req.json();
  const task = await taskQueue.enqueue(c.env, body);
  return c.json({ task }, 201);
});

app.get("/api/tasks", async (c) => {
  const status = c.req.query("status");
  const agentId = c.req.query("agentId");
  const tasks = await taskQueue.list(c.env, { status, agentId });
  return c.json({ tasks });
});

app.get("/api/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const task = await taskQueue.get(c.env, taskId);
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({ task });
});

// ── Costs ──

app.get("/api/costs", async (c) => {
  const agentId = c.req.query("agentId");
  const costs = await costTracker.getSummary(c.env, agentId);
  return c.json(costs);
});

// ── Browser Profiles ──

app.get("/api/profiles", async (c) => {
  const agentId = c.req.query("agentId");
  const profiles = await listProfiles(c.env, agentId);
  return c.json({ profiles });
});

// ── Status Dashboard ──

app.get("/api/status", async (c) => {
  const [nodes, tasks, agents] = await Promise.all([
    vpsRegistry.list(c.env),
    taskQueue.list(c.env, { status: "running" }),
    listAgents(c.env),
  ]);

  return c.json({
    vpsNodes: nodes.length,
    healthyNodes: nodes.filter((n) => n.health === "healthy").length,
    activeTasks: tasks.length,
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status === "active").length,
    timestamp: new Date().toISOString(),
  });
});

// ── Cron Handler (Heartbeat) ──

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(heartbeat.tick(env));
  },
};

// ── Agent helpers ──

async function listAgents(env: Env) {
  const raw = await env.KV_AGENTS.get("agents:list", "json");
  return (raw as any[]) || [];
}

async function getAgent(env: Env, agentId: string) {
  const raw = await env.KV_AGENTS.get(`agent:${agentId}`, "json");
  return raw || null;
}

async function createAgent(
  env: Env,
  data: { displayName: string; adapterType?: string },
) {
  const agentId = `agt_${crypto.randomUUID().slice(0, 12)}`;
  const agent = {
    id: agentId,
    displayName: data.displayName,
    emailInbox: null, // set up via identity worker
    walletId: null, // set up via payment worker
    status: "active",
    adapterType: data.adapterType || "claude_local",
    createdAt: new Date().toISOString(),
  };

  // Store agent
  await env.KV_AGENTS.put(`agent:${agentId}`, JSON.stringify(agent));

  // Update agent list
  const agents = await listAgents(env);
  agents.push(agent);
  await env.KV_AGENTS.put("agents:list", JSON.stringify(agents));

  return agent;
}

async function listProfiles(env: Env, agentId?: string | null) {
  const raw = await env.KV_PROFILES.get("profiles:list", "json");
  const profiles = (raw as any[]) || [];
  if (agentId) return profiles.filter((p: any) => p.agentId === agentId);
  return profiles;
}
