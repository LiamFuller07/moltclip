interface RawSuggestion {
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
}

interface ScoredSuggestion extends RawSuggestion {
  id: string;
  composite_rank: number;
  requires_human_review: boolean;
  auto_deployable: boolean;
}

const AUTO_DEPLOY_TYPES = ["prompt_improvement", "config_change"];
const HIGH_RISK_TYPES = ["architecture_change", "capability_gap"];

export function scoreSuggestions(
  suggestions: RawSuggestion[],
): ScoredSuggestion[] {
  return suggestions
    .map((s, i) => {
      const effortInverse = s.effort_hours > 0 ? 1 / s.effort_hours : 1;
      const riskPenalty = (s.risk_score ?? 0) * 0.1;

      const composite =
        s.impact_score * 0.5 +
        s.confidence_score * 0.3 +
        effortInverse * 10 * 0.1 -
        riskPenalty;

      const requiresHuman = HIGH_RISK_TYPES.includes(s.category);
      const autoDeployable =
        AUTO_DEPLOY_TYPES.includes(s.category) &&
        s.confidence_score >= 7 &&
        (s.risk_score ?? 0) <= 3;

      return {
        ...s,
        id: `sug_${Date.now()}_${i}`,
        composite_rank: Math.round(composite * 100) / 100,
        requires_human_review: requiresHuman,
        auto_deployable: autoDeployable,
      };
    })
    .sort((a, b) => b.composite_rank - a.composite_rank);
}

export function deduplicateSuggestions(
  suggestions: ScoredSuggestion[],
): ScoredSuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.category}:${s.title.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
