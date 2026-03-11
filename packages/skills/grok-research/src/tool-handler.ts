import type { GrokResearchResult } from "@moltclip/shared";
import { GrokResearchInputSchema, GrokResearchResultSchema } from "./schema.js";
import { loadTemplate, modeToTemplate } from "./template-loader.js";
import { callGrok } from "./grok-client.js";
import { safeParseGrokResponse } from "./validators.js";

export async function handleGrokResearch(
  args: Record<string, unknown>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  // Validate input
  const parseResult = GrokResearchInputSchema.safeParse(args);
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
  const templateFile = modeToTemplate(input.mode);

  // Build template variables
  const outputSchema = JSON.stringify(
    GrokResearchResultSchema.shape,
    null,
    2,
  );
  const variables: Record<string, string> = {
    query: input.query,
    domain: input.domain ?? "enterprise software / ERP / B2B SaaS",
    max_results: String(input.max_results),
    OUTPUT_SCHEMA: outputSchema,
  };

  // For weakness/synthesis/tool_discovery, parse context into sub-variables
  if (input.context) {
    try {
      const ctx = JSON.parse(input.context);
      for (const [key, value] of Object.entries(ctx)) {
        variables[`context.${key}`] = typeof value === "string" ? value : JSON.stringify(value);
      }
    } catch {
      variables["context"] = input.context;
    }
  }

  try {
    // Load and populate prompt template
    const prompt = await loadTemplate(templateFile, variables);

    // Call Grok API
    const grokResult = await callGrok(prompt);

    // Parse and validate response
    const { result, error } = safeParseGrokResponse(grokResult.content, {
      query: input.query,
      mode: input.mode,
      model: grokResult.model,
    });

    if (!result) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "MALFORMED_RESPONSE",
              message: error,
              raw_preview: grokResult.content.slice(0, 500),
            }),
          },
        ],
      };
    }

    // Ensure meta is populated with actual call data
    result.meta.tokens_used = grokResult.tokens_used;
    result.meta.model = grokResult.model;
    result.meta.timestamp = new Date().toISOString();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
