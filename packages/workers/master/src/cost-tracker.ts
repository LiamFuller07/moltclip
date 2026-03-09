import type { Env } from "./index.js";

interface CostRecord {
  agentId: string;
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

interface CostSummary {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byAgent: Record<string, { costUsd: number; runs: number }>;
  recentEvents: CostRecord[];
}

const R2_COSTS_KEY = "state/costs.json";

export const costTracker = {
  async record(env: Env, event: CostRecord): Promise<void> {
    const events = await this.loadEvents(env);
    events.push(event);

    // Keep last 10000 events
    const trimmed = events.length > 10000 ? events.slice(-10000) : events;
    await env.R2.put(R2_COSTS_KEY, JSON.stringify({ events: trimmed }));

    // Also write to audit log (append-only)
    const auditKey = `audit/costs/${event.agentId}/${new Date().toISOString().slice(0, 7)}.jsonl`;
    const existing = await env.R2.get(auditKey);
    const existingText = existing ? await existing.text() : "";
    await env.R2.put(auditKey, existingText + JSON.stringify(event) + "\n");
  },

  async getSummary(env: Env, agentId?: string | null): Promise<CostSummary> {
    let events = await this.loadEvents(env);

    if (agentId) {
      events = events.filter((e) => e.agentId === agentId);
    }

    const byAgent: Record<string, { costUsd: number; runs: number }> = {};
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const e of events) {
      totalCostUsd += e.costUsd;
      totalInputTokens += e.inputTokens;
      totalOutputTokens += e.outputTokens;

      if (!byAgent[e.agentId]) {
        byAgent[e.agentId] = { costUsd: 0, runs: 0 };
      }
      byAgent[e.agentId].costUsd += e.costUsd;
      byAgent[e.agentId].runs += 1;
    }

    return {
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      byAgent,
      recentEvents: events.slice(-50),
    };
  },

  async checkBudget(
    env: Env,
    agentId: string,
    monthlyLimitCents: number,
  ): Promise<{ withinBudget: boolean; currentSpendCents: number; remainingCents: number }> {
    const events = await this.loadEvents(env);

    // Current month's spend
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthSpend = events
      .filter(
        (e) =>
          e.agentId === agentId &&
          new Date(e.timestamp) >= monthStart,
      )
      .reduce((sum, e) => sum + Math.round(e.costUsd * 100), 0);

    return {
      withinBudget: monthSpend < monthlyLimitCents,
      currentSpendCents: monthSpend,
      remainingCents: Math.max(0, monthlyLimitCents - monthSpend),
    };
  },

  async loadEvents(env: Env): Promise<CostRecord[]> {
    const obj = await env.R2.get(R2_COSTS_KEY);
    if (!obj) return [];
    const data = await obj.json<{ events: CostRecord[] }>();
    return data.events;
  },
};
