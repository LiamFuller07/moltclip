-- MoltClip Harness D1 Schema

-- Raw signals from all monitoring sources
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  author TEXT,
  relevance_score REAL DEFAULT 0,
  captured_at TEXT NOT NULL,
  processed INTEGER DEFAULT 0
);

-- Improvement suggestions from synthesis pipeline
CREATE TABLE IF NOT EXISTS harness_suggestions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  evidence TEXT,
  evidence_links TEXT, -- JSON array
  impact_score INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0,
  risk_score INTEGER DEFAULT 0,
  effort_hours REAL DEFAULT 0,
  composite_rank REAL DEFAULT 0,
  proposed_change TEXT,
  deployment_steps TEXT, -- JSON array
  files_affected TEXT, -- JSON array
  requires_human_review INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  deployment_result TEXT, -- JSON
  approved_at TEXT,
  approved_by TEXT,
  deployed_at TEXT,
  dismissed_at TEXT,
  dismissal_reason TEXT
);

-- Synthesis cycle tracking
CREATE TABLE IF NOT EXISTS synthesis_cycles (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  signals_processed INTEGER DEFAULT 0,
  suggestions_generated INTEGER DEFAULT 0,
  suggestions_deployed INTEGER DEFAULT 0,
  stages_completed TEXT, -- JSON array
  error TEXT
);

-- X.com monitoring state
CREATE TABLE IF NOT EXISTS x_monitor_state (
  id TEXT PRIMARY KEY,
  monitor_type TEXT NOT NULL,
  list_id TEXT,
  search_query TEXT,
  last_checked TEXT,
  last_cursor TEXT,
  posts_processed_count INTEGER DEFAULT 0,
  next_check_at TEXT
);

-- Processed X posts
CREATE TABLE IF NOT EXISTS x_posts_processed (
  post_id TEXT PRIMARY KEY,
  url TEXT,
  author_handle TEXT,
  post_text TEXT,
  timestamp TEXT,
  engagement_metrics TEXT, -- JSON
  processed_at TEXT,
  relevance_score INTEGER DEFAULT 0
);

-- Crawled content cache (deduplication)
CREATE TABLE IF NOT EXISTS crawled_content (
  url_hash TEXT PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  content TEXT,
  content_type TEXT DEFAULT 'markdown',
  last_modified TEXT,
  crawled_at TEXT NOT NULL,
  content_hash TEXT,
  relevance_score INTEGER DEFAULT 0,
  expires_at TEXT
);

-- System performance baselines
CREATE TABLE IF NOT EXISTS system_baselines (
  metric_name TEXT PRIMARY KEY,
  metric_type TEXT,
  target_value REAL,
  actual_value REAL,
  skill_name TEXT,
  last_updated TEXT,
  samples_count INTEGER DEFAULT 0
);

-- Escalation event tracking
CREATE TABLE IF NOT EXISTS escalation_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  task_id TEXT,
  blockade_type TEXT,
  blockade_description TEXT,
  software_solutions_found TEXT, -- JSON
  channel_used TEXT,
  escalation_draft TEXT,
  escalation_sent INTEGER DEFAULT 0,
  escalation_sent_at TEXT,
  status TEXT DEFAULT 'draft',
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

-- Cached log analysis results
CREATE TABLE IF NOT EXISTS log_analysis_cache (
  analysis_id TEXT PRIMARY KEY,
  analysis_timestamp TEXT NOT NULL,
  log_window_hours INTEGER,
  total_events INTEGER DEFAULT 0,
  error_patterns TEXT, -- JSON
  retry_hotspots TEXT, -- JSON
  duration_outliers TEXT, -- JSON
  reviewer_analysis TEXT, -- JSON
  blockade_patterns TEXT, -- JSON
  capability_gaps TEXT, -- JSON
  overall_health_score INTEGER DEFAULT 0,
  most_urgent_issue TEXT,
  error_rate_pct REAL DEFAULT 0
);

-- Deployment audit trail
CREATE TABLE IF NOT EXISTS deployment_history (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  deployment_timestamp TEXT NOT NULL,
  deployment_type TEXT,
  files_changed TEXT, -- JSON
  git_commit_sha TEXT,
  git_pr_url TEXT,
  test_results TEXT, -- JSON
  test_passed INTEGER DEFAULT 0,
  error_log TEXT,
  rollback_executed INTEGER DEFAULT 0,
  deployed_by TEXT
);

-- System health snapshots
CREATE TABLE IF NOT EXISTS system_health_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  snapshot_timestamp TEXT NOT NULL,
  overall_score INTEGER DEFAULT 0,
  error_rate_pct REAL DEFAULT 0,
  avg_iterations REAL DEFAULT 0,
  tool_error_distribution TEXT, -- JSON
  recent_escalations INTEGER DEFAULT 0,
  active_suggestions INTEGER DEFAULT 0,
  deployed_this_cycle INTEGER DEFAULT 0
);

-- Discovered tools registry
CREATE TABLE IF NOT EXISTS discovered_tools (
  tool_id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  tool_url TEXT,
  description TEXT,
  solves_blockade_type TEXT,
  pricing TEXT DEFAULT 'unknown',
  setup_complexity TEXT DEFAULT 'medium',
  confidence_score INTEGER DEFAULT 0,
  discovered_in_query TEXT,
  discovered_at TEXT,
  last_verified_at TEXT,
  still_exists INTEGER DEFAULT 1
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_captured ON signals(captured_at);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON harness_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_type ON harness_suggestions(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_escalation_agent ON escalation_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_health_timestamp ON system_health_snapshots(snapshot_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_crawled_expires ON crawled_content(expires_at);
CREATE INDEX IF NOT EXISTS idx_cycles_started ON synthesis_cycles(started_at DESC);
