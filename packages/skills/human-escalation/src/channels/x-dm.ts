import type { ChannelResult } from "@moltclip/shared";

/**
 * Send a direct message on X (Twitter) via the v2 DM API.
 *
 * Requires a bearer token with dm.write scope.
 * Returns ChannelResult with dm_id on success.
 */
export async function sendXDm(
  recipientId: string,
  content: string,
  bearerToken: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 48 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const res = await fetch(
      `https://api.x.com/2/dm_conversations/with/${recipientId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: content,
        }),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "x_dm",
        draft_content: content,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check X DM inbox for reply",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "email",
        },
      };
    }

    const data = (await res.json()) as {
      data?: { dm_event_id?: string };
    };
    const dmId = data.data?.dm_event_id;

    return {
      channel: "x_dm",
      draft_content: content,
      send_status: "sent",
      send_details: {
        platform_response: JSON.stringify(data),
        dm_id: dmId,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Check X DM inbox for reply from recipient",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  } catch (err) {
    return {
      channel: "x_dm",
      draft_content: content,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry sending the DM",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  }
}
