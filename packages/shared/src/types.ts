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
