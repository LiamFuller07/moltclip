import type { BlockadeType, EscalationChannel } from "@moltclip/shared";

interface RoutingContext {
  blockadeDescription: string;
  attempts: string[];
  domain?: string;
}

interface ChannelRecommendation {
  channel: EscalationChannel;
  rationale: string;
}

/**
 * Channel priority by blockade type:
 *
 * Type A (API/SaaS blockade): github → email → x_dm
 *   Rationale: maintainers respond best to structured issues, then direct contact
 *
 * Type B (Knowledge blockade): x_post → upwork → email
 *   Rationale: broadcast to community first, then hire expert, then targeted outreach
 *
 * Type C (Access blockade): internal → email
 *   Rationale: access grants usually come from internal team or direct vendor contact
 *
 * Type D (Resource blockade): internal → upwork
 *   Rationale: resource allocation is an internal decision, or outsource the work
 */
const CHANNEL_PRIORITY: Record<BlockadeType, EscalationChannel[]> = {
  A: ["github", "email", "x_dm"],
  B: ["x_post", "upwork", "email"],
  C: ["internal", "email"],
  D: ["internal", "upwork"],
};

const CHANNEL_RATIONALES: Record<EscalationChannel, string> = {
  github:
    "Opening a GitHub issue targets the tool maintainers directly with a structured bug report or feature request.",
  email:
    "Email provides a formal, direct channel for professional requests that require detailed context.",
  x_dm:
    "A targeted X direct message reaches the individual most likely to help with a concise, personal ask.",
  x_post:
    "A public X post broadcasts the need to a wide community of practitioners who may have solved this.",
  x_job:
    "An X job post reaches technical professionals actively seeking consulting or contract work.",
  upwork:
    "Posting on Upwork engages freelance experts who can be hired to resolve the blockade directly.",
  internal:
    "Internal escalation notifies the human team for issues that require organizational decisions or access grants.",
};

/**
 * Select the best escalation channel based on blockade type and context.
 *
 * Returns the first available channel from the priority list for the given
 * blockade type, along with a rationale for the selection.
 */
export function selectChannel(
  blockadeType: BlockadeType,
  context: RoutingContext,
): ChannelRecommendation {
  const priorities = CHANNEL_PRIORITY[blockadeType];
  const channel = priorities[0];

  const rationale =
    `${CHANNEL_RATIONALES[channel]} ` +
    `Selected as primary channel for Type ${blockadeType} blockade. ` +
    `Fallback channels: ${priorities.slice(1).join(" → ")}.`;

  return { channel, rationale };
}
