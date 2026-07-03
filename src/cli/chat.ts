import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { formatAgentStep, runAgent } from "../agent/agent.js";
import { chat, type ChatMessage } from "../llm/llm.js";
import { buildPrompt, formatSources } from "../llm/prompt.js";
import { retrieveHybrid } from "../retrieval/retriever.js";
import { appendTurn, trimHistory } from "../agent/session.js";
import { syncIndex } from "../indexing/syncIndex.js";
import { buildEditDiffPreview, buildWriteDiffPreview } from "../tools/diff.js";
import { editProjectFile } from "../tools/editFile.js";
import { getGitSummary, getRecentDiff, isGitQuestion } from "../tools/git.js";
import { formatGrepResults, grep } from "../tools/grep.js";
import {
  formatImports,
  findReferences,
  findImporters,
  formatReferenceResults,
  formatImporterResults,
  getImports,
  resetProjectCache,
} from "../tools/references.js";
import {
  formatFileWithLineNumbers,
  readProjectFile,
} from "../tools/readFile.js";
import { syncProjectAfterWrite } from "../tools/registry.js";
import {
  findSymbol,
  formatSymbolResults,
} from "../tools/symbols.js";
import { writeProjectFile } from "../tools/writeFile.js";
import { startWatcher } from "../indexing/watcher.js";
import { confirmDiffPreview } from "../preview/confirmPreview.js";
import { config } from "../core/config.js";
import { hasFlag } from "../core/cliArgs.js";
import { runIfDirect } from "../core/cliEntry.js";
import {
  formatIndexedProjects,
  listIndexedProjects,
} from "../core/projectStorage.js";

const enableWatch = hasFlag("--watch");
const simpleMode = hasFlag("--simple");

const HELP = `
Commands:
  /help                      Show this help
  /clear                     Clear conversation memory
  /read <path>               Read a project file with line numbers
  /write <path>              Write a file (multiline, end with ---)
  /edit <path> <start> <end> Replace line range (multiline, end with ---)
  /grep <pattern>            Search codebase (regex)
  /find <symbol>             Find function/class/type definitions
  /refs <symbol>             Find all references (AST)
  /imports <path>            List imports in a file
  /importers <path>          Find files that import a module
  /git                       Show git status and diff summary
  /projects                  List all indexed projects
  /reindex                   Run incremental index sync
  exit | quit                Quit

Modes:
  <path>      Project path as first argument (e.g. npm run dev -- ./my-app)
  --project   Path to the codebase (overrides PROJECT_PATH in .env)
  -p          Short form of --project
  Default     Agent mode with conversation memory
  --simple    Single-shot hybrid RAG (still remembers prior turns)
  --watch     Auto-sync index on file changes
  --no-ui     Terminal-only diff preview (skip browser UI)

Examples:
  npm run dev -- D:\Projects\MyApp
  npm run chat -- --project ../my-app
  npm run index -- -p ./portfolio

Tips:
  Code changes open in a Claude-style browser preview by default.
  Follow-up questions work: "show me the full file" / "what about tests?"
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
  resetHistory: () => void,
): Promise<boolean> {
  const [command, ...rest] = line.split(/\s+/);

  switch (command.toLowerCase()) {
    case "/help":
      console.log(`\n${HELP}\n`);
      return true;

    case "/clear":
      resetHistory();
      console.log("\nConversation cleared.\n");
      return true;

    case "/read": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /read <path>\n");
        return true;
      }

      const content = await readProjectFile(arg);
      console.log(`\n${formatFileWithLineNumbers(arg, content)}\n`);
      return true;
    }

    case "/write": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /write <path>\n");
        return true;
      }

      const content = await readMultiline(rl);
      const preview = await buildWriteDiffPreview(arg, content);

      if (!(await confirmDiffPreview(preview, rl))) {
        console.log("\nCancelled.\n");
        return true;
      }

      await writeProjectFile(arg, content);
      await syncProjectAfterWrite();
      console.log(`\n✅ Wrote ${arg} (index synced)\n`);
      return true;
    }

    case "/edit": {
      const [filePath, startRaw, endRaw] = rest;

      if (!filePath || !startRaw || !endRaw) {
        console.log("\nUsage: /edit <path> <startLine> <endLine>\n");
        return true;
      }

      const content = await readMultiline(rl);
      const preview = await buildEditDiffPreview(
        filePath,
        Number(startRaw),
        Number(endRaw),
        content,
      );

      if (!(await confirmDiffPreview(preview, rl))) {
        console.log("\nCancelled.\n");
        return true;
      }

      await editProjectFile(
        filePath,
        Number(startRaw),
        Number(endRaw),
        content,
      );
      await syncProjectAfterWrite();
      console.log(
        `\n✅ Edited ${filePath}:${startRaw}-${endRaw} (index synced)\n`,
      );
      return true;
    }

    case "/grep": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /grep <pattern>\n");
        return true;
      }

      const matches = await grep(arg);
      console.log(`\n${formatGrepResults(matches)}\n`);
      return true;
    }

    case "/find": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /find <symbol>\n");
        return true;
      }

      const matches = await findSymbol(arg);
      console.log(`\n${formatSymbolResults(matches)}\n`);
      return true;
    }

    case "/refs": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /refs <symbol>\n");
        return true;
      }

      const matches = await findReferences(arg);
      console.log(`\n${formatReferenceResults(matches)}\n`);
      return true;
    }

    case "/imports": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /imports <path>\n");
        return true;
      }

      const imports = await getImports(arg);
      console.log(`\n${formatImports(imports)}\n`);
      return true;
    }

    case "/importers": {
      const arg = rest.join(" ").trim();

      if (!arg) {
        console.log("\nUsage: /importers <path>\n");
        return true;
      }

      const matches = await findImporters(arg);
      console.log(`\n${formatImporterResults(matches)}\n`);
      return true;
    }

    case "/git": {
      const summary = await getGitSummary();
      console.log(`\n${summary}\n`);
      return true;
    }

    case "/projects": {
      const projects = await listIndexedProjects();
      console.log(`\nIndexed projects:\n\n${formatIndexedProjects(projects, config.projectPath)}\n`);
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

async function answerSimple(question: string, history: ChatMessage[]) {
  console.log("\nSearching (hybrid)...\n");

  const chunks = await retrieveHybrid(question);
  let extraContext: string | undefined;

  if (isGitQuestion(question)) {
    try {
      const [summary, diff] = await Promise.all([
        getGitSummary(),
        getRecentDiff(80),
      ]);
      extraContext = `${summary}\n\nRecent diff:\n${diff || "(no diff)"}`;
    } catch {
      // not a git repo
    }
  }

  const prompt = buildPrompt(question, chunks, extraContext);
  const result = await chat([
    {
      role: "system",
      content:
        "You are a coding assistant. Use the provided code context and prior conversation.",
    },
    ...trimHistory(history),
    { role: "user", content: prompt },
  ]);

  console.log(`Assistant:\n${result.content}\n`);
  console.log("Sources:");
  console.log(formatSources(chunks));
  console.log();

  return result.content.trim();
}

async function answerWithAgent(
  question: string,
  history: ChatMessage[],
  rl: readline.Interface,
) {
  console.log("\nAgent thinking...\n");

  const answer = await runAgent(question, {
    history,
    onStep: (step, toolName, args) => {
      console.log(formatAgentStep(step, toolName, args));
    },
    toolContext: {
      confirm: (preview) => confirmDiffPreview(preview, rl),
    },
  });

  console.log(`\nAssistant:\n${answer}\n`);
  return answer;
}

export async function runChat() {
  if (enableWatch) {
    startWatcher();
  }

  const rl = readline.createInterface({ input, output });
  let history: ChatMessage[] = [];

  const resetHistory = () => {
    history = [];
  };

  const modeLabel = simpleMode ? "simple RAG" : "agent";
  console.log(`code (${modeLabel})`);
  console.log(`Project: ${config.projectPath}`);
  console.log(`Index storage: ${config.projectStorageDir}\n`);

  while (true) {
    const question = (await rl.question("You: ")).trim();

    if (!question || question === "exit" || question === "quit") {
      break;
    }

    try {
      if (question.startsWith("/")) {
        await handleCommand(question, rl, resetHistory);
        continue;
      }

      const answer = simpleMode
        ? await answerSimple(question, history)
        : await answerWithAgent(question, history, rl);

      history = appendTurn(history, question, answer);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      console.log();
    }
  }

  rl.close();
}

runIfDirect(import.meta.url, runChat);
