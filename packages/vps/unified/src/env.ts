function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  // Server
  port: parseInt(optionalEnv("PORT", "8800"), 10),

  // Auth
  controllerSecret: requireEnv("CONTROLLER_SECRET"),
  apiKey: requireEnv("API_KEY"),

  // AI Providers
  anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
  xaiApiKey: optionalEnv("XAI_API_KEY", ""),
  firecrawlApiKey: optionalEnv("FIRECRAWL_API_KEY", ""),

  // Identity
  agentmailApiKey: optionalEnv("AGENTMAIL_API_KEY", ""),
  agentmailDomain: optionalEnv("AGENTMAIL_DOMAIN", "agents.moltclip.to"),
  encryptionKey: requireEnv("ENCRYPTION_KEY"),

  // Payment
  privacyApiKey: optionalEnv("PRIVACY_API_KEY", ""),
  stripeSecretKey: optionalEnv("STRIPE_SECRET_KEY", ""),
  approvalThresholdCents: parseInt(optionalEnv("APPROVAL_THRESHOLD_CENTS", "5000"), 10),

  // Social / Monitoring
  xBearerToken: optionalEnv("X_BEARER_TOKEN", ""),
  githubToken: optionalEnv("GITHUB_TOKEN", ""),

  // Database (defaults work for all-in-one container mode)
  databaseUrl: optionalEnv("DATABASE_URL", "postgresql://moltclip:moltclip@localhost:5432/moltclip"),
  redisUrl: optionalEnv("REDIS_URL", "redis://localhost:6379"),

  // Agent pool
  maxClaudeInstances: parseInt(optionalEnv("MAX_CLAUDE_INSTANCES", "4"), 10),
  maxCodexInstances: parseInt(optionalEnv("MAX_CODEX_INSTANCES", "2"), 10),
  maxBrowsers: parseInt(optionalEnv("MAX_BROWSERS", "10"), 10),

  // Orchestrator
  orchestratorPollMs: parseInt(optionalEnv("ORCHESTRATOR_POLL_INTERVAL_MS", "5000"), 10),
  maxConcurrentGoals: parseInt(optionalEnv("MAX_CONCURRENT_GOALS", "3"), 10),
  maxSubTasksPerGoal: parseInt(optionalEnv("MAX_SUBTASKS_PER_GOAL", "10"), 10),

  // Paths
  workspacesDir: optionalEnv("WORKSPACES_DIR", "/data/workspaces"),
  profilesDir: optionalEnv("BROWSER_PROFILE_DIR", "/data/profiles"),
  storageDir: optionalEnv("STORAGE_DIR", "/data/storage"),
  skillsDir: optionalEnv("SKILLS_DIR", "/app/packages/skills"),
} as const;
