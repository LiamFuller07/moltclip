import { Redis } from "ioredis";
import { env } from "./env.js";
import pino from "pino";

const log = pino({ name: "redis" });

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    return Math.min(times * 200, 5000);
  },
});

redis.on("connect", () => log.info("redis connected"));
redis.on("error", (err: Error) => log.error({ err }, "redis error"));

// KV-like interface (replaces Cloudflare KV)
export const kv = {
  async get<T = string>(key: string): Promise<T | null> {
    const val = await redis.get(key);
    if (val === null) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as unknown as T;
    }
  },

  async put(key: string, value: string | object, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await redis.set(key, serialized, "EX", ttlSeconds);
    } else {
      await redis.set(key, serialized);
    }
  },

  async delete(key: string): Promise<void> {
    await redis.del(key);
  },

  async list(prefix: string): Promise<{ keys: { name: string }[] }> {
    const keys = await redis.keys(`${prefix}*`);
    return { keys: keys.map((name: string) => ({ name })) };
  },
};
