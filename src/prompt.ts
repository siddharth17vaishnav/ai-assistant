import type { SearchResult } from "./types.js";

export function buildPrompt(
  question: string,
  chunks: SearchResult[],
  extraContext?: string,
): string {
  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.path}:${chunk.startLine}-${chunk.endLine}\n${chunk.text}`,
    )
    .join("\n\n---\n\n");

  const sections = [
    "You are a coding assistant. Answer based only on the provided code context.",
    "Cite file paths and line numbers when relevant. If the context is insufficient, say so.",
  ];

  if (extraContext) {
    sections.push("", "Additional context:", extraContext);
  }

  sections.push("", "Context:", context, "", "Question:", question);

  return sections.join("\n");
}

export function formatSources(chunks: SearchResult[]): string {
  return chunks
    .map((chunk) => `  - ${chunk.path}:${chunk.startLine}-${chunk.endLine}`)
    .join("\n");
}
