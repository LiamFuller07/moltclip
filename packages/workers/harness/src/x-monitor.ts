interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV_HARNESS: KVNamespace;
  X_BEARER_TOKEN: string;
}

interface XSearchResult {
  data?: { id: string; text: string; author_id: string; created_at: string }[];
  meta?: { newest_id?: string; next_token?: string };
}

const SEARCH_QUERIES = [
  "AI agent infrastructure OR autonomous agent tooling",
  "Claude Code automation OR Codex agent",
  "browser automation headless persistent session",
  "ERP migration agent OR NetSuite automation",
];

export async function runXMonitor(env: Env): Promise<void> {
  if (!env.X_BEARER_TOKEN) return;

  for (const query of SEARCH_QUERIES) {
    // Get last cursor for this query
    const stateRow = await env.DB.prepare(
      "SELECT last_cursor FROM x_monitor_state WHERE search_query = ?",
    )
      .bind(query)
      .first<{ last_cursor: string | null }>();

    const params = new URLSearchParams({
      query,
      max_results: "20",
      "tweet.fields": "created_at,author_id,public_metrics",
    });
    if (stateRow?.last_cursor) {
      params.set("since_id", stateRow.last_cursor);
    }

    try {
      const res = await fetch(
        `https://api.x.com/2/tweets/search/recent?${params}`,
        {
          headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
        },
      );

      if (!res.ok) continue;
      const data = (await res.json()) as XSearchResult;
      if (!data.data?.length) continue;

      // Score relevance and store signals
      for (const tweet of data.data) {
        const relevance = scoreRelevance(tweet.text);
        if (relevance < 0.3) continue;

        // Check dedup
        const existing = await env.DB.prepare(
          "SELECT post_id FROM x_posts_processed WHERE post_id = ?",
        )
          .bind(tweet.id)
          .first();
        if (existing) continue;

        // Store as signal
        const signalId = `sig_x_${tweet.id}`;
        await env.DB.prepare(
          "INSERT OR IGNORE INTO signals (id, source, content, url, author, relevance_score, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(
            signalId,
            "x_monitor",
            tweet.text,
            `https://x.com/i/status/${tweet.id}`,
            tweet.author_id,
            relevance,
            new Date().toISOString(),
          )
          .run();

        // Mark as processed
        await env.DB.prepare(
          "INSERT OR IGNORE INTO x_posts_processed (post_id, url, author_handle, post_text, timestamp, processed_at, relevance_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(
            tweet.id,
            `https://x.com/i/status/${tweet.id}`,
            tweet.author_id,
            tweet.text,
            tweet.created_at,
            new Date().toISOString(),
            Math.round(relevance * 10),
          )
          .run();
      }

      // Update cursor
      if (data.meta?.newest_id) {
        await env.DB.prepare(
          "INSERT OR REPLACE INTO x_monitor_state (id, monitor_type, search_query, last_checked, last_cursor, posts_processed_count) VALUES (?, ?, ?, ?, ?, ?)",
        )
          .bind(
            `xmon_${hashString(query)}`,
            "search",
            query,
            new Date().toISOString(),
            data.meta.newest_id,
            data.data.length,
          )
          .run();
      }
    } catch {
      // Skip failed queries, continue with others
    }
  }
}

function scoreRelevance(text: string): number {
  const keywords = [
    "agent", "automation", "claude", "browser", "headless", "scraping",
    "AI infrastructure", "orchestration", "MCP", "tool use", "autonomous",
    "ERP", "NetSuite", "migration", "consultant", "SaaS",
  ];
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) score += 0.15;
  }
  return Math.min(score, 1);
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
