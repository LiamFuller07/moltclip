import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.post("/api/costs", async (c) => {
  const { agentId, amountCents, category, description } = await c.req.json();
  if (!agentId || !amountCents || !category) {
    return c.json({ error: "agentId, amountCents, and category are required" }, 400);
  }

  const id = `cost_${crypto.randomUUID().slice(0, 12)}`;
  const [record] = await sql`
    INSERT INTO cost_records (id, agent_id, amount_cents, category, description)
    VALUES (${id}, ${agentId}, ${amountCents}, ${category}, ${description || null})
    RETURNING *
  `;

  return c.json({ record }, 201);
});

app.get("/api/costs", async (c) => {
  const agentId = c.req.query("agentId");

  if (agentId) {
    const records = await sql`
      SELECT * FROM cost_records WHERE agent_id = ${agentId} ORDER BY created_at DESC LIMIT 100
    `;
    const [summary] = await sql`
      SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as count
      FROM cost_records WHERE agent_id = ${agentId}
    `;
    return c.json({ agentId, totalCents: Number(summary.total_cents), count: Number(summary.count), records });
  }

  const [summary] = await sql`
    SELECT COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as count FROM cost_records
  `;
  const byAgent = await sql`
    SELECT agent_id, COALESCE(SUM(amount_cents), 0) as total_cents, COUNT(*) as count
    FROM cost_records GROUP BY agent_id ORDER BY total_cents DESC
  `;

  return c.json({ totalCents: Number(summary.total_cents), count: Number(summary.count), byAgent });
});

export default app;
