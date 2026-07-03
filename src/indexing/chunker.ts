import type { Chunk } from "../core/types.js";
import { config } from "../core/config.js";

export function chunkCode(path: string, content: string): Chunk[] {
  const { maxLines, overlap } = config.chunking;
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  let start = 0;
  let index = 0;

  while (start < lines.length) {
    const end = Math.min(start + maxLines, lines.length);

    chunks.push({
      id: `${path}:${index}`,
      path,
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join("\n"),
    });

    if (end === lines.length) break;

    start += maxLines - overlap;
    index++;
  }

  return chunks;
}
