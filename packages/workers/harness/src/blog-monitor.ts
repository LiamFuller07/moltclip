interface Env {
  DB: D1Database;
  R2: R2Bucket;
  FIRECRAWL_API_KEY: string;
}

const MONITORED_URLS = [
  "https://blog.cloudflare.com",
  "https://www.anthropic.com/research",
  "https://openai.com/blog",
  "https://blog.x.ai",
];

export async function runBlogMonitor(env: Env): Promise<void> {
  if (!env.FIRECRAWL_API_KEY) return;

  for (const blogUrl of MONITORED_URLS) {
    try {
      // Crawl the blog page
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({ url: blogUrl, formats: ["markdown"] }),
      });

      if (!res.ok) continue;

      const data = (await res.json()) as {
        data?: { markdown?: string; metadata?: { title?: string } };
      };
      const content = data.data?.markdown;
      if (!content) continue;

      // Hash content for change detection
      const contentHash = simpleHash(content);
      const urlHash = simpleHash(blogUrl);

      // Check if content changed since last crawl
      const existing = await env.DB.prepare(
        "SELECT content_hash FROM crawled_content WHERE url_hash = ?",
      )
        .bind(urlHash)
        .first<{ content_hash: string }>();

      if (existing?.content_hash === contentHash) continue;

      // Content changed — store update and create signal
      await env.DB.prepare(
        "INSERT OR REPLACE INTO crawled_content (url_hash, url, content, content_type, crawled_at, content_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          urlHash,
          blogUrl,
          content.slice(0, 50000),
          "markdown",
          new Date().toISOString(),
          contentHash,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        )
        .run();

      // Extract key changes (diff summary)
      const signalContent = existing
        ? `Blog update detected at ${blogUrl}: Content changed since last check.`
        : `New blog content indexed from ${blogUrl}`;

      const signalId = `sig_blog_${urlHash}_${Date.now()}`;
      await env.DB.prepare(
        "INSERT OR IGNORE INTO signals (id, source, content, url, relevance_score, captured_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          signalId,
          "blog_monitor",
          signalContent,
          blogUrl,
          0.7,
          new Date().toISOString(),
        )
        .run();
    } catch {
      // Skip failed crawls
    }
  }
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
