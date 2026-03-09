// ── Master ←→ VPS Protocol ──
// All messages between CF Master Worker and VPS controllers

// Master → VPS
export interface AssignTaskMessage {
  type: "assign_task";
  taskId: string;
  agentId: string;
  adapterType: string;
  payload: Record<string, unknown>;
  sessionParams: Record<string, unknown> | null;
  credentials: Record<string, string>; // decrypted for this run only
  browserProfileId: string | null;
}

export interface StopTaskMessage {
  type: "stop_task";
  taskId: string;
  reason: string;
}

export interface HealthCheckMessage {
  type: "health_check";
}

// VPS → Master
export interface HeartbeatReport {
  type: "heartbeat";
  vpsNodeId: string;
  capacity: {
    maxBrowsers: number;
    usedBrowsers: number;
    maxAgentInstances: number;
    usedAgentInstances: number;
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
  };
  activeTasks: string[];
  uptime: number;
}

export interface TaskProgressMessage {
  type: "task_progress";
  taskId: string;
  agentId: string;
  status: "running" | "completed" | "failed";
  log: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  } | null;
  sessionParams: Record<string, unknown> | null;
}

export interface ProfileStatusMessage {
  type: "profile_status";
  profileId: string;
  state: "ready" | "login_required" | "error";
  error: string | null;
}

// Union types
export type MasterToVpsMessage = AssignTaskMessage | StopTaskMessage | HealthCheckMessage;
export type VpsToMasterMessage = HeartbeatReport | TaskProgressMessage | ProfileStatusMessage;
