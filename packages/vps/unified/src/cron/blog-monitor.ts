import { createHash } from "node:crypto";
import pino from "pino";
import { env } from "../env.js";
import { sql } from "../db.js";

const log = pino({ name: "blog-monitor" });

const WATCH_URLS = [
  "https://docs.anthropic.com/en/docs/changelog",
  "https://openai.com/blog",
  "https://blog.cloudflare.com",
];

export const blogMonitor = {
  async run(): Promise<void> {
    if (!env.firecrawlApiKey) {
      log.warn("FIRECRAWL_API_KEY not set, skipping blog monitor");
      return;
    }

    for (const url of WATCH_URLS) {
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.firecrawlApiKey}`,
          },
          body: JSON.stringify({ url, formats: ["markdown"] }),
        });

        if (!res.ok) {
          log.warn({ status: res.status, url }, "Firecrawl error");
          continue;
        }

        const data = await res.json() as any;
        const content = data.data?.markdown || "";
        const contentHash = createHash("sha256").update(content).digest("hex");
        const urlHash = createHash("sha256").update(url).digest("hex");

        // Check for content change
        const [existing] = await sql`SELECT content_hash FROM crawled_content WHERE url_hash = ${urlHash}`;

        if (existing && existing.content_hash === contentHash) {
          log.debug({ url }, "no content change");
          continue;
        }

        // Store new content
        await sql`
          INSERT INTO crawled_content (url_hash, url, content, content_hash, crawled_at, expires_at)
          VALUES (${urlHash}, ${url}, ${content.slice(0, 50000)}, ${contentHash}, NOW(), NOW() + INTERVAL '7 days')
          ON CONFLICT (url_hash) DO UPDATE
          SET content = ${content.slice(0, 50000)}, content_hash = ${contentHash}, crawled_at = NOW()
        `;

        // Create signal for content change
        if (existing) {
          const signalId = `sig_${crypto.randomUUID().slice(0, 12)}`;
          await sql`
            INSERT INTO signals (id, source, content, url, relevance_score)
            VALUES (${signalId}, 'blog_monitor', ${"Content change detected: " + url}, ${url}, 0.7)
          `;
          log.info({ signalId, url }, "blog content change detected");
        }
      } catch (err) {
        log.error({ err, url }, "blog monitor error");
      }
    }
  },
};
