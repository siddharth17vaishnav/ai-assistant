import { grep } from "../tools/grep.js";
import { findSymbol } from "../tools/symbols.js";
import { getChangedFiles } from "../tools/git.js";
import { config } from "../core/config.js";
import { embed } from "../indexing/embedder.js";
import { searchChunks } from "../indexing/vectorStore.js";
import type { GrepMatch, SearchResult } from "../core/types.js";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function extractSymbols(query: string): string[] {
  const matches = query.match(/\b[A-Z][A-Za-z0-9_$]*\b/g) ?? [];
  return [...new Set(matches)].slice(0, 3);
}

function chunkKey(chunk: Pick<SearchResult, "path" | "startLine">): string {
  return `${chunk.path}:${chunk.startLine}`;
}

function grepToSearchResult(match: GrepMatch): SearchResult {
  return {
    id: `${match.path}:grep:${match.line}`,
    path: match.path,
    startLine: match.line,
    endLine: match.line,
    text: match.text,
  };
}

function symbolToSearchResult(match: {
  path: string;
  line: number;
  text: string;
}): SearchResult {
  return {
    id: `${match.path}:symbol:${match.line}`,
    path: match.path,
    startLine: match.line,
    endLine: match.line,
    text: match.text,
  };
}

function prioritizeChangedFiles(
  chunks: SearchResult[],
  changedFiles: string[],
): SearchResult[] {
  if (changedFiles.length === 0) {
    return chunks;
  }

  const changed = new Set(changedFiles.map(normalizePath));

  return [...chunks].sort((left, right) => {
    const leftChanged = changed.has(normalizePath(left.path)) ? 0 : 1;
    const rightChanged = changed.has(normalizePath(right.path)) ? 0 : 1;
    return leftChanged - rightChanged;
  });
}

export async function retrieve(
  query: string,
  topK = config.retrieval.topK,
): Promise<SearchResult[]> {
  const vector = await embed(query);
  const results = await searchChunks(vector, topK);

  return results.map((row) => ({
    id: row.id as string,
    path: row.path as string,
    startLine: row.startLine as number,
    endLine: row.endLine as number,
    text: row.text as string,
    score: row._distance as number | undefined,
  }));
}

export async function retrieveHybrid(
  query: string,
  topK = config.retrieval.topK,
): Promise<SearchResult[]> {
  const semantic = await retrieve(query, Math.max(4, topK - 2));
  const seen = new Set(semantic.map(chunkKey));
  const merged = [...semantic];

  const symbols = extractSymbols(query);

  for (const symbol of symbols) {
    const definitions = await findSymbol(symbol, 3);

    for (const match of definitions) {
      const chunk = symbolToSearchResult(match);
      const key = chunkKey(chunk);

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(chunk);
      }
    }

    const grepMatches = await grep(symbol, 5);

    for (const match of grepMatches) {
      const chunk = grepToSearchResult(match);
      const key = chunkKey(chunk);

      if (!seen.has(key)) {
        seen.add(key);
        merged.push(chunk);
      }
    }
  }

  let changedFiles: string[] = [];

  try {
    changedFiles = await getChangedFiles();
  } catch {
    changedFiles = [];
  }

  return prioritizeChangedFiles(merged, changedFiles).slice(0, topK);
}
