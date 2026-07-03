import fg from "fast-glob";
import fs from "fs/promises";
import path from "path";

import { config } from "../core/config.js";
import type { FileEntry, ProjectFile } from "../core/types.js";

function projectPatterns(): string[] {
  const root = config.projectPath.replace(/\\/g, "/");
  return config.include.map((pattern) => `${root}/${pattern}`);
}

export async function listProjectPaths(): Promise<string[]> {
  const files = await fg(projectPatterns(), {
    ignore: config.exclude,
    absolute: true,
  });

  return files.map((file) => path.relative(config.projectPath, file));
}

export async function scanProject(): Promise<Record<string, FileEntry>> {
  const paths = await listProjectPaths();
  const files: Record<string, FileEntry> = {};

  for (const relativePath of paths) {
    try {
      const fullPath = path.join(config.projectPath, relativePath);
      const stat = await fs.stat(fullPath);

      files[relativePath] = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      };
    } catch {
      // skip unreadable files
    }
  }

  return files;
}

export async function loadProjectFiles(
  paths?: string[],
): Promise<ProjectFile[]> {
  const targetPaths = paths ?? (await listProjectPaths());
  const result: ProjectFile[] = [];

  for (const relativePath of targetPaths) {
    try {
      const fullPath = path.join(config.projectPath, relativePath);
      const content = await fs.readFile(fullPath, "utf8");

      result.push({ path: relativePath, content });
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

export async function loadProject(): Promise<ProjectFile[]> {
  return loadProjectFiles();
}
