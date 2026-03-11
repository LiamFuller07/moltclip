import { z } from "zod";

// ── blockade_check input/output schemas ──

export const BlockadeCheckInputSchema = z.object({
  task_description: z.string().min(1),
  blockade_description: z.string().min(1),
  attempts: z.array(z.string()).min(2),
  domain: z.string().optional(),
});

export const SoftwareAlternativeSchema = z.object({
  tool_name: z.string(),
  description: z.string(),
  url: z.string(),
  solves_blockade: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const BlockadeCheckOutputSchema = z.object({
  confirmed: z.boolean(),
  blockade_type: z.enum(["A", "B", "C", "D"]).nullable(),
  type_rationale: z.string(),
  software_alternatives: z.array(SoftwareAlternativeSchema),
  recommended_channel: z
    .enum(["x_post", "x_dm", "x_job", "upwork", "email", "internal", "github"])
    .nullable(),
  channel_rationale: z.string().nullable(),
  estimated_resolution: z.string().nullable(),
  meta: z.object({
    task_description: z.string(),
    blockade_description: z.string(),
    attempts_reviewed: z.number(),
    tool_discovery_run: z.boolean(),
    timestamp: z.string(),
  }),
});

// ── escalate input/output schemas ──

export const EscalateInputSchema = z.object({
  blockade_check_result: z.object({
    confirmed: z.boolean(),
    blockade_type: z.enum(["A", "B", "C", "D"]).nullable(),
    type_rationale: z.string(),
    software_alternatives: z.array(SoftwareAlternativeSchema),
    recommended_channel: z
      .enum([
        "x_post",
        "x_dm",
        "x_job",
        "upwork",
        "email",
        "internal",
        "github",
      ])
      .nullable(),
    channel_rationale: z.string().nullable(),
    estimated_resolution: z.string().nullable(),
    meta: z.object({
      task_description: z.string(),
      blockade_description: z.string(),
      attempts_reviewed: z.number(),
      tool_discovery_run: z.boolean(),
      timestamp: z.string(),
    }),
  }),
  channel: z.enum([
    "x_post",
    "x_dm",
    "x_job",
    "upwork",
    "email",
    "internal",
    "github",
  ]),
  target: z.string().optional(),
  auto_send: z.boolean().default(false),
  urgency: z.enum(["low", "medium", "high", "critical"]),
});

export const ChannelResultSchema = z.object({
  channel: z.enum([
    "x_post",
    "x_dm",
    "x_job",
    "upwork",
    "email",
    "internal",
    "github",
  ]),
  draft_content: z.string(),
  send_status: z.enum(["draft", "sent", "failed"]),
  send_details: z
    .object({
      platform_response: z.string(),
      post_id: z.string().optional(),
      dm_id: z.string().optional(),
    })
    .optional(),
  follow_up_plan: z.object({
    check_at: z.string(),
    check_method: z.string(),
    escalate_if_no_response_by: z.string(),
    escalation_fallback: z.string(),
  }),
});

// ── Tool definitions for MCP registration ──

export const TOOL_DEFINITIONS = [
  {
    name: "blockade_check",
    description:
      "Detects and classifies a blockade that prevents task completion. " +
      "Runs up to 5 rounds of software-first search using Grok to find existing tools " +
      "that solve the blockade before recommending human escalation. " +
      "Returns blockade type (A-D), software alternatives found, and recommended channel.",
    inputSchema: {
      type: "object" as const,
      required: ["task_description", "blockade_description", "attempts"],
      properties: {
        task_description: {
          type: "string",
          description: "What the agent was trying to accomplish.",
        },
        blockade_description: {
          type: "string",
          description:
            "What specifically is blocking progress. Be precise about the technical barrier.",
        },
        attempts: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          description:
            "List of approaches already tried. Minimum 2 required to confirm genuine blockade.",
        },
        domain: {
          type: "string",
          description:
            "Optional domain hint to focus tool discovery (e.g., 'browser automation', 'API integration').",
        },
      },
    },
  },
  {
    name: "escalate",
    description:
      "Escalates a confirmed blockade to a human via the specified channel. " +
      "Drafts appropriate outreach content, optionally sends it, and creates a follow-up plan. " +
      "Requires a prior blockade_check result to proceed.",
    inputSchema: {
      type: "object" as const,
      required: ["blockade_check_result", "channel", "urgency"],
      properties: {
        blockade_check_result: {
          type: "object",
          description:
            "The full result object from a prior blockade_check call.",
        },
        channel: {
          type: "string",
          enum: [
            "x_post",
            "x_dm",
            "x_job",
            "upwork",
            "email",
            "internal",
            "github",
          ],
          description: "The escalation channel to use.",
        },
        target: {
          type: "string",
          description:
            "Channel-specific target. X DM: recipient user ID. Email: address. GitHub: owner/repo. Upwork: job category.",
        },
        auto_send: {
          type: "boolean",
          default: false,
          description:
            "If true, actually send/post the message. If false (default), return draft only.",
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Urgency level affects tone, follow-up timing, and fallback speed.",
        },
      },
    },
  },
];
