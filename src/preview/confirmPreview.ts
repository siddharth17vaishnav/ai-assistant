import readline from "readline/promises";

import { hasFlag } from "../core/cliArgs.js";
import { config } from "../core/config.js";
import type { DiffPreview } from "../core/types.js";
import { formatDiffPreviewText } from "../tools/diff.js";
import { requestWebPreviewApproval } from "./previewServer.js";

export async function confirmDiffPreview(
  preview: DiffPreview,
  rl?: readline.Interface,
  options?: { forceTerminal?: boolean },
): Promise<boolean> {
  const useWeb =
    config.preview.enabled &&
    !options?.forceTerminal &&
    !hasFlag("--no-ui");

  if (useWeb) {
    try {
      console.log(`\nOpening preview in browser: ${preview.path}`);
      return await requestWebPreviewApproval(preview);
    } catch (error) {
      console.log(
        `Web preview unavailable (${error instanceof Error ? error.message : "error"}). Falling back to terminal.`,
      );
    }
  }

  const text = formatDiffPreviewText(preview);
  console.log(`\n${text}\n`);

  if (rl) {
    const answer = (await rl.question("Apply this change? (y/N): ")).trim();
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  }

  return false;
}
