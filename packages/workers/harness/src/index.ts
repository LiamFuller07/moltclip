import { Hono } from "hono";
import { dashboardApi } from "./dashboard-api.js";
import { runXMonitor } from "./x-monitor.js";
import { runBlogMonitor } from "./blog-monitor.js";
import { runLogCollector } from "./log-collector.js";
import { runSynthesisPipeline } from "./synthesis-pipeline.js";

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV_HARNESS: KVNamespace;
  MASTER_WORKER: Fetcher;
  XAI_API_KEY: string;
  FIRECRAWL_API_KEY: string;
  X_BEARER_TOKEN: string;
  GITHUB_TOKEN: string;
  CONTROLLER_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// Health endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "moltclip-harness",
    timestamp: new Date().toISOString(),
  });
});

// Mount dashboard API
app.route("/api/harness", dashboardApi);

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    switch (event.cron) {
      // X monitor — every 30 minutes
      case "*/30 * * * *":
        ctx.waitUntil(runXMonitor(env));
        break;

      // Blog monitor — every 2 hours
      case "0 */2 * * *":
        ctx.waitUntil(runBlogMonitor(env));
        break;

      // Synthesis pipeline — every 4 hours
      case "0 */4 * * *":
        ctx.waitUntil(runSynthesisPipeline(env));
        break;

      // Log collector — every hour
      case "0 * * * *":
        ctx.waitUntil(runLogCollector(env));
        break;
    }
  },
};
