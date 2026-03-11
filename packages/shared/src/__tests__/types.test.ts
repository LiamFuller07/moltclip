import { describe, it, expect } from "vitest";

// Import types to verify they compile and are structurally valid
import type {
  AgentIdentity,
  AgentStatus,
  VpsNode,
  VpsCapacity,
  VpsHealth,
  BrowserProfile,
  ProfileState,
  Task,
  TaskType,
  TaskStatus,
  CostEvent,
  AgentBudget,
  GrokResearchMode,
  GrokResearchResult,
  GrokSource,
  BlockadeType,
  EscalationChannel,
  ReviewSuggestion,
  SuggestionCategory,
  SuggestionPriority,
  SynthesisSuggestion,
  RawSignal,
  SignalSource,
} from "../types.js";

describe("Type definitions", () => {
  describe("AgentStatus", () => {
    it("allows valid status values", () => {
      const statuses: AgentStatus[] = ["active", "paused", "suspended"];
      expect(statuses).toHaveLength(3);
      expect(statuses).toContain("active");
      expect(statuses).toContain("paused");
      expect(statuses).toContain("suspended");
    });
  });

  describe("VpsHealth", () => {
    it("allows valid health values", () => {
      const values: VpsHealth[] = ["healthy", "degraded", "unhealthy", "offline"];
      expect(values).toHaveLength(4);
    });
  });

  describe("TaskType", () => {
    it("allows all defined task types", () => {
      const types: TaskType[] = ["browser", "code", "email", "payment", "custom"];
      expect(types).toHaveLength(5);
    });
  });

  describe("TaskStatus", () => {
    it("allows all defined status values", () => {
      const statuses: TaskStatus[] = [
        "queued",
        "assigned",
        "running",
        "completed",
        "failed",
        "cancelled",
      ];
      expect(statuses).toHaveLength(6);
    });
  });

  describe("GrokResearchMode", () => {
    it("defines all research modes", () => {
      const modes: GrokResearchMode[] = ["cold", "weakness", "synthesis", "tool_discovery"];
      expect(modes).toHaveLength(4);
    });
  });

  describe("BlockadeType", () => {
    it("defines all blockade types A-D", () => {
      const types: BlockadeType[] = ["A", "B", "C", "D"];
      expect(types).toHaveLength(4);
    });
  });

  describe("EscalationChannel", () => {
    it("defines all channels", () => {
      const channels: EscalationChannel[] = [
        "x_post",
        "x_dm",
        "x_job",
        "upwork",
        "email",
        "internal",
        "github",
      ];
      expect(channels).toHaveLength(7);
    });
  });

  describe("SuggestionCategory", () => {
    it("defines all categories", () => {
      const categories: SuggestionCategory[] = [
        "capability_gap",
        "architecture_change",
        "prompt_improvement",
        "tool_upgrade",
        "workflow_fix",
      ];
      expect(categories).toHaveLength(5);
    });
  });

  describe("SuggestionPriority", () => {
    it("defines all priority levels", () => {
      const priorities: SuggestionPriority[] = ["critical", "high", "medium", "low"];
      expect(priorities).toHaveLength(4);
    });
  });

  describe("SignalSource", () => {
    it("defines all signal sources", () => {
      const sources: SignalSource[] = ["x_monitor", "blog_monitor", "agent_logs", "manual"];
      expect(sources).toHaveLength(4);
    });
  });

  describe("ProfileState", () => {
    it("defines all profile states", () => {
      const states: ProfileState[] = ["creating", "login_required", "ready", "locked", "error"];
      expect(states).toHaveLength(5);
    });
  });

  describe("Structural type checks", () => {
    it("AgentIdentity has required fields", () => {
      const agent: AgentIdentity = {
        id: "agt_123",
        displayName: "Test Agent",
        emailInbox: "test@agent.mail",
        walletId: null,
        status: "active",
        createdAt: "2025-01-01T00:00:00Z",
      };
      expect(agent.id).toBe("agt_123");
      expect(agent.walletId).toBeNull();
    });

    it("Task has nullable fields", () => {
      const task: Task = {
        id: "task_abc",
        agentId: null,
        type: "browser",
        status: "queued",
        priority: 0,
        payload: {},
        result: null,
        vpsNodeId: null,
        createdAt: "2025-01-01T00:00:00Z",
        startedAt: null,
        completedAt: null,
        error: null,
      };
      expect(task.agentId).toBeNull();
      expect(task.result).toBeNull();
      expect(task.error).toBeNull();
    });

    it("CostEvent has all required numeric fields", () => {
      const event: CostEvent = {
        id: "cost_1",
        agentId: "agt_1",
        runId: "run_1",
        provider: "anthropic",
        model: "claude-4",
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        timestamp: "2025-01-01T00:00:00Z",
      };
      expect(event.inputTokens).toBeGreaterThan(0);
      expect(event.costUsd).toBeGreaterThan(0);
    });

    it("GrokSource has relevance_score", () => {
      const source: GrokSource = {
        url: "https://example.com",
        title: "Test",
        summary: "A test source",
        relevance_score: 8.5,
      };
      expect(source.relevance_score).toBeGreaterThanOrEqual(0);
    });

    it("VpsCapacity has numeric metrics", () => {
      const capacity: VpsCapacity = {
        maxBrowsers: 10,
        usedBrowsers: 3,
        maxAgentInstances: 4,
        usedAgentInstances: 1,
        cpuPercent: 45.2,
        memoryPercent: 62.1,
        diskPercent: 30.0,
      };
      expect(capacity.usedBrowsers).toBeLessThanOrEqual(capacity.maxBrowsers);
      expect(capacity.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(capacity.cpuPercent).toBeLessThanOrEqual(100);
    });

    it("ReviewSuggestion has all fields", () => {
      const suggestion: ReviewSuggestion = {
        id: "rev_1",
        category: "prompt_improvement",
        title: "Improve error handling prompt",
        description: "The error handling prompt could be better",
        evidence: ["log line 1", "log line 2"],
        priority: "medium",
        effort_hours: 2,
        expected_impact: "Reduce error rate by 15%",
        source_stage: "log_analysis",
        created_at: "2025-01-01T00:00:00Z",
      };
      expect(suggestion.evidence).toHaveLength(2);
      expect(suggestion.effort_hours).toBeGreaterThan(0);
    });

    it("RawSignal has relevance_score between 0 and 1", () => {
      const signal: RawSignal = {
        id: "sig_1",
        source: "x_monitor",
        content: "New tool released",
        relevance_score: 0.85,
        captured_at: "2025-01-01T00:00:00Z",
      };
      expect(signal.relevance_score).toBeGreaterThanOrEqual(0);
      expect(signal.relevance_score).toBeLessThanOrEqual(1);
    });
  });
});
