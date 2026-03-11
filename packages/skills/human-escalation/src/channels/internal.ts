import type { ChannelResult } from "@moltclip/shared";

/**
 * Escalate to the internal human team via a configured webhook.
 *
 * POSTs a structured notification to the team webhook (Slack, Discord, etc.)
 * for issues requiring organizational decisions or access grants.
 */
export async function escalateInternal(
  subject: string,
  description: string,
  webhookUrl: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 4 * 60 * 60 * 1000,
  ).toISOString();

  const draftContent = `[INTERNAL ESCALATION]\nSubject: ${subject}\n\n${description}`;

  const payload = {
    type: "escalation",
    subject,
    description,
    timestamp: now.toISOString(),
    requires_action: true,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "internal",
        draft_content: draftContent,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check webhook delivery logs",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "email",
        },
      };
    }

    const responseText = await res.text();

    return {
      channel: "internal",
      draft_content: draftContent,
      send_status: "sent",
      send_details: {
        platform_response: responseText,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Check internal channel for team response",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  } catch (err) {
    return {
      channel: "internal",
      draft_content: draftContent,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry webhook delivery",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  }
}
