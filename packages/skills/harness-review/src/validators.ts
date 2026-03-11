/**
 * Parse a Claude JSON response, stripping markdown fences and fixing
 * common malformations (trailing commas, etc.).
 */
export function parseClaudeJson<T = unknown>(raw: string): T {
  const cleaned = cleanJsonString(raw);
  return JSON.parse(cleaned) as T;
}

/**
 * Attempt to parse, returning the result or an error string.
 */
export function safeParseClaudeJson<T = unknown>(
  raw: string,
): { result: T; error: null } | { result: null; error: string } {
  try {
    const result = parseClaudeJson<T>(raw);
    return { result, error: null };
  } catch (err) {
    return {
      result: null,
      error: `Failed to parse JSON: ${(err as Error).message}`,
    };
  }
}

/**
 * Clean a string that may contain JSON wrapped in markdown code fences,
 * trailing commas, or other common LLM output artefacts.
 */
function cleanJsonString(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences
  if (s.startsWith("```json")) {
    s = s.slice(7);
  } else if (s.startsWith("```")) {
    s = s.slice(3);
  }
  if (s.endsWith("```")) {
    s = s.slice(0, -3);
  }
  s = s.trim();

  // Fix trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}
