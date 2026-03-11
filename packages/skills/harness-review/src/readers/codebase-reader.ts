import { readdir, readFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const ALLOWED_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".yml"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/**
 * Recursively walk `repoPath`, reading up to `maxFiles` files
 * with allowed extensions. Skips node_modules, dist, and .git.
 * Returns a Map of relative filepath -> file content.
 */
export async function readCodebase(
  repoPath: string,
  maxFiles: number,
): Promise<Map<string, string>> {
  const files = new Map<string, string>();

  const entries = await readdir(repoPath, {
    withFileTypes: true,
    recursive: true,
  });

  for (const entry of entries) {
    if (files.size >= maxFiles) break;
    if (!entry.isFile()) continue;

    const ext = extname(entry.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    // Build full path from parentPath (Node 20+) or entry path
    const parentDir = (entry as unknown as { parentPath?: string }).parentPath ?? entry.path;
    const fullPath = join(parentDir, entry.name);

    // Skip if any ancestor directory is in SKIP_DIRS
    const rel = relative(repoPath, fullPath);
    const segments = rel.split("/");
    if (segments.some((seg) => SKIP_DIRS.has(seg))) continue;

    try {
      const content = await readFile(fullPath, "utf-8");
      files.set(rel, content);
    } catch {
      // Permission denied or other read error — skip
      continue;
    }
  }

  return files;
}
