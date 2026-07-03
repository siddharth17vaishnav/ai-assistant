import fs from "fs/promises";
import path from "path";

import { config } from "../core/config.js";
import type { FileEntry, IndexManifest } from "../core/types.js";
import { touchProjectRegistry } from "../core/projectStorage.js";

export async function loadManifest(): Promise<IndexManifest | null> {
  try {
    const raw = await fs.readFile(config.manifestPath, "utf8");
    return JSON.parse(raw) as IndexManifest;
  } catch {
    return null;
  }
}

export async function saveManifest(files: Record<string, FileEntry>): Promise<void> {
  await fs.mkdir(path.dirname(config.manifestPath), { recursive: true });

  const manifest: IndexManifest = {
    projectPath: config.projectPath,
    updatedAt: new Date().toISOString(),
    files,
  };

  await fs.writeFile(config.manifestPath, JSON.stringify(manifest, null, 2));
  await touchProjectRegistry(config.projectPath);
}

export function diffFiles(
  current: Record<string, FileEntry>,
  previous: Record<string, FileEntry>,
): {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
} {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const [filePath, entry] of Object.entries(current)) {
    const prev = previous[filePath];

    if (!prev) {
      added.push(filePath);
    } else if (
      prev.mtimeMs !== entry.mtimeMs ||
      prev.size !== entry.size
    ) {
      modified.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  }

  for (const filePath of Object.keys(previous)) {
    if (!current[filePath]) {
      deleted.push(filePath);
    }
  }

  return { added, modified, deleted, unchanged };
}
