import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, "..", "prompts");

const cache = new Map<string, string>();

export async function loadTemplate(
  filename: string,
  variables: Record<string, string>,
): Promise<string> {
  let template = cache.get(filename);
  if (!template) {
    const filePath = join(promptsDir, filename);
    template = await readFile(filePath, "utf-8");
    cache.set(filename, template);
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] ?? `{{${key}}}`;
  });
}

export function modeToTemplate(mode: string): string {
  switch (mode) {
    case "cold":
      return "cold-research.md";
    case "weakness":
      return "weakness-research.md";
    case "synthesis":
      return "synthesis.md";
    case "tool_discovery":
      return "tool-discovery.md";
    default:
      return "cold-research.md";
  }
}
