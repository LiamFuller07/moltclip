import { type ChildProcess, spawn } from "node:child_process";
import pino from "pino";

const log = pino({ name: "agent-pool" });

const MAX_CLAUDE = parseInt(process.env.MAX_CLAUDE_INSTANCES || "4", 10);
const MAX_CODEX = parseInt(process.env.MAX_CODEX_INSTANCES || "2", 10);
const WORKSPACES_DIR = process.env.WORKSPACES_DIR || "/data/workspaces";

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
  /**
   * Spawn a Claude Code or Codex instance for a task.
   */
  async spawn(opts: {
    agentId: string;
    taskId: string;
    adapterType: string;
    prompt: string;
    env?: Record<string, string>;
    onLog?: (stream: "stdout" | "stderr", chunk: string) => void;
    onExit?: (code: number | null, signal: string | null) => void;
  }): Promise<string | null> {
    const maxForType = opts.adapterType === "codex" ? MAX_CODEX : MAX_CLAUDE;
    const currentOfType = [...instances.values()].filter(
      (i) => i.adapterType === opts.adapterType,
    ).length;

    if (currentOfType >= maxForType) {
      log.warn({ adapterType: opts.adapterType }, "agent pool at capacity for type");
      return null;
    }

    const instanceId = `inst_${crypto.randomUUID().slice(0, 8)}`;
    const workspace = `${WORKSPACES_DIR}/${opts.agentId}`;

    // Determine command based on adapter type
    const cmd = opts.adapterType === "codex" ? "codex" : "claude";
    const args = [
      "--print",
      "--output-format", "json",
      opts.prompt,
    ];

    const childEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      MOLTCLIP_AGENT_ID: opts.agentId,
      MOLTCLIP_TASK_ID: opts.taskId,
      MOLTCLIP_INSTANCE_ID: instanceId,
      ...(opts.env || {}),
    };

    try {
      const child = spawn(cmd, args, {
        cwd: workspace,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
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
        log.info({ instanceId, code, signal }, "agent instance exited");
        opts.onExit?.(code, signal);
      });

      child.on("error", (err) => {
        instances.delete(instanceId);
        log.error({ instanceId, err }, "agent instance error");
        opts.onExit?.(-1, null);
      });

      log.info({ instanceId, agentId: opts.agentId, adapterType: opts.adapterType }, "agent spawned");
      return instanceId;
    } catch (err) {
      log.error({ err, agentId: opts.agentId }, "failed to spawn agent");
      return null;
    }
  },

  /**
   * Kill a running agent instance.
   */
  async kill(instanceId: string): Promise<void> {
    const instance = instances.get(instanceId);
    if (!instance) return;

    instance.process.kill("SIGTERM");

    // Give it 10s to exit gracefully
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        instance.process.kill("SIGKILL");
        resolve();
      }, 10_000);

      instance.process.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    instances.delete(instanceId);
  },

  /**
   * Kill all instances (graceful shutdown).
   */
  async killAll(): Promise<void> {
    const ids = [...instances.keys()];
    await Promise.allSettled(ids.map((id) => this.kill(id)));
  },

  getStatus() {
    const active = instances.size;
    const claudeCount = [...instances.values()].filter(
      (i) => i.adapterType !== "codex",
    ).length;
    const codexCount = [...instances.values()].filter(
      (i) => i.adapterType === "codex",
    ).length;

    return {
      max: MAX_CLAUDE + MAX_CODEX,
      active,
      claude: { max: MAX_CLAUDE, active: claudeCount },
      codex: { max: MAX_CODEX, active: codexCount },
      instances: [...instances.values()].map((i) => ({
        id: i.id,
        agentId: i.agentId,
        adapterType: i.adapterType,
        taskId: i.taskId,
        uptime: Date.now() - i.startedAt.getTime(),
      })),
    };
  },
};
