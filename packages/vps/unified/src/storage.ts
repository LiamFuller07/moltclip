import { mkdir, readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { env } from "./env.js";
import pino from "pino";

const log = pino({ name: "storage" });
const BASE = env.storageDir;

export const storage = {
  async get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const resolved = join(BASE, key);
    if (!resolved.startsWith(BASE + "/") && resolved !== BASE) {
      log.error({ key }, "storage.get: path traversal detected");
      return null;
    }
    try {
      const data = await readFile(resolved);
      return {
        async text() { return data.toString("utf-8"); },
        async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); },
      };
    } catch (err: any) {
      if (err.code !== "ENOENT") log.warn({ err, key }, "storage.get failed");
      return null;
    }
  },

  async put(key: string, data: string | Buffer | ArrayBuffer): Promise<void> {
    const path = join(BASE, key);
    if (!path.startsWith(BASE + "/") && path !== BASE) {
      throw new Error("Path traversal detected");
    }
    await mkdir(dirname(path), { recursive: true });
    if (data instanceof ArrayBuffer) {
      await writeFile(path, Buffer.from(data));
    } else {
      await writeFile(path, data);
    }
  },

  async delete(key: string): Promise<void> {
    const path = join(BASE, key);
    if (!path.startsWith(BASE + "/") && path !== BASE) return;
    try {
      await unlink(path);
    } catch (err: any) {
      if (err.code !== "ENOENT") log.warn({ err, key }, "storage.delete failed");
    }
  },

  async list(prefix: string): Promise<string[]> {
    const dir = join(BASE, prefix);
    if (!dir.startsWith(BASE + "/") && dir !== BASE) return [];
    try {
      const files = await readdir(dir, { recursive: true });
      return files.map((f) => join(prefix, f.toString()));
    } catch (err: any) {
      if (err.code !== "ENOENT") log.warn({ err, prefix }, "storage.list failed");
      return [];
    }
  },
};
