import { describe, it, expect } from "vitest";
import {
  DEFAULT_CONTROLLER_PORT,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_CRON_INTERVAL_MINUTES,
  DEFAULT_MAX_BROWSERS,
  DEFAULT_MAX_CLAUDE_INSTANCES,
  DEFAULT_MAX_CODEX_INSTANCES,
  DEFAULT_PROFILE_BACKUP_HOURS,
  DEFAULT_PROFILE_LOCK_TIMEOUT_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  DEFAULT_VPS_UNHEALTHY_THRESHOLD,
  VPS_DATA_DIR,
  VPS_PROFILES_DIR,
  VPS_WORKSPACES_DIR,
  VPS_CREDENTIALS_DIR,
  VPS_BACKUPS_DIR,
  R2_PROFILES_PREFIX,
  R2_STATE_PREFIX,
  R2_AUDIT_PREFIX,
  R2_BACKUPS_PREFIX,
  KV_AGENTS,
  KV_PROFILES,
  KV_CREDENTIALS,
  KV_SESSIONS,
  MAX_CONCURRENT_RUNS_PER_AGENT,
  MAX_SPEND_WITHOUT_APPROVAL_CENTS,
  BROWSER_MEMORY_MB,
  API,
  GROK_API_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_FALLBACK_MODEL,
  GROK_MAX_TOKENS,
  GROK_TEMPERATURE,
  GROK_MAX_CONTEXT_TOKENS,
  GROK_RETRY_ATTEMPTS,
  GROK_RETRY_DELAYS_MS,
  REVIEW_MAX_LOGS,
  REVIEW_MAX_FILES,
  REVIEW_SCORE_THRESHOLD,
  ESCALATION_SOFTWARE_ROUNDS,
  ESCALATION_ROUND_TIMEOUT_MS,
  MAX_SELF_REVIEW_ITERATIONS,
  FIRECRAWL_API_BASE_URL,
  SYNTHESIS_CYCLE_INTERVAL_HOURS,
  X_MONITOR_INTERVAL_MINUTES,
  BLOG_MONITOR_INTERVAL_HOURS,
  MAX_SIGNALS_PER_CYCLE,
  SIGNAL_RELEVANCE_THRESHOLD,
  D1_TABLES,
} from "../constants.js";

describe("Constants", () => {
  describe("Numeric defaults are positive", () => {
    it.each([
      ["DEFAULT_CONTROLLER_PORT", DEFAULT_CONTROLLER_PORT],
      ["DEFAULT_HEARTBEAT_INTERVAL_MS", DEFAULT_HEARTBEAT_INTERVAL_MS],
      ["DEFAULT_CRON_INTERVAL_MINUTES", DEFAULT_CRON_INTERVAL_MINUTES],
      ["DEFAULT_MAX_BROWSERS", DEFAULT_MAX_BROWSERS],
      ["DEFAULT_MAX_CLAUDE_INSTANCES", DEFAULT_MAX_CLAUDE_INSTANCES],
      ["DEFAULT_MAX_CODEX_INSTANCES", DEFAULT_MAX_CODEX_INSTANCES],
      ["DEFAULT_PROFILE_BACKUP_HOURS", DEFAULT_PROFILE_BACKUP_HOURS],
      ["DEFAULT_PROFILE_LOCK_TIMEOUT_MS", DEFAULT_PROFILE_LOCK_TIMEOUT_MS],
      ["DEFAULT_TASK_TIMEOUT_MS", DEFAULT_TASK_TIMEOUT_MS],
      ["DEFAULT_VPS_UNHEALTHY_THRESHOLD", DEFAULT_VPS_UNHEALTHY_THRESHOLD],
      ["MAX_CONCURRENT_RUNS_PER_AGENT", MAX_CONCURRENT_RUNS_PER_AGENT],
      ["MAX_SPEND_WITHOUT_APPROVAL_CENTS", MAX_SPEND_WITHOUT_APPROVAL_CENTS],
      ["BROWSER_MEMORY_MB", BROWSER_MEMORY_MB],
      ["GROK_MAX_TOKENS", GROK_MAX_TOKENS],
      ["GROK_MAX_CONTEXT_TOKENS", GROK_MAX_CONTEXT_TOKENS],
      ["GROK_RETRY_ATTEMPTS", GROK_RETRY_ATTEMPTS],
      ["REVIEW_MAX_LOGS", REVIEW_MAX_LOGS],
      ["REVIEW_MAX_FILES", REVIEW_MAX_FILES],
      ["REVIEW_SCORE_THRESHOLD", REVIEW_SCORE_THRESHOLD],
      ["ESCALATION_SOFTWARE_ROUNDS", ESCALATION_SOFTWARE_ROUNDS],
      ["ESCALATION_ROUND_TIMEOUT_MS", ESCALATION_ROUND_TIMEOUT_MS],
      ["MAX_SELF_REVIEW_ITERATIONS", MAX_SELF_REVIEW_ITERATIONS],
      ["MAX_SIGNALS_PER_CYCLE", MAX_SIGNALS_PER_CYCLE],
      ["SYNTHESIS_CYCLE_INTERVAL_HOURS", SYNTHESIS_CYCLE_INTERVAL_HOURS],
      ["X_MONITOR_INTERVAL_MINUTES", X_MONITOR_INTERVAL_MINUTES],
      ["BLOG_MONITOR_INTERVAL_HOURS", BLOG_MONITOR_INTERVAL_HOURS],
    ])("%s is positive", (_name, value) => {
      expect(value).toBeGreaterThan(0);
    });
  });

  describe("Specific default values", () => {
    it("controller port is 8800", () => {
      expect(DEFAULT_CONTROLLER_PORT).toBe(8800);
    });

    it("heartbeat interval is 30 seconds", () => {
      expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    });

    it("max browsers is 10", () => {
      expect(DEFAULT_MAX_BROWSERS).toBe(10);
    });

    it("task timeout is 10 minutes", () => {
      expect(DEFAULT_TASK_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });

    it("profile lock timeout is 30 minutes", () => {
      expect(DEFAULT_PROFILE_LOCK_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });

    it("max spend without approval is $50 (5000 cents)", () => {
      expect(MAX_SPEND_WITHOUT_APPROVAL_CENTS).toBe(5000);
    });

    it("signal relevance threshold is between 0 and 1", () => {
      expect(SIGNAL_RELEVANCE_THRESHOLD).toBeGreaterThanOrEqual(0);
      expect(SIGNAL_RELEVANCE_THRESHOLD).toBeLessThanOrEqual(1);
    });

    it("Grok temperature is between 0 and 1", () => {
      expect(GROK_TEMPERATURE).toBeGreaterThanOrEqual(0);
      expect(GROK_TEMPERATURE).toBeLessThanOrEqual(1);
    });
  });

  describe("VPS paths", () => {
    it("all VPS paths start with /data", () => {
      expect(VPS_DATA_DIR).toBe("/data");
      expect(VPS_PROFILES_DIR).toMatch(/^\/data\//);
      expect(VPS_WORKSPACES_DIR).toMatch(/^\/data\//);
      expect(VPS_CREDENTIALS_DIR).toMatch(/^\/data\//);
      expect(VPS_BACKUPS_DIR).toMatch(/^\/data\//);
    });

    it("VPS paths are absolute", () => {
      [VPS_DATA_DIR, VPS_PROFILES_DIR, VPS_WORKSPACES_DIR, VPS_CREDENTIALS_DIR, VPS_BACKUPS_DIR].forEach((p) => {
        expect(p).toMatch(/^\//);
      });
    });
  });

  describe("R2 prefixes", () => {
    it("all R2 prefixes end with /", () => {
      [R2_PROFILES_PREFIX, R2_STATE_PREFIX, R2_AUDIT_PREFIX, R2_BACKUPS_PREFIX].forEach((p) => {
        expect(p).toMatch(/\/$/);
      });
    });
  });

  describe("KV namespace names", () => {
    it("all KV names are non-empty strings", () => {
      [KV_AGENTS, KV_PROFILES, KV_CREDENTIALS, KV_SESSIONS].forEach((name) => {
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
      });
    });
  });

  describe("URL constants", () => {
    it("GROK_API_BASE_URL is a valid URL", () => {
      const url = new URL(GROK_API_BASE_URL);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("api.x.ai");
    });

    it("FIRECRAWL_API_BASE_URL is a valid URL", () => {
      const url = new URL(FIRECRAWL_API_BASE_URL);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("api.firecrawl.dev");
    });
  });

  describe("Grok configuration", () => {
    it("has expected model names", () => {
      expect(GROK_DEFAULT_MODEL).toBe("grok-3");
      expect(GROK_FALLBACK_MODEL).toBe("grok-3-mini");
    });

    it("retry delays array matches retry attempts count", () => {
      expect(GROK_RETRY_DELAYS_MS).toHaveLength(GROK_RETRY_ATTEMPTS);
    });

    it("retry delays are in ascending order (exponential backoff)", () => {
      for (let i = 1; i < GROK_RETRY_DELAYS_MS.length; i++) {
        expect(GROK_RETRY_DELAYS_MS[i]).toBeGreaterThan(GROK_RETRY_DELAYS_MS[i - 1]);
      }
    });
  });

  describe("API paths", () => {
    it("all API paths start with /", () => {
      for (const [_key, path] of Object.entries(API)) {
        expect(path).toMatch(/^\//);
      }
    });

    it("has expected master worker endpoints", () => {
      expect(API.HEALTH).toBe("/health");
      expect(API.AGENTS).toBe("/api/agents");
      expect(API.TASKS).toBe("/api/tasks");
      expect(API.VPS).toBe("/api/vps");
      expect(API.PROFILES).toBe("/api/profiles");
      expect(API.COSTS).toBe("/api/costs");
    });

    it("has expected harness endpoints", () => {
      expect(API.HARNESS_SIGNALS).toBe("/api/harness/signals");
      expect(API.HARNESS_SUGGESTIONS).toBe("/api/harness/suggestions");
      expect(API.HARNESS_CYCLES).toBe("/api/harness/cycles");
      expect(API.HARNESS_HEALTH).toBe("/api/harness/health");
      expect(API.HARNESS_DEPLOY).toBe("/api/harness/deploy");
    });

    it("has VPS controller endpoints", () => {
      expect(API.VPS_HEALTH).toBe("/health");
      expect(API.VPS_TASK).toBe("/task");
      expect(API.VPS_BROWSERS).toBe("/browsers");
      expect(API.VPS_AGENTS).toBe("/agents");
      expect(API.VPS_METRICS).toBe("/metrics");
    });
  });

  describe("D1 table names", () => {
    it("has all expected tables", () => {
      expect(D1_TABLES.SIGNALS).toBe("signals");
      expect(D1_TABLES.SUGGESTIONS).toBe("suggestions");
      expect(D1_TABLES.SYNTHESIS_CYCLES).toBe("synthesis_cycles");
      expect(D1_TABLES.HEALTH_SNAPSHOTS).toBe("health_snapshots");
      expect(D1_TABLES.AGENT_LOGS).toBe("agent_logs");
      expect(D1_TABLES.ESCALATIONS).toBe("escalations");
    });

    it("all table names are lowercase with underscores", () => {
      for (const [_key, name] of Object.entries(D1_TABLES)) {
        expect(name).toMatch(/^[a-z_]+$/);
      }
    });
  });
});
