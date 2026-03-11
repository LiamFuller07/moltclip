import pino from "pino";
import { env } from "../env.js";
import { sql } from "../db.js";

const log = pino({ name: "x-monitor" });

const SEARCH_QUERIES = [
  "AI agent infrastructure",
  "Claude Code automation",
  "autonomous coding agent",
  "MCP server tools",
];

export const xMonitor = {
  async run(): Promise<void> {
    if (!env.xBearerToken) {
      log.warn("X_BEARER_TOKEN not set, skipping X monitor");
      return;
    }

    for (const query of SEARCH_QUERIES) {
      try {
        const url = new URL("https://api.twitter.com/2/tweets/search/recent");
        url.searchParams.set("query", query);
        url.searchParams.set("max_results", "10");
        url.searchParams.set("tweet.fields", "created_at,author_id,public_metrics");

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${env.xBearerToken}` },
        });

        if (!res.ok) {
          log.warn({ status: res.status, query }, "X API error");
          continue;
        }

        const data = await res.json() as any;
        if (!data.data) continue;

        for (const tweet of data.data) {
          // Check if already processed
          const [existing] = await sql`SELECT post_id FROM x_posts_processed WHERE post_id = ${tweet.id}`;
          if (existing) continue;

          const relevanceScore = scoreRelevance(tweet.text, query);

          await sql`
            INSERT INTO x_posts_processed (post_id, url, author_handle, post_text, relevance_score)
            VALUES (${tweet.id}, ${"https://x.com/i/status/" + tweet.id}, ${tweet.author_id || ""}, ${tweet.text}, ${relevanceScore})
            ON CONFLICT (post_id) DO NOTHING
          `;

          if (relevanceScore > 0.5) {
            const signalId = `sig_${crypto.randomUUID().slice(0, 12)}`;
            await sql`
              INSERT INTO signals (id, source, content, url, author, relevance_score)
              VALUES (${signalId}, 'x_api', ${tweet.text}, ${"https://x.com/i/status/" + tweet.id}, ${tweet.author_id || ""}, ${relevanceScore})
            `;
            log.info({ signalId, score: relevanceScore }, "new signal from X");
          }
        }
      } catch (err) {
        log.error({ err, query }, "X search error");
      }
    }
  },
};

function scoreRelevance(text: string, query: string): number {
  const lower = text.toLowerCase();
  const keywords = ["agent", "claude", "mcp", "autonomous", "infrastructure", "orchestr", "self-evolv"];
  let score = 0.3; // base for matching query
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 0.1;
  }
  return Math.min(score, 1.0);
}
