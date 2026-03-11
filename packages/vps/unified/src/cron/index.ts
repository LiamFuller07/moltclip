import cron from "node-cron";
import pino from "pino";
import { xMonitor } from "./x-monitor.js";
import { blogMonitor } from "./blog-monitor.js";
import { synthesisPipeline } from "./synthesis.js";
import { logCollector } from "./log-collector.js";

const log = pino({ name: "cron" });

export function startCronJobs(): void {
  // X Monitor - every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    log.info("cron: x-monitor");
    try { await xMonitor.run(); } catch (err) { log.error({ err }, "x-monitor failed"); }
  });

  // Blog Monitor - every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    log.info("cron: blog-monitor");
    try { await blogMonitor.run(); } catch (err) { log.error({ err }, "blog-monitor failed"); }
  });

  // Synthesis Pipeline - every 4 hours
  cron.schedule("0 */4 * * *", async () => {
    log.info("cron: synthesis-pipeline");
    try { await synthesisPipeline.run(); } catch (err) { log.error({ err }, "synthesis failed"); }
  });

  // Log Collector - every hour
  cron.schedule("0 * * * *", async () => {
    log.info("cron: log-collector");
    try { await logCollector.run(); } catch (err) { log.error({ err }, "log-collector failed"); }
  });

  log.info("cron jobs scheduled: x-monitor(*/30), blog-monitor(0 */2), synthesis(0 */4), log-collector(0 *)");
}
