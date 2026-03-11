import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.get("/api/harness/health", async (c) => {
  const [signalCount] = await sql`
    SELECT COUNT(*) as count FROM signals WHERE captured_at > NOW() - INTERVAL '24 hours'
  `;
  const [suggestionCount] = await sql`
    SELECT COUNT(*) as count FROM harness_suggestions WHERE created_at > NOW() - INTERVAL '24 hours'
  `;
  const [pendingCount] = await sql`
    SELECT COUNT(*) as count FROM harness_suggestions WHERE status = 'pending'
  `;
  const [latestCycle] = await sql`
    SELECT * FROM synthesis_cycles ORDER BY started_at DESC LIMIT 1
  `;

  return c.json({
    timestamp: new Date().toISOString(),
    signals_24h: Number(signalCount.count),
    suggestions_24h: Number(suggestionCount.count),
    pending_suggestions: Number(pendingCount.count),
    latest_cycle: latestCycle || null,
  });
});

app.get("/api/harness/suggestions", async (c) => {
  const status = c.req.query("status");
  const type = c.req.query("type");

  let suggestions;
  if (status && type) {
    suggestions = await sql`SELECT * FROM harness_suggestions WHERE status = ${status} AND type = ${type} ORDER BY composite_rank DESC`;
  } else if (status) {
    suggestions = await sql`SELECT * FROM harness_suggestions WHERE status = ${status} ORDER BY composite_rank DESC`;
  } else if (type) {
    suggestions = await sql`SELECT * FROM harness_suggestions WHERE type = ${type} ORDER BY composite_rank DESC`;
  } else {
    suggestions = await sql`SELECT * FROM harness_suggestions ORDER BY composite_rank DESC LIMIT 50`;
  }

  return c.json({ suggestions });
});

app.get("/api/harness/suggestions/:id", async (c) => {
  const id = c.req.param("id");
  const [suggestion] = await sql`SELECT * FROM harness_suggestions WHERE id = ${id}`;
  if (!suggestion) return c.json({ error: "Suggestion not found" }, 404);
  return c.json({ suggestion });
});

app.post("/api/harness/suggestions/:id/approve", async (c) => {
  const id = c.req.param("id");
  const [suggestion] = await sql`
    UPDATE harness_suggestions SET status = 'approved', reviewed_at = NOW()
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  if (!suggestion) return c.json({ error: "Suggestion not found or already reviewed" }, 404);
  return c.json({ suggestion });
});

app.post("/api/harness/suggestions/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const { reason } = await c.req.json();
  const [suggestion] = await sql`
    UPDATE harness_suggestions SET status = 'dismissed', reviewed_at = NOW(), dismissed_reason = ${reason || null}
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
  `;
  if (!suggestion) return c.json({ error: "Suggestion not found or already reviewed" }, 404);
  return c.json({ suggestion });
});

app.get("/api/harness/signals", async (c) => {
  const signals = await sql`SELECT * FROM signals ORDER BY captured_at DESC LIMIT 50`;
  return c.json({ signals });
});

app.get("/api/harness/cycles", async (c) => {
  const cycles = await sql`SELECT * FROM synthesis_cycles ORDER BY started_at DESC LIMIT 20`;
  return c.json({ cycles });
});

export default app;
