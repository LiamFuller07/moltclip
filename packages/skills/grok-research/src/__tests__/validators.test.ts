import { describe, it, expect } from "vitest";
import { parseGrokResponse, safeParseGrokResponse } from "../validators.js";

function makeValidResult() {
  return {
    findings: ["Finding 1", "Finding 2"],
    sources: [
      {
        url: "https://example.com/article",
        title: "Test Article",
        summary: "A test article about AI",
        relevance_score: 8,
      },
    ],
    sentiment: {
      label: "positive",
      summary: "Generally positive outlook",
      signals: ["strong adoption", "good reviews"],
    },
    meta: {
      query: "test query",
      mode: "cold",
      model: "grok-3",
      tokens_used: 1500,
      timestamp: "2025-01-01T00:00:00Z",
      confidence: 7,
    },
  };
}

describe("parseGrokResponse", () => {
  it("parses valid JSON input", () => {
    const raw = JSON.stringify(makeValidResult());
    const result = parseGrokResponse(raw);

    expect(result.findings).toEqual(["Finding 1", "Finding 2"]);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe("https://example.com/article");
    expect(result.sentiment.label).toBe("positive");
    expect(result.meta.model).toBe("grok-3");
  });

  it("strips markdown ```json fences", () => {
    const inner = JSON.stringify(makeValidResult());
    const raw = "```json\n" + inner + "\n```";
    const result = parseGrokResponse(raw);

    expect(result.findings).toHaveLength(2);
    expect(result.meta.query).toBe("test query");
  });

  it("strips plain ``` fences", () => {
    const inner = JSON.stringify(makeValidResult());
    const raw = "```\n" + inner + "\n```";
    const result = parseGrokResponse(raw);

    expect(result.findings).toHaveLength(2);
  });

  it("fixes trailing commas before } or ]", () => {
    const raw = `{
      "findings": ["Finding 1", "Finding 2",],
      "sources": [],
      "sentiment": {
        "label": "neutral",
        "summary": "Neutral",
        "signals": [],
      },
      "meta": {
        "query": "test",
        "mode": "cold",
        "model": "grok-3",
        "tokens_used": 100,
        "timestamp": "2025-01-01T00:00:00Z",
        "confidence": 5,
      },
    }`;

    const result = parseGrokResponse(raw);
    expect(result.findings).toEqual(["Finding 1", "Finding 2"]);
    expect(result.sentiment.label).toBe("neutral");
  });

  it("handles whitespace around input", () => {
    const raw = "   \n" + JSON.stringify(makeValidResult()) + "\n   ";
    const result = parseGrokResponse(raw);
    expect(result.findings).toHaveLength(2);
  });

  it("throws on completely invalid JSON", () => {
    expect(() => parseGrokResponse("not json at all")).toThrow();
  });

  it("throws when required fields are missing", () => {
    const raw = JSON.stringify({ findings: ["test"] }); // missing sources, sentiment, meta
    expect(() => parseGrokResponse(raw)).toThrow();
  });

  it("parses result with optional fields", () => {
    const data = {
      ...makeValidResult(),
      improvement_ideas: [
        {
          idea: "Use caching",
          rationale: "Reduce API calls",
        },
      ],
      upgrade_plan: {
        summary: "Add caching layer",
        steps: ["Step 1", "Step 2"],
        expected_score: 9,
      },
      tool_discoveries: [
        {
          tool_name: "Redis",
          url: "https://redis.io",
          description: "In-memory store",
          integration_effort: "low",
          relevance: 8,
        },
      ],
    };

    const result = parseGrokResponse(JSON.stringify(data));
    expect(result.improvement_ideas).toHaveLength(1);
    expect(result.upgrade_plan!.expected_score).toBe(9);
    expect(result.tool_discoveries).toHaveLength(1);
    expect(result.tool_discoveries![0].integration_effort).toBe("low");
  });
});

describe("safeParseGrokResponse", () => {
  const fallbackMeta = { query: "test query", mode: "cold", model: "grok-3" };

  it("returns parsed result with no error for valid input", () => {
    const raw = JSON.stringify(makeValidResult());
    const { result, error } = safeParseGrokResponse(raw, fallbackMeta);

    expect(result).not.toBeNull();
    expect(error).toBeNull();
    expect(result!.findings).toHaveLength(2);
  });

  it("returns partial result for input missing some required zod fields", () => {
    // Valid JSON but doesn't pass full zod schema (missing meta.confidence and meta.tokens_used)
    const data = {
      findings: ["partial finding"],
      sources: [],
      sentiment: {
        label: "neutral",
        summary: "Neutral",
        signals: [],
      },
      meta: {
        query: "test",
        mode: "cold",
        model: "grok-3",
        // missing tokens_used, timestamp, confidence
      },
    };

    const { result, error } = safeParseGrokResponse(JSON.stringify(data), fallbackMeta);

    // The strict schema parse fails, but fallback partial parse succeeds
    expect(result).not.toBeNull();
    expect(result!.findings).toEqual(["partial finding"]);
    // Fallback meta should fill in gaps
    expect(result!.meta.query).toBe("test");
    expect(result!.meta.model).toBe("grok-3");
  });

  it("returns null result for completely unparseable input", () => {
    const { result, error } = safeParseGrokResponse("totally broken {{{", fallbackMeta);

    expect(result).toBeNull();
    expect(error).not.toBeNull();
    expect(error).toContain("Failed to parse");
  });

  it("provides fallback meta when partial meta is missing", () => {
    const data = {
      findings: ["found something"],
      // missing sources, sentiment — partial parse fills defaults
    };

    const { result, error } = safeParseGrokResponse(JSON.stringify(data), fallbackMeta);

    // Partial parse should succeed
    expect(result).not.toBeNull();
    expect(result!.meta.query).toBe("test query");
    expect(result!.meta.mode).toBe("cold");
    expect(result!.meta.model).toBe("grok-3");
    expect(error).not.toBeNull(); // Partial parse returns an error message
  });

  it("defaults sentiment to neutral when missing", () => {
    const data = {
      findings: ["test"],
      sources: [],
      // no sentiment
      meta: { query: "q", mode: "cold", model: "grok-3" },
    };

    const { result } = safeParseGrokResponse(JSON.stringify(data), fallbackMeta);
    expect(result).not.toBeNull();
    expect(result!.sentiment.label).toBe("neutral");
  });

  it("handles empty findings gracefully", () => {
    const data = {
      findings: [],
      sources: [],
      sentiment: { label: "neutral", summary: "n/a", signals: [] },
      meta: {
        query: "q",
        mode: "cold",
        model: "grok-3",
        tokens_used: 0,
        timestamp: "2025-01-01T00:00:00Z",
        confidence: 1,
      },
    };

    const { result, error } = safeParseGrokResponse(JSON.stringify(data), fallbackMeta);
    expect(result).not.toBeNull();
    expect(error).toBeNull();
    expect(result!.findings).toEqual([]);
  });
});
