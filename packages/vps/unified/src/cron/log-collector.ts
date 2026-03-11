import pino from "pino";
import { sql } from "../db.js";
import { storage } from "../storage.js";

const log = pino({ name: "log-collector" });

export const logCollector = {
  async run(): Promise<void> {
    log.info("collecting agent logs");

    try {
      // List recent log files from storage
      const logFiles = await storage.list("logs/agents/");

      let errorCount = 0;
      let totalEntries = 0;
      const errorPatterns: Record<string, number> = {};

      for (const file of logFiles.slice(-100)) {
        const obj = await storage.get(file);
        if (!obj) continue;

        const text = await obj.text();
        const lines = text.split("\n").filter(Boolean);
        totalEntries += lines.length;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.level >= 50 || entry.err) { // error level
              errorCount++;
              const pattern = entry.msg || entry.err?.message || "unknown";
              errorPatterns[pattern] = (errorPatterns[pattern] || 0) + 1;
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }

      const healthScore = totalEntries > 0 ? Math.max(0, 1 - (errorCount / totalEntries) * 10) : 1;

      const analysisId = `la_${crypto.randomUUID().slice(0, 12)}`;
      await sql`
        INSERT INTO log_analysis_cache (analysis_id, log_window_hours, error_patterns, health_score)
        VALUES (${analysisId}, 1, ${JSON.stringify(Object.entries(errorPatterns).slice(0, 20).map(([p, c]) => ({ pattern: p, count: c })))}, ${healthScore})
      `;

      // Update system health
      await sql`
        INSERT INTO system_health_snapshots (snapshot_id, overall_score, error_rate_pct, data)
        VALUES (${`sh_${crypto.randomUUID().slice(0, 12)}`}, ${healthScore}, ${totalEntries > 0 ? (errorCount / totalEntries) * 100 : 0}, ${JSON.stringify({ totalEntries, errorCount, logFiles: logFiles.length })})
      `;

      log.info({ totalEntries, errorCount, healthScore, patterns: Object.keys(errorPatterns).length }, "log analysis complete");
    } catch (err) {
      log.error({ err }, "log collection failed");
    }
  },
};
