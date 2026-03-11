import type { ChannelResult } from "@moltclip/shared";

/**
 * Send a public X (Twitter) post via the v2 API.
 *
 * Requires a bearer token with tweet.write scope.
 * Returns ChannelResult with post_id on success.
 */
export async function sendXPost(
  content: string,
  bearerToken: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 72 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const res = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: content }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "x_post",
        draft_content: content,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check X notifications and mentions",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "x_dm",
        },
      };
    }

    const data = (await res.json()) as { data?: { id?: string } };
    const postId = data.data?.id;

    return {
      channel: "x_post",
      draft_content: content,
      send_status: "sent",
      send_details: {
        platform_response: JSON.stringify(data),
        post_id: postId,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method:
          "Check X notifications, replies, and quote tweets on the post",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "x_dm",
      },
    };
  } catch (err) {
    return {
      channel: "x_post",
      draft_content: content,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry sending the post",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  }
}
