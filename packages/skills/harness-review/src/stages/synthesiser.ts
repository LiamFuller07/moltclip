import Anthropic from "@anthropic-ai/sdk";
import type { HarnessReviewOutput, ReviewSuggestion, SuggestionCategory } from "@moltclip/shared";
import type { LogAnalysisResult } from "./log-analyser.js";
import type { CodebaseFinding } from "./codebase-scanner.js";
import { ReviewSuggestionSchema, WeakSignalSchema } from "../schema.js";
import { loadTemplate } from "../template-loader.js";
import { parseClaudeJson } from "../validators.js";

interface SynthesisRaw {
  suggestions: ReviewSuggestion[];
  weak_signals: { observation: string; why_not_suggested: string }[];
  health: HarnessReviewOutput["health"];
  data_quality: HarnessReviewOutput["data_quality"];
}

/**
 * Cross-reference log analysis and codebase findings to produce
 * ranked ReviewSuggestion[] with composite scoring:
 *   score = (impact * 0.6) + (confidence * 0.3) + (1/effort * 0.1)
 */
export async function synthesize(
  logAnalysis: LogAnalysisResult | null,
  codebaseFindings: CodebaseFinding[] | null,
  suggestionTypes: SuggestionCategory[],
  maxSuggestions: number,
): Promise<{
  suggestions: ReviewSuggestion[];
  weak_signals: HarnessReviewOutput["weak_signals"];
  health: HarnessReviewOutput["health"];
  data_quality: HarnessReviewOutput["data_quality"];
}> {
  const client = new Anthropic();

  const suggestionSchema = JSON.stringify(
    {
      suggestions: "ReviewSuggestion[] — each with id, category, title, description, evidence[], priority, effort_hours, expected_impact, implementation_hint, source_stage, created_at",
      weak_signals: "{ observation, why_not_suggested }[]",
      health: "{ overall_score (1-10), trend, most_urgent_issue, error_rate_pct, avg_iterations, top_errors[] }",
      data_quality: "{ logs_normalised, log_coverage, codebase_coverage, warnings[] }",
    },
    null,
    2,
  );

  const prompt = await loadTemplate("suggestion-synthesis.md", {
    log_window_hours: logAnalysis ? "included" : "skipped",
    log_analysis: logAnalysis ? JSON.stringify(logAnalysis, null, 2) : "(log analysis was skipped)",
    codebase_findings: codebaseFindings
      ? JSON.stringify(codebaseFindings, null, 2)
      : "(codebase scan was skipped)",
    max_suggestions: String(maxSuggestions),
    suggestion_types: suggestionTypes.join(", "),
    REVIEW_SUGGESTION_SCHEMA: suggestionSchema,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const raw = parseClaudeJson<SynthesisRaw>(text);

  // Apply composite scoring and sort
  const scored = raw.suggestions.map((s) => {
    const impact = scoreImpact(s.priority);
    const confidence = findConfidence(s, codebaseFindings);
    const effort = Math.max(s.effort_hours, 0.5); // avoid division by zero
    const compositeScore = impact * 0.6 + confidence * 0.3 + (1 / effort) * 0.1;
    return { suggestion: s, compositeScore };
  });

  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const suggestions = scored.slice(0, maxSuggestions).map((s) => s.suggestion);

  return {
    suggestions,
    weak_signals: raw.weak_signals ?? [],
    health: raw.health ?? {
      overall_score: logAnalysis?.overall_health_score ?? 5,
      trend: "unknown" as const,
      most_urgent_issue: logAnalysis?.most_urgent_issue ?? "Unknown",
      error_rate_pct: logAnalysis?.error_rate_pct ?? 0,
      avg_iterations: 0,
      top_errors: [],
    },
    data_quality: raw.data_quality ?? {
      logs_normalised: true,
      log_coverage: "unknown",
      codebase_coverage: "unknown",
      warnings: [],
    },
  };
}

function scoreImpact(priority: string): number {
  switch (priority) {
    case "critical":
      return 10;
    case "high":
      return 8;
    case "medium":
      return 5;
    case "low":
      return 3;
    default:
      return 5;
  }
}

function findConfidence(
  suggestion: ReviewSuggestion,
  findings: CodebaseFinding[] | null,
): number {
  if (!findings) return 5;

  // If there's a matching codebase finding, use its confidence
  const match = findings.find(
    (f) =>
      suggestion.evidence.some((e) => e.includes(f.file_path)) ||
      (suggestion.implementation_hint ?? "").includes(f.file_path),
  );

  return match?.confidence ?? 5;
}
