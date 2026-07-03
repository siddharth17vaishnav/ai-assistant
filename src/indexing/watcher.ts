import fs from "fs";
import path from "path";

import { config } from "../core/config.js";
import { syncIndex } from "./syncIndex.js";
import type { SyncResult } from "../core/types.js";

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "storage",
]);

function shouldIgnore(filename: string): boolean {
  const parts = filename.replace(/\\/g, "/").split("/");
  return parts.some((part) => IGNORED_SEGMENTS.has(part));
}

function formatSyncResult(result: SyncResult): string {
  if (result.mode === "unchanged") {
    return "Index up to date.";
  }

  if (result.mode === "full") {
    return `Full sync — ${result.chunksEmbedded} chunks embedded.`;
  }

  return `Incremental sync — +${result.added} ~${result.modified} -${result.deleted}, ${result.chunksEmbedded} chunks embedded.`;
}

export function startWatcher(onSync?: (result: SyncResult) => void) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;

  const projectPath = path.resolve(config.projectPath);

  const scheduleSync = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      if (syncing) return;

      syncing = true;

      try {
        console.log("\n[watch] Syncing index...");
        const result = await syncIndex({ quiet: true });
        const message = formatSyncResult(result);
        console.log(`[watch] ${message}\n`);
        onSync?.(result);
      } catch (error) {
        console.error(
          "[watch] Sync failed:",
          error instanceof Error ? error.message : error,
        );
      } finally {
        syncing = false;
      }
    }, config.watch.debounceMs);
  };

  fs.watch(projectPath, { recursive: true }, (_event, filename) => {
    if (!filename || shouldIgnore(filename)) return;
    scheduleSync();
  });

  console.log(`Watching ${projectPath} for changes...`);

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
