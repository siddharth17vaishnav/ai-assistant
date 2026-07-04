import { chunkCode } from "./chunker.js";
import { config } from "../core/config.js";
import { embedBatch } from "./embedder.js";
import { loadProject, loadProjectFiles, scanProject } from "./loader.js";
import { diffFiles, loadManifest, saveManifest } from "./manifest.js";
import { ensureStorageReady } from "../core/projectStorage.js";
import type { Chunk, ProjectFile, StoredChunk, SyncResult } from "../core/types.js";
import {
  addChunks,
  deleteChunksByPaths,
  saveChunks,
  tableExists,
} from "./vectorStore.js";

function log(message: string, quiet?: boolean) {
  if (!quiet) {
    console.log(message);
  }
}

async function buildChunks(
  files: ProjectFile[],
  quiet?: boolean,
): Promise<StoredChunk[]> {
  const allChunks: Chunk[] = [];

  for (const file of files) {
    allChunks.push(...chunkCode(file.path, file.content));
  }

  if (allChunks.length === 0) {
    return [];
  }

  log(`Embedding ${allChunks.length} chunks...`, quiet);

  const texts = allChunks.map((chunk) => chunk.text);
  const vectors = await embedBatch(texts, 8, (done, total) => {
    log(`Embedded ${done}/${total} chunks`, quiet);
  });

  return allChunks.map((chunk, index) => ({
    ...chunk,
    vector: vectors[index],
  }));
}

async function fullIndex(quiet?: boolean): Promise<SyncResult> {
  log("Running full index...", quiet);

  const files = await loadProject();
  log(`Found ${files.length} files`, quiet);

  const rows = await buildChunks(files, quiet);

  if (rows.length === 0) {
    throw new Error("No indexable content found.");
  }

  await saveChunks(rows);

  const scanned = await scanProject();
  await saveManifest(scanned);

  log(`✅ Full index saved (${rows.length} chunks)`, quiet);

  return {
    mode: "full",
    added: files.length,
    modified: 0,
    deleted: 0,
    chunksEmbedded: rows.length,
  };
}

export async function syncIndex(options?: {
  forceFull?: boolean;
  quiet?: boolean;
}): Promise<SyncResult> {
  const { forceFull = false, quiet = false } = options ?? {};

  await ensureStorageReady(config.projectPath);

  if (forceFull) {
    return fullIndex(quiet);
  }

  const currentFiles = await scanProject();
  const manifest = await loadManifest();
  const hasTable = await tableExists();

  const needsFull = !manifest || !hasTable;

  if (needsFull) {
    return fullIndex(quiet);
  }

  const { added, modified, deleted, unchanged } = diffFiles(
    currentFiles,
    manifest.files,
  );

  const changedCount = added.length + modified.length + deleted.length;

  if (changedCount === 0) {
    log("✅ Index is up to date — no changes detected.", quiet);
    return {
      mode: "unchanged",
      added: 0,
      modified: 0,
      deleted: 0,
      chunksEmbedded: 0,
    };
  }

  log("Incremental update:", quiet);
  log(`  Added:     ${added.length}`, quiet);
  log(`  Modified:  ${modified.length}`, quiet);
  log(`  Deleted:   ${deleted.length}`, quiet);
  log(`  Unchanged: ${unchanged.length}`, quiet);

  const pathsToRemove = [...deleted, ...modified];

  if (pathsToRemove.length > 0) {
    log(`Removing chunks for ${pathsToRemove.length} file(s)...`, quiet);
    await deleteChunksByPaths(pathsToRemove);
  }

  const pathsToIndex = [...added, ...modified];
  let chunksEmbedded = 0;

  if (pathsToIndex.length > 0) {
    const files = await loadProjectFiles(pathsToIndex);
    const rows = await buildChunks(files, quiet);
    await addChunks(rows);
    chunksEmbedded = rows.length;
  }

  await saveManifest(currentFiles);

  log("✅ Incremental index updated.", quiet);

  return {
    mode: "incremental",
    added: added.length,
    modified: modified.length,
    deleted: deleted.length,
    chunksEmbedded,
  };
}
