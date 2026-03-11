import OpenAI from "openai";
import type { GrokResearchResult, SelfReviewOutput } from "@moltclip/shared";
import {
  GROK_API_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_MAX_TOKENS,
  GROK_TEMPERATURE,
  FIRECRAWL_API_BASE_URL,
} from "@moltclip/shared";
import { SelfReviewInputSchema } from "./schema.js";
import { scoreOutput } from "./reviewer.js";
import { createLoopState, shouldContinue, recordImprovement } from "./loop-controller.js";

function text(str: string) {
  return { content: [{ type: "text" as const, text: str }] };
}

function errorResult(error: string, message: string) {
  return { isError: true as const, ...text(JSON.stringify({ error, message })) };
}

export async function handleSelfReview(
  args: Record<string, unknown>,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const parseResult = SelfReviewInputSchema.safeParse(args);
  if (!parseResult.success) {
    return errorResult("INVALID_INPUT", parseResult.error.message);
  }

  const input = parseResult.data;
  const state = createLoopState(input.max_iterations);

  try {
    // Step 1: Initial review
    const review = await scoreOutput(
      input.output_text,
      input.task_description,
      input.rubric_dimensions,
    );

    if (!shouldContinue(state, review.overall_score)) {
      // Score meets threshold or max iterations
      const output: SelfReviewOutput = {
        final_score: review.overall_score,
        dimension_scores: review.dimension_scores,
        iterations_run: state.iteration,
        improvements_applied: [],
        upgrade_plan: null,
      };
      return text(JSON.stringify(output));
    }

    // Step 2: Grok weakness research
    const grok = new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: GROK_API_BASE_URL,
    });

    const weaknessPrompt = buildWeaknessPrompt(
      input.task_description,
      input.output_text,
      review.feedback,
      review.weak_areas,
      input.domain,
    );

    const weaknessRes = await grok.chat.completions.create({
      model: GROK_DEFAULT_MODEL,
      max_tokens: GROK_MAX_TOKENS,
      temperature: GROK_TEMPERATURE,
      messages: [{ role: "user", content: weaknessPrompt }],
    });

    const weaknessContent = weaknessRes.choices[0]?.message?.content ?? "{}";
    let grokResult: Partial<GrokResearchResult>;
    try {
      let cleaned = weaknessContent.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim().replace(/,\s*([}\]])/g, "$1");
      grokResult = JSON.parse(cleaned);
    } catch {
      grokResult = { findings: [weaknessContent] };
    }

    recordImprovement(state, "Grok weakness research completed");

    // Step 3: Firecrawl top sources (if available)
    let firecrawlContent = "";
    const sources = grokResult.sources ?? [];
    if (sources.length > 0 && process.env.FIRECRAWL_API_KEY) {
      const topUrls = sources.slice(0, 3).map((s) => s.url);
      const crawled = await crawlUrls(topUrls);
      firecrawlContent = crawled;
      recordImprovement(state, `Firecrawl crawled ${topUrls.length} sources`);
    }

    // Step 4: Grok synthesis
    const synthesisPrompt = buildSynthesisPrompt(
      input.task_description,
      review.weak_areas,
      weaknessContent,
      firecrawlContent,
    );

    const synthesisRes = await grok.chat.completions.create({
      model: GROK_DEFAULT_MODEL,
      max_tokens: GROK_MAX_TOKENS,
      temperature: GROK_TEMPERATURE,
      messages: [{ role: "user", content: synthesisPrompt }],
    });

    const synthesisContent = synthesisRes.choices[0]?.message?.content ?? "{}";
    let synthesisResult: Partial<GrokResearchResult>;
    try {
      let cleaned = synthesisContent.trim();
      if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
      else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
      if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
      cleaned = cleaned.trim().replace(/,\s*([}\]])/g, "$1");
      synthesisResult = JSON.parse(cleaned);
    } catch {
      synthesisResult = {};
    }

    recordImprovement(state, "Synthesis complete");

    const output: SelfReviewOutput = {
      final_score: review.overall_score,
      dimension_scores: review.dimension_scores,
      iterations_run: state.iteration,
      improvements_applied: state.improvements,
      upgrade_plan: synthesisResult.upgrade_plan ?? null,
    };

    return text(JSON.stringify(output));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("INTERNAL_ERROR", message);
  }
}

async function crawlUrls(urls: string[]): Promise<string> {
  const results: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(`${FIRECRAWL_API_BASE_URL}/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"] }),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { markdown?: string } };
        if (data.data?.markdown) {
          results.push(`--- ${url} ---\n${data.data.markdown.slice(0, 5000)}`);
        }
      }
    } catch {
      // Skip failed crawls
    }
  }
  return results.join("\n\n");
}

function buildWeaknessPrompt(
  task: string,
  output: string,
  feedback: string,
  weakAreas: string,
  domain?: string,
): string {
  return `You are in TARGETED WEAKNESS RESEARCH MODE with real-time X and web access.

ORIGINAL TASK: ${task}
DOMAIN: ${domain ?? "enterprise software / B2B SaaS"}

CURRENT OUTPUT (excerpt):
${output.slice(0, 3000)}

REVIEWER FEEDBACK:
${feedback}

WEAK AREAS:
${weakAreas}

Research what is needed to close these gaps. Find current tools, patterns, and approaches.
Return JSON with: findings[], sources[], sentiment, improvement_ideas[] (at least 3).
JSON only, no markdown fences.`;
}

function buildSynthesisPrompt(
  task: string,
  weakAreas: string,
  priorResearch: string,
  firecrawlData: string,
): string {
  return `You are in IMPROVEMENT SYNTHESIS MODE.

TASK + WEAK AREAS:
${task}
${weakAreas}

PRIOR RESEARCH:
${priorResearch.slice(0, 4000)}

CRAWLED PAGE DATA:
${firecrawlData.slice(0, 6000)}

Synthesise into a concrete upgrade_plan with ranked steps.
Return JSON with: findings[], sources[], sentiment, upgrade_plan { summary, steps[], expected_score }.
JSON only, no markdown fences.`;
}
