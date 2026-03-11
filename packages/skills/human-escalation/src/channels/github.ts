import type { ChannelResult } from "@moltclip/shared";

/**
 * Create a GitHub issue on the specified repository.
 *
 * Used for Type A (API/SaaS) blockades to report bugs, request features,
 * or ask for guidance from tool maintainers.
 */
export async function createGithubIssue(
  repo: string,
  title: string,
  body: string,
  token: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 168 * 60 * 60 * 1000,
  ).toISOString();

  const draftContent = `Repository: ${repo}\nTitle: ${title}\n\n${body}`;

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, body }),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "github",
        draft_content: draftContent,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check GitHub issue for maintainer response",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "email",
        },
      };
    }

    const data = (await res.json()) as {
      number?: number;
      html_url?: string;
      id?: number;
    };

    return {
      channel: "github",
      draft_content: draftContent,
      send_status: "sent",
      send_details: {
        platform_response: JSON.stringify(data),
        post_id: data.number ? String(data.number) : undefined,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: `Check GitHub issue ${data.html_url ?? `#${data.number}`} for maintainer response`,
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  } catch (err) {
    return {
      channel: "github",
      draft_content: draftContent,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry creating the GitHub issue",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  }
}
