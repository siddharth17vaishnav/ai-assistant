import fs from "fs";
import path from "path";

export interface ParsedCli {
  projectPath?: string;
  flags: Set<string>;
  positionals: string[];
}

let cached: ParsedCli | null = null;

export const CLI_COMMANDS = new Set([
  "chat",
  "index",
  "query",
  "watch",
  "dev",
]);

const PROJECT_FLAGS = new Set(["--project", "-p"]);

function getRawArgs(): string[] {
  const args = process.argv.slice(2);

  if (args.length > 0 && CLI_COMMANDS.has(args[0]!)) {
    return args.slice(1);
  }

  return args;
}

function isDirectory(rawPath: string): boolean {
  const resolved = path.resolve(rawPath);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
}

function looksLikePath(raw: string): boolean {
  return (
    path.isAbsolute(raw) ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    raw.startsWith("./") ||
    raw.startsWith("../") ||
    raw.startsWith(".\\") ||
    raw.startsWith("..\\")
  );
}

function consumeProjectPath(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  return resolveProjectPath(raw);
}

export function resetCliCache(): void {
  cached = null;
}

export function parseCli(): ParsedCli {
  if (cached) {
    return cached;
  }

  const args = getRawArgs();
  let projectPath: string | undefined;
  const flags = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "--project" || arg === "-p") {
      projectPath = consumeProjectPath(args[index + 1]);
      index++;
      continue;
    }

    if (arg.startsWith("--project=")) {
      projectPath = consumeProjectPath(arg.slice("--project=".length));
      continue;
    }

    if (arg.startsWith("--")) {
      flags.add(arg.split("=")[0]!);
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      flags.add(arg);
      continue;
    }

    positionals.push(arg);
  }

  if (!projectPath && positionals.length > 0) {
    const first = positionals[0]!;

    if (looksLikePath(first) || isDirectory(first)) {
      projectPath = consumeProjectPath(first);
      positionals.shift();
    }
  }

  cached = { projectPath, flags, positionals };
  return cached;
}

export function getArgValue(...flags: string[]): string | undefined {
  const args = getRawArgs();

  for (const flag of flags) {
    const eqPrefix = `${flag}=`;

    for (let index = 0; index < args.length; index++) {
      const arg = args[index];

      if (arg === flag && index + 1 < args.length) {
        return args[index + 1];
      }

      if (arg.startsWith(eqPrefix)) {
        return arg.slice(eqPrefix.length);
      }
    }
  }

  return undefined;
}

export function hasFlag(...flags: string[]): boolean {
  const parsed = parseCli();

  return flags.some((flag) => parsed.flags.has(flag));
}

export function getQueryText(): string {
  return parseCli().positionals.join(" ").trim();
}

export function resolveProjectPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Project path not found: ${resolved}`);
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project path is not a directory: ${resolved}`);
  }

  return resolved;
}

export function getProjectPathFromArgs(): string | undefined {
  return parseCli().projectPath;
}

export function resolveConfigProjectPath(): string {
  const fromArgs = getProjectPathFromArgs();

  if (fromArgs) {
    return fromArgs;
  }

  const fromEnv = process.env.PROJECT_PATH?.trim();

  if (fromEnv) {
    return resolveProjectPath(path.resolve(fromEnv));
  }

  return resolveProjectPath(process.cwd());
}

export function isProjectFlag(arg: string): boolean {
  return PROJECT_FLAGS.has(arg) || arg.startsWith("--project=");
}
