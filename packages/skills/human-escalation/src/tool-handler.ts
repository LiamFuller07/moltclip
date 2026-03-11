import type { BlockadeCheckResult, ChannelResult } from "@moltclip/shared";
import { BlockadeCheckInputSchema, EscalateInputSchema } from "./schema.js";
import { detectBlockade } from "./blockade-detector.js";
import { sendXPost } from "./channels/x-post.js";
import { sendXDm } from "./channels/x-dm.js";
import { postUpworkJob } from "./channels/upwork.js";
import { sendEmail } from "./channels/email.js";
import { escalateInternal } from "./channels/internal.js";
import { createGithubIssue } from "./channels/github.js";

type McpResponse = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Handle the blockade_check tool call.
 *
 * Validates input, runs blockade detection with software-first search,
 * and returns a BlockadeCheckResult.
 */
export async function handleBlockadeCheck(
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parseResult = BlockadeCheckInputSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "INVALID_INPUT",
            message: parseResult.error.message,
          }),
        },
      ],
    };
  }

  const { task_description, blockade_description, attempts, domain } =
    parseResult.data;

  try {
    const result: BlockadeCheckResult = await detectBlockade(
      task_description,
      blockade_description,
      attempts,
      domain,
    );

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("429") || message.includes("rate")) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "RATE_LIMIT",
              message,
              retry_after: 8000,
            }),
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "INTERNAL_ERROR", message }),
        },
      ],
    };
  }
}

/**
 * Handle the escalate tool call.
 *
 * Validates input, drafts content for the selected channel,
 * optionally sends it, and returns a ChannelResult with follow-up plan.
 */
export async function handleEscalate(
  args: Record<string, unknown>,
): Promise<McpResponse> {
  const parseResult = EscalateInputSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "INVALID_INPUT",
            message: parseResult.error.message,
          }),
        },
      ],
    };
  }

  const { blockade_check_result, channel, target, auto_send, urgency } =
    parseResult.data;

  // Verify the blockade was confirmed
  if (!blockade_check_result.confirmed) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "BLOCKADE_NOT_CONFIRMED",
            message:
              "Cannot escalate: blockade_check_result.confirmed is false. " +
              "A software solution was found. Check software_alternatives.",
          }),
        },
      ],
    };
  }

  const blockadeDesc =
    blockade_check_result.meta.blockade_description;
  const taskDesc = blockade_check_result.meta.task_description;

  try {
    let result: ChannelResult;

    switch (channel) {
      case "x_post": {
        const bearerToken = process.env.X_BEARER_TOKEN;
        if (!bearerToken) {
          return envError("X_BEARER_TOKEN");
        }
        const content = draftXPost(blockadeDesc, taskDesc, urgency);
        if (!auto_send) {
          result = draftOnly("x_post", content);
        } else {
          result = await sendXPost(content, bearerToken);
        }
        break;
      }

      case "x_dm": {
        const bearerToken = process.env.X_BEARER_TOKEN;
        if (!bearerToken) {
          return envError("X_BEARER_TOKEN");
        }
        if (!target) {
          return missingTarget("x_dm", "recipient user ID");
        }
        const content = draftXDm(blockadeDesc, taskDesc, target);
        if (!auto_send) {
          result = draftOnly("x_dm", content);
        } else {
          result = await sendXDm(target, content, bearerToken);
        }
        break;
      }

      case "x_job": {
        // x_job uses the same X post mechanism with job-specific framing
        const bearerToken = process.env.X_BEARER_TOKEN;
        if (!bearerToken) {
          return envError("X_BEARER_TOKEN");
        }
        const content = draftXJobPost(blockadeDesc, taskDesc, urgency);
        if (!auto_send) {
          result = draftOnly("x_job", content);
        } else {
          result = await sendXPost(content, bearerToken);
          result.channel = "x_job";
        }
        break;
      }

      case "upwork": {
        const apiKey = process.env.UPWORK_API_KEY;
        if (!apiKey) {
          return envError("UPWORK_API_KEY");
        }
        const title = `Expert needed: ${blockadeDesc.slice(0, 80)}`;
        const description = draftUpworkDescription(
          blockadeDesc,
          taskDesc,
          urgency,
        );
        const budget = urgency === "critical" ? 500 : urgency === "high" ? 300 : 150;
        if (!auto_send) {
          result = draftOnly(
            "upwork",
            `Title: ${title}\n\nDescription:\n${description}\n\nBudget: $${budget} (fixed)`,
          );
        } else {
          result = await postUpworkJob(
            title,
            description,
            { amount: budget, type: "fixed" },
            apiKey,
          );
        }
        break;
      }

      case "email": {
        const identityWorkerUrl = process.env.IDENTITY_WORKER_URL;
        const agentId = process.env.AGENT_ID;
        if (!identityWorkerUrl || !agentId) {
          return envError("IDENTITY_WORKER_URL and AGENT_ID");
        }
        if (!target) {
          return missingTarget("email", "email address");
        }
        const subject = `Assistance needed: ${blockadeDesc.slice(0, 60)}`;
        const body = draftEmailBody(blockadeDesc, taskDesc, urgency);
        if (!auto_send) {
          result = draftOnly(
            "email",
            `To: ${target}\nSubject: ${subject}\n\n${body}`,
          );
        } else {
          result = await sendEmail(
            target,
            subject,
            body,
            identityWorkerUrl,
            agentId,
          );
        }
        break;
      }

      case "internal": {
        const webhookUrl = process.env.INTERNAL_WEBHOOK_URL;
        if (!webhookUrl) {
          return envError("INTERNAL_WEBHOOK_URL");
        }
        const subject = `[${urgency.toUpperCase()}] Blockade: ${blockadeDesc.slice(0, 60)}`;
        const description = draftInternalDescription(
          blockadeDesc,
          taskDesc,
          blockade_check_result,
          urgency,
        );
        if (!auto_send) {
          result = draftOnly(
            "internal",
            `[INTERNAL ESCALATION]\nSubject: ${subject}\n\n${description}`,
          );
        } else {
          result = await escalateInternal(subject, description, webhookUrl);
        }
        break;
      }

      case "github": {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return envError("GITHUB_TOKEN");
        }
        if (!target) {
          return missingTarget("github", "owner/repo");
        }
        const title = `${blockadeDesc.slice(0, 100)}`;
        const body = draftGithubIssueBody(blockadeDesc, taskDesc, urgency);
        if (!auto_send) {
          result = draftOnly(
            "github",
            `Repository: ${target}\nTitle: ${title}\n\n${body}`,
          );
        } else {
          result = await createGithubIssue(target, title, body, token);
        }
        break;
      }

      default: {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "UNSUPPORTED_CHANNEL",
                message: `Channel "${channel}" is not supported.`,
              }),
            },
          ],
        };
      }
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "ESCALATION_FAILED", message }),
        },
      ],
    };
  }
}

// ── Helpers ──

function envError(varName: string): McpResponse {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "MISSING_ENV",
          message: `${varName} environment variable is required for this channel.`,
        }),
      },
    ],
  };
}

function missingTarget(channel: string, expected: string): McpResponse {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "MISSING_TARGET",
          message: `Channel "${channel}" requires a target parameter (${expected}).`,
        }),
      },
    ],
  };
}

function draftOnly(
  channel: ChannelResult["channel"],
  content: string,
): ChannelResult {
  const now = new Date();
  return {
    channel,
    draft_content: content,
    send_status: "draft",
    follow_up_plan: {
      check_at: new Date(
        now.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      check_method: "Review draft and send manually or re-run with auto_send=true",
      escalate_if_no_response_by: new Date(
        now.getTime() + 72 * 60 * 60 * 1000,
      ).toISOString(),
      escalation_fallback: "internal",
    },
  };
}

function draftXPost(
  blockadeDesc: string,
  taskDesc: string,
  urgency: string,
): string {
  const urgencyTag = urgency === "critical" ? " [URGENT]" : "";
  const shortDesc = blockadeDesc.slice(0, 180);
  return `${urgencyTag}Seeking help: ${shortDesc}\n\nContext: ${taskDesc.slice(0, 60)}\n\n#DevHelp #OpenSource`.slice(
    0,
    280,
  );
}

function draftXDm(
  blockadeDesc: string,
  taskDesc: string,
  recipientId: string,
): string {
  return (
    `Hi! I'm working on ${taskDesc.slice(0, 80)} and hit a technical challenge: ` +
    `${blockadeDesc.slice(0, 150)}. ` +
    `Your expertise seems highly relevant. Would you be open to a brief discussion? ` +
    `Happy to share full details via email or a quick call.`
  );
}

function draftXJobPost(
  blockadeDesc: string,
  taskDesc: string,
  urgency: string,
): string {
  const urgencyNote = urgency === "critical" ? " ASAP needed." : "";
  return `Looking for an expert to help with: ${blockadeDesc.slice(0, 140)}.${urgencyNote} DM if interested.\n\n#FreelanceWork #TechJobs`.slice(
    0,
    280,
  );
}

function draftUpworkDescription(
  blockadeDesc: string,
  taskDesc: string,
  urgency: string,
): string {
  return [
    `## Task Overview`,
    taskDesc,
    ``,
    `## Specific Challenge`,
    blockadeDesc,
    ``,
    `## Requirements`,
    `- Experience with the specific technology described above`,
    `- Clear communication and ability to explain the solution`,
    `- Availability to start ${urgency === "critical" ? "immediately" : "within 48 hours"}`,
    ``,
    `## Deliverables`,
    `- Working solution or clear guidance to resolve the blockade`,
    `- Brief documentation of the approach taken`,
  ].join("\n");
}

function draftEmailBody(
  blockadeDesc: string,
  taskDesc: string,
  urgency: string,
): string {
  const urgencyLine =
    urgency === "critical"
      ? "This is time-sensitive and we would greatly appreciate a prompt response.\n\n"
      : "";

  return [
    `Hello,`,
    ``,
    `I'm reaching out regarding a technical challenge we've encountered.`,
    ``,
    `Task: ${taskDesc}`,
    ``,
    `Challenge: ${blockadeDesc}`,
    ``,
    urgencyLine,
    `Would you be available to discuss this? We're looking for guidance or a direct solution.`,
    ``,
    `Thank you for your time.`,
  ].join("\n");
}

function draftInternalDescription(
  blockadeDesc: string,
  taskDesc: string,
  checkResult: Record<string, unknown>,
  urgency: string,
): string {
  return [
    `Urgency: ${urgency.toUpperCase()}`,
    `Blockade Type: ${(checkResult as { blockade_type?: string }).blockade_type ?? "unknown"}`,
    ``,
    `Task: ${taskDesc}`,
    ``,
    `Blockade: ${blockadeDesc}`,
    ``,
    `Software alternatives searched: ${((checkResult as { software_alternatives?: unknown[] }).software_alternatives ?? []).length} found, none resolved the issue.`,
    ``,
    `Action required: Please review and provide guidance or access to resolve this blockade.`,
  ].join("\n");
}

function draftGithubIssueBody(
  blockadeDesc: string,
  taskDesc: string,
  urgency: string,
): string {
  return [
    `## Description`,
    ``,
    blockadeDesc,
    ``,
    `## Context`,
    ``,
    taskDesc,
    ``,
    `## Environment`,
    ``,
    `- Node.js ${process.version}`,
    `- OS: ${process.platform}`,
    ``,
    `## Expected Behavior`,
    ``,
    `Looking for guidance or a fix to resolve the described blockade.`,
    ``,
    urgency === "critical" || urgency === "high"
      ? `> **Note**: This is a ${urgency}-priority issue for our use case.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
