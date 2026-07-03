import fs from "fs/promises";

import type { DiffLine, DiffPreview } from "../core/types.js";
import { resolveProjectPath, readProjectFile } from "./readFile.js";

function buildEditLines(
  allLines: string[],
  startLine: number,
  endLine: number,
  oldLines: string[],
  newLines: string[],
  path: string,
): DiffPreview {
  const lines: DiffLine[] = [];

  for (let index = Math.max(0, startLine - 3); index < startLine - 1; index++) {
    lines.push({
      type: "context",
      content: allLines[index] ?? "",
      oldLineNumber: index + 1,
      newLineNumber: index + 1,
    });
  }

  for (let index = 0; index < oldLines.length; index++) {
    lines.push({
      type: "remove",
      content: oldLines[index] ?? "",
      oldLineNumber: startLine + index,
    });
  }

  for (let index = 0; index < newLines.length; index++) {
    lines.push({
      type: "add",
      content: newLines[index] ?? "",
      newLineNumber: startLine + index,
    });
  }

  for (
    let index = endLine;
    index < Math.min(allLines.length, endLine + 2);
    index++
  ) {
    lines.push({
      type: "context",
      content: allLines[index] ?? "",
      oldLineNumber: index + 1,
      newLineNumber: index + 1,
    });
  }

  return {
    title: `Edit lines ${startLine}-${endLine}`,
    path,
    lines,
    summary: `${oldLines.length} line(s) removed, ${newLines.length} line(s) added`,
  };
}

function buildFullFileDiff(
  path: string,
  oldContent: string | null,
  newContent: string,
): DiffPreview {
  if (oldContent === null) {
    const newLines = newContent.split("\n");

    return {
      title: "New file",
      path,
      summary: `${newLines.length} new line(s)`,
      lines: newLines.map((content, index) => ({
        type: "add" as const,
        content,
        newLineNumber: index + 1,
      })),
    };
  }

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: DiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);

  for (let index = 0; index < max; index++) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];

    if (oldLine === newLine) {
      lines.push({
        type: "context",
        content: oldLine ?? "",
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
      });
      continue;
    }

    if (oldLine !== undefined) {
      lines.push({
        type: "remove",
        content: oldLine,
        oldLineNumber: index + 1,
      });
    }

    if (newLine !== undefined) {
      lines.push({
        type: "add",
        content: newLine,
        newLineNumber: index + 1,
      });
    }
  }

  const removed = lines.filter((line) => line.type === "remove").length;
  const added = lines.filter((line) => line.type === "add").length;

  return {
    title: "File update",
    path,
    lines,
    summary: `${removed} line(s) removed, ${added} line(s) added`,
  };
}

export async function buildWriteDiffPreview(
  relativePath: string,
  newContent: string,
): Promise<DiffPreview> {
  const fullPath = resolveProjectPath(relativePath);
  let oldContent: string | null = null;

  try {
    await fs.access(fullPath);
    oldContent = await readProjectFile(relativePath);
  } catch {
    oldContent = null;
  }

  return buildFullFileDiff(relativePath, oldContent, newContent);
}

export async function buildEditDiffPreview(
  relativePath: string,
  startLine: number,
  endLine: number,
  newContent: string,
): Promise<DiffPreview> {
  const oldContent = await readProjectFile(relativePath);
  const lines = oldContent.split("\n");
  const oldLines = lines.slice(startLine - 1, endLine);
  const newLines = newContent.split("\n");

  return buildEditLines(
    lines,
    startLine,
    endLine,
    oldLines,
    newLines,
    relativePath,
  );
}

export async function buildMutationDiffPreview(
  toolName: string,
  args: Record<string, unknown>,
): Promise<DiffPreview> {
  if (toolName === "write_file") {
    return buildWriteDiffPreview(
      String(args.path ?? ""),
      String(args.content ?? ""),
    );
  }

  if (toolName === "edit_file") {
    return buildEditDiffPreview(
      String(args.path ?? ""),
      Number(args.start_line),
      Number(args.end_line),
      String(args.content ?? ""),
    );
  }

  return {
    title: toolName,
    path: String(args.path ?? "unknown"),
    lines: [],
    summary: "Proposed change",
  };
}

export function formatDiffPreviewText(preview: DiffPreview): string {
  const header = `${preview.title}: ${preview.path}\n${preview.summary}\n`;

  const body = preview.lines
    .map((line) => {
      const prefix =
        line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      return `${prefix} ${line.content}`;
    })
    .join("\n");

  return `${header}\n${body}`;
}

export const MUTATING_TOOLS = new Set(["write_file", "edit_file"]);

// Legacy text preview for logging
export async function previewWrite(
  relativePath: string,
  newContent: string,
): Promise<string> {
  return formatDiffPreviewText(
    await buildWriteDiffPreview(relativePath, newContent),
  );
}

export async function previewEdit(
  relativePath: string,
  startLine: number,
  endLine: number,
  newContent: string,
): Promise<string> {
  return formatDiffPreviewText(
    await buildEditDiffPreview(relativePath, startLine, endLine, newContent),
  );
}

export async function buildMutationPreview(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  return formatDiffPreviewText(
    await buildMutationDiffPreview(toolName, args),
  );
}
