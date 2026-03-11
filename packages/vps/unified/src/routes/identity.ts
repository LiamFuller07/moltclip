import { Hono } from "hono";
import { sql } from "../db.js";
import { env } from "../env.js";
import { encrypt, decrypt, generateTOTP } from "../crypto.js";
import pino from "pino";

const log = pino({ name: "identity" });
const app = new Hono();

// ── Email (AgentMail) ──

app.post("/api/identity/:agentId/inbox", async (c) => {
  const agentId = c.req.param("agentId");
  const { displayName } = await c.req.json();
  const localPart = agentId.replace("agt_", "");
  const email = `${localPart}@${env.agentmailDomain}`;

  if (!env.agentmailApiKey) return c.json({ error: "AgentMail not configured" }, 503);

  const res = await fetch("https://api.agentmail.to/v1/inboxes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.agentmailApiKey}` },
    body: JSON.stringify({ address: email, display_name: displayName || agentId }),
  });

  if (!res.ok) return c.json({ error: `AgentMail error: ${await res.text()}` }, 500);
  const inbox = await res.json();
  return c.json({ email, inbox }, 201);
});

app.get("/api/identity/:agentId/inbox", async (c) => {
  const agentId = c.req.param("agentId");
  const localPart = agentId.replace("agt_", "");

  if (!env.agentmailApiKey) return c.json({ messages: [] });

  const res = await fetch(
    `https://api.agentmail.to/v1/inboxes/${localPart}@${env.agentmailDomain}/messages`,
    { headers: { Authorization: `Bearer ${env.agentmailApiKey}` } },
  );

  if (!res.ok) return c.json({ messages: [] });
  const messages = await res.json();
  return c.json({ messages });
});

app.post("/api/identity/:agentId/send", async (c) => {
  const agentId = c.req.param("agentId");
  const localPart = agentId.replace("agt_", "");
  const { to, subject, body } = await c.req.json();

  if (!env.agentmailApiKey) return c.json({ error: "AgentMail not configured" }, 503);

  const res = await fetch("https://api.agentmail.to/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.agentmailApiKey}` },
    body: JSON.stringify({ from: `${localPart}@${env.agentmailDomain}`, to, subject, body }),
  });

  if (!res.ok) return c.json({ error: "Failed to send email" }, 500);
  return c.json({ ok: true });
});

// ── Credential Vault ──

app.put("/api/identity/:agentId/credentials/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");
  const { type, value } = await c.req.json();

  const encrypted = encrypt(value, env.encryptionKey);

  await sql`
    INSERT INTO credentials (agent_id, service, type, encrypted_value, last_rotated)
    VALUES (${agentId}, ${service}, ${type}, ${encrypted}, NOW())
    ON CONFLICT (agent_id, service) DO UPDATE
    SET type = ${type}, encrypted_value = ${encrypted}, last_rotated = NOW()
  `;

  return c.json({ ok: true });
});

app.get("/api/identity/:agentId/credentials/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");

  const [cred] = await sql`
    SELECT * FROM credentials WHERE agent_id = ${agentId} AND service = ${service}
  `;
  if (!cred) return c.json({ error: "Not found" }, 404);

  const value = decrypt(cred.encrypted_value as string, env.encryptionKey);
  return c.json({ type: cred.type, value, lastRotated: cred.last_rotated });
});

app.get("/api/identity/:agentId/credentials", async (c) => {
  const agentId = c.req.param("agentId");
  const creds = await sql`
    SELECT service, type, last_rotated FROM credentials WHERE agent_id = ${agentId}
  `;
  return c.json({ credentials: creds });
});

// ── TOTP ──

app.get("/api/identity/:agentId/totp/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");

  const [cred] = await sql`
    SELECT * FROM credentials WHERE agent_id = ${agentId} AND service = ${service + '_totp'}
  `;
  if (!cred) return c.json({ error: "No TOTP seed for service" }, 404);

  const seed = decrypt(cred.encrypted_value as string, env.encryptionKey);
  const code = generateTOTP(seed);

  return c.json({ code, validFor: 30 - (Math.floor(Date.now() / 1000) % 30) });
});

export default app;
