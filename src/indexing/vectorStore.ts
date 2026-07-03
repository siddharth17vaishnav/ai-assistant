import * as lancedb from "@lancedb/lancedb";

import { config } from "../core/config.js";
import type { StoredChunk } from "../core/types.js";

const TABLE_NAME = "code_chunks";

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export async function getDb() {
  return lancedb.connect(config.lanceDbDir);
}

export async function tableExists(): Promise<boolean> {
  const db = await getDb();
  const tables = await db.tableNames();
  return tables.includes(TABLE_NAME);
}

export async function saveChunks(rows: StoredChunk[]) {
  if (rows.length === 0) {
    throw new Error("No chunks to index.");
  }

  const db = await getDb();

  if (await tableExists()) {
    await db.dropTable(TABLE_NAME);
  }

  return db.createTable(
    TABLE_NAME,
    rows as unknown as Record<string, unknown>[],
  );
}

export async function addChunks(rows: StoredChunk[]) {
  if (rows.length === 0) return;

  const db = await getDb();

  if (!(await tableExists())) {
    await db.createTable(
      TABLE_NAME,
      rows as unknown as Record<string, unknown>[],
    );
    return;
  }

  const table = await db.openTable(TABLE_NAME);
  await table.add(rows as unknown as Record<string, unknown>[]);
}

export async function deleteChunksByPaths(paths: string[]) {
  if (paths.length === 0) return;

  const table = await openChunksTable();

  for (const filePath of paths) {
    await table.delete(`path = '${escapeSqlString(filePath)}'`);
  }
}

export async function openChunksTable() {
  const db = await getDb();
  const tables = await db.tableNames();

  if (!tables.includes(TABLE_NAME)) {
    throw new Error('No index found. Run "npm run index" first.');
  }

  return db.openTable(TABLE_NAME);
}

export async function searchChunks(vector: number[], topK: number) {
  const table = await openChunksTable();
  return table.vectorSearch(vector).limit(topK).toArray();
}
