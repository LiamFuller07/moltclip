import { describe, it, expect } from "vitest";
import { scoreSuggestions, deduplicateSuggestions } from "../suggestion-scorer.js";

function makeSuggestion(overrides: Record<string, unknown> = {}) {
  return {
    title: "Improve error handling",
    category: "prompt_improvement",
    description: "Add better error messages",
    evidence: "Logs show 15% error rate",
    impact_score: 7,
    confidence_score: 8,
    effort_hours: 4,
    ...overrides,
  };
}

describe("scoreSuggestions", () => {
  it("returns scored suggestions with required fields", () => {
    const input = [makeSuggestion()];
    const result = scoreSuggestions(input);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("composite_rank");
    expect(result[0]).toHaveProperty("requires_human_review");
    expect(result[0]).toHaveProperty("auto_deployable");
    expect(result[0].id).toMatch(/^sug_/);
  });

  describe("composite scoring formula", () => {
    it("scores higher impact suggestions higher", () => {
      const suggestions = [
        makeSuggestion({ title: "low impact", impact_score: 2, confidence_score: 5 }),
        makeSuggestion({ title: "high impact", impact_score: 9, confidence_score: 5 }),
      ];

      const scored = scoreSuggestions(suggestions);
      // Sorted by composite_rank descending
      expect(scored[0].title).toBe("high impact");
      expect(scored[0].composite_rank).toBeGreaterThan(scored[1].composite_rank);
    });

    it("weights confidence at 0.3", () => {
      const base = makeSuggestion({ impact_score: 5, effort_hours: 1 });
      const high = makeSuggestion({ impact_score: 5, effort_hours: 1, confidence_score: 10 });
      const low = makeSuggestion({ impact_score: 5, effort_hours: 1, confidence_score: 1 });

      const [scoredHigh] = scoreSuggestions([high]);
      const [scoredLow] = scoreSuggestions([low]);

      // Confidence difference of 9 * 0.3 = 2.7 points difference
      const diff = scoredHigh.composite_rank - scoredLow.composite_rank;
      expect(diff).toBeCloseTo(2.7, 1);
    });

    it("gives bonus for low effort (inverse)", () => {
      const quickFix = makeSuggestion({ title: "quick", effort_hours: 0.5 });
      const bigProject = makeSuggestion({ title: "big", effort_hours: 100 });

      const [scoredQuick] = scoreSuggestions([quickFix]);
      const [scoredBig] = scoreSuggestions([bigProject]);

      expect(scoredQuick.composite_rank).toBeGreaterThan(scoredBig.composite_rank);
    });

    it("applies risk penalty", () => {
      const safe = makeSuggestion({ title: "safe", risk_score: 0 });
      const risky = makeSuggestion({ title: "risky", risk_score: 10 });

      const [scoredSafe] = scoreSuggestions([safe]);
      const [scoredRisky] = scoreSuggestions([risky]);

      // Risk penalty = risk_score * 0.1
      // Difference should be 10 * 0.1 = 1.0
      expect(scoredSafe.composite_rank).toBeGreaterThan(scoredRisky.composite_rank);
      const diff = scoredSafe.composite_rank - scoredRisky.composite_rank;
      expect(diff).toBeCloseTo(1.0, 1);
    });

    it("handles zero effort_hours (treats as 1)", () => {
      const suggestion = makeSuggestion({ effort_hours: 0 });
      const scored = scoreSuggestions([suggestion]);
      // effortInverse = 1 when effort_hours is 0
      expect(scored[0].composite_rank).toBeGreaterThan(0);
    });

    it("defaults risk_score to 0 when not provided", () => {
      const withoutRisk = makeSuggestion();
      delete (withoutRisk as any).risk_score;

      const withZeroRisk = makeSuggestion({ risk_score: 0 });

      const [scoredWithout] = scoreSuggestions([withoutRisk]);
      const [scoredWithZero] = scoreSuggestions([withZeroRisk]);

      expect(scoredWithout.composite_rank).toBeCloseTo(scoredWithZero.composite_rank, 2);
    });
  });

  describe("sorting", () => {
    it("sorts by composite_rank descending", () => {
      const suggestions = [
        makeSuggestion({ title: "low", impact_score: 1, confidence_score: 1 }),
        makeSuggestion({ title: "high", impact_score: 10, confidence_score: 10 }),
        makeSuggestion({ title: "mid", impact_score: 5, confidence_score: 5 }),
      ];

      const scored = scoreSuggestions(suggestions);
      expect(scored[0].title).toBe("high");
      expect(scored[scored.length - 1].title).toBe("low");

      for (let i = 1; i < scored.length; i++) {
        expect(scored[i - 1].composite_rank).toBeGreaterThanOrEqual(scored[i].composite_rank);
      }
    });
  });

  describe("auto_deployable categorization", () => {
    it("marks prompt_improvement with high confidence as auto-deployable", () => {
      const suggestion = makeSuggestion({
        category: "prompt_improvement",
        confidence_score: 8,
        risk_score: 1,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(true);
    });

    it("marks config_change with high confidence as auto-deployable", () => {
      const suggestion = makeSuggestion({
        category: "config_change",
        confidence_score: 9,
        risk_score: 2,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(true);
    });

    it("rejects auto-deploy when confidence is below 7", () => {
      const suggestion = makeSuggestion({
        category: "prompt_improvement",
        confidence_score: 6,
        risk_score: 1,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(false);
    });

    it("rejects auto-deploy when risk is above 3", () => {
      const suggestion = makeSuggestion({
        category: "prompt_improvement",
        confidence_score: 9,
        risk_score: 4,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(false);
    });

    it("rejects auto-deploy for architecture_change category", () => {
      const suggestion = makeSuggestion({
        category: "architecture_change",
        confidence_score: 10,
        risk_score: 0,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(false);
    });

    it("rejects auto-deploy for capability_gap category", () => {
      const suggestion = makeSuggestion({
        category: "capability_gap",
        confidence_score: 10,
        risk_score: 0,
      });

      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.auto_deployable).toBe(false);
    });
  });

  describe("requires_human_review", () => {
    it("requires human review for architecture_change", () => {
      const suggestion = makeSuggestion({ category: "architecture_change" });
      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.requires_human_review).toBe(true);
    });

    it("requires human review for capability_gap", () => {
      const suggestion = makeSuggestion({ category: "capability_gap" });
      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.requires_human_review).toBe(true);
    });

    it("does not require human review for prompt_improvement", () => {
      const suggestion = makeSuggestion({ category: "prompt_improvement" });
      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.requires_human_review).toBe(false);
    });

    it("does not require human review for tool_upgrade", () => {
      const suggestion = makeSuggestion({ category: "tool_upgrade" });
      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.requires_human_review).toBe(false);
    });

    it("does not require human review for workflow_fix", () => {
      const suggestion = makeSuggestion({ category: "workflow_fix" });
      const [scored] = scoreSuggestions([suggestion]);
      expect(scored.requires_human_review).toBe(false);
    });
  });

  describe("ID generation", () => {
    it("generates unique IDs with index suffix", () => {
      const suggestions = [
        makeSuggestion({ title: "first" }),
        makeSuggestion({ title: "second" }),
      ];

      const scored = scoreSuggestions(suggestions);
      const ids = scored.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length); // All unique
      ids.forEach((id) => expect(id).toMatch(/^sug_\d+_\d+$/));
    });
  });
});

describe("deduplicateSuggestions", () => {
  it("removes duplicate suggestions by category + title", () => {
    const scored = scoreSuggestions([
      makeSuggestion({ title: "Same Title", category: "prompt_improvement" }),
      makeSuggestion({ title: "Same Title", category: "prompt_improvement" }),
      makeSuggestion({ title: "Different Title", category: "prompt_improvement" }),
    ]);

    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(2);
  });

  it("keeps suggestions with same title but different category", () => {
    const scored = scoreSuggestions([
      makeSuggestion({ title: "Improve caching", category: "prompt_improvement" }),
      makeSuggestion({ title: "Improve caching", category: "architecture_change" }),
    ]);

    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(2);
  });

  it("is case-insensitive for title comparison", () => {
    const scored = scoreSuggestions([
      makeSuggestion({ title: "Add Caching", category: "tool_upgrade" }),
      makeSuggestion({ title: "add caching", category: "tool_upgrade" }),
      makeSuggestion({ title: "ADD CACHING", category: "tool_upgrade" }),
    ]);

    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(1);
  });

  it("trims whitespace in title comparison", () => {
    const scored = scoreSuggestions([
      makeSuggestion({ title: "  Add Caching  ", category: "tool_upgrade" }),
      makeSuggestion({ title: "Add Caching", category: "tool_upgrade" }),
    ]);

    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(1);
  });

  it("preserves order (first occurrence wins)", () => {
    const scored = scoreSuggestions([
      makeSuggestion({ title: "Alpha", category: "prompt_improvement", impact_score: 10 }),
      makeSuggestion({ title: "Alpha", category: "prompt_improvement", impact_score: 1 }),
    ]);

    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(1);
    // scoreSuggestions sorts by score, so the higher-scored one should be first
    expect(deduped[0].impact_score).toBe(10);
  });

  it("returns empty array for empty input", () => {
    const deduped = deduplicateSuggestions([]);
    expect(deduped).toEqual([]);
  });

  it("returns single item for single input", () => {
    const scored = scoreSuggestions([makeSuggestion()]);
    const deduped = deduplicateSuggestions(scored);
    expect(deduped).toHaveLength(1);
  });
});
