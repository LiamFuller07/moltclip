import express from "express";
import pino from "pino";
import { browserPool } from "./browser-pool.js";
import { agentPool } from "./agent-pool.js";
import { taskRunner } from "./task-runner.js";
import { metrics } from "./metrics.js";

const log = pino({ name: "moltclip-controller" });

const PORT = parseInt(process.env.CONTROLLER_PORT || "8800", 10);
const CONTROLLER_SECRET = process.env.CONTROLLER_SECRET || "";

const app = express();
app.use(express.json());

// ── Auth middleware ──

function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!CONTROLLER_SECRET) {
    next();
    return;
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== CONTROLLER_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use(authMiddleware);

// ── Health endpoint ──

app.get("/health", async (_req, res) => {
  const m = await metrics.collect();
  const browsers = browserPool.getStatus();
  const agents = agentPool.getStatus();

  res.json({
    status: "ok",
    uptime: process.uptime(),
    capacity: {
      maxBrowsers: browsers.max,
      usedBrowsers: browsers.active,
      maxAgentInstances: agents.max,
      usedAgentInstances: agents.active,
      cpuPercent: m.cpuPercent,
      memoryPercent: m.memoryPercent,
      diskPercent: m.diskPercent,
    },
    activeTasks: taskRunner.getActiveTasks(),
  });
});

// ── Task endpoint (receives tasks from Master Worker) ──

app.post("/task", async (req, res) => {
  const message = req.body;

  if (message.type === "assign_task") {
    const accepted = taskRunner.accept(message);
    if (!accepted) {
      res.status(503).json({ error: "At capacity" });
      return;
    }
    res.json({ ok: true, taskId: message.taskId });
    return;
  }

  if (message.type === "stop_task") {
    await taskRunner.stop(message.taskId, message.reason);
    res.json({ ok: true });
    return;
  }

  res.status(400).json({ error: `Unknown message type: ${message.type}` });
});

// ── Browser status ──

app.get("/browsers", (_req, res) => {
  res.json(browserPool.getStatus());
});

// ── Agent status ──

app.get("/agents", (_req, res) => {
  res.json(agentPool.getStatus());
});

// ── Metrics ──

app.get("/metrics", async (_req, res) => {
  res.json(await metrics.collect());
});

// ── Start server ──

app.listen(PORT, "0.0.0.0", () => {
  log.info({ port: PORT }, "moltclip-controller started");
});

// ── Graceful shutdown ──

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  await taskRunner.drainAll();
  await browserPool.closeAll();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
