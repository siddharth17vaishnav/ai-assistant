import type { SearchResult } from "../core/types.js";
import { LOCAL_ASSISTANT_RULES } from "../agent/capabilities.js";

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
    LOCAL_ASSISTANT_RULES,
    "Answer based on the provided code context from the user's project.",
    "Cite file paths and line numbers. If context is insufficient, say which files to inspect — do not claim you lack access.",
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
