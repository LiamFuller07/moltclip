// ── Direct MCP Skill Invocation ──
// Spawns MCP skill processes (stdio transport), sends a JSON-RPC tool call,
// collects the result, and tears down the process.
//
// Each invocation is ephemeral: spawn → initialize → callTool → close.

import { spawn, type ChildProcess } from "node:child_process";
import pino from "pino";

const log = pino({ name: "skill-runner" });

const SKILL_TIMEOUT_MS = 120_000; // 2 minutes per skill invocation

// ── JSON-RPC helpers ──

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

function makeRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", id: nextId++, method, params };
}

// ── Skill runner ──

/**
 * Call an MCP skill tool by spawning the skill process, initialising the
 * MCP session, invoking the tool, and tearing down.
 *
 * @param skillPath - Path to the built skill entry point (e.g., dist/index.js)
 * @param toolName  - MCP tool name (e.g., "grok_research")
 * @param args      - Tool arguments
 * @returns The tool call result content
 */
export async function callSkill(
  skillPath: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!skillPath) {
    throw new Error(`Skill path not configured for tool "${toolName}"`);
  }

  log.info({ skillPath, toolName }, "invoking MCP skill");

  const child = spawn("node", [skillPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  try {
    const result = await withTimeout(
      runSkillSession(child, toolName, args),
      SKILL_TIMEOUT_MS,
      `Skill "${toolName}" timed out after ${SKILL_TIMEOUT_MS}ms`,
    );
    return result;
  } finally {
    // Ensure cleanup
    if (!child.killed) {
      child.kill("SIGTERM");
      // Force-kill after 5s if still alive
      const forceKillTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
      child.on("exit", () => clearTimeout(forceKillTimer));
    }
  }
}

async function runSkillSession(
  child: ChildProcess,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const sendRequest = (req: JsonRpcRequest): void => {
    const msg = JSON.stringify(req) + "\n";
    child.stdin?.write(msg);
  };

  const waitForResponse = (expectedId: number): Promise<JsonRpcResponse> => {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      let buffer = "";

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        // Process all complete lines; keep the last (potentially partial) line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as JsonRpcResponse;
            if (parsed.id === expectedId) {
              child.stdout?.off("data", onData);
              child.off("error", onError);
              resolve(parsed);
              return;
            }
            // Notifications or other responses — ignore
          } catch {
            // Non-JSON line from the skill (log output etc.) — ignore
          }
        }
      };

      const onError = (err: Error) => {
        child.stdout?.off("data", onData);
        reject(err);
      };

      child.stdout?.on("data", onData);
      child.on("error", onError);
    });
  };

  // Step 1: Initialize
  const initReq = makeRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "moltclip-orchestrator", version: "0.1.0" },
  });
  sendRequest(initReq);
  const initRes = await waitForResponse(initReq.id);
  if (initRes.error) {
    throw new Error(`MCP initialize failed: ${initRes.error.message}`);
  }

  // Step 2: Send initialized notification (no response expected)
  const notif: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: 0, // notifications technically shouldn't have id, but we use 0 as a sentinel
    method: "notifications/initialized",
  };
  // Send as notification (no id field)
  child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // Step 3: Call the tool
  const callReq = makeRequest("tools/call", {
    name: toolName,
    arguments: args,
  });
  sendRequest(callReq);
  const callRes = await waitForResponse(callReq.id);

  if (callRes.error) {
    throw new Error(`MCP tool "${toolName}" failed: ${callRes.error.message}`);
  }

  log.info({ toolName }, "skill invocation succeeded");
  return callRes.result;
}

// ── Timeout utility ──

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
