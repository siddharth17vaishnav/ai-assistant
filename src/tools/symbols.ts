import fs from "fs/promises";
import path from "path";

import { config } from "../core/config.js";
import { listProjectPaths } from "../indexing/loader.js";
import type { SymbolMatch } from "../core/types.js";

const SYMBOL_PATTERNS: Array<{
  kind: SymbolMatch["kind"];
  regex: RegExp;
}> = [
  {
    kind: "function",
    regex:
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "class",
    regex: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "interface",
    regex: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "type",
    regex: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: "export",
    regex:
      /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  },
];

export async function findSymbol(
  name: string,
  maxResults = 20,
): Promise<SymbolMatch[]> {
  const paths = await listProjectPaths();
  const codePaths = paths.filter((filePath) =>
    /\.(ts|tsx|js|jsx)$/.test(filePath),
  );

  const matches: SymbolMatch[] = [];
  const namePattern = new RegExp(`\\b${escapeRegex(name)}\\b`);

  for (const relativePath of codePaths) {
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

      const line = lines[index];

      if (!namePattern.test(line)) continue;

      for (const { kind, regex } of SYMBOL_PATTERNS) {
        const match = line.match(regex);

        if (match?.[1] === name) {
          matches.push({
            path: relativePath,
            line: index + 1,
            kind,
            name,
            text: line.trimEnd(),
          });
          break;
        }
      }
    }
  }

  return matches;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatSymbolResults(matches: SymbolMatch[]): string {
  if (matches.length === 0) {
    return "No symbol definitions found.";
  }

  return matches
    .map(
      (match) =>
        `${match.path}:${match.line} [${match.kind}] ${match.text}`,
    )
    .join("\n");
}
