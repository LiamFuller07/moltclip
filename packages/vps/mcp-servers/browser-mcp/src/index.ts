#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CONTROLLER_URL = process.env.CONTROLLER_URL || "http://localhost:8800";
const AGENT_ID = process.env.MOLTCLIP_AGENT_ID || "";

// Track current browser slot for this agent session
let currentSlotId: string | null = null;

const server = new Server(
  { name: "moltclip-browser", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "open_browser",
      description:
        "Open a browser with a persistent profile for a specific service. Sessions persist across uses.",
      inputSchema: {
        type: "object",
        properties: {
          profileId: {
            type: "string",
            description: "Profile ID to use (e.g., 'prf_abc123')",
          },
          service: {
            type: "string",
            description: "Service name (e.g., 'github', 'amazon')",
          },
        },
        required: ["profileId", "service"],
      },
    },
    {
      name: "navigate",
      description: "Navigate the browser to a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to navigate to" },
        },
        required: ["url"],
      },
    },
    {
      name: "screenshot",
      description: "Take a screenshot of the current browser page",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "click",
      description: "Click on an element matching a CSS selector",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of element to click" },
        },
        required: ["selector"],
      },
    },
    {
      name: "type_text",
      description: "Type text into an input field",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of input element" },
          text: { type: "string", description: "Text to type" },
        },
        required: ["selector", "text"],
      },
    },
    {
      name: "get_page_content",
      description: "Get the text content of the current page",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "close_browser",
      description: "Close the current browser session",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_profiles",
      description: "List available browser profiles for this agent",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "open_browser": {
      const { profileId, service } = args as any;
      // Request browser launch from controller
      const res = await fetch(`${CONTROLLER_URL}/browsers/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, agentId: AGENT_ID, service }),
      });
      const data = await res.json() as any;
      if (data.slotId) {
        currentSlotId = data.slotId;
        return text(`Browser opened. Slot: ${data.slotId}, Profile: ${profileId}, Service: ${service}`);
      }
      return text(`Failed to open browser: ${JSON.stringify(data)}`);
    }

    case "navigate": {
      if (!currentSlotId) return text("No browser open. Use open_browser first.");
      const res = await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/navigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: (args as any).url }),
      });
      const data = await res.json() as any;
      return text(`Navigated to ${(args as any).url}. Title: ${data.title || "unknown"}`);
    }

    case "screenshot": {
      if (!currentSlotId) return text("No browser open. Use open_browser first.");
      const res = await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/screenshot`);
      if (!res.ok) return text("Screenshot failed");
      const buffer = await res.arrayBuffer();
      return {
        content: [{
          type: "image",
          data: btoa(String.fromCharCode(...new Uint8Array(buffer))),
          mimeType: "image/png",
        }],
      };
    }

    case "click": {
      if (!currentSlotId) return text("No browser open.");
      const res = await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector: (args as any).selector }),
      });
      const data = await res.json() as any;
      return text(data.ok ? "Clicked successfully" : `Click failed: ${data.error}`);
    }

    case "type_text": {
      if (!currentSlotId) return text("No browser open.");
      const res = await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      const data = await res.json() as any;
      return text(data.ok ? "Typed successfully" : `Type failed: ${data.error}`);
    }

    case "get_page_content": {
      if (!currentSlotId) return text("No browser open.");
      const res = await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/content`);
      const data = await res.json() as any;
      return text(data.content || "No content");
    }

    case "close_browser": {
      if (!currentSlotId) return text("No browser open.");
      await fetch(`${CONTROLLER_URL}/browsers/${currentSlotId}/close`, { method: "POST" });
      const slotId = currentSlotId;
      currentSlotId = null;
      return text(`Browser slot ${slotId} closed.`);
    }

    case "list_profiles": {
      const res = await fetch(`${CONTROLLER_URL}/browsers?agentId=${AGENT_ID}`);
      const data = await res.json() as any;
      return text(JSON.stringify(data, null, 2));
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
});

function text(str: string) {
  return { content: [{ type: "text" as const, text: str }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
