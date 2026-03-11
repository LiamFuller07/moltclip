import { z } from "zod";

export const ReviewDimensionSchema = z.object({
  name: z.string(),
  description: z.string(),
  weight: z.number().min(0).max(1),
});

export const SelfReviewInputSchema = z.object({
  output_text: z.string().min(1),
  task_description: z.string().min(1),
  rubric_dimensions: z
    .array(ReviewDimensionSchema)
    .optional()
    .default([
      { name: "accuracy", description: "Factual correctness and precision", weight: 0.3 },
      { name: "completeness", description: "Coverage of all requirements", weight: 0.25 },
      { name: "clarity", description: "Clear, well-structured communication", weight: 0.2 },
      { name: "actionability", description: "Specific, implementable recommendations", weight: 0.15 },
      { name: "innovation", description: "Novel approaches and current best practices", weight: 0.1 },
    ]),
  max_iterations: z.number().int().min(1).max(5).default(3),
  domain: z.string().optional(),
});

export const TOOL_DEFINITION = {
  name: "run_self_review_and_iterate",
  description:
    "Reviews agent output against a scoring rubric, then iteratively improves it " +
    "using Grok real-time research and Firecrawl content extraction. " +
    "Returns upgrade plan when score is below threshold, or confirms quality when above.",
  inputSchema: {
    type: "object" as const,
    required: ["output_text", "task_description"],
    properties: {
      output_text: {
        type: "string",
        description: "The agent output to review and potentially improve.",
      },
      task_description: {
        type: "string",
        description: "The original task the output was generated for.",
      },
      rubric_dimensions: {
        type: "array",
        description: "Optional custom scoring dimensions. Defaults to accuracy/completeness/clarity/actionability/innovation.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            weight: { type: "number" },
          },
        },
      },
      max_iterations: {
        type: "integer",
        default: 3,
        description: "Maximum improvement iterations before returning. 1-5.",
      },
      domain: {
        type: "string",
        description: "Optional domain context for research (e.g., 'ERP migration').",
      },
    },
  },
};
