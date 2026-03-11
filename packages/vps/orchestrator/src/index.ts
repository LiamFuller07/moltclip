// ── MoltClip Orchestrator ──
// The brain of the system: a long-running process that receives high-level
// goals, decomposes them via Claude, dispatches sub-tasks to agents via the
// Master Worker, monitors progress, and aggregates results.

import pino from "pino";
import { config } from "./config.js";
import * as masterClient from "./master-client.js";
import { startGoalLoop, stopGoalLoop } from "./goal-loop.js";

const log = pino({ name: "orchestrator" });

async function main(): Promise<void> {
  log.info("moltclip orchestrator starting");
  log.info({
    masterUrl: config.masterUrl,
    pollIntervalMs: config.pollIntervalMs,
    maxConcurrentGoals: config.maxConcurrentGoals,
    maxSubTasksPerGoal: config.maxSubTasksPerGoal,
  }, "configuration loaded");

  // Register ourselves as an agent with the Master Worker
  let agentId: string;
  try {
    const agent = await masterClient.createAgent({
      displayName: "orchestrator",
      adapterType: "orchestrator",
    });
    agentId = agent.id;
    log.info({ agentId }, "registered with master worker");
  } catch (err) {
    log.fatal(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to register with master worker — cannot start",
    );
    process.exit(1);
  }

  // Verify Master Worker connectivity
  try {
    const status = await masterClient.getStatus();
    log.info(
      {
        vpsNodes: status.vpsNodes,
        activeTasks: status.activeTasks,
        totalAgents: status.totalAgents,
      },
      "master worker status OK",
    );
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "could not fetch master status (non-fatal)",
    );
  }

  // Start the main goal-polling loop
  startGoalLoop(agentId);

  log.info("orchestrator is running");
}

// ── Graceful shutdown ──

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutdown requested");
  await stopGoalLoop();
  log.info("orchestrator stopped");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle unhandled rejections
process.on("unhandledRejection", (reason) => {
  log.error({ reason }, "unhandled rejection");
});

// ── Start ──

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.message : String(err) }, "fatal startup error");
  process.exit(1);
});
