import { z } from "zod";

export const GrokResearchInputSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["cold", "weakness", "synthesis", "tool_discovery"]).default("cold"),
  context: z.string().optional(),
  domain: z.string().optional(),
  max_results: z.number().int().min(1).max(20).default(8),
});

export const GrokSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  summary: z.string(),
  relevance_score: z.number().min(1).max(10),
});

export const GrokSentimentSchema = z.object({
  label: z.enum(["positive", "negative", "neutral", "mixed"]),
  summary: z.string(),
  signals: z.array(z.string()),
});

export const GrokImprovementIdeaSchema = z.object({
  idea: z.string(),
  rationale: z.string(),
  code_snippet: z.string().optional(),
});

export const GrokUpgradePlanSchema = z.object({
  summary: z.string(),
  steps: z.array(z.string()),
  expected_score: z.number().min(1).max(10),
});

export const ToolDiscoverySchema = z.object({
  tool_name: z.string(),
  url: z.string(),
  description: z.string(),
  integration_effort: z.enum(["low", "medium", "high"]),
  relevance: z.number().min(0).max(10),
});

export const GrokMetaSchema = z.object({
  query: z.string(),
  mode: z.string(),
  model: z.string(),
  tokens_used: z.number(),
  timestamp: z.string(),
  confidence: z.number().min(1).max(10),
});

export const GrokResearchResultSchema = z.object({
  findings: z.array(z.string()),
  sources: z.array(GrokSourceSchema),
  sentiment: GrokSentimentSchema,
  improvement_ideas: z.array(GrokImprovementIdeaSchema).optional(),
  upgrade_plan: GrokUpgradePlanSchema.optional(),
  tool_discoveries: z.array(ToolDiscoverySchema).optional(),
  meta: GrokMetaSchema,
});

export const TOOL_DEFINITION = {
  name: "grok_research",
  description:
    "Performs live research using the Grok API (real-time X + web access). " +
    "Returns structured findings, links, sentiment, and improvement ideas. " +
    "Use for: current market intelligence, competitor activity, live tooling data, " +
    "or when Claude training data is insufficient for the task at hand.",
  inputSchema: {
    type: "object" as const,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description:
          "The core research question. Be specific. Include domain context.",
      },
      mode: {
        type: "string",
        enum: ["cold", "weakness", "synthesis", "tool_discovery"],
        default: "cold",
        description:
          "cold = fresh research. weakness = targeted gap research. " +
          "synthesis = combine prior output into upgrade plan. " +
          "tool_discovery = find tools that solve a specific blockade.",
      },
      context: {
        type: "string",
        description:
          "Optional. Prior research output, weak areas, or Firecrawl results. " +
          "Required when mode=weakness or synthesis.",
      },
      domain: {
        type: "string",
        description: "Optional domain hint to focus research.",
      },
      max_results: {
        type: "integer",
        default: 8,
        description: "Target number of links/sources to return. 5-15 recommended.",
      },
    },
  },
};
