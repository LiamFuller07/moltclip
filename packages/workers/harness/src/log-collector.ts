interface Env {
  DB: D1Database;
  R2: R2Bucket;
}

export async function runLogCollector(env: Env): Promise<void> {
  // Collect agent logs from R2 audit paths
  const prefix = "audit/costs/";
  const listed = await env.R2.list({ prefix, limit: 50 });

  let totalEvents = 0;
  const errorPatterns: Record<string, number> = {};

  for (const obj of listed.objects) {
    try {
      const data = await env.R2.get(obj.key);
      if (!data) continue;
      const text = await data.text();

      // Parse JSONL lines
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          totalEvents++;

          // Track error patterns
          if (entry.error || entry.status === "failed") {
            const errorKey = entry.error || entry.model || "unknown";
            errorPatterns[errorKey] = (errorPatterns[errorKey] || 0) + 1;
          }
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Skip inaccessible objects
    }
  }

  // Store analysis result
  if (totalEvents > 0) {
    const analysisId = `logcol_${Date.now()}`;
    const errorRate =
      Object.values(errorPatterns).reduce((a, b) => a + b, 0) / totalEvents;

    // Find most urgent issue
    const topError = Object.entries(errorPatterns).sort(
      ([, a], [, b]) => b - a,
    )[0];

    await env.DB.prepare(
      "INSERT OR REPLACE INTO log_analysis_cache (analysis_id, analysis_timestamp, log_window_hours, total_events, error_patterns, overall_health_score, most_urgent_issue, error_rate_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        analysisId,
        new Date().toISOString(),
        1,
        totalEvents,
        JSON.stringify(errorPatterns),
        errorRate < 0.05 ? 9 : errorRate < 0.15 ? 7 : errorRate < 0.3 ? 5 : 3,
        topError ? `${topError[0]} (${topError[1]} occurrences)` : "None",
        Math.round(errorRate * 100 * 100) / 100,
      )
      .run();

    // Create signal if error rate is concerning
    if (errorRate > 0.1) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO signals (id, source, content, relevance_score, captured_at) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(
          `sig_log_${Date.now()}`,
          "agent_logs",
          `Elevated error rate detected: ${(errorRate * 100).toFixed(1)}% across ${totalEvents} events. Top error: ${topError?.[0] ?? "unknown"}`,
          0.8,
          new Date().toISOString(),
        )
        .run();
    }
  }
}
