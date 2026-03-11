// ── Defaults ──
export const DEFAULT_CONTROLLER_PORT = 8800;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_CRON_INTERVAL_MINUTES = 5;
export const DEFAULT_MAX_BROWSERS = 10;
export const DEFAULT_MAX_CLAUDE_INSTANCES = 4;
export const DEFAULT_MAX_CODEX_INSTANCES = 2;
export const DEFAULT_PROFILE_BACKUP_HOURS = 6;
export const DEFAULT_PROFILE_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
export const DEFAULT_VPS_UNHEALTHY_THRESHOLD = 3; // consecutive failures

// ── Paths (VPS) ──
export const VPS_DATA_DIR = "/data";
export const VPS_PROFILES_DIR = "/data/profiles";
export const VPS_WORKSPACES_DIR = "/data/workspaces";
export const VPS_CREDENTIALS_DIR = "/data/credentials";
export const VPS_BACKUPS_DIR = "/data/backups";

// ── R2 Keys ──
export const R2_PROFILES_PREFIX = "profiles/";
export const R2_STATE_PREFIX = "state/";
export const R2_AUDIT_PREFIX = "audit/";
export const R2_BACKUPS_PREFIX = "backups/";

// ── KV Namespaces ──
export const KV_AGENTS = "agents";
export const KV_PROFILES = "profiles";
export const KV_CREDENTIALS = "credentials";
export const KV_SESSIONS = "sessions";

// ── Limits ──
export const MAX_CONCURRENT_RUNS_PER_AGENT = 1;
export const MAX_SPEND_WITHOUT_APPROVAL_CENTS = 5000; // $50
export const BROWSER_MEMORY_MB = 600; // estimated per Chromium instance

// ── API Paths ──
export const API = {
  // Master Worker
  HEALTH: "/health",
  AGENTS: "/api/agents",
  TASKS: "/api/tasks",
  VPS: "/api/vps",
  PROFILES: "/api/profiles",
  COSTS: "/api/costs",

  // VPS Controller
  VPS_HEALTH: "/health",
  VPS_TASK: "/task",
  VPS_BROWSERS: "/browsers",
  VPS_AGENTS: "/agents",
  VPS_METRICS: "/metrics",

  // Harness Dashboard
  HARNESS_SIGNALS: "/api/harness/signals",
  HARNESS_SUGGESTIONS: "/api/harness/suggestions",
  HARNESS_CYCLES: "/api/harness/cycles",
  HARNESS_HEALTH: "/api/harness/health",
  HARNESS_DEPLOY: "/api/harness/deploy",
} as const;

// ── Grok Research ──
export const GROK_API_BASE_URL = "https://api.x.ai/v1";
export const GROK_DEFAULT_MODEL = "grok-3";
export const GROK_FALLBACK_MODEL = "grok-3-mini";
export const GROK_MAX_TOKENS = 4096;
export const GROK_TEMPERATURE = 0.2;
export const GROK_MAX_CONTEXT_TOKENS = 80_000;
export const GROK_RETRY_ATTEMPTS = 3;
export const GROK_RETRY_DELAYS_MS = [2000, 4000, 8000];

// ── Harness Review ──
export const REVIEW_MAX_LOGS = 500;
export const REVIEW_MAX_FILES = 200;
export const REVIEW_SCORE_THRESHOLD = 9; // trigger improvement loop below this

// ── Human Escalation ──
export const ESCALATION_SOFTWARE_ROUNDS = 5;
export const ESCALATION_ROUND_TIMEOUT_MS = 60_000;

// ── Self-Review ──
export const MAX_SELF_REVIEW_ITERATIONS = 3;
export const FIRECRAWL_API_BASE_URL = "https://api.firecrawl.dev/v1";

// ── Self-Evolving Harness ──
export const SYNTHESIS_CYCLE_INTERVAL_HOURS = 4;
export const X_MONITOR_INTERVAL_MINUTES = 30;
export const BLOG_MONITOR_INTERVAL_HOURS = 2;
export const MAX_SIGNALS_PER_CYCLE = 100;
export const SIGNAL_RELEVANCE_THRESHOLD = 0.6;

// ── D1 Tables ──
export const D1_TABLES = {
  SIGNALS: "signals",
  SUGGESTIONS: "suggestions",
  SYNTHESIS_CYCLES: "synthesis_cycles",
  HEALTH_SNAPSHOTS: "health_snapshots",
  AGENT_LOGS: "agent_logs",
  ESCALATIONS: "escalations",
} as const;
