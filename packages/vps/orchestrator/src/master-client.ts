// ── HTTP client for the Master Worker API ──
// All orchestrator ↔ Master Worker communication goes through this module.

import pino from "pino";
import type { Task, TaskStatus, AgentIdentity } from "@moltclip/shared";
import { API } from "@moltclip/shared";
import { config } from "./config.js";

const log = pino({ name: "master-client" });

const FETCH_TIMEOUT_MS = 30_000;

// ── Helpers ──

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.controllerSecret}`,
    "Content-Type": "application/json",
  };
}

function url(path: string): string {
  return `${config.masterUrl}${path}`;
}

// ── Agent operations ──

export interface CreateAgentInput {
  displayName: string;
  adapterType: string;
}

export async function createAgent(
  input: CreateAgentInput,
): Promise<AgentIdentity & { adapterType: string }> {
  const res = await fetchWithTimeout(url(API.AGENTS), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createAgent failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { agent: AgentIdentity & { adapterType: string } };
  log.info({ agentId: data.agent.id }, "registered orchestrator agent");
  return data.agent;
}

// ── Task operations ──

export interface CreateTaskInput {
  agentId?: string;
  type: string;
  priority?: number;
  payload: Record<string, unknown>;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const res = await fetchWithTimeout(url(API.TASKS), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createTask failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { task: Task };
  log.debug({ taskId: data.task.id }, "task created");
  return data.task;
}

export async function getTask(taskId: string): Promise<Task | null> {
  const res = await fetchWithTimeout(url(`${API.TASKS}/${taskId}`), {
    method: "GET",
    headers: authHeaders(),
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getTask failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { task: Task };
  return data.task;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  agentId?: string;
}

export async function listTasks(filter?: ListTasksFilter): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.agentId) params.set("agentId", filter.agentId);

  const query = params.toString();
  const path = query ? `${API.TASKS}?${query}` : API.TASKS;

  const res = await fetchWithTimeout(url(path), {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`listTasks failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { tasks: Task[] };
  return data.tasks;
}

// ── Status ──

export interface MasterStatus {
  vpsNodes: number;
  healthyNodes: number;
  activeTasks: number;
  totalAgents: number;
  activeAgents: number;
  harness: unknown;
  timestamp: string;
}

export async function getStatus(): Promise<MasterStatus> {
  const res = await fetchWithTimeout(url("/api/status"), {
    method: "GET",
    headers: authHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getStatus failed (${res.status}): ${text}`);
  }

  return (await res.json()) as MasterStatus;
}
