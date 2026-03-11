#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITION } from "./schema.js";
import { handleHarnessReview } from "./tool-handler.js";

const server = new Server(
  { name: "harness-review", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [TOOL_DEFINITION],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "harness_review") {
    return {
      isError: true,
      content: [{ type: "text" as const, text: "Unknown tool" }],
    };
  }

  return handleHarnessReview(
    (request.params.arguments ?? {}) as Record<string, unknown>,
  );
});

const transport = new StdioServerTransport();
await server.connect(transport);
