import { Hono } from "hono";
import { sql } from "../db.js";

const app = new Hono();

app.post("/api/profiles", async (c) => {
  const body = await c.req.json();
  const id = `prf_${crypto.randomUUID().slice(0, 8)}`;

  const [profile] = await sql`
    INSERT INTO browser_profiles (id, agent_id, service, email, profile_dir)
    VALUES (${id}, ${body.agentId}, ${body.service}, ${body.email || null}, ${`/data/profiles/${id}`})
    RETURNING *
  `;

  return c.json({ profile }, 201);
});

app.get("/api/profiles", async (c) => {
  const agentId = c.req.query("agentId");
  const service = c.req.query("service");

  let profiles;
  if (agentId && service) {
    profiles = await sql`SELECT * FROM browser_profiles WHERE agent_id = ${agentId} AND service = ${service}`;
  } else if (agentId) {
    profiles = await sql`SELECT * FROM browser_profiles WHERE agent_id = ${agentId}`;
  } else if (service) {
    profiles = await sql`SELECT * FROM browser_profiles WHERE service = ${service}`;
  } else {
    profiles = await sql`SELECT * FROM browser_profiles ORDER BY last_used DESC LIMIT 100`;
  }

  return c.json({ profiles });
});

app.get("/api/profiles/:profileId", async (c) => {
  const profileId = c.req.param("profileId");
  const [profile] = await sql`SELECT * FROM browser_profiles WHERE id = ${profileId}`;
  if (!profile) return c.json({ error: "Profile not found" }, 404);
  return c.json({ profile });
});

app.patch("/api/profiles/:profileId", async (c) => {
  const profileId = c.req.param("profileId");
  const update = await c.req.json();

  const [profile] = await sql`
    UPDATE browser_profiles
    SET state = COALESCE(${update.state || null}, state),
        email = COALESCE(${update.email || null}, email),
        error = COALESCE(${update.error || null}, error),
        last_used = NOW()
    WHERE id = ${profileId}
    RETURNING *
  `;

  if (!profile) return c.json({ error: "Profile not found" }, 404);
  return c.json({ profile });
});

app.post("/api/profiles/:profileId/lock", async (c) => {
  const profileId = c.req.param("profileId");
  const [profile] = await sql`
    UPDATE browser_profiles SET state = 'locked', last_used = NOW()
    WHERE id = ${profileId} AND state != 'locked'
    RETURNING *
  `;
  if (!profile) return c.json({ error: "Profile not found or already locked" }, 409);
  return c.json({ locked: true });
});

app.post("/api/profiles/:profileId/unlock", async (c) => {
  const profileId = c.req.param("profileId");
  await sql`UPDATE browser_profiles SET state = 'ready', last_used = NOW() WHERE id = ${profileId}`;
  return c.json({ locked: false });
});

export default app;
