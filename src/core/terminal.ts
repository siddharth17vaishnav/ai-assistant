import { clearLine, moveCursor } from "node:readline";
import { stdout } from "node:process";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";

export function shouldUseColors(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  if (
    process.env.FORCE_COLOR === "1" ||
    process.env.FORCE_COLOR === "true"
  ) {
    return true;
  }

  if (!stdout.isTTY) {
    return false;
  }

  const depth = stdout.getColorDepth?.() ?? 1;
  return depth >= 4 || process.platform === "win32";
}

export const colors = {
  green(text: string): string {
    return shouldUseColors() ? `${GREEN}${text}${RESET}` : text;
  },
};

export function userInputPrompt(): string {
  return "You: ";
}

export function formatUserLine(line: string): string {
  return colors.green(`You: ${line}`);
}

export function rewriteSubmittedUserLine(
  line: string,
  output: NodeJS.WriteStream = stdout,
): void {
  if (!shouldUseColors()) {
    return;
  }

  moveCursor(output, 0, -1);
  clearLine(output, 0);
  output.write(`${formatUserLine(line)}\n`);
}
