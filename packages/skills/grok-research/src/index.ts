#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITION } from "./schema.js";
import { handleGrokResearch } from "./tool-handler.js";

const server = new Server(
  { name: "grok-research", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [TOOL_DEFINITION],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "grok_research") {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Unknown tool" }],
    };
  }

  return handleGrokResearch(
    (request.params.arguments ?? {}) as Record<string, unknown>,
  );
});

const transport = new StdioServerTransport();
await server.connect(transport);
