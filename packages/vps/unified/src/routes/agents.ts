import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.get("/api/agents", async (c) => {
  const agents = await sql`SELECT * FROM agents ORDER BY created_at DESC`;
  return c.json({ agents });
});

app.post("/api/agents", async (c) => {
  const { displayName, adapterType } = await c.req.json();
  const id = `agt_${crypto.randomUUID().slice(0, 12)}`;

  const [agent] = await sql`
    INSERT INTO agents (id, display_name, adapter_type)
    VALUES (${id}, ${displayName}, ${adapterType || "claude_local"})
    RETURNING *
  `;

  return c.json({ agent }, 201);
});

app.get("/api/agents/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const [agent] = await sql`SELECT * FROM agents WHERE id = ${agentId}`;
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({ agent });
});

app.patch("/api/agents/:agentId", async (c) => {
  const agentId = c.req.param("agentId");
  const updates = await c.req.json();

  const [agent] = await sql`
    UPDATE agents
    SET status = COALESCE(${updates.status || null}, status),
        display_name = COALESCE(${updates.displayName || null}, display_name),
        email_inbox = COALESCE(${updates.emailInbox || null}, email_inbox),
        wallet_id = COALESCE(${updates.walletId || null}, wallet_id)
    WHERE id = ${agentId}
    RETURNING *
  `;

  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({ agent });
});

export default app;
