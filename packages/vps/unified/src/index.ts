// ── MoltClip Unified VPS Entry Point ──
// Starts: HTTP server + orchestrator + cron jobs
// Everything runs in one process on one VPS.

import { serve } from "@hono/node-server";
import pino from "pino";
import { env } from "./env.js";
import { initDatabase } from "./db.js";
import app from "./server.js";
import { orchestrator } from "./services/orchestrator.js";
import { startCronJobs } from "./cron/index.js";
import { agentPool } from "./services/agent-pool.js";
import { browserPool } from "./services/browser-pool.js";
import { taskRunner } from "./services/task-runner.js";

const log = pino({ name: "moltclip" });

async function waitForDatabase(maxRetries = 30, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await initDatabase();
      return;
    } catch (err) {
      log.warn({ attempt: i, maxRetries, err: (err as Error).message }, "database not ready, retrying...");
      if (i === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  log.info("MoltClip unified service starting...");

  // 1. Start HTTP server FIRST — bind to 0.0.0.0 immediately
  //    CF Containers expects TCP 8800 to be ready quickly.
  //    Health endpoint will report "starting" until DB is ready.
  const server = serve({
    fetch: app.fetch,
    port: env.port,
    hostname: "0.0.0.0",
  });

  log.info({ port: env.port }, "HTTP server listening (DB not yet ready)");

  // 2. Wait for database to be ready and initialize schema
  await waitForDatabase();

  // 3. Start orchestrator (goal decomposition + task dispatch loop)
  orchestrator.start();

  // 4. Start cron jobs (X monitor, blog monitor, synthesis, log collector)
  startCronJobs();

  log.info("MoltClip unified service fully started");
  log.info({
    port: env.port,
    maxClaude: env.maxClaudeInstances,
    maxCodex: env.maxCodexInstances,
    maxBrowsers: env.maxBrowsers,
    maxGoals: env.maxConcurrentGoals,
  }, "configuration");

  // ── Graceful shutdown ──

  async function shutdown(signal: string) {
    log.info({ signal }, "shutting down...");

    orchestrator.stop();
    const results = await Promise.allSettled([
      taskRunner.drainAll(),
      agentPool.killAll(),
      browserPool.closeAll(),
    ]);
    for (const r of results) {
      if (r.status === "rejected") log.error({ err: r.reason }, "shutdown cleanup failed");
    }

    // Close HTTP server
    if (typeof (server as any).close === "function") {
      (server as any).close();
    }

    log.info("shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.fatal({ err }, "failed to start");
  process.exit(1);
});
