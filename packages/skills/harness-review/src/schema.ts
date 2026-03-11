import { z } from "zod";

// ── Input Schema ──

export const HarnessReviewInputSchema = z.object({
  log_path: z.string().min(1),
  repo_path: z.string().min(1),
  log_window_hours: z.number().int().min(1).default(24),
  focus: z.enum(["logs_only", "codebase_only", "both"]).default("both"),
  suggestion_types: z
    .array(
      z.enum([
        "capability_gap",
        "architecture_change",
        "prompt_improvement",
        "tool_upgrade",
        "workflow_fix",
      ]),
    )
    .default([
      "capability_gap",
      "architecture_change",
      "prompt_improvement",
      "tool_upgrade",
      "workflow_fix",
    ]),
  max_suggestions: z.number().int().min(1).max(20).default(5),
  raw_log_sample: z.string().optional(),
});

// ── Output Schemas ──

export const TopErrorSchema = z.object({
  tool: z.string(),
  error: z.string(),
  count: z.number(),
});

export const HealthSchema = z.object({
  overall_score: z.number().min(1).max(10),
  trend: z.enum(["improving", "stable", "degrading", "unknown"]),
  most_urgent_issue: z.string(),
  error_rate_pct: z.number(),
  avg_iterations: z.number(),
  top_errors: z.array(TopErrorSchema),
});

export const ReviewSuggestionSchema = z.object({
  id: z.string(),
  category: z.enum([
    "capability_gap",
    "architecture_change",
    "prompt_improvement",
    "tool_upgrade",
    "workflow_fix",
  ]),
  title: z.string(),
  description: z.string(),
  evidence: z.array(z.string()),
  priority: z.enum(["critical", "high", "medium", "low"]),
  effort_hours: z.number(),
  expected_impact: z.string(),
  implementation_hint: z.string().optional(),
  source_stage: z.enum(["log_analysis", "codebase_scan", "synthesis"]),
  created_at: z.string(),
});

export const WeakSignalSchema = z.object({
  observation: z.string(),
  why_not_suggested: z.string(),
});

export const DataQualitySchema = z.object({
  logs_normalised: z.boolean(),
  log_coverage: z.string(),
  codebase_coverage: z.string(),
  warnings: z.array(z.string()),
});

export const HarnessReviewOutputSchema = z.object({
  review_id: z.string(),
  reviewed_at: z.string(),
  log_window_hours: z.number(),
  log_events_read: z.number(),
  files_read: z.array(z.string()),
  health: HealthSchema,
  suggestions: z.array(ReviewSuggestionSchema),
  weak_signals: z.array(WeakSignalSchema),
  data_quality: DataQualitySchema,
});

// ── MCP Tool Definition ──

export const TOOL_DEFINITION = {
  name: "harness_review",
  description:
    "Performs a comprehensive review of agent harness health by analyzing runtime logs and codebase quality. " +
    "Cross-references error patterns, retry hotspots, and duration outliers from logs with code-level findings " +
    "(outdated patterns, missing error handling, hardcoded values, security issues). " +
    "Returns prioritised improvement suggestions with composite scoring.",
  inputSchema: {
    type: "object" as const,
    required: ["log_path", "repo_path"],
    properties: {
      log_path: {
        type: "string",
        description:
          "Path to the JSONL log file to analyze. Each line should be a JSON object with at minimum a timestamp and message field.",
      },
      repo_path: {
        type: "string",
        description:
          "Path to the repository root to scan for codebase quality issues.",
      },
      log_window_hours: {
        type: "integer",
        default: 24,
        description:
          "How many hours of logs to include in analysis. Only log entries within this window are processed.",
      },
      focus: {
        type: "string",
        enum: ["logs_only", "codebase_only", "both"],
        default: "both",
        description:
          "Which analysis stages to run. 'logs_only' skips codebase scan, 'codebase_only' skips log analysis, 'both' runs all stages.",
      },
      suggestion_types: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "capability_gap",
            "architecture_change",
            "prompt_improvement",
            "tool_upgrade",
            "workflow_fix",
          ],
        },
        default: [
          "capability_gap",
          "architecture_change",
          "prompt_improvement",
          "tool_upgrade",
          "workflow_fix",
        ],
        description:
          "Which categories of suggestions to generate. Limits output to requested types only.",
      },
      max_suggestions: {
        type: "integer",
        default: 5,
        description:
          "Maximum number of suggestions to return. Suggestions are ranked by composite score.",
      },
      raw_log_sample: {
        type: "string",
        description:
          "Optional. Raw log text to analyze instead of reading from log_path. Useful for piping in a subset of logs directly.",
      },
    },
  },
};
