import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedLogEntry } from "../readers/log-reader.js";
import { loadTemplate } from "../template-loader.js";
import { parseClaudeJson } from "../validators.js";

export interface LogAnalysisResult {
  error_patterns: { error: string; tool: string; count: number; first_seen: string; last_seen: string }[];
  retry_hotspots: { operation: string; retry_count: number; eventual_success: boolean }[];
  duration_outliers: { operation: string; avg_ms: number; max_ms: number; p95_ms: number }[];
  blockade_patterns: { operation: string; error: string; consecutive_failures: number }[];
  capability_gaps: { attempted_task: string; reason: string }[];
  overall_health_score: number;
  most_urgent_issue: string;
  error_rate_pct: number;
}

/**
 * Analyze normalized log entries using Claude to detect error patterns,
 * retry hotspots, duration outliers, and overall health.
 */
export async function analyseLogs(
  logs: NormalizedLogEntry[],
  windowHours: number,
): Promise<LogAnalysisResult> {
  const client = new Anthropic();

  const logsJsonl = logs
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  const prompt = await loadTemplate("log-analysis.md", {
    event_count: String(logs.length),
    log_window_hours: String(windowHours),
    logs_jsonl: logsJsonl,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseClaudeJson<LogAnalysisResult>(text);
}
