import { Hono } from "hono";
import { sql } from "../db.js";
import { env } from "../env.js";
import pino from "pino";

const log = pino({ name: "payment" });
const app = new Hono();

const AGENT_ID_RE = /^agt_[a-zA-Z0-9]{1,36}$/;

function validateAgentId(agentId: string): string | null {
  if (!agentId || !AGENT_ID_RE.test(agentId)) return "Invalid agentId format";
  return null;
}

// ── Virtual Cards (Privacy.com) ──

app.post("/api/payment/:agentId/card", async (c) => {
  const agentId = c.req.param("agentId");
  const err = validateAgentId(agentId);
  if (err) return c.json({ error: err }, 400);
  if (!env.privacyApiKey) return c.json({ error: "Privacy.com not configured" }, 503);

  const { merchantLock, monthlyLimitCents } = await c.req.json();
  if (!monthlyLimitCents || monthlyLimitCents <= 0) return c.json({ error: "monthlyLimitCents required" }, 400);

  const res = await fetch("https://api.privacy.com/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `api-key ${env.privacyApiKey}` },
    body: JSON.stringify({
      type: "MERCHANT_LOCKED",
      memo: `MoltClip Agent ${agentId}`,
      spend_limit: monthlyLimitCents,
      spend_limit_duration: "MONTHLY",
      ...(merchantLock ? { merchant_id: merchantLock } : {}),
    }),
  });

  if (!res.ok) return c.json({ error: `Privacy.com error: ${await res.text()}` }, 500);
  const card = await res.json() as any;

  const [cardRecord] = await sql`
    INSERT INTO cards (id, agent_id, last_four, merchant_lock, monthly_limit_cents)
    VALUES (${card.token}, ${agentId}, ${card.last_four || null}, ${merchantLock || null}, ${monthlyLimitCents})
    RETURNING *
  `;

  return c.json({ card: cardRecord }, 201);
});

app.get("/api/payment/:agentId/cards", async (c) => {
  const agentId = c.req.param("agentId");
  const err = validateAgentId(agentId);
  if (err) return c.json({ error: err }, 400);

  const cards = await sql`SELECT * FROM cards WHERE agent_id = ${agentId}`;
  return c.json({ cards });
});

app.get("/api/payment/:agentId/balance", async (c) => {
  const agentId = c.req.param("agentId");
  const err = validateAgentId(agentId);
  if (err) return c.json({ error: err }, 400);

  const [summary] = await sql`
    SELECT COALESCE(SUM(monthly_limit_cents), 0) as total_limit,
           COALESCE(SUM(current_spend_cents), 0) as total_spend,
           COUNT(*) as card_count
    FROM cards WHERE agent_id = ${agentId}
  `;

  return c.json({
    agentId,
    totalLimitCents: Number(summary.total_limit),
    totalSpendCents: Number(summary.total_spend),
    remainingCents: Number(summary.total_limit) - Number(summary.total_spend),
    cards: Number(summary.card_count),
  });
});

app.post("/api/payment/:agentId/card/:cardId/record-spend", async (c) => {
  const agentId = c.req.param("agentId");
  const cardId = c.req.param("cardId");
  const { amountCents, merchant, description } = await c.req.json();
  if (!amountCents || amountCents <= 0) return c.json({ error: "amountCents required" }, 400);

  const [card] = await sql`
    UPDATE cards SET current_spend_cents = current_spend_cents + ${amountCents}
    WHERE id = ${cardId} AND agent_id = ${agentId}
    RETURNING *
  `;
  if (!card) return c.json({ error: "Card not found" }, 404);

  await sql`
    INSERT INTO audit_log (agent_id, event_type, data)
    VALUES (${agentId}, 'spend_recorded', ${JSON.stringify({ cardId, amountCents, merchant, description })})
  `;

  return c.json({ ok: true, currentSpendCents: card.current_spend_cents, remainingCents: Number(card.monthly_limit_cents) - Number(card.current_spend_cents) });
});

app.post("/api/payment/:agentId/card/:cardId/pause", async (c) => {
  const agentId = c.req.param("agentId");
  const cardId = c.req.param("cardId");

  if (env.privacyApiKey) {
    await fetch(`https://api.privacy.com/v1/cards/${cardId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `api-key ${env.privacyApiKey}` },
      body: JSON.stringify({ state: "PAUSED" }),
    });
  }

  await sql`UPDATE cards SET status = 'paused' WHERE id = ${cardId} AND agent_id = ${agentId}`;
  return c.json({ ok: true });
});

// ── Approval Gate ──

app.post("/api/payment/:agentId/approve", async (c) => {
  const agentId = c.req.param("agentId");
  const { amountCents, merchant, reason } = await c.req.json();
  if (!amountCents || amountCents <= 0) return c.json({ error: "amountCents required" }, 400);
  if (!merchant) return c.json({ error: "merchant required" }, 400);

  if (amountCents <= env.approvalThresholdCents) {
    return c.json({ approved: true, reason: "Under threshold" });
  }

  const id = `apr_${crypto.randomUUID().slice(0, 8)}`;
  const [approval] = await sql`
    INSERT INTO approvals (id, agent_id, amount_cents, merchant, reason)
    VALUES (${id}, ${agentId}, ${amountCents}, ${merchant}, ${reason || null})
    RETURNING *
  `;

  await sql`
    INSERT INTO audit_log (agent_id, event_type, data)
    VALUES (${agentId}, 'approval_requested', ${JSON.stringify({ approvalId: id, amountCents, merchant })})
  `;

  return c.json({ approved: false, approvalId: id, message: "Awaiting human approval" });
});

// ── Stripe ──

app.post("/api/payment/:agentId/charge", async (c) => {
  const agentId = c.req.param("agentId");
  if (!env.stripeSecretKey) return c.json({ error: "Stripe not configured" }, 503);

  const { amountCents, currency, description, metadata } = await c.req.json();
  if (!amountCents || amountCents <= 0) return c.json({ error: "amountCents required" }, 400);

  const cur = currency || "usd";
  const params = new URLSearchParams();
  params.set("amount", String(amountCents));
  params.set("currency", cur);
  params.set("description", description || `MoltClip Agent ${agentId}`);
  params.set("metadata[agentId]", agentId);
  params.set("confirm", "true");
  params.set("automatic_payment_methods[enabled]", "true");
  params.set("automatic_payment_methods[allow_redirects]", "never");

  if (metadata && typeof metadata === "object") {
    for (const [k, v] of Object.entries(metadata)) {
      params.set(`metadata[${k}]`, String(v));
    }
  }

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(env.stripeSecretKey + ":").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) return c.json({ error: `Stripe error: ${await res.text()}` }, 500);
  const intent = await res.json() as any;

  await sql`
    INSERT INTO audit_log (agent_id, event_type, data)
    VALUES (${agentId}, 'stripe_charge', ${JSON.stringify({ amountCents, currency: cur, paymentIntentId: intent.id, status: intent.status })})
  `;

  return c.json({ ok: true, paymentIntentId: intent.id, status: intent.status, amountCents, currency: cur }, 201);
});

// ── Audit Log ──

app.get("/api/payment/:agentId/transactions", async (c) => {
  const agentId = c.req.param("agentId");
  const transactions = await sql`
    SELECT * FROM audit_log WHERE agent_id = ${agentId} ORDER BY created_at DESC LIMIT 100
  `;
  return c.json({ transactions });
});

export default app;
