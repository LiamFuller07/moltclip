import { Hono } from "hono";

interface Env {
  KV_CREDENTIALS: KVNamespace;
  AGENTMAIL_API_KEY: string;
  AGENTMAIL_DOMAIN: string;
  ENCRYPTION_KEY: string; // 256-bit key for AES-GCM
}

const app = new Hono<{ Bindings: Env }>();

// ── Email Management (AgentMail) ──

app.post("/api/identity/:agentId/inbox", async (c) => {
  const agentId = c.req.param("agentId");
  const { displayName } = await c.req.json();
  const localPart = agentId.replace("agt_", "");
  const email = `${localPart}@${c.env.AGENTMAIL_DOMAIN}`;

  // Create inbox via AgentMail API
  const res = await fetch("https://api.agentmail.to/v1/inboxes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.AGENTMAIL_API_KEY}`,
    },
    body: JSON.stringify({
      address: email,
      display_name: displayName || agentId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return c.json({ error: `AgentMail error: ${err}` }, 500);
  }

  const inbox = await res.json();
  return c.json({ email, inbox }, 201);
});

app.get("/api/identity/:agentId/inbox", async (c) => {
  const agentId = c.req.param("agentId");
  const localPart = agentId.replace("agt_", "");

  // Poll inbox for new messages
  const res = await fetch(
    `https://api.agentmail.to/v1/inboxes/${localPart}@${c.env.AGENTMAIL_DOMAIN}/messages`,
    {
      headers: { Authorization: `Bearer ${c.env.AGENTMAIL_API_KEY}` },
    },
  );

  if (!res.ok) return c.json({ messages: [] });
  const messages = await res.json();
  return c.json({ messages });
});

app.post("/api/identity/:agentId/send", async (c) => {
  const agentId = c.req.param("agentId");
  const localPart = agentId.replace("agt_", "");
  const { to, subject, body } = await c.req.json();

  const res = await fetch("https://api.agentmail.to/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.AGENTMAIL_API_KEY}`,
    },
    body: JSON.stringify({
      from: `${localPart}@${c.env.AGENTMAIL_DOMAIN}`,
      to,
      subject,
      body,
    }),
  });

  if (!res.ok) {
    return c.json({ error: "Failed to send email" }, 500);
  }

  return c.json({ ok: true });
});

// ── Credential Vault ──

app.put("/api/identity/:agentId/credentials/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");
  const { type, value } = await c.req.json();

  // Encrypt the credential value
  const encrypted = await encrypt(value, c.env.ENCRYPTION_KEY);

  const key = `cred:${agentId}:${service}`;
  await c.env.KV_CREDENTIALS.put(
    key,
    JSON.stringify({
      type,
      encrypted,
      lastRotated: new Date().toISOString(),
    }),
  );

  return c.json({ ok: true });
});

app.get("/api/identity/:agentId/credentials/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");

  const key = `cred:${agentId}:${service}`;
  const raw = await c.env.KV_CREDENTIALS.get(key, "json") as any;
  if (!raw) return c.json({ error: "Not found" }, 404);

  // Decrypt the value
  const value = await decrypt(raw.encrypted, c.env.ENCRYPTION_KEY);

  return c.json({ type: raw.type, value, lastRotated: raw.lastRotated });
});

app.get("/api/identity/:agentId/credentials", async (c) => {
  const agentId = c.req.param("agentId");
  const prefix = `cred:${agentId}:`;

  const list = await c.env.KV_CREDENTIALS.list({ prefix });
  const credentials = list.keys.map((k) => ({
    service: k.name.replace(prefix, ""),
    name: k.name,
  }));

  return c.json({ credentials });
});

// ── TOTP ──

app.get("/api/identity/:agentId/totp/:service", async (c) => {
  const agentId = c.req.param("agentId");
  const service = c.req.param("service");

  // Get TOTP seed from credentials
  const key = `cred:${agentId}:${service}_totp`;
  const raw = await c.env.KV_CREDENTIALS.get(key, "json") as any;
  if (!raw) return c.json({ error: "No TOTP seed for service" }, 404);

  const seed = await decrypt(raw.encrypted, c.env.ENCRYPTION_KEY);
  const code = generateTOTP(seed);

  return c.json({ code, validFor: 30 - (Math.floor(Date.now() / 1000) % 30) });
});

export default app;

// ── Crypto Helpers ──

async function encrypt(plaintext: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToHex(combined);
}

async function decrypt(ciphertextHex: string, keyHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const combined = hexToBytes(ciphertextHex);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateTOTP(seed: string): string {
  // Simplified TOTP - in production use a proper RFC 6238 implementation
  const counter = Math.floor(Date.now() / 30000);
  const hash = counter.toString(16) + seed.slice(0, 8);
  const code = (parseInt(hash, 16) % 1000000).toString().padStart(6, "0");
  return code;
}
