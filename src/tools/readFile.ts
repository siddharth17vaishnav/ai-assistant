import fs from "fs/promises";
import path from "path";

import { config } from "../core/config.js";

export function resolveProjectPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const fullPath = path.resolve(config.projectPath, normalized);
  const root = path.resolve(config.projectPath);

  if (!fullPath.startsWith(root)) {
    throw new Error("Path escapes project directory.");
  }

  return fullPath;
}

export async function readProjectFile(relativePath: string): Promise<string> {
  const fullPath = resolveProjectPath(relativePath);

  try {
    return await fs.readFile(fullPath, "utf8");
  } catch {
    throw new Error(`File not found: ${relativePath}`);
  }
}

export function formatFileWithLineNumbers(
  relativePath: string,
  content: string,
): string {
  const lines = content.split("\n");
  const width = String(lines.length).length;

  const numbered = lines
    .map((line, index) => {
      const lineNo = String(index + 1).padStart(width, " ");
      return `${lineNo}| ${line}`;
    })
    .join("\n");

  return `${relativePath}\n${numbered}`;
}
