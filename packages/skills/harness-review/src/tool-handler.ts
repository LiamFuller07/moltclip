import { randomUUID } from "node:crypto";
import { REVIEW_MAX_LOGS, REVIEW_MAX_FILES } from "@moltclip/shared";
import type { HarnessReviewOutput, SuggestionCategory } from "@moltclip/shared";
import { HarnessReviewInputSchema } from "./schema.js";
import { readLogs } from "./readers/log-reader.js";
import { readCodebase } from "./readers/codebase-reader.js";
import { analyseLogs } from "./stages/log-analyser.js";
import { scanCodebase } from "./stages/codebase-scanner.js";
import { synthesize } from "./stages/synthesiser.js";
import type { LogAnalysisResult } from "./stages/log-analyser.js";
import type { CodebaseFinding } from "./stages/codebase-scanner.js";

type McpResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export async function handleHarnessReview(
  args: Record<string, unknown>,
): Promise<McpResponse> {
  // ── Validate input ──
  const parseResult = HarnessReviewInputSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "INVALID_INPUT",
            message: parseResult.error.message,
          }),
        },
      ],
    };
  }

  const input = parseResult.data;
  const startMs = Date.now();

  let logAnalysis: LogAnalysisResult | null = null;
  let codebaseFindings: CodebaseFinding[] | null = null;
  let logsRead = 0;
  let filesRead: string[] = [];

  try {
    // ── Stage 1: Log Analysis ──
    if (input.focus !== "codebase_only") {
      const logs = await readLogs(
        input.log_path,
        input.log_window_hours,
        REVIEW_MAX_LOGS,
      );
      logsRead = logs.length;

      if (logs.length > 0) {
        logAnalysis = await analyseLogs(logs, input.log_window_hours);
      }
    }

    // ── Stage 2: Codebase Scan ──
    if (input.focus !== "logs_only") {
      const files = await readCodebase(input.repo_path, REVIEW_MAX_FILES);
      filesRead = Array.from(files.keys());

      if (files.size > 0) {
        codebaseFindings = await scanCodebase(files);
      }
    }

    // ── Stage 3: Synthesis ──
    const { suggestions, weak_signals, health, data_quality } =
      await synthesize(
        logAnalysis,
        codebaseFindings,
        input.suggestion_types as SuggestionCategory[],
        input.max_suggestions,
      );

    const durationMs = Date.now() - startMs;

    // ── Assemble output ──
    const output: HarnessReviewOutput = {
      review_id: randomUUID(),
      reviewed_at: new Date().toISOString(),
      log_window_hours: input.log_window_hours,
      log_events_read: logsRead,
      files_read: filesRead,
      health,
      suggestions,
      weak_signals,
      data_quality: {
        ...data_quality,
        warnings: [
          ...data_quality.warnings,
          ...(logsRead === 0 && input.focus !== "codebase_only"
            ? ["No log entries found within the specified time window"]
            : []),
          ...(filesRead.length === 0 && input.focus !== "logs_only"
            ? ["No matching source files found in the repository"]
            : []),
        ],
      },
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(output) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect rate limiting
    if (message.includes("429") || message.includes("rate")) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "RATE_LIMIT",
              message,
              retry_after: 8000,
            }),
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "INTERNAL_ERROR", message }),
        },
      ],
    };
  }
}
