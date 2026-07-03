import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { ask } from "./llm.js";
import { buildPrompt, formatSources } from "./prompt.js";
import { retrieve } from "./retriever.js";
import { syncIndex } from "./syncIndex.js";
import { getGitSummary, getRecentDiff, isGitQuestion } from "./tools/git.js";
import { formatGrepResults, grep } from "./tools/grep.js";
import {
  formatImports,
  findReferences,
  formatReferenceResults,
  getImports,
  resetProjectCache,
} from "./tools/references.js";
import {
  formatFileWithLineNumbers,
  readProjectFile,
} from "./tools/readFile.js";
import {
  findSymbol,
  formatSymbolResults,
} from "./tools/symbols.js";
import { writeProjectFile } from "./tools/writeFile.js";
import { startWatcher } from "./watcher.js";

const enableWatch = process.argv.includes("--watch");

const HELP = `
Commands:
  /help                 Show this help
  /read <path>          Read a project file with line numbers
  /write <path>         Write a file (multiline, end with ---)
  /grep <pattern>       Search codebase (regex)
  /find <symbol>        Find function/class/type definitions
  /refs <symbol>        Find all references (AST)
  /imports <path>       List imports in a file
  /git                  Show git status and diff summary
  /reindex              Run incremental index sync
  exit | quit           Quit

Tips:
  Ask natural questions about your codebase — semantic search runs automatically.
  Questions about recent changes include git context when available.
  Use --watch to auto-sync the index when files change.
`.trim();

async function readMultiline(rl: readline.Interface): Promise<string> {
  console.log("\nEnter content (type --- on its own line to finish):\n");

  const lines: string[] = [];

  while (true) {
    const line = await rl.question("");

    if (line.trim() === "---") {
      break;
    }

    lines.push(line);
  }

  return lines.join("\n");
}

async function handleCommand(
  line: string,
  rl: readline.Interface,
): Promise<boolean> {
  const [command, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command.toLowerCase()) {
    case "/help":
      console.log(`\n${HELP}\n`);
      return true;

    case "/read": {
      if (!arg) {
        console.log("\nUsage: /read <path>\n");
        return true;
      }

      const content = await readProjectFile(arg);
      console.log(`\n${formatFileWithLineNumbers(arg, content)}\n`);
      return true;
    }

    case "/write": {
      if (!arg) {
        console.log("\nUsage: /write <path>\n");
        return true;
      }

      const content = await readMultiline(rl);
      await writeProjectFile(arg, content);
      resetProjectCache();
      console.log(`\n✅ Wrote ${arg}\n`);
      return true;
    }

    case "/grep": {
      if (!arg) {
        console.log("\nUsage: /grep <pattern>\n");
        return true;
      }

      const matches = await grep(arg);
      console.log(`\n${formatGrepResults(matches)}\n`);
      return true;
    }

    case "/find": {
      if (!arg) {
        console.log("\nUsage: /find <symbol>\n");
        return true;
      }

      const matches = await findSymbol(arg);
      console.log(`\n${formatSymbolResults(matches)}\n`);
      return true;
    }

    case "/refs": {
      if (!arg) {
        console.log("\nUsage: /refs <symbol>\n");
        return true;
      }

      const matches = await findReferences(arg);
      console.log(`\n${formatReferenceResults(matches)}\n`);
      return true;
    }

    case "/imports": {
      if (!arg) {
        console.log("\nUsage: /imports <path>\n");
        return true;
      }

      const imports = await getImports(arg);
      console.log(`\n${formatImports(imports)}\n`);
      return true;
    }

    case "/git": {
      const summary = await getGitSummary();
      console.log(`\n${summary}\n`);
      return true;
    }

    case "/reindex": {
      console.log("\nSyncing index...\n");
      resetProjectCache();
      const result = await syncIndex();
      console.log(
        result.mode === "unchanged"
          ? "Index already up to date.\n"
          : "Index sync complete.\n",
      );
      return true;
    }

    default:
      return false;
  }
}

async function answerQuestion(question: string) {
  console.log("\nSearching...\n");

  const chunks = await retrieve(question);
  let extraContext: string | undefined;

  if (isGitQuestion(question)) {
    try {
      const [summary, diff] = await Promise.all([
        getGitSummary(),
        getRecentDiff(80),
      ]);
      extraContext = `${summary}\n\nRecent diff:\n${diff || "(no diff)"}`;
    } catch {
      // not a git repo — continue without git context
    }
  }

  const prompt = buildPrompt(question, chunks, extraContext);
  const answer = await ask(prompt);

  console.log(`Assistant:\n${answer}\n`);
  console.log("Sources:");
  console.log(formatSources(chunks));
  console.log();
}

async function main() {
  if (enableWatch) {
    startWatcher();
  }

  const rl = readline.createInterface({ input, output });

  console.log("AI Coding Assistant — type /help for commands\n");

  while (true) {
    const question = (await rl.question("You: ")).trim();

    if (!question || question === "exit" || question === "quit") {
      break;
    }

    try {
      if (question.startsWith("/")) {
        await handleCommand(question, rl);
        continue;
      }

      await answerQuestion(question);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      console.log();
    }
  }

  rl.close();
}

main().catch(console.error);
