import { Hono } from "hono";

interface Env {
  R2: R2Bucket;
  KV_WALLETS: KVNamespace;
  PRIVACY_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  APPROVAL_THRESHOLD_CENTS: string; // e.g., "5000" = $50
}

const app = new Hono<{ Bindings: Env }>();

// ── Virtual Card Management (Privacy.com) ──

app.post("/api/payment/:agentId/card", async (c) => {
  const agentId = c.req.param("agentId");
  const { merchantLock, monthlyLimitCents } = await c.req.json();

  // Create a virtual card via Privacy.com API
  const res = await fetch("https://api.privacy.com/v1/cards", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `api-key ${c.env.PRIVACY_API_KEY}`,
    },
    body: JSON.stringify({
      type: "MERCHANT_LOCKED",
      memo: `MoltClip Agent ${agentId}`,
      spend_limit: monthlyLimitCents,
      spend_limit_duration: "MONTHLY",
      ...(merchantLock ? { merchant_id: merchantLock } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return c.json({ error: `Privacy.com error: ${err}` }, 500);
  }

  const card = await res.json() as any;

  // Store card metadata in KV (without full card number)
  const cardMeta = {
    id: card.token,
    agentId,
    lastFour: card.last_four,
    merchantLock: merchantLock || null,
    monthlyLimitCents,
    currentSpendCents: 0,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  await c.env.KV_WALLETS.put(`card:${agentId}:${card.token}`, JSON.stringify(cardMeta));

  // Update agent's card list
  const cardList = await getAgentCards(c.env, agentId);
  cardList.push(cardMeta);
  await c.env.KV_WALLETS.put(`cards:${agentId}`, JSON.stringify(cardList));

  return c.json({ card: cardMeta }, 201);
});

app.get("/api/payment/:agentId/cards", async (c) => {
  const agentId = c.req.param("agentId");
  const cards = await getAgentCards(c.env, agentId);
  return c.json({ cards });
});

app.get("/api/payment/:agentId/balance", async (c) => {
  const agentId = c.req.param("agentId");
  const cards = await getAgentCards(c.env, agentId);

  const totalLimit = cards.reduce((sum, card) => sum + card.monthlyLimitCents, 0);
  const totalSpend = cards.reduce((sum, card) => sum + card.currentSpendCents, 0);

  return c.json({
    agentId,
    totalLimitCents: totalLimit,
    totalSpendCents: totalSpend,
    remainingCents: totalLimit - totalSpend,
    cards: cards.length,
  });
});

// ── Card Actions ──

app.post("/api/payment/:agentId/card/:cardId/pause", async (c) => {
  const agentId = c.req.param("agentId");
  const cardId = c.req.param("cardId");

  // Pause card via Privacy.com
  await fetch(`https://api.privacy.com/v1/cards/${cardId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `api-key ${c.env.PRIVACY_API_KEY}`,
    },
    body: JSON.stringify({ state: "PAUSED" }),
  });

  // Update KV
  const raw = await c.env.KV_WALLETS.get(`card:${agentId}:${cardId}`, "json") as any;
  if (raw) {
    raw.status = "paused";
    await c.env.KV_WALLETS.put(`card:${agentId}:${cardId}`, JSON.stringify(raw));
  }

  return c.json({ ok: true });
});

// ── Approval Gate ──

app.post("/api/payment/:agentId/approve", async (c) => {
  const agentId = c.req.param("agentId");
  const { amountCents, merchant, reason } = await c.req.json();
  const threshold = parseInt(c.env.APPROVAL_THRESHOLD_CENTS || "5000", 10);

  if (amountCents <= threshold) {
    return c.json({ approved: true, reason: "Under threshold" });
  }

  // Store approval request
  const approvalId = `apr_${crypto.randomUUID().slice(0, 8)}`;
  const approval = {
    id: approvalId,
    agentId,
    amountCents,
    merchant,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  await c.env.KV_WALLETS.put(`approval:${approvalId}`, JSON.stringify(approval));

  // Append to audit log
  await appendAuditLog(c.env, {
    type: "approval_requested",
    agentId,
    approvalId,
    amountCents,
    merchant,
    timestamp: new Date().toISOString(),
  });

  return c.json({ approved: false, approvalId, message: "Awaiting human approval" });
});

// ── Transaction Audit Log ──

app.get("/api/payment/:agentId/transactions", async (c) => {
  const agentId = c.req.param("agentId");
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);

  const key = `audit/payments/${agentId}/${month}.jsonl`;
  const obj = await c.env.R2.get(key);
  if (!obj) return c.json({ transactions: [] });

  const text = await obj.text();
  const transactions = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return c.json({ transactions });
});

export default app;

// ── Helpers ──

async function getAgentCards(env: Env, agentId: string) {
  const raw = await env.KV_WALLETS.get(`cards:${agentId}`, "json");
  return (raw as any[]) || [];
}

async function appendAuditLog(env: Env, entry: Record<string, unknown>): Promise<void> {
  const agentId = entry.agentId as string;
  const month = new Date().toISOString().slice(0, 7);
  const key = `audit/payments/${agentId}/${month}.jsonl`;

  const existing = await env.R2.get(key);
  const text = existing ? await existing.text() : "";
  await env.R2.put(key, text + JSON.stringify(entry) + "\n");
}
