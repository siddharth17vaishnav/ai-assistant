import fs from "fs/promises";
import path from "path";

import { config } from "../config.js";

function resolveProjectPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const fullPath = path.resolve(config.projectPath, normalized);
  const root = path.resolve(config.projectPath);

  if (!fullPath.startsWith(root)) {
    throw new Error("Path escapes project directory.");
  }

  return fullPath;
}

export async function writeProjectFile(
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = resolveProjectPath(relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf8");
}
