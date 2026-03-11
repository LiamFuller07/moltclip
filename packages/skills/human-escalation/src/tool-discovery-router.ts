import OpenAI from "openai";
import pRetry from "p-retry";
import {
  GROK_API_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_MAX_TOKENS,
  GROK_TEMPERATURE,
} from "@moltclip/shared";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error("XAI_API_KEY environment variable is required");
    }
    client = new OpenAI({ apiKey, baseURL: GROK_API_BASE_URL });
  }
  return client;
}

interface DiscoveredTool {
  tool_name: string;
  description: string;
  url: string;
  solves_blockade: boolean;
  confidence: number;
}

/**
 * Discover existing tools/services that might resolve the blockade.
 *
 * Calls Grok API with tool_discovery prompt, parsing the response for
 * structured tool_discoveries[]. Returns array of software alternatives.
 */
export async function discoverTools(
  blockadeDescription: string,
  failedAttempts: string[],
  domain?: string,
): Promise<DiscoveredTool[]> {
  const grok = getClient();

  const prompt = `You are a tool discovery agent. Your task is to find existing software tools, APIs, libraries, or SaaS services that solve a specific technical blockade.

BLOCKADE DESCRIPTION:
${blockadeDescription}

APPROACHES ALREADY TRIED (these did not work):
${failedAttempts.map((a, i) => `${i + 1}. ${a}`).join("\n")}

${domain ? `DOMAIN CONTEXT: ${domain}` : ""}

Search for tools that directly address this blockade. For each tool found, assess whether it fully solves the blockade or only partially helps.

Respond with ONLY valid JSON in this exact format:
{
  "tool_discoveries": [
    {
      "tool_name": "Name of the tool/service",
      "description": "What it does and how it addresses the blockade",
      "url": "https://...",
      "solves_blockade": true,
      "confidence": 0.85
    }
  ]
}

Rules:
- Return 0-5 tools maximum
- confidence is 0.0 to 1.0 — only mark > 0.7 if the tool directly and fully solves the blockade
- solves_blockade should only be true if it addresses the core issue, not just a peripheral aspect
- Include tools from: npm, PyPI, GitHub, commercial APIs, SaaS platforms
- Do NOT suggest tools the user has already tried
- If no relevant tools exist, return an empty tool_discoveries array`;

  const result = await pRetry(
    async () => {
      const res = await grok.chat.completions.create({
        model: GROK_DEFAULT_MODEL,
        max_tokens: GROK_MAX_TOKENS,
        temperature: GROK_TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      });

      const content = res.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from Grok API");
      }

      return content;
    },
    {
      retries: 2,
      minTimeout: 2000,
      factor: 2,
      onFailedAttempt: (error) => {
        console.error(
          `Grok tool discovery attempt ${error.attemptNumber} failed: ${error.message}`,
        );
      },
    },
  );

  // Parse the JSON response
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON found in Grok tool discovery response");
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const discoveries = parsed.tool_discoveries;

    if (!Array.isArray(discoveries)) {
      return [];
    }

    return discoveries
      .filter(
        (d: Record<string, unknown>) =>
          typeof d.tool_name === "string" &&
          typeof d.description === "string" &&
          typeof d.url === "string" &&
          typeof d.confidence === "number",
      )
      .map((d: Record<string, unknown>) => ({
        tool_name: d.tool_name as string,
        description: d.description as string,
        url: d.url as string,
        solves_blockade: d.solves_blockade === true,
        confidence: Math.min(1, Math.max(0, d.confidence as number)),
      }));
  } catch (err) {
    console.error(
      `Failed to parse Grok tool discovery response: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
