import fs from "fs/promises";
import path from "path";

import { config } from "../core/config.js";
import { listProjectPaths } from "../indexing/loader.js";
import type { GrepMatch } from "../core/types.js";

export async function grep(
  pattern: string,
  maxResults = 30,
): Promise<GrepMatch[]> {
  const paths = await listProjectPaths();
  const regex = new RegExp(pattern, "i");
  const matches: GrepMatch[] = [];

  for (const relativePath of paths) {
    if (matches.length >= maxResults) break;

    const fullPath = path.join(config.projectPath, relativePath);
    let content: string;

    try {
      content = await fs.readFile(fullPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    for (let index = 0; index < lines.length; index++) {
      if (matches.length >= maxResults) break;

      if (regex.test(lines[index])) {
        matches.push({
          path: relativePath,
          line: index + 1,
          text: lines[index].trimEnd(),
        });
      }
    }
  }

  return matches;
}

export function formatGrepResults(matches: GrepMatch[]): string {
  if (matches.length === 0) {
    return "No matches found.";
  }

  return matches
    .map((match) => `${match.path}:${match.line}: ${match.text}`)
    .join("\n");
}
