import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import path from "path";

import { formatAgentStep, executePlan, runAgent, runPlanner } from "../agent/agent.js";
import type { PlanPhase } from "../agent/plan.js";
import {
  assessPlanOutput,
  formatPlanFollowUpHint,
  isPersistablePlanContent,
} from "../agent/plan.js";
import { LOCAL_ASSISTANT_RULES } from "../agent/capabilities.js";
import {
  createPlanId,
  createPlanSnapshot,
  deletePlanRecord,
  formatSavedPlansList,
  getPlanRecordPaths,
  listSavedPlans,
  savePlanRecord,
  savePlanToFile,
  titleFromPrompt,
  type PlanSessionSnapshot,
} from "../agent/planStorage.js";
import { promptPlanSelection } from "../agent/planResume.js";
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
  rewriteSubmittedUserLine,
  userInputPrompt,
} from "../core/terminal.js";
import {
  formatIndexedProjects,
  listIndexedProjects,
} from "../core/projectStorage.js";

const enableWatch = hasFlag("--watch");
const simpleMode = hasFlag("--simple");
const startInPlanMode = hasFlag("--plan");
const autoResume = hasFlag("--resume");

type ChatMode = "simple" | "agent" | "plan";

function resolveInitialMode(): ChatMode {
  if (simpleMode) {
    return "simple";
  }

  if (startInPlanMode) {
    return "plan";
  }

  return "agent";
}

function formatModeLabel(mode: ChatMode): string {
  switch (mode) {
    case "simple":
      return "simple RAG";
    case "plan":
      return "plan";
    default:
      return "agent";
  }
}

interface PlanSessionState {
  phase: PlanPhase;
  readyToExecute: boolean;
  hasPlan: boolean;
}

function createPlanSession(): PlanSessionState {
  return { phase: "discover", readyToExecute: false, hasPlan: false };
}

function resetPlanSession(planSession: PlanSessionState): void {
  planSession.phase = "discover";
  planSession.readyToExecute = false;
  planSession.hasPlan = false;
}

function buildPlanQuestion(
  question: string,
  planSession: PlanSessionState,
  lastPlan: string | null,
): string {
  if (
    planSession.hasPlan &&
    planSession.phase === "finalize" &&
    lastPlan &&
    planSession.readyToExecute
  ) {
    return `Update the current plan based on this feedback. Produce a full revised plan (not a diff).\n\nFeedback:\n${question}\n\nCurrent plan:\n${lastPlan}`;
  }

  return question;
}

interface ChatState {
  history: ChatMessage[];
  lastPlan: string | null;
  session: { mode: ChatMode };
  planSession: PlanSessionState;
  activePlanId: string | null;
  planCreatedAt: string | null;
  planTitle: string | null;
}

function startNewPlan(chatState: ChatState): void {
  chatState.activePlanId = createPlanId();
  chatState.planCreatedAt = new Date().toISOString();
  chatState.history = [];
  chatState.lastPlan = null;
  chatState.planTitle = null;
  resetPlanSession(chatState.planSession);
}

function capturePlanTitle(chatState: ChatState, prompt: string): void {
  if (!chatState.planTitle && prompt.trim()) {
    chatState.planTitle = titleFromPrompt(prompt);
  }
}

function ensureActivePlan(chatState: ChatState): void {
  if (!chatState.activePlanId) {
    chatState.activePlanId = createPlanId();
    chatState.planCreatedAt = new Date().toISOString();
  }
}

async function persistChatState(state: ChatState): Promise<void> {
  if (!state.planSession.hasPlan && state.history.length === 0) {
    return;
  }

  ensureActivePlan(state);

  const snapshot = createPlanSnapshot({
    id: state.activePlanId!,
    title: state.planTitle ?? undefined,
    createdAt: state.planCreatedAt ?? new Date().toISOString(),
    chatMode: state.session.mode,
    planPhase: state.planSession.phase,
    readyToExecute: state.planSession.readyToExecute,
    hasPlan: state.planSession.hasPlan,
    lastPlan: state.lastPlan,
    history: state.history,
  });

  await savePlanRecord(config.projectStorageDir, snapshot, {
    projectPath: config.projectPath,
  });
}

function applySavedSession(
  state: ChatState,
  saved: PlanSessionSnapshot,
): void {
  state.history = saved.history;
  state.lastPlan = saved.lastPlan;
  state.session.mode = saved.chatMode;
  state.planSession.phase = saved.planPhase;
  state.planSession.readyToExecute = saved.readyToExecute;
  state.planSession.hasPlan = saved.hasPlan;
  state.activePlanId = saved.id;
  state.planCreatedAt = saved.createdAt;
  state.planTitle = saved.title;
}

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
  /plan                      Switch to plan mode (read-only exploration)
  /agent                     Switch to agent mode (can edit files)
  /finalize                  Produce final plan from current discussion
  /save [path]               Save plan to markdown (default: ./plan.md)
  /plans                     List saved plans for this project
  /resume                    Pick a saved plan and continue
  /execute                   Implement the last plan (after it is ready)
  exit | quit                Quit

Modes:
  <path>      Project path as first argument (e.g. npm run dev -- ./my-app)
  --project   Path to the codebase (default: current directory)
  -p          Short form of --project
  Default     Agent mode with conversation memory
  --plan      Start in plan mode (explore first, /execute to implement)
  --simple    Single-shot hybrid RAG (still remembers prior turns)
  --watch     Auto-sync index on file changes
  --no-ui     Terminal-only diff preview (skip browser UI)

Examples:
  npm run dev -- D:\Projects\MyApp
  npm run chat -- --project ../my-app
  npm run index -- -p ./portfolio

Tips:
  Plan mode runs in two phases: discovery (approaches + questions) then finalize.
  Follow-up prompts update the current plan — they do not start over.
  Plans auto-save under storage/projects/<id>/plans/.
  Use --resume to pick a saved plan on startup, or /resume anytime.
  Use /plans to list saved plans, or /plan to start a new plan.
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
  chatState: ChatState,
): Promise<boolean> {
  const resetHistory = () => {
    if (chatState.activePlanId) {
      void deletePlanRecord(config.projectStorageDir, chatState.activePlanId);
    }
    chatState.activePlanId = null;
    chatState.planCreatedAt = null;
    chatState.planTitle = null;
    chatState.history = [];
    chatState.lastPlan = null;
    resetPlanSession(chatState.planSession);
  };
  const [command, ...rest] = line.split(/\s+/);

  switch (command.toLowerCase()) {
    case "/help":
      console.log(`\n${HELP}\n`);
      return true;

    case "/clear":
      resetHistory();
      console.log("\nConversation cleared.\n");
      return true;

    case "/plan":
      chatState.session.mode = "plan";
      startNewPlan(chatState);
      console.log(
        "\nPlan mode — new plan started. Discovery first, then finalize.\n",
      );
      return true;

    case "/agent":
      chatState.session.mode = "agent";
      console.log("\nAgent mode — tools can read and edit files.\n");
      return true;

    case "/resume": {
      const saved = await promptPlanSelection(rl, config.projectStorageDir);

      if (saved) {
        applySavedSession(chatState, saved);
        chatState.session.mode = "plan";
        console.log(`Mode: ${formatModeLabel(chatState.session.mode)}`);
      }

      return true;
    }

    case "/plans": {
      const plans = await listSavedPlans(config.projectStorageDir);
      console.log(`\n${formatSavedPlansList(plans)}\n`);
      return true;
    }

    case "/save": {
      if (!chatState.lastPlan) {
        console.log("\nNo plan to save yet.\n");
        return true;
      }

      const targetArg = rest.join(" ").trim();
      const targetPath = targetArg
        ? path.resolve(targetArg)
        : path.join(config.projectPath, "plan.md");
      const updatedAt = new Date().toISOString();
      const savedPath = await savePlanToFile(
        targetPath,
        chatState.lastPlan,
        {
          projectPath: config.projectPath,
          updatedAt,
          ready: chatState.planSession.readyToExecute,
        },
      );

      await persistChatState(chatState);
      console.log(`\nPlan saved to ${savedPath}\n`);
      return true;
    }

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
      content: `${LOCAL_ASSISTANT_RULES}\n\nUse the provided code context and prior conversation.`,
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

async function answerWithPlan(
  question: string,
  chatState: ChatState,
  rl: readline.Interface,
  phaseOverride?: PlanPhase,
) {
  const { planSession } = chatState;
  let phase = phaseOverride ?? planSession.phase;

  if (planSession.hasPlan && phase === "discover" && !phaseOverride) {
    phase = "finalize";
  }

  const plannerQuestion = buildPlanQuestion(
    question,
    planSession,
    chatState.lastPlan,
  );
  const phaseLabel =
    phase === "discover"
      ? "discovery (read-only)"
      : planSession.hasPlan && planSession.readyToExecute
        ? "updating plan"
        : "finalizing";

  console.log(`\nPlanning — ${phaseLabel}...\n`);

  const answer = await runPlanner(plannerQuestion, {
    history: chatState.history,
    planPhase: phase,
    onStep: (step, toolName, args) => {
      console.log(formatAgentStep(step, toolName, args));
    },
    toolContext: {
      readOnly: true,
    },
  });

  const assessment = assessPlanOutput(answer, phase);

  planSession.hasPlan = true;

  if (phase === "discover") {
    if (assessment.hasOpenQuestions) {
      planSession.phase = "finalize";
      planSession.readyToExecute = false;
    } else {
      planSession.readyToExecute = assessment.readyToExecute;
      planSession.phase = "finalize";
    }
  } else {
    planSession.readyToExecute = assessment.readyToExecute;
    planSession.phase = "finalize";
  }

  const previousPlan = chatState.lastPlan;
  const planUpdated = isPersistablePlanContent(answer);

  if (planUpdated) {
    chatState.lastPlan = answer;
  } else if (previousPlan && isPersistablePlanContent(previousPlan)) {
    chatState.lastPlan = previousPlan;
  } else {
    chatState.lastPlan = answer;
  }

  await persistChatState(chatState);

  const displayPlan = planUpdated
    ? answer
    : chatState.lastPlan && isPersistablePlanContent(chatState.lastPlan)
      ? chatState.lastPlan
      : answer;

  if (chatState.activePlanId) {
    const { markdownPath } = getPlanRecordPaths(
      config.projectStorageDir,
      chatState.activePlanId,
    );
    console.log(`\nPlan:\n${displayPlan}\n`);
    if (!planUpdated && previousPlan && isPersistablePlanContent(previousPlan)) {
      console.log(
        "Plan not updated — kept your previous saved plan. Try rephrasing your feedback.\n",
      );
    }
    console.log(`${formatPlanFollowUpHint(assessment)}`);
    console.log(`Saved to ${markdownPath}\n`);
  } else {
    console.log(`\nPlan:\n${displayPlan}\n`);
    if (!planUpdated && previousPlan && isPersistablePlanContent(previousPlan)) {
      console.log(
        "Plan not updated — kept your previous saved plan. Try rephrasing your feedback.\n",
      );
    }
    console.log(`${formatPlanFollowUpHint(assessment)}\n`);
  }

  return planUpdated ? answer : displayPlan;
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
  const chatState: ChatState = {
    history: [],
    lastPlan: null,
    session: { mode: resolveInitialMode() },
    planSession: createPlanSession(),
    activePlanId: null,
    planCreatedAt: null,
    planTitle: null,
  };

  const savedPlans = await listSavedPlans(config.projectStorageDir);

  if (autoResume) {
    const saved = await promptPlanSelection(rl, config.projectStorageDir);

    if (saved) {
      applySavedSession(chatState, saved);
      chatState.session.mode = "plan";
    }
  } else if (savedPlans.length > 0) {
    console.log(
      `${savedPlans.length} saved plan(s). Run /resume or start with --resume to pick one.\n`,
    );
  }

  console.log(`code (${formatModeLabel(chatState.session.mode)})`);
  console.log(`Project: ${config.projectPath}`);
  console.log(`Index storage: ${config.projectStorageDir}\n`);

  while (true) {
    const raw = await rl.question(userInputPrompt());
    if (raw.length > 0) {
      rewriteSubmittedUserLine(raw.trimEnd());
    }
    const question = raw.trim();

    if (!question || question === "exit" || question === "quit") {
      await persistChatState(chatState);
      break;
    }

    try {
      if (question === "/execute") {
        if (!chatState.lastPlan) {
          console.log(
            "\nNo plan yet. Use /plan, describe what you want, answer questions, then /execute.\n",
          );
          continue;
        }

        if (!chatState.planSession.readyToExecute) {
          console.log(
            "\nPlan not ready. Answer the open questions or run /finalize first.\n",
          );
          continue;
        }

        console.log("\nExecuting plan...\n");

        const answer = await executePlan(chatState.lastPlan, {
          history: chatState.history,
          onStep: (step, toolName, args) => {
            console.log(formatAgentStep(step, toolName, args));
          },
          toolContext: {
            confirm: (preview) => confirmDiffPreview(preview, rl),
          },
        });

        console.log(`\nAssistant:\n${answer}\n`);
        chatState.history = appendTurn(chatState.history, "[execute plan]", answer);
        await persistChatState(chatState);
        continue;
      }

      if (question === "/finalize") {
        if (chatState.session.mode !== "plan") {
          console.log("\n/finalize is only available in plan mode. Run /plan first.\n");
          continue;
        }

        const answer = await answerWithPlan(
          "Produce the final implementation plan now based on our discussion. Include Plan status: ready if nothing blocks implementation.",
          chatState,
          rl,
          "finalize",
        );
        chatState.history = appendTurn(chatState.history, "/finalize", answer);
        continue;
      }

      if (question.startsWith("/")) {
        await handleCommand(question, rl, chatState);
        continue;
      }

      let answer: string;

      if (chatState.session.mode === "simple") {
        answer = await answerSimple(question, chatState.history);
        chatState.history = appendTurn(chatState.history, question, answer);
      } else if (chatState.session.mode === "plan") {
        capturePlanTitle(chatState, question);
        answer = await answerWithPlan(question, chatState, rl);
        chatState.history = appendTurn(chatState.history, question, answer);
      } else {
        answer = await answerWithAgent(question, chatState.history, rl);
        chatState.history = appendTurn(chatState.history, question, answer);
      }
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      console.log();
    }
  }

  rl.close();
}

runIfDirect(import.meta.url, runChat);
