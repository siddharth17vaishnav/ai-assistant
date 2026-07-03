export interface ProjectFile {
  path: string;
  content: string;
}

export interface FileEntry {
  mtimeMs: number;
  size: number;
}

export interface IndexManifest {
  projectPath: string;
  updatedAt: string;
  files: Record<string, FileEntry>;
}

export interface Chunk {
  id: string;
  path: string;
  text: string;
  startLine: number;
  endLine: number;
}

export interface StoredChunk extends Chunk {
  vector: number[];
}

export interface SearchResult extends Chunk {
  score?: number;
}

export interface SyncResult {
  mode: "full" | "incremental" | "unchanged";
  added: number;
  modified: number;
  deleted: number;
  chunksEmbedded: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface SymbolMatch {
  path: string;
  line: number;
  kind: "function" | "class" | "interface" | "type" | "export";
  name: string;
  text: string;
}

export interface ReferenceMatch {
  path: string;
  line: number;
  kind: string;
  text: string;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffPreview {
  title: string;
  path: string;
  lines: DiffLine[];
  summary: string;
}
