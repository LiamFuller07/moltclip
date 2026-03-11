import { Hono } from "hono";
import { sql } from "../db.js";
import { redis } from "../redis.js";
import pino from "pino";

const log = pino({ name: "health" });
const app = new Hono();

app.get("/health", async (c) => {
  let dbOk = false;
  let redisOk = false;

  try { await sql`SELECT 1`; dbOk = true; } catch (err) { log.error({ err }, "health: postgres check failed"); }
  try { await redis.ping(); redisOk = true; } catch (err) { log.error({ err }, "health: redis check failed"); }

  return c.json({
    service: "moltclip-unified",
    status: dbOk && redisOk ? "ok" : "degraded",
    postgres: dbOk ? "ok" : "error",
    redis: redisOk ? "ok" : "error",
    timestamp: new Date().toISOString(),
  });
});

export default app;
