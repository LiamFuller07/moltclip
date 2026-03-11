import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { userInfo } from "node:os";
import pino from "pino";
import { env } from "../env.js";
import { ensureWorkspace, writeMcpConfig } from "./workspace-setup.js";

// Resolve moltclip user uid/gid for spawning Claude Code as non-root
let agentUid: number | undefined;
let agentGid: number | undefined;
try {
  if (userInfo().uid === 0) {
    const id = execFileSync("id", ["-u", "moltclip"], { encoding: "utf-8" }).trim();
    const gid = execFileSync("id", ["-g", "moltclip"], { encoding: "utf-8" }).trim();
    agentUid = parseInt(id, 10);
    agentGid = parseInt(gid, 10);
  }
} catch {
  // moltclip user doesn't exist (dev mode) — run as current user
}

const log = pino({ name: "agent-pool" });

interface AgentInstance {
  id: string;
  agentId: string;
  adapterType: string;
  process: ChildProcess;
  taskId: string;
  startedAt: Date;
  workspace: string;
}

const instances = new Map<string, AgentInstance>();

export const agentPool = {
  async spawn(opts: {
    agentId: string;
    taskId: string;
    adapterType: string;
    prompt: string;
    extraEnv?: Record<string, string>;
    onLog?: (stream: "stdout" | "stderr", chunk: string) => void;
    onExit?: (code: number | null, signal: string | null) => void;
  }): Promise<string | null> {
    const maxForType = opts.adapterType === "codex" ? env.maxCodexInstances : env.maxClaudeInstances;
    const currentOfType = [...instances.values()].filter((i) => i.adapterType === opts.adapterType).length;

    if (currentOfType >= maxForType) {
      log.warn({ adapterType: opts.adapterType }, "agent pool at capacity");
      return null;
    }

    const instanceId = `inst_${crypto.randomUUID().slice(0, 8)}`;
    const workspace = `${env.workspacesDir}/${opts.agentId}`;

    await ensureWorkspace(workspace, opts.agentId);

    const cmd = opts.adapterType === "codex" ? "codex" : "claude";
    const mcpConfigPath = await writeMcpConfig(workspace);
    // IMPORTANT: prompt MUST come before --mcp-config because it's variadic (<configs...>)
    // and would consume the prompt as another config path
    const args = opts.adapterType === "codex"
      ? ["--print", "--output-format", "json", opts.prompt]
      : ["-p", "--output-format", "json", "--dangerously-skip-permissions", opts.prompt, "--mcp-config", mcpConfigPath];
    log.info({ cmd, args: args.map((a, i) => i === args.indexOf(opts.prompt) ? `<prompt:${a.length}chars>` : a) }, "spawning agent");

    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ANTHROPIC_API_KEY: env.anthropicApiKey,
      MOLTCLIP_AGENT_ID: opts.agentId,
      MOLTCLIP_TASK_ID: opts.taskId,
      MOLTCLIP_INSTANCE_ID: instanceId,
      CI: "1",
      NONINTERACTIVE: "1",
      ...(agentUid !== undefined ? { HOME: "/home/moltclip" } : {}),
      ...(opts.extraEnv || {}),
    };

    try {
      const child = spawn(cmd, args, {
        cwd: workspace,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        ...(agentUid !== undefined ? { uid: agentUid, gid: agentGid } : {}),
      });

      const instance: AgentInstance = {
        id: instanceId,
        agentId: opts.agentId,
        adapterType: opts.adapterType,
        process: child,
        taskId: opts.taskId,
        startedAt: new Date(),
        workspace,
      };

      instances.set(instanceId, instance);

      child.stdout?.on("data", (data: Buffer) => {
        opts.onLog?.("stdout", data.toString());
      });

      child.stderr?.on("data", (data: Buffer) => {
        opts.onLog?.("stderr", data.toString());
      });

      child.on("exit", (code, signal) => {
        instances.delete(instanceId);
        log.info({ instanceId, code, signal }, "agent exited");
        try {
          const result = opts.onExit?.(code, signal);
          if (result && typeof (result as any).catch === "function") {
            (result as any).catch((err: unknown) => log.error({ err, instanceId }, "onExit callback failed"));
          }
        } catch (err) {
          log.error({ err, instanceId }, "onExit callback threw");
        }
      });

      child.on("error", (err) => {
        instances.delete(instanceId);
        log.error({ instanceId, err }, "agent error");
        try {
          const result = opts.onExit?.(-1, null);
          if (result && typeof (result as any).catch === "function") {
            (result as any).catch((err2: unknown) => log.error({ err: err2, instanceId }, "onExit callback failed after spawn error"));
          }
        } catch (err2) {
          log.error({ err: err2, instanceId }, "onExit callback threw after spawn error");
        }
      });

      log.info({ instanceId, agentId: opts.agentId, adapterType: opts.adapterType }, "agent spawned");
      return instanceId;
    } catch (err) {
      log.error({ err, agentId: opts.agentId }, "failed to spawn agent");
      return null;
    }
  },

  async kill(instanceId: string): Promise<void> {
    const instance = instances.get(instanceId);
    if (!instance) return;
    instance.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { instance.process.kill("SIGKILL"); resolve(); }, 10_000);
      instance.process.on("exit", () => { clearTimeout(timeout); resolve(); });
    });
    instances.delete(instanceId);
  },

  async killAll(): Promise<void> {
    await Promise.allSettled([...instances.keys()].map((id) => this.kill(id)));
  },

  getStatus() {
    return {
      max: env.maxClaudeInstances + env.maxCodexInstances,
      active: instances.size,
      claude: { max: env.maxClaudeInstances, active: [...instances.values()].filter((i) => i.adapterType !== "codex").length },
      codex: { max: env.maxCodexInstances, active: [...instances.values()].filter((i) => i.adapterType === "codex").length },
      instances: [...instances.values()].map((i) => ({
        id: i.id, agentId: i.agentId, adapterType: i.adapterType, taskId: i.taskId,
        uptime: Date.now() - i.startedAt.getTime(),
      })),
    };
  },
};
