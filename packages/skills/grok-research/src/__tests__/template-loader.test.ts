import { describe, it, expect } from "vitest";
import { modeToTemplate } from "../template-loader.js";

// Note: We test modeToTemplate (pure function) directly.
// loadTemplate requires filesystem access to prompts/ directory,
// so we test variable interpolation logic via its regex pattern.

describe("modeToTemplate", () => {
  it("maps 'cold' to cold-research.md", () => {
    expect(modeToTemplate("cold")).toBe("cold-research.md");
  });

  it("maps 'weakness' to weakness-research.md", () => {
    expect(modeToTemplate("weakness")).toBe("weakness-research.md");
  });

  it("maps 'synthesis' to synthesis.md", () => {
    expect(modeToTemplate("synthesis")).toBe("synthesis.md");
  });

  it("maps 'tool_discovery' to tool-discovery.md", () => {
    expect(modeToTemplate("tool_discovery")).toBe("tool-discovery.md");
  });

  it("defaults unknown modes to cold-research.md", () => {
    expect(modeToTemplate("unknown")).toBe("cold-research.md");
    expect(modeToTemplate("")).toBe("cold-research.md");
    expect(modeToTemplate("COLD")).toBe("cold-research.md");
  });
});

describe("Variable interpolation logic", () => {
  // The regex used in loadTemplate: /\{\{(\w+)\}\}/g
  // If the key exists in variables, replace; otherwise keep {{key}}
  const interpolationRegex = /\{\{(\w+)\}\}/g;

  function interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(interpolationRegex, (_, key: string) => {
      return variables[key] ?? `{{${key}}}`;
    });
  }

  it("replaces single variable", () => {
    const result = interpolate("Hello {{name}}", { name: "World" });
    expect(result).toBe("Hello World");
  });

  it("replaces multiple variables", () => {
    const result = interpolate("{{greeting}} {{name}}, welcome to {{place}}", {
      greeting: "Hello",
      name: "Alice",
      place: "Wonderland",
    });
    expect(result).toBe("Hello Alice, welcome to Wonderland");
  });

  it("preserves unmatched variables as-is", () => {
    const result = interpolate("{{known}} and {{unknown}}", { known: "found" });
    expect(result).toBe("found and {{unknown}}");
  });

  it("handles template with no variables", () => {
    const result = interpolate("No variables here", { key: "value" });
    expect(result).toBe("No variables here");
  });

  it("handles empty variables map", () => {
    const result = interpolate("{{query}} in {{domain}}", {});
    expect(result).toBe("{{query}} in {{domain}}");
  });

  it("replaces same variable appearing multiple times", () => {
    const result = interpolate("{{x}} + {{x}} = {{result}}", {
      x: "1",
      result: "2",
    });
    expect(result).toBe("1 + 1 = 2");
  });

  it("handles multi-line templates", () => {
    const template = `# Research: {{query}}
Mode: {{mode}}
Domain: {{domain}}
---
Results for {{query}}:`;

    const result = interpolate(template, {
      query: "AI tools",
      mode: "cold",
      domain: "technology",
    });

    expect(result).toContain("# Research: AI tools");
    expect(result).toContain("Mode: cold");
    expect(result).toContain("Domain: technology");
    expect(result).toContain("Results for AI tools:");
  });

  it("does not match non-word characters in variable names", () => {
    // {{foo-bar}} should not match because - is not a \w character
    const result = interpolate("{{foo-bar}} vs {{foo_bar}}", { foo_bar: "yes" });
    expect(result).toBe("{{foo-bar}} vs yes");
  });
});
