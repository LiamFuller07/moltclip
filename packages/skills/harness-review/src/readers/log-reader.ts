import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface NormalizedLogEntry {
  timestamp: string;
  level: string;
  tool?: string;
  message: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Stream-read a JSONL log file, filtering entries to those within
 * `windowHours` of now. Handles malformed lines gracefully by skipping them.
 * Returns at most `maxLogs` entries.
 */
export async function readLogs(
  logPath: string,
  windowHours: number,
  maxLogs: number,
): Promise<NormalizedLogEntry[]> {
  const entries: NormalizedLogEntry[] = [];
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;

  const rl = createInterface({
    input: createReadStream(logPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (entries.length >= maxLogs) break;

    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      const entry = normalizeEntry(parsed);
      if (!entry) continue;

      // Filter by time window
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isNaN(ts) || ts < cutoff) continue;

      entries.push(entry);
    } catch {
      // Malformed line — skip silently
      continue;
    }
  }

  return entries;
}

/**
 * Normalize a parsed JSON log object into a consistent shape.
 * Returns null if the object lacks minimum required fields.
 */
function normalizeEntry(obj: Record<string, unknown>): NormalizedLogEntry | null {
  // Require at least a timestamp and some form of message
  const timestamp =
    asString(obj.timestamp) ??
    asString(obj.ts) ??
    asString(obj.time) ??
    asString(obj["@timestamp"]);

  const message =
    asString(obj.message) ??
    asString(obj.msg) ??
    asString(obj.text) ??
    asString(obj.body);

  if (!timestamp || !message) return null;

  return {
    timestamp,
    level: asString(obj.level) ?? asString(obj.severity) ?? "info",
    tool: asString(obj.tool) ?? asString(obj.component) ?? undefined,
    message,
    error: asString(obj.error) ?? asString(obj.err) ?? undefined,
    duration_ms:
      typeof obj.duration_ms === "number"
        ? obj.duration_ms
        : typeof obj.duration === "number"
          ? obj.duration
          : undefined,
  };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
