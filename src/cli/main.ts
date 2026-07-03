#!/usr/bin/env node

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HELP = `
code — local RAG coding assistant

Usage:
  code <command> [options] [project-path]

Package: code

Commands:
  chat      Interactive agent chat (default workflow)
  index     Index a project for RAG search
  query     One-shot question from the terminal
  watch     Watch files and re-index on changes
  dev       List loaded project files (smoke test)

Options:
  --project, -p   Path to the codebase
  --simple        RAG mode instead of agent (chat)
  --watch         Auto-sync index on file changes (chat)
  --no-ui         Terminal-only diff preview (chat)
  --full          Force full index rebuild (index)

Examples:
  code index ./my-app
  code index ./my-app --full
  code chat --project D:\\Projects\\MyApp
  code query ./my-app "How does auth work?"

Install globally: npm install -g code
`.trim();

type CommandRunner = () => Promise<void>;

const commands: Record<string, CommandRunner> = {
  chat: async () => {
    const { runChat } = await import("./chat.js");
    await runChat();
  },
  index: async () => {
    const { runIndexer } = await import("./indexer.js");
    await runIndexer();
  },
  query: async () => {
    const { runQuery } = await import("./query.js");
    await runQuery();
  },
  watch: async () => {
    const { runWatch } = await import("./watch.js");
    await runWatch();
  },
  dev: async () => {
    const { runDev } = await import("./dev.js");
    await runDev();
  },
};

async function main() {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    console.log(`\n${HELP}\n`);
    return;
  }

  if (command === "--version" || command === "-v") {
    const pkgPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    console.log(pkg.version);
    return;
  }

  const runner = commands[command];

  if (!runner) {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exit(1);
  }

  await runner();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
