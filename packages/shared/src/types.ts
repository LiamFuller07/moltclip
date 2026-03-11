// ── Agent Identity ──

export interface AgentIdentity {
  id: string;
  displayName: string;
  emailInbox: string;
  walletId: string | null;
  status: AgentStatus;
  createdAt: string;
}

export type AgentStatus = "active" | "paused" | "suspended";

// ── VPS Node ──

export interface VpsNode {
  id: string;
  host: string; // Tailscale/tunnel hostname
  capacity: VpsCapacity;
  health: VpsHealth;
  lastHeartbeat: string;
  region: string;
  provider: "contabo" | "hetzner" | "custom";
}

export interface VpsCapacity {
  maxBrowsers: number;
  usedBrowsers: number;
  maxAgentInstances: number;
  usedAgentInstances: number;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
}

export type VpsHealth = "healthy" | "degraded" | "unhealthy" | "offline";

// ── Browser Profile ──

export interface BrowserProfile {
  id: string;
  agentId: string;
  service: string; // e.g., "amazon", "github", "linkedin"
  email: string;
  state: ProfileState;
  vpsNodeId: string;
  profileDir: string;
  lastUsed: string;
  createdAt: string;
}

export type ProfileState = "creating" | "login_required" | "ready" | "locked" | "error";

// ── Task ──

export interface Task {
  id: string;
  agentId: string | null;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  vpsNodeId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type TaskType = "browser" | "code" | "email" | "payment" | "custom";
export type TaskStatus = "queued" | "assigned" | "running" | "completed" | "failed" | "cancelled";

// ── Heartbeat Run ──

export interface HeartbeatRun {
  id: string;
  agentId: string;
  vpsNodeId: string;
  status: "queued" | "running" | "completed" | "failed";
  adapterType: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  usage: TokenUsage | null;
  costUsd: number | null;
  sessionId: string | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

// ── Cost ──

export interface CostEvent {
  id: string;
  agentId: string;
  runId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface AgentBudget {
  agentId: string;
  monthlyLimitCents: number;
  currentSpendCents: number;
  lastResetAt: string;
}

// ── Payment ──

export interface VirtualCard {
  id: string;
  agentId: string;
  provider: "privacy" | "stripe";
  lastFour: string;
  merchantLock: string | null;
  monthlyLimitCents: number;
  currentSpendCents: number;
  status: "active" | "paused" | "closed";
}

export interface PaymentApproval {
  id: string;
  agentId: string;
  amountCents: number;
  merchant: string;
  reason: string;
  status: "pending" | "approved" | "denied";
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

// ── Credential ──

export interface CredentialEntry {
  agentId: string;
  service: string;
  type: "password" | "totp_seed" | "oauth_token" | "api_key" | "ssh_key";
  // value is never exposed in API responses
  lastRotated: string;
  createdAt: string;
}

// ── Grok Research ──

export type GrokResearchMode = "cold" | "weakness" | "synthesis" | "tool_discovery";

export interface GrokResearchInput {
  query: string;
  mode?: GrokResearchMode;
  context?: string;
  domain?: string;
  max_results?: number;
}

export interface GrokResearchResult {
  findings: string[];
  sources: GrokSource[];
  sentiment: GrokSentiment;
  improvement_ideas?: GrokImprovementIdea[];
  upgrade_plan?: GrokUpgradePlan;
  tool_discoveries?: ToolDiscovery[];
  meta: GrokMeta;
}

export interface GrokSource {
  url: string;
  title: string;
  summary: string;
  relevance_score: number;
}

export interface GrokSentiment {
  label: "positive" | "negative" | "neutral" | "mixed";
  summary: string;
  signals: string[];
}

export interface GrokImprovementIdea {
  idea: string;
  rationale: string;
  code_snippet?: string;
}

export interface GrokUpgradePlan {
  summary: string;
  steps: string[];
  expected_score: number;
}

export interface ToolDiscovery {
  tool_name: string;
  url: string;
  description: string;
  integration_effort: "low" | "medium" | "high";
  relevance: number;
}

export interface GrokMeta {
  query: string;
  mode: string;
  model: string;
  tokens_used: number;
  timestamp: string;
  confidence: number;
}

// ── Harness Review ──

export type ReviewStage = "log_analysis" | "codebase_scan" | "synthesis";
export type SuggestionCategory = "capability_gap" | "architecture_change" | "prompt_improvement" | "tool_upgrade" | "workflow_fix";
export type SuggestionPriority = "critical" | "high" | "medium" | "low";

export interface ReviewSuggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  description: string;
  evidence: string[];
  priority: SuggestionPriority;
  effort_hours: number;
  expected_impact: string;
  implementation_hint?: string;
  source_stage: ReviewStage;
  created_at: string;
}

export interface ReviewRunResult {
  run_id: string;
  suggestions: ReviewSuggestion[];
  stats: {
    logs_analyzed: number;
    files_scanned: number;
    duration_ms: number;
  };
  timestamp: string;
}

// ── Human Escalation ──

export type BlockadeType = "A" | "B" | "C" | "D";
export type EscalationChannel = "x_post" | "x_dm" | "x_job" | "upwork" | "email" | "internal" | "github";
export type EscalationStatus = "detecting" | "searching" | "engaging" | "resolved" | "failed";

export interface BlockadeDetection {
  type: BlockadeType;
  description: string;
  failed_attempts: string[];
  software_rounds_completed: number;
}

export interface EscalationRequest {
  id: string;
  blockade: BlockadeDetection;
  channel: EscalationChannel;
  status: EscalationStatus;
  query: string;
  contacts_tried: string[];
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

// ── Self-Evolving Harness ──

export type SignalSource = "x_monitor" | "blog_monitor" | "agent_logs" | "manual";

export interface RawSignal {
  id: string;
  source: SignalSource;
  content: string;
  url?: string;
  author?: string;
  relevance_score: number;
  captured_at: string;
}

export interface SynthesisSuggestion {
  id: string;
  title: string;
  category: SuggestionCategory;
  description: string;
  evidence_ids: string[];
  priority: SuggestionPriority;
  pipeline_stage: string;
  auto_deployable: boolean;
  created_at: string;
  deployed_at: string | null;
  status: "pending" | "approved" | "deployed" | "rejected";
}

export interface SynthesisCycle {
  id: string;
  started_at: string;
  completed_at: string | null;
  signals_processed: number;
  suggestions_generated: number;
  suggestions_deployed: number;
  stages_completed: string[];
}

export interface HealthSnapshot {
  timestamp: string;
  workers: Record<string, { status: string; last_run: string; error_count: number }>;
  signals_24h: number;
  suggestions_24h: number;
  deployments_24h: number;
}

// ── Harness Review Output ──

export interface HarnessReviewOutput {
  review_id: string;
  reviewed_at: string;
  log_window_hours: number;
  log_events_read: number;
  files_read: string[];
  health: {
    overall_score: number;
    trend: "improving" | "stable" | "degrading" | "unknown";
    most_urgent_issue: string;
    error_rate_pct: number;
    avg_iterations: number;
    top_errors: { tool: string; error: string; count: number }[];
  };
  suggestions: ReviewSuggestion[];
  weak_signals: { observation: string; why_not_suggested: string }[];
  data_quality: {
    logs_normalised: boolean;
    log_coverage: string;
    codebase_coverage: string;
    warnings: string[];
  };
}

// ── Self-Review ──

export interface SelfReviewInput {
  output_text: string;
  task_description: string;
  rubric_dimensions?: ReviewDimension[];
  max_iterations?: number;
  domain?: string;
}

export interface ReviewDimension {
  name: string;
  description: string;
  weight: number;
}

export interface SelfReviewOutput {
  final_score: number;
  dimension_scores: Record<string, number>;
  iterations_run: number;
  improvements_applied: string[];
  upgrade_plan: GrokUpgradePlan | null;
}

// ── Channel Result ──

export interface ChannelResult {
  channel: EscalationChannel;
  draft_content: string;
  send_status: "draft" | "sent" | "failed";
  send_details?: {
    platform_response: string;
    post_id?: string;
    dm_id?: string;
  };
  follow_up_plan: {
    check_at: string;
    check_method: string;
    escalate_if_no_response_by: string;
    escalation_fallback: string;
  };
}

// ── Blockade Check Result ──

export interface BlockadeCheckResult {
  confirmed: boolean;
  blockade_type: BlockadeType | null;
  type_rationale: string;
  software_alternatives: {
    tool_name: string;
    description: string;
    url: string;
    solves_blockade: boolean;
    confidence: number;
  }[];
  recommended_channel: EscalationChannel | null;
  channel_rationale: string | null;
  estimated_resolution: string | null;
  meta: {
    task_description: string;
    blockade_description: string;
    attempts_reviewed: number;
    tool_discovery_run: boolean;
    timestamp: string;
  };
}
