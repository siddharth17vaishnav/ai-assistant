import { execFile } from "child_process";
import { promisify } from "util";

import { config } from "../core/config.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: config.projectPath,
      maxBuffer: 1024 * 1024,
    });

    return stdout.trim();
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? error.message)
        : "Git command failed.";

    throw new Error(message.trim() || "Not a git repository.");
  }
}

export async function getGitSummary(): Promise<string> {
  const [branch, status, diffStat] = await Promise.all([
    runGit(["branch", "--show-current"]),
    runGit(["status", "--short"]),
    runGit(["diff", "--stat"]),
  ]);

  const sections = [`Branch: ${branch || "(detached)"}`];

  sections.push(status ? `Status:\n${status}` : "Status: clean");

  if (diffStat) {
    sections.push(`Diff:\n${diffStat}`);
  }

  return sections.join("\n\n");
}

export async function getChangedFiles(): Promise<string[]> {
  const output = await runGit(["status", "--porcelain"]);
  if (!output) return [];

  return output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export async function getRecentDiff(maxLines = 120): Promise<string> {
  const diff = await runGit(["diff"]);
  if (!diff) return "";

  const lines = diff.split("\n");

  if (lines.length <= maxLines) {
    return diff;
  }

  return `${lines.slice(0, maxLines).join("\n")}\n... (truncated)`;
}

export function isGitQuestion(question: string): boolean {
  return /\b(recent changes|what changed|git diff|uncommitted|modified files)\b/i.test(
    question,
  );
}
