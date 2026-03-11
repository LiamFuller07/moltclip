import Anthropic from "@anthropic-ai/sdk";
import type { ReviewDimension } from "@moltclip/shared";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

export interface ReviewResult {
  overall_score: number;
  dimension_scores: Record<string, number>;
  feedback: string;
  weak_areas: string;
}

export async function scoreOutput(
  outputText: string,
  taskDescription: string,
  dimensions: ReviewDimension[],
): Promise<ReviewResult> {
  const rubricPrompt = await loadRubricPrompt();

  const dimensionList = dimensions
    .map((d) => `- ${d.name} (weight ${d.weight}): ${d.description}`)
    .join("\n");

  const prompt = rubricPrompt
    .replace("{{task_description}}", taskDescription)
    .replace("{{output_text}}", outputText)
    .replace("{{dimensions}}", dimensionList);

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Strip markdown fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim().replace(/,\s*([}\]])/g, "$1");

    const parsed = JSON.parse(cleaned);

    // Calculate weighted overall score
    let overall = 0;
    const dimensionScores: Record<string, number> = {};
    for (const dim of dimensions) {
      const score = parsed.dimension_scores?.[dim.name] ?? 5;
      dimensionScores[dim.name] = score;
      overall += score * dim.weight;
    }

    return {
      overall_score: Math.round(overall * 10) / 10,
      dimension_scores: dimensionScores,
      feedback: parsed.feedback ?? "",
      weak_areas: parsed.weak_areas ?? "",
    };
  } catch {
    // Fallback if parsing fails
    return {
      overall_score: 5,
      dimension_scores: {},
      feedback: text,
      weak_areas: "Unable to parse structured review",
    };
  }
}

let rubricCache: string | null = null;

async function loadRubricPrompt(): Promise<string> {
  if (!rubricCache) {
    const filePath = join(__dirname, "..", "prompts", "review-rubric.md");
    rubricCache = await readFile(filePath, "utf-8");
  }
  return rubricCache;
}
