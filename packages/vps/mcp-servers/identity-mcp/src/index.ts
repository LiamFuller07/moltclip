#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const IDENTITY_WORKER_URL = process.env.IDENTITY_WORKER_URL || "http://localhost:8787";
const AGENT_ID = process.env.MOLTCLIP_AGENT_ID || "";

const server = new Server(
  { name: "moltclip-identity", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_my_email",
      description: "Get this agent's email address",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "check_inbox",
      description: "Check for new emails in this agent's inbox",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max messages to return", default: 10 },
        },
      },
    },
    {
      name: "send_email",
      description: "Send an email from this agent's inbox",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "get_credential",
      description: "Retrieve a stored credential for a service",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service name (e.g., 'github', 'amazon')" },
        },
        required: ["service"],
      },
    },
    {
      name: "get_2fa_code",
      description: "Generate a TOTP 2FA code for a service",
      inputSchema: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service name" },
        },
        required: ["service"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_my_email": {
      const res = await fetch(`${IDENTITY_WORKER_URL}/api/identity/${AGENT_ID}/inbox`);
      const data = await res.json() as any;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "check_inbox": {
      const res = await fetch(`${IDENTITY_WORKER_URL}/api/identity/${AGENT_ID}/inbox`);
      const data = await res.json() as any;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "send_email": {
      const res = await fetch(`${IDENTITY_WORKER_URL}/api/identity/${AGENT_ID}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json() as any;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_credential": {
      const service = (args as any).service;
      const res = await fetch(
        `${IDENTITY_WORKER_URL}/api/identity/${AGENT_ID}/credentials/${service}`,
      );
      const data = await res.json() as any;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_2fa_code": {
      const service = (args as any).service;
      const res = await fetch(
        `${IDENTITY_WORKER_URL}/api/identity/${AGENT_ID}/totp/${service}`,
      );
      const data = await res.json() as any;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
