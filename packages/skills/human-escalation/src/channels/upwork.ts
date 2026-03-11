import type { ChannelResult } from "@moltclip/shared";

/**
 * Post a job on Upwork via the GraphQL API.
 *
 * Creates a fixed-price or hourly job posting to find a freelancer
 * who can resolve the blockade.
 */
export async function postUpworkJob(
  title: string,
  description: string,
  budget: { amount: number; type: "fixed" | "hourly" },
  apiKey: string,
): Promise<ChannelResult> {
  const now = new Date();
  const checkAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const escalateBy = new Date(
    now.getTime() + 96 * 60 * 60 * 1000,
  ).toISOString();

  const draftContent = `Title: ${title}\n\nDescription:\n${description}\n\nBudget: $${budget.amount} (${budget.type})`;

  try {
    const query = `
      mutation CreateJobPosting($input: CreateJobPostingInput!) {
        createJobPosting(input: $input) {
          jobPosting {
            id
            title
            status
          }
        }
      }
    `;

    const variables = {
      input: {
        title,
        description,
        budget: {
          amount: budget.amount,
          currencyCode: "USD",
          type: budget.type === "fixed" ? "FIXED_PRICE" : "HOURLY",
        },
        visibility: "PUBLIC",
        category: "Web, Mobile & Software Dev",
      },
    };

    const res = await fetch("https://api.upwork.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return {
        channel: "upwork",
        draft_content: draftContent,
        send_status: "failed",
        send_details: {
          platform_response: `HTTP ${res.status}: ${errorBody}`,
        },
        follow_up_plan: {
          check_at: checkAt,
          check_method: "Check Upwork dashboard for proposals",
          escalate_if_no_response_by: escalateBy,
          escalation_fallback: "email",
        },
      };
    }

    const data = (await res.json()) as {
      data?: {
        createJobPosting?: {
          jobPosting?: { id?: string; status?: string };
        };
      };
    };

    return {
      channel: "upwork",
      draft_content: draftContent,
      send_status: "sent",
      send_details: {
        platform_response: JSON.stringify(data),
        post_id: data.data?.createJobPosting?.jobPosting?.id,
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method:
          "Check Upwork dashboard for freelancer proposals and messages",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "email",
      },
    };
  } catch (err) {
    return {
      channel: "upwork",
      draft_content: draftContent,
      send_status: "failed",
      send_details: {
        platform_response:
          err instanceof Error ? err.message : String(err),
      },
      follow_up_plan: {
        check_at: checkAt,
        check_method: "Retry posting the job",
        escalate_if_no_response_by: escalateBy,
        escalation_fallback: "internal",
      },
    };
  }
}
