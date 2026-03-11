import { Hono } from "hono";
import { deploySuggestion } from "./deployment-pipeline.js";

interface Env {
  DB: D1Database;
  R2: R2Bucket;
  KV_HARNESS: KVNamespace;
  GITHUB_TOKEN: string;
}

export const dashboardApi = new Hono<{ Bindings: Env }>();

// List suggestions
dashboardApi.get("/suggestions", async (c) => {
  const status = c.req.query("status");
  const type = c.req.query("type");

  let query = "SELECT * FROM harness_suggestions";
  const conditions: string[] = [];
  const params: string[] = [];

  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (type) {
    conditions.push("suggestion_type = ?");
    params.push(type);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY composite_rank DESC LIMIT 50";

  const stmt = c.env.DB.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  return c.json({ suggestions: result.results ?? [] });
});

// Get single suggestion
dashboardApi.get("/suggestions/:id", async (c) => {
  const id = c.req.param("id");
  const suggestion = await c.env.DB.prepare(
    "SELECT * FROM harness_suggestions WHERE id = ?",
  )
    .bind(id)
    .first();

  if (!suggestion) return c.json({ error: "Not found" }, 404);
  return c.json(suggestion);
});

// Approve suggestion
dashboardApi.post("/suggestions/:id/approve", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "UPDATE harness_suggestions SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(new Date().toISOString(), id)
    .run();

  return c.json({ ok: true });
});

// Dismiss suggestion
dashboardApi.post("/suggestions/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string }>();

  await c.env.DB.prepare(
    "UPDATE harness_suggestions SET status = 'dismissed', dismissed_at = ?, dismissal_reason = ? WHERE id = ?",
  )
    .bind(new Date().toISOString(), body.reason ?? null, id)
    .run();

  return c.json({ ok: true });
});

// Deploy approved suggestion
dashboardApi.post("/deploy", async (c) => {
  const { suggestion_id } = await c.req.json<{ suggestion_id: string }>();
  const result = await deploySuggestion(c.env, suggestion_id);
  return c.json(result);
});

// Recent signals
dashboardApi.get("/signals", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50");
  const result = await c.env.DB.prepare(
    "SELECT * FROM signals ORDER BY captured_at DESC LIMIT ?",
  )
    .bind(limit)
    .all();

  return c.json({ signals: result.results ?? [] });
});

// Synthesis cycles
dashboardApi.get("/cycles", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM synthesis_cycles ORDER BY started_at DESC LIMIT 20",
  ).all();

  return c.json({ cycles: result.results ?? [] });
});

// Health snapshot
dashboardApi.get("/health", async (c) => {
  const now = new Date();
  const h24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [signals24h, suggestions24h, latestCycle, pendingSuggestions] =
    await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as count FROM signals WHERE captured_at > ?")
        .bind(h24Ago)
        .first<{ count: number }>(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM harness_suggestions WHERE created_at > ?")
        .bind(h24Ago)
        .first<{ count: number }>(),
      c.env.DB.prepare("SELECT * FROM synthesis_cycles ORDER BY started_at DESC LIMIT 1").first(),
      c.env.DB.prepare("SELECT COUNT(*) as count FROM harness_suggestions WHERE status = 'pending'")
        .first<{ count: number }>(),
    ]);

  return c.json({
    timestamp: now.toISOString(),
    signals_24h: signals24h?.count ?? 0,
    suggestions_24h: suggestions24h?.count ?? 0,
    pending_suggestions: pendingSuggestions?.count ?? 0,
    latest_cycle: latestCycle,
  });
});
