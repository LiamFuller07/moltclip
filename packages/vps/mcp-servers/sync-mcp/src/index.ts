#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const MASTER_URL = process.env.MASTER_WORKER_URL || "";
const CONTROLLER_SECRET = process.env.CONTROLLER_SECRET || "";
const AGENT_ID = process.env.MOLTCLIP_AGENT_ID || "";

const server = new Server(
  { name: "moltclip-sync", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_system_status",
      description: "Get the overall MoltClip system status (VPS nodes, tasks, agents)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_my_tasks",
      description: "Get tasks assigned to this agent",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status (queued, running, completed)" },
        },
      },
    },
    {
      name: "report_progress",
      description: "Report progress on a task to the Master Worker",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "Task ID" },
          status: { type: "string", description: "Status (running, completed, failed)" },
          message: { type: "string", description: "Progress message" },
        },
        required: ["taskId", "status"],
      },
    },
    {
      name: "get_cost_summary",
      description: "Get cost/usage summary for this agent",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(CONTROLLER_SECRET ? { Authorization: `Bearer ${CONTROLLER_SECRET}` } : {}),
  };

  switch (name) {
    case "get_system_status": {
      const res = await fetch(`${MASTER_URL}/api/status`, { headers });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_my_tasks": {
      const status = (args as any)?.status || "";
      const url = `${MASTER_URL}/api/tasks?agentId=${AGENT_ID}${status ? `&status=${status}` : ""}`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "report_progress": {
      const { taskId, status, message } = args as any;
      const res = await fetch(`${MASTER_URL}/api/tasks/${taskId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status, message, agentId: AGENT_ID }),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_cost_summary": {
      const res = await fetch(`${MASTER_URL}/api/costs?agentId=${AGENT_ID}`, { headers });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
