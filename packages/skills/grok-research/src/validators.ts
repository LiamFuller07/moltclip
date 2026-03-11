import type { GrokResearchResult } from "@moltclip/shared";
import { GrokResearchResultSchema } from "./schema.js";

/**
 * Parse a raw Grok response string into a validated GrokResearchResult.
 * Handles common malformations: markdown code fences, trailing commas, partial JSON.
 */
export function parseGrokResponse(raw: string): GrokResearchResult {
  const cleaned = cleanJsonString(raw);
  const parsed = JSON.parse(cleaned);
  return GrokResearchResultSchema.parse(parsed);
}

/**
 * Attempt to parse, falling back to a partial result on failure.
 */
export function safeParseGrokResponse(
  raw: string,
  fallbackMeta: { query: string; mode: string; model: string },
): { result: GrokResearchResult | null; error: string | null } {
  try {
    const result = parseGrokResponse(raw);
    return { result, error: null };
  } catch (err) {
    // Try extracting partial data
    try {
      const cleaned = cleanJsonString(raw);
      const partial = JSON.parse(cleaned);
      const result: GrokResearchResult = {
        findings: Array.isArray(partial.findings) ? partial.findings : [],
        sources: Array.isArray(partial.sources) ? partial.sources : [],
        sentiment: partial.sentiment ?? {
          label: "neutral" as const,
          summary: "Unable to parse full sentiment",
          signals: [],
        },
        improvement_ideas: partial.improvement_ideas,
        upgrade_plan: partial.upgrade_plan,
        tool_discoveries: partial.tool_discoveries,
        meta: {
          query: fallbackMeta.query,
          mode: fallbackMeta.mode,
          model: fallbackMeta.model,
          tokens_used: 0,
          timestamp: new Date().toISOString(),
          confidence: 1,
          ...partial.meta,
        },
      };
      return { result, error: `Partial parse: ${(err as Error).message}` };
    } catch {
      return { result: null, error: `Failed to parse Grok response: ${(err as Error).message}` };
    }
  }
}

function cleanJsonString(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences
  if (s.startsWith("```json")) {
    s = s.slice(7);
  } else if (s.startsWith("```")) {
    s = s.slice(3);
  }
  if (s.endsWith("```")) {
    s = s.slice(0, -3);
  }
  s = s.trim();

  // Fix trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}
