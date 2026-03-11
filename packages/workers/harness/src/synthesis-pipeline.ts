import { scoreSuggestions, deduplicateSuggestions } from "./suggestion-scorer.js";

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV_HARNESS: KVNamespace;
  XAI_API_KEY: string;
}

export async function runSynthesisPipeline(env: Env): Promise<void> {
  const cycleId = `cycle_${Date.now()}`;
  const startedAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO synthesis_cycles (id, started_at, stages_completed) VALUES (?, ?, ?)",
  )
    .bind(cycleId, startedAt, "[]")
    .run();

  const stagesCompleted: string[] = [];

  try {
    // S1: Collect signals since last cycle
    const lastCycle = await env.DB.prepare(
      "SELECT completed_at FROM synthesis_cycles WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
    ).first<{ completed_at: string }>();

    const since = lastCycle?.completed_at ?? new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const signals = await env.DB.prepare(
      "SELECT * FROM signals WHERE captured_at > ? AND processed = 0 ORDER BY relevance_score DESC LIMIT 100",
    )
      .bind(since)
      .all();

    stagesCompleted.push("S1_collect");

    if (!signals.results?.length) {
      await completeCycle(env, cycleId, stagesCompleted, 0, 0, 0);
      return;
    }

    // S2: Get latest log analysis
    const logAnalysis = await env.DB.prepare(
      "SELECT * FROM log_analysis_cache ORDER BY analysis_timestamp DESC LIMIT 1",
    ).first();

    stagesCompleted.push("S2_analyze");

    // S3: Grok research on signal clusters
    const signalSummary = signals.results
      .slice(0, 20)
      .map((s: Record<string, unknown>) => `[${s.source}] ${s.content}`)
      .join("\n");

    let grokFindings = "";
    if (env.XAI_API_KEY) {
      try {
        const res = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.XAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "grok-3",
            max_tokens: 4096,
            temperature: 0.2,
            messages: [
              {
                role: "user",
                content: `You are analyzing signals collected from X.com, technical blogs, and agent logs for an AI agent infrastructure system.

SIGNALS:
${signalSummary}

LOG ANALYSIS:
${logAnalysis ? JSON.stringify(logAnalysis) : "No recent log analysis available"}

Based on these signals, identify actionable improvement suggestions for the system. For each suggestion, provide:
- title, category (prompt_improvement|config_change|architecture_change|capability_gap|tool_upgrade), description, evidence, impact_score (1-10), confidence_score (1-10), risk_score (1-10), effort_hours, proposed_change, deployment_steps[], files_affected[]

Return a JSON array of suggestions. JSON only, no fences.`,
              },
            ],
          }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          grokFindings = data.choices?.[0]?.message?.content ?? "";
        }
      } catch {
        // Continue without Grok research
      }
    }

    stagesCompleted.push("S3_research");

    // S4: Score suggestions
    let rawSuggestions: Array<{
      title: string;
      category: string;
      description: string;
      evidence: string;
      evidence_links?: string[];
      impact_score: number;
      confidence_score: number;
      risk_score?: number;
      effort_hours: number;
      proposed_change?: string;
      deployment_steps?: string[];
      files_affected?: string[];
    }> = [];
    if (grokFindings) {
      try {
        let cleaned = grokFindings.trim();
        if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
        else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
        if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
        cleaned = cleaned.trim().replace(/,\s*([}\]])/g, "$1");
        rawSuggestions = JSON.parse(cleaned);
      } catch {
        // No parseable suggestions
      }
    }

    const scored = scoreSuggestions(rawSuggestions);
    const deduped = deduplicateSuggestions(scored);

    stagesCompleted.push("S4_score");

    // S5: Store suggestions in D1
    let stored = 0;
    for (const s of deduped) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO harness_suggestions
        (id, created_at, suggestion_type, title, rationale, evidence, evidence_links, impact_score, confidence_score, risk_score, effort_hours, composite_rank, proposed_change, deployment_steps, files_affected, requires_human_review, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          s.id,
          new Date().toISOString(),
          s.category,
          s.title,
          s.description,
          s.evidence,
          JSON.stringify(s.evidence_links ?? []),
          s.impact_score,
          s.confidence_score,
          s.risk_score ?? 0,
          s.effort_hours,
          s.composite_rank,
          s.proposed_change ?? null,
          JSON.stringify(s.deployment_steps ?? []),
          JSON.stringify(s.files_affected ?? []),
          s.requires_human_review ? 1 : 0,
          s.auto_deployable ? "approved" : "pending",
        )
        .run();
      stored++;
    }

    stagesCompleted.push("S5_rank");

    // S6: Mark signals as processed
    for (const sig of signals.results) {
      await env.DB.prepare("UPDATE signals SET processed = 1 WHERE id = ?")
        .bind(sig.id as string)
        .run();
    }

    stagesCompleted.push("S6_deploy");

    await completeCycle(
      env,
      cycleId,
      stagesCompleted,
      signals.results.length,
      stored,
      deduped.filter((s) => s.auto_deployable).length,
    );
  } catch (err) {
    await env.DB.prepare(
      "UPDATE synthesis_cycles SET completed_at = ?, error = ?, stages_completed = ? WHERE id = ?",
    )
      .bind(
        new Date().toISOString(),
        err instanceof Error ? err.message : String(err),
        JSON.stringify(stagesCompleted),
        cycleId,
      )
      .run();
  }
}

async function completeCycle(
  env: Env,
  cycleId: string,
  stages: string[],
  signalsProcessed: number,
  suggestionsGenerated: number,
  suggestionsDeployed: number,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE synthesis_cycles SET completed_at = ?, signals_processed = ?, suggestions_generated = ?, suggestions_deployed = ?, stages_completed = ? WHERE id = ?",
  )
    .bind(
      new Date().toISOString(),
      signalsProcessed,
      suggestionsGenerated,
      suggestionsDeployed,
      JSON.stringify(stages),
      cycleId,
    )
    .run();
}
