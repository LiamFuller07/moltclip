import type { ChannelResult } from "@moltclip/shared";

/**
 * Send an email via the identity worker's send email endpoint.
 *
 * Routes through the identity worker which manages AgentMail outbound sending.
 */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  identityWorkerUrl: string,
  agentId: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 72 * 60 * 60 * 1000,
  ).toISOString();

  const draftContent = `To: ${to}\nSubject: ${subject}\n\n${body}`;

  try {
    const res = await fetch(`${identityWorkerUrl}/api/agents/${agentId}/email/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        subject,
        body,
        format: "text",
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "email",
        draft_content: draftContent,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check agent email inbox for reply",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "x_dm",
        },
      };
    }

    const data = (await res.json()) as {
      messageId?: string;
      status?: string;
    };

    return {
      channel: "email",
      draft_content: draftContent,
      send_status: "sent",
      send_details: {
        platform_response: JSON.stringify(data),
        post_id: data.messageId,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Check agent email inbox for reply from recipient",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "x_dm",
      },
    };
  } catch (err) {
    return {
      channel: "email",
      draft_content: draftContent,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry sending the email",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "internal",
      },
    };
  }
}
