import pino from "pino";
import { env } from "../env.js";
import { sql } from "../db.js";
import OpenAI from "openai";

const log = pino({ name: "synthesis" });

export const synthesisPipeline = {
  async run(): Promise<void> {
    const cycleId = `cycle_${crypto.randomUUID().slice(0, 12)}`;

    await sql`INSERT INTO synthesis_cycles (id) VALUES (${cycleId})`;
    log.info({ cycleId }, "synthesis pipeline started");

    try {
      // S1: Collect signals since last cycle
      const [lastCycle] = await sql`
        SELECT completed_at FROM synthesis_cycles WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1
      `;
      const since = lastCycle?.completed_at || new Date(Date.now() - 24 * 60 * 60 * 1000);

      const signals = await sql`
        SELECT * FROM signals WHERE captured_at > ${since} AND relevance_score > 0.4
        ORDER BY relevance_score DESC LIMIT 50
      `;

      if (signals.length === 0) {
        log.info("no new signals, skipping synthesis");
        await sql`UPDATE synthesis_cycles SET status = 'completed', completed_at = NOW(), signals_processed = 0 WHERE id = ${cycleId}`;
        return;
      }

      // S2-S3: Analyze signals with Grok (if available)
      let analysisText = signals.map((s: any) => `[${s.source}] ${s.content} (score: ${s.relevance_score})`).join("\n");

      if (env.xaiApiKey) {
        try {
          const grok = new OpenAI({ apiKey: env.xaiApiKey, baseURL: "https://api.x.ai/v1" });
          const res = await grok.chat.completions.create({
            model: "grok-3-mini",
            messages: [
              { role: "system", content: "Analyze these signals and identify actionable improvement suggestions for an AI agent infrastructure. Return JSON array of suggestions with title, rationale, impact (0-1), confidence (0-1), type (prompt_improvement|tool_addition|architecture|config_change)." },
              { role: "user", content: analysisText },
            ],
          });
          analysisText = res.choices[0]?.message?.content || analysisText;
        } catch (err) {
          log.warn({ err }, "Grok analysis failed, using raw signals");
        }
      }

      // S4-S5: Score and rank suggestions
      let suggestions: any[] = [];
      try {
        const parsed = JSON.parse(analysisText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
        suggestions = Array.isArray(parsed) ? parsed : [];
      } catch {
        log.warn("Could not parse suggestions from analysis");
      }

      // S6: Store suggestions
      let generated = 0;
      for (const sug of suggestions.slice(0, 10)) {
        const id = `sug_${crypto.randomUUID().slice(0, 12)}`;
        const composite = ((sug.impact || 0) * 0.6) + ((sug.confidence || 0) * 0.3) + 0.1;

        await sql`
          INSERT INTO harness_suggestions (id, type, title, rationale, impact, confidence, composite_rank)
          VALUES (${id}, ${sug.type || "config_change"}, ${sug.title || "Untitled"}, ${sug.rationale || ""}, ${sug.impact || 0}, ${sug.confidence || 0}, ${composite})
        `;
        generated++;
      }

      await sql`
        UPDATE synthesis_cycles
        SET status = 'completed', completed_at = NOW(), signals_processed = ${signals.length}, suggestions_generated = ${generated}
        WHERE id = ${cycleId}
      `;
      log.info({ cycleId, signals: signals.length, suggestions: generated }, "synthesis complete");
    } catch (err) {
      log.error({ err, cycleId }, "synthesis failed");
      await sql`UPDATE synthesis_cycles SET status = 'failed', completed_at = NOW() WHERE id = ${cycleId}`;
    }
  },
};
