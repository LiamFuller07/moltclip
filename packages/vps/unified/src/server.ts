// ── Unified MoltClip Server ──
// Single Hono app with all routes — replaces 5 CF Workers + Controller

import { Hono } from "hono";
import { cors } from "hono/cors";
import { timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import pino from "pino";

import healthRoutes from "./routes/health.js";
import agentRoutes from "./routes/agents.js";
import taskRoutes from "./routes/tasks.js";
import costRoutes from "./routes/costs.js";
import identityRoutes from "./routes/identity.js";
import paymentRoutes from "./routes/payment.js";
import profileRoutes from "./routes/profiles.js";
import harnessRoutes from "./routes/harness.js";
import statusRoutes from "./routes/status.js";

const log = pino({ name: "server" });

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const app = new Hono();

// ── Middleware ──

app.use("*", cors());

// Auth middleware — skip /health
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) return c.json({ error: "Unauthorized" }, 401);
  if (!safeCompare(token, env.controllerSecret) && !safeCompare(token, env.apiKey)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

// ── Mount all routes ──

app.route("/", healthRoutes);
app.route("/", agentRoutes);
app.route("/", taskRoutes);
app.route("/", costRoutes);
app.route("/", identityRoutes);
app.route("/", paymentRoutes);
app.route("/", profileRoutes);
app.route("/", harnessRoutes);
app.route("/", statusRoutes);

// ── Agent pool + browser pool status ──

app.get("/api/pool", async (c) => {
  // Lazy import to avoid circular deps
  const { agentPool } = await import("./services/agent-pool.js");
  const { browserPool } = await import("./services/browser-pool.js");
  return c.json({
    agents: agentPool.getStatus(),
    browsers: browserPool.getStatus(),
  });
});

// ── Task dispatch (VPS accepts work) ──

app.post("/api/dispatch", async (c) => {
  const { taskRunner } = await import("./services/task-runner.js");
  const body = await c.req.json();
  const accepted = taskRunner.accept(body);
  if (!accepted) return c.json({ error: "At capacity or duplicate task" }, 503);
  return c.json({ accepted: true });
});

// ── Catch-all ──

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  log.error({ err }, "unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
