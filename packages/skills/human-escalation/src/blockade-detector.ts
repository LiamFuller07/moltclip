import type { BlockadeType, BlockadeCheckResult } from "@moltclip/shared";
import {
  ESCALATION_SOFTWARE_ROUNDS,
  ESCALATION_ROUND_TIMEOUT_MS,
} from "@moltclip/shared";
import { discoverTools } from "./tool-discovery-router.js";
import { selectChannel } from "./engagement-router.js";

/**
 * Classify blockade type from description analysis.
 *
 * Type A — API/SaaS blockade: needs a specific tool, service, or API access
 * Type B — Knowledge blockade: needs expert knowledge or guidance
 * Type C — Access blockade: needs credentials, permissions, or account access
 * Type D — Resource blockade: needs compute, budget, or physical resources
 */
function classifyBlockade(
  blockadeDescription: string,
  attempts: string[],
): { type: BlockadeType; rationale: string } {
  const desc = blockadeDescription.toLowerCase();
  const allText = `${desc} ${attempts.join(" ").toLowerCase()}`;

  // Type C — Access: credentials, permissions, login, auth, keys
  if (
    /\b(credentials?|permission|access denied|auth(entication|orization)?|login|api.?key|token|oauth|forbidden|403|401)\b/.test(
      allText,
    )
  ) {
    return {
      type: "C",
      rationale:
        "Blockade involves access, authentication, or credential requirements that software alone cannot resolve.",
    };
  }

  // Type D — Resource: budget, compute, hardware, capacity
  if (
    /\b(budget|cost|pay|compute|gpu|memory|disk|capacity|quota|limit|resource|hardware)\b/.test(
      allText,
    )
  ) {
    return {
      type: "D",
      rationale:
        "Blockade involves resource constraints (budget, compute, capacity) requiring allocation decisions.",
    };
  }

  // Type A — API/SaaS: tool, library, service, API, integration, SDK
  if (
    /\b(api|sdk|library|package|service|saas|tool|integration|endpoint|webhook|plugin)\b/.test(
      allText,
    )
  ) {
    return {
      type: "A",
      rationale:
        "Blockade requires a specific tool, API, or service integration that may already exist.",
    };
  }

  // Type B — Knowledge: fallback for expert knowledge gaps
  return {
    type: "B",
    rationale:
      "Blockade appears to be a knowledge gap requiring expert human guidance or domain-specific insight.",
  };
}

/**
 * Detect whether a genuine blockade exists and attempt software-first resolution.
 *
 * Runs up to ESCALATION_SOFTWARE_ROUNDS rounds of tool discovery via Grok,
 * checking each round for a high-confidence match (relevance > 0.7).
 * If a tool is found that solves the blockade, confirmed = false (no escalation needed).
 */
export async function detectBlockade(
  taskDescription: string,
  blockadeDescription: string,
  attempts: string[],
  domain?: string,
): Promise<BlockadeCheckResult> {
  const { type, rationale } = classifyBlockade(blockadeDescription, attempts);

  const allAlternatives: BlockadeCheckResult["software_alternatives"] = [];
  let toolDiscoveryRun = false;

  // Run software-first search rounds
  for (let round = 0; round < ESCALATION_SOFTWARE_ROUNDS; round++) {
    toolDiscoveryRun = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        ESCALATION_ROUND_TIMEOUT_MS,
      );

      const tools = await discoverTools(
        blockadeDescription,
        attempts,
        domain,
      );

      clearTimeout(timeout);

      for (const tool of tools) {
        // Deduplicate by tool name
        if (
          !allAlternatives.some(
            (a) => a.tool_name.toLowerCase() === tool.tool_name.toLowerCase(),
          )
        ) {
          allAlternatives.push(tool);
        }
      }

      // Check if any discovered tool solves the blockade with high confidence
      const solver = allAlternatives.find(
        (a) => a.solves_blockade && a.confidence > 0.7,
      );

      if (solver) {
        // Software solution found — no human escalation needed
        return {
          confirmed: false,
          blockade_type: type,
          type_rationale: rationale,
          software_alternatives: allAlternatives,
          recommended_channel: null,
          channel_rationale: `Software solution found: ${solver.tool_name} (confidence: ${solver.confidence})`,
          estimated_resolution: null,
          meta: {
            task_description: taskDescription,
            blockade_description: blockadeDescription,
            attempts_reviewed: attempts.length,
            tool_discovery_run: true,
            timestamp: new Date().toISOString(),
          },
        };
      }
    } catch (err) {
      // Log round failure but continue to next round
      console.error(
        `Tool discovery round ${round + 1} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // All rounds exhausted, no software solution found — escalation confirmed
  const { channel, rationale: channelRationale } = selectChannel(type, {
    blockadeDescription,
    attempts,
    domain,
  });

  // Estimate resolution time based on channel and urgency
  const resolutionEstimates: Record<string, string> = {
    x_post: "24-72 hours",
    x_dm: "12-48 hours",
    x_job: "24-72 hours",
    upwork: "48-96 hours",
    email: "24-72 hours",
    internal: "1-4 hours",
    github: "48-168 hours",
  };

  return {
    confirmed: true,
    blockade_type: type,
    type_rationale: rationale,
    software_alternatives: allAlternatives,
    recommended_channel: channel,
    channel_rationale: channelRationale,
    estimated_resolution: resolutionEstimates[channel] ?? "unknown",
    meta: {
      task_description: taskDescription,
      blockade_description: blockadeDescription,
      attempts_reviewed: attempts.length,
      tool_discovery_run: toolDiscoveryRun,
      timestamp: new Date().toISOString(),
    },
  };
}
