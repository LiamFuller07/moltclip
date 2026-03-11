// ── Orchestrator Configuration ──
// All config sourced from environment variables with sensible defaults.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export const config = {
  /** URL of the Master Worker (Cloudflare) */
  masterUrl: requireEnv("MASTER_WORKER_URL"),

  /** Shared secret for Master Worker auth */
  controllerSecret: requireEnv("CONTROLLER_SECRET"),

  /** Anthropic API key for Claude planning calls */
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),

  /** How often to poll the Master Worker for new goals (ms) */
  pollIntervalMs: parseInt(process.env.ORCHESTRATOR_POLL_INTERVAL_MS || "5000", 10),

  /** Max goals being executed concurrently */
  maxConcurrentGoals: parseInt(process.env.MAX_CONCURRENT_GOALS || "3", 10),

  /** Max sub-tasks per goal decomposition */
  maxSubTasksPerGoal: parseInt(process.env.MAX_SUBTASKS_PER_GOAL || "10", 10),

  /** Paths to MCP skill entry points (built JS files) */
  skillPaths: {
    grokResearch: process.env.GROK_RESEARCH_PATH || "",
    harnessReview: process.env.HARNESS_REVIEW_PATH || "",
    humanEscalation: process.env.HUMAN_ESCALATION_PATH || "",
    selfReview: process.env.SELF_REVIEW_PATH || "",
  },
} as const;
