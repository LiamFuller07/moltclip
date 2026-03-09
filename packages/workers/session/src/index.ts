import { Hono } from "hono";

interface Env {
  R2: R2Bucket;
  KV_PROFILES: KVNamespace;
}

interface ProfileRecord {
  id: string;
  agentId: string;
  service: string;
  email: string;
  state: "creating" | "login_required" | "ready" | "locked" | "error";
  vpsNodeId: string;
  profileDir: string;
  lastUsed: string;
  createdAt: string;
  error: string | null;
}

const app = new Hono<{ Bindings: Env }>();

// ── Profile Registry ──

app.post("/api/profiles", async (c) => {
  const body = await c.req.json();
  const profileId = `prf_${crypto.randomUUID().slice(0, 8)}`;

  const profile: ProfileRecord = {
    id: profileId,
    agentId: body.agentId,
    service: body.service,
    email: body.email,
    state: "creating",
    vpsNodeId: body.vpsNodeId,
    profileDir: `/data/profiles/${profileId}`,
    lastUsed: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    error: null,
  };

  await c.env.KV_PROFILES.put(`profile:${profileId}`, JSON.stringify(profile));

  // Update profiles list
  const profiles = await getAllProfiles(c.env);
  profiles.push(profile);
  await c.env.KV_PROFILES.put("profiles:list", JSON.stringify(profiles));

  return c.json({ profile }, 201);
});

app.get("/api/profiles", async (c) => {
  const agentId = c.req.query("agentId");
  const service = c.req.query("service");
  let profiles = await getAllProfiles(c.env);

  if (agentId) profiles = profiles.filter((p) => p.agentId === agentId);
  if (service) profiles = profiles.filter((p) => p.service === service);

  return c.json({ profiles });
});

app.get("/api/profiles/:profileId", async (c) => {
  const profileId = c.req.param("profileId");
  const raw = await c.env.KV_PROFILES.get(`profile:${profileId}`, "json");
  if (!raw) return c.json({ error: "Profile not found" }, 404);
  return c.json({ profile: raw });
});

// ── Profile State Updates ──

app.patch("/api/profiles/:profileId", async (c) => {
  const profileId = c.req.param("profileId");
  const update = await c.req.json();

  const raw = await c.env.KV_PROFILES.get(`profile:${profileId}`, "json") as ProfileRecord | null;
  if (!raw) return c.json({ error: "Profile not found" }, 404);

  const updated = { ...raw, ...update, lastUsed: new Date().toISOString() };
  await c.env.KV_PROFILES.put(`profile:${profileId}`, JSON.stringify(updated));

  // Update list
  const profiles = await getAllProfiles(c.env);
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx >= 0) profiles[idx] = updated;
  await c.env.KV_PROFILES.put("profiles:list", JSON.stringify(profiles));

  return c.json({ profile: updated });
});

// ── Profile Locking ──

app.post("/api/profiles/:profileId/lock", async (c) => {
  const profileId = c.req.param("profileId");
  const raw = await c.env.KV_PROFILES.get(`profile:${profileId}`, "json") as ProfileRecord | null;
  if (!raw) return c.json({ error: "Profile not found" }, 404);

  if (raw.state === "locked") {
    return c.json({ error: "Profile already locked" }, 409);
  }

  raw.state = "locked";
  raw.lastUsed = new Date().toISOString();
  await c.env.KV_PROFILES.put(`profile:${profileId}`, JSON.stringify(raw));

  return c.json({ locked: true });
});

app.post("/api/profiles/:profileId/unlock", async (c) => {
  const profileId = c.req.param("profileId");
  const raw = await c.env.KV_PROFILES.get(`profile:${profileId}`, "json") as ProfileRecord | null;
  if (!raw) return c.json({ error: "Profile not found" }, 404);

  raw.state = "ready";
  raw.lastUsed = new Date().toISOString();
  await c.env.KV_PROFILES.put(`profile:${profileId}`, JSON.stringify(raw));

  return c.json({ locked: false });
});

// ── Profile Backup Coordination ──

app.post("/api/profiles/:profileId/backup", async (c) => {
  const profileId = c.req.param("profileId");

  // The VPS tars the profile dir and uploads to R2
  // This endpoint records the backup metadata
  const body = await c.req.json();
  const backupKey = `profiles/${profileId}/${new Date().toISOString()}.tar.gz`;

  await c.env.KV_PROFILES.put(
    `backup:${profileId}:latest`,
    JSON.stringify({
      key: backupKey,
      size: body.size,
      timestamp: new Date().toISOString(),
    }),
  );

  return c.json({ backupKey });
});

app.get("/api/profiles/:profileId/backup", async (c) => {
  const profileId = c.req.param("profileId");
  const raw = await c.env.KV_PROFILES.get(`backup:${profileId}:latest`, "json");
  if (!raw) return c.json({ error: "No backup found" }, 404);
  return c.json({ backup: raw });
});

export default app;

// ── Helpers ──

async function getAllProfiles(env: Env): Promise<ProfileRecord[]> {
  const raw = await env.KV_PROFILES.get("profiles:list", "json");
  return (raw as ProfileRecord[]) || [];
}
