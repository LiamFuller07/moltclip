import OpenAI from "openai";
import pRetry from "p-retry";
import {
  GROK_API_BASE_URL,
  GROK_DEFAULT_MODEL,
  GROK_MAX_TOKENS,
  GROK_TEMPERATURE,
  GROK_RETRY_ATTEMPTS,
  GROK_RETRY_DELAYS_MS,
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

export interface GrokCallResult {
  content: string;
  model: string;
  tokens_used: number;
}

export async function callGrok(
  prompt: string,
  model?: string,
): Promise<GrokCallResult> {
  const selectedModel = model || GROK_DEFAULT_MODEL;
  const grok = getClient();

  const result = await pRetry(
    async () => {
      const res = await grok.chat.completions.create({
        model: selectedModel,
        max_tokens: GROK_MAX_TOKENS,
        temperature: GROK_TEMPERATURE,
        messages: [{ role: "user", content: prompt }],
      });

      const content = res.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from Grok API");
      }

      const tokensUsed =
        (res.usage?.prompt_tokens ?? 0) + (res.usage?.completion_tokens ?? 0);

      return {
        content,
        model: selectedModel,
        tokens_used: tokensUsed,
      };
    },
    {
      retries: GROK_RETRY_ATTEMPTS,
      minTimeout: GROK_RETRY_DELAYS_MS[0],
      factor: 2,
      onFailedAttempt: (error) => {
        console.error(
          `Grok API attempt ${error.attemptNumber} failed: ${error.message}`,
        );
      },
    },
  );

  return result;
}
