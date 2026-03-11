import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadTemplate } from "../template-loader.js";
import { parseClaudeJson } from "../validators.js";

const execFileAsync = promisify(execFile);

export interface CodebaseFinding {
  file_path: string;
  finding_type: "outdated" | "error_handling" | "hardcoded" | "security" | "performance";
  issue: string;
  suggested_fix: string;
  confidence: number;
}

/**
 * Scan codebase files using Claude to identify quality issues,
 * outdated patterns, security risks, and performance problems.
 */
export async function scanCodebase(
  files: Map<string, string>,
): Promise<CodebaseFinding[]> {
  const client = new Anthropic();

  // Build file contents block
  const filesContents = Array.from(files.entries())
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join("\n\n");

  // Attempt to get recent git log for context
  let gitLog = "(git log unavailable)";
  try {
    const { stdout } = await execFileAsync("git", [
      "log",
      "--oneline",
      "--no-decorate",
      "-20",
    ]);
    gitLog = stdout.trim() || "(empty git log)";
  } catch {
    // Not a git repo or git unavailable — continue without
  }

  const prompt = await loadTemplate("codebase-scan.md", {
    git_log: gitLog,
    files_contents: filesContents,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parseClaudeJson<CodebaseFinding[]>(text);
}
