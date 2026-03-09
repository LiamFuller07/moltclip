#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("moltclip")
  .description("MoltClip - Scalable AI Agent Infrastructure")
  .version("0.1.0");

// ── Status ──

program
  .command("status")
  .description("Show system-wide health status")
  .option("--url <url>", "Master Worker URL")
  .action(async (opts) => {
    const url = opts.url || process.env.MASTER_WORKER_URL || "http://localhost:8787";
    try {
      const res = await fetch(`${url}/api/status`);
      const data = await res.json();
      console.log("\nMoltClip System Status");
      console.log("=".repeat(40));
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to reach Master Worker:", err);
    }
  });

// ── VPS Management ──

const vps = program.command("vps").description("Manage VPS nodes");

vps
  .command("list")
  .description("List registered VPS nodes")
  .action(async () => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const res = await fetch(`${url}/api/vps`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  });

vps
  .command("register")
  .description("Register a new VPS node")
  .requiredOption("--host <host>", "VPS controller URL")
  .option("--region <region>", "Region", "us")
  .option("--provider <provider>", "Provider", "contabo")
  .option("--max-browsers <n>", "Max browsers", "10")
  .option("--max-agents <n>", "Max agent instances", "6")
  .action(async (opts) => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const res = await fetch(`${url}/api/vps/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: opts.host,
        region: opts.region,
        provider: opts.provider,
        maxBrowsers: parseInt(opts.maxBrowsers, 10),
        maxAgentInstances: parseInt(opts.maxAgents, 10),
      }),
    });
    const data = await res.json();
    console.log("Registered:", JSON.stringify(data, null, 2));
  });

// ── Agent Management ──

const agent = program.command("agent").description("Manage agents");

agent
  .command("list")
  .description("List all agents")
  .action(async () => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const res = await fetch(`${url}/api/agents`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  });

agent
  .command("create")
  .description("Create a new agent")
  .requiredOption("--name <name>", "Agent display name")
  .option("--adapter <type>", "Adapter type", "claude_local")
  .action(async (opts) => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const res = await fetch(`${url}/api/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: opts.name,
        adapterType: opts.adapter,
      }),
    });
    const data = await res.json();
    console.log("Created:", JSON.stringify(data, null, 2));
  });

// ── Task Management ──

const task = program.command("task").description("Manage tasks");

task
  .command("list")
  .description("List tasks")
  .option("--status <status>", "Filter by status")
  .option("--agent <agentId>", "Filter by agent")
  .action(async (opts) => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.agent) params.set("agentId", opts.agent);
    const res = await fetch(`${url}/api/tasks?${params}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  });

task
  .command("create")
  .description("Create a new task")
  .requiredOption("--type <type>", "Task type (browser, code, email, payment)")
  .option("--agent <agentId>", "Assign to agent")
  .option("--prompt <prompt>", "Task prompt/payload")
  .option("--priority <n>", "Priority (0-10)", "0")
  .action(async (opts) => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const res = await fetch(`${url}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: opts.type,
        agentId: opts.agent,
        priority: parseInt(opts.priority, 10),
        payload: { prompt: opts.prompt || "" },
      }),
    });
    const data = await res.json();
    console.log("Created:", JSON.stringify(data, null, 2));
  });

// ── Costs ──

program
  .command("costs")
  .description("Show cost summary")
  .option("--agent <agentId>", "Filter by agent")
  .action(async (opts) => {
    const url = process.env.MASTER_WORKER_URL || "http://localhost:8787";
    const params = opts.agent ? `?agentId=${opts.agent}` : "";
    const res = await fetch(`${url}/api/costs${params}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  });

program.parse();
