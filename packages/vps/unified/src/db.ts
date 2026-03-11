import postgres from "postgres";
import { env } from "./env.js";
import pino from "pino";

const log = pino({ name: "db" });

export const sql = postgres(env.databaseUrl, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

export async function initDatabase(): Promise<void> {
  log.info("initializing database schema...");

  await sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      email_inbox TEXT,
      wallet_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      adapter_type TEXT NOT NULL DEFAULT 'claude_local',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      payload JSONB NOT NULL DEFAULT '{}',
      result JSONB,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cost_records (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS browser_profiles (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      service TEXT NOT NULL,
      email TEXT,
      state TEXT NOT NULL DEFAULT 'creating',
      profile_dir TEXT NOT NULL,
      last_used TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      error TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS credentials (
      agent_id TEXT NOT NULL,
      service TEXT NOT NULL,
      type TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      last_rotated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, service)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      last_four TEXT,
      merchant_lock TEXT,
      monthly_limit_cents INTEGER NOT NULL,
      current_spend_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      merchant TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      agent_id TEXT,
      event_type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // ── Harness tables (from D1 schema) ──

  await sql`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      url TEXT,
      author TEXT,
      relevance_score REAL NOT NULL DEFAULT 0,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS harness_suggestions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT,
      evidence JSONB DEFAULT '[]',
      impact REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      risk TEXT DEFAULT 'low',
      effort TEXT DEFAULT 'medium',
      composite_rank REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      dismissed_reason TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS synthesis_cycles (
      id TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      signals_processed INTEGER NOT NULL DEFAULT 0,
      suggestions_generated INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running'
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS x_monitor_state (
      id TEXT PRIMARY KEY,
      monitor_type TEXT NOT NULL,
      search_query TEXT,
      last_checked TIMESTAMPTZ,
      last_cursor TEXT,
      config JSONB DEFAULT '{}'
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS x_posts_processed (
      post_id TEXT PRIMARY KEY,
      url TEXT,
      author_handle TEXT,
      post_text TEXT,
      relevance_score REAL NOT NULL DEFAULT 0,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS crawled_content (
      url_hash TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      content TEXT,
      content_hash TEXT,
      crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS system_baselines (
      metric_name TEXT PRIMARY KEY,
      metric_type TEXT NOT NULL,
      target_value REAL,
      actual_value REAL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS escalation_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      task_id TEXT,
      blockade_type TEXT,
      channel_used TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS log_analysis_cache (
      analysis_id TEXT PRIMARY KEY,
      log_window_hours INTEGER NOT NULL,
      error_patterns JSONB DEFAULT '[]',
      health_score REAL,
      analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deployment_history (
      id TEXT PRIMARY KEY,
      suggestion_id TEXT,
      git_commit_sha TEXT,
      git_pr_url TEXT,
      test_passed BOOLEAN,
      deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS system_health_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      overall_score REAL,
      error_rate_pct REAL,
      data JSONB DEFAULT '{}',
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS discovered_tools (
      tool_id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      tool_url TEXT,
      solves_blockade_type TEXT,
      confidence_score REAL NOT NULL DEFAULT 0,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks (agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_signals_captured ON signals (captured_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_suggestions_status ON harness_suggestions (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log (agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cards_agent ON cards (agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cost_agent ON cost_records (agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profiles_agent ON browser_profiles (agent_id)`;

  log.info("database schema initialized (21 tables, 8 indexes)");
}

// Run schema init if called directly
if (process.argv.includes("--init")) {
  initDatabase().then(() => {
    log.info("database initialized successfully");
    process.exit(0);
  }).catch((err) => {
    log.error({ err }, "failed to initialize database");
    process.exit(1);
  });
}
