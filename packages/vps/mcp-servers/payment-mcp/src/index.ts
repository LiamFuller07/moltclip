#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PAYMENT_WORKER_URL = process.env.PAYMENT_WORKER_URL || "http://localhost:8788";
const AGENT_ID = process.env.MOLTCLIP_AGENT_ID || "";

const server = new Server(
  { name: "moltclip-payment", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_balance",
      description: "Get current spending balance and remaining budget",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_card",
      description: "Get virtual card details for making a purchase",
      inputSchema: {
        type: "object",
        properties: {
          merchant: { type: "string", description: "Merchant name (e.g., 'anthropic', 'aws')" },
        },
        required: ["merchant"],
      },
    },
    {
      name: "request_approval",
      description: "Request human approval for a purchase over the threshold",
      inputSchema: {
        type: "object",
        properties: {
          amountCents: { type: "number", description: "Amount in cents" },
          merchant: { type: "string", description: "Merchant name" },
          reason: { type: "string", description: "Why this purchase is needed" },
        },
        required: ["amountCents", "merchant", "reason"],
      },
    },
    {
      name: "get_transactions",
      description: "Get recent transaction history",
      inputSchema: {
        type: "object",
        properties: {
          month: { type: "string", description: "Month (YYYY-MM), defaults to current" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "get_balance": {
      const res = await fetch(`${PAYMENT_WORKER_URL}/api/payment/${AGENT_ID}/balance`);
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_card": {
      const res = await fetch(`${PAYMENT_WORKER_URL}/api/payment/${AGENT_ID}/cards`);
      const data = await res.json() as any;
      const cards = data.cards || [];
      const match = cards.find(
        (c: any) => c.merchantLock === (args as any).merchant || !c.merchantLock,
      );
      return {
        content: [{
          type: "text",
          text: match
            ? JSON.stringify(match, null, 2)
            : "No card found for this merchant. Request one via the admin.",
        }],
      };
    }

    case "request_approval": {
      const res = await fetch(`${PAYMENT_WORKER_URL}/api/payment/${AGENT_ID}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "get_transactions": {
      const month = (args as any)?.month || new Date().toISOString().slice(0, 7);
      const res = await fetch(
        `${PAYMENT_WORKER_URL}/api/payment/${AGENT_ID}/transactions?month=${month}`,
      );
      const data = await res.json();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
