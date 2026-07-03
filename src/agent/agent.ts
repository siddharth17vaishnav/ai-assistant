import { config } from "../core/config.js";
import {
  isFinalAnswer,
  parseToolCallsFromText,
} from "./parseToolCalls.js";
import { chat, type ChatMessage, type ToolCall } from "../llm/llm.js";
import { retrieveHybrid } from "../retrieval/retriever.js";
import { trimHistory } from "./session.js";
import {
  executeTool,
  getToolNames,
  type ToolContext,
} from "../tools/registry.js";
import { getGitSummary, getRecentDiff, isGitQuestion } from "../tools/git.js";
import { buildPrompt } from "../llm/prompt.js";
import { ask } from "../llm/llm.js";
import { buildPlanSystemPrompt, type PlanPhase } from "./plan.js";
import {
  AGENT_MODE_RULES,
  LOCAL_ASSISTANT_RULES,
  PLAN_MODE_RULES,
} from "./capabilities.js";

export type AgentMode = "agent" | "plan";

function buildSystemPrompt(mode: AgentMode, planPhase?: PlanPhase): string {
  const readOnly = mode === "plan";
  const toolNames = getToolNames({ readOnly }).join(", ");

  if (mode === "plan") {
    const phasePrompt = buildPlanSystemPrompt(planPhase ?? "discover");
    return `${LOCAL_ASSISTANT_RULES}

${PLAN_MODE_RULES}

${phasePrompt}

Available read-only tools: ${toolNames}

You may receive prior conversation turns — use them for follow-up questions.`;
  }

  return `${LOCAL_ASSISTANT_RULES}

${AGENT_MODE_RULES}

You are an expert coding assistant exploring a local codebase.

Available tools: ${toolNames}

When you need a tool, respond with ONLY a JSON object (no markdown, no explanation):
{"name": "tool_name", "arguments": {...}}

Examples:
{"name": "search_codebase", "arguments": {"query": "theme styling"}}
{"name": "read_file", "arguments": {"path": "app/page.tsx"}}
{"name": "find_importers", "arguments": {"path": "app/stores/themeStore.ts"}}

When you have enough context to answer, respond in plain English.
Do NOT return JSON for your final answer. Cite file paths and line numbers.
Do not invent code that is not in the project.
You may receive prior conversation turns — use them for follow-up questions.`;
}

function normalizeToolCalls(
  native: ToolCall[],
  content: string,
  mode: AgentMode,
): ToolCall[] {
  const allowed = new Set(getToolNames({ readOnly: mode === "plan" }));
  const calls = native.length > 0 ? native : parseToolCallsFromText(content);

  return calls.filter((call) => allowed.has(call.name));
}

function planContinueHint(planPhase?: PlanPhase): string {
  if (planPhase === "finalize") {
    return "Continue exploring (JSON only) or produce the final plan using the finalize template.";
  }

  return "Continue exploring (JSON only) or produce your discovery response with approaches and questions.";
}

export interface AgentOptions {
  mode?: AgentMode;
  planPhase?: PlanPhase;
  history?: ChatMessage[];
  onStep?: (
    step: number,
    toolName: string,
    args: Record<string, unknown>,
  ) => void;
  toolContext?: ToolContext;
  maxSteps?: number;
}

export async function runAgent(
  question: string,
  options?: AgentOptions,
): Promise<string> {
  const mode = options?.mode ?? "agent";
  const planPhase = options?.planPhase;
  const maxSteps =
    options?.maxSteps ??
    (mode === "plan" ? config.plan.maxSteps : config.agent.maxSteps);
  const prior = trimHistory(
    (options?.history ?? []).filter(
      (message) => message.role === "user" || message.role === "assistant",
    ),
  );

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(mode, planPhase) },
    ...prior,
    { role: "user", content: question },
  ];

  const toolContext: ToolContext = {
    ...options?.toolContext,
    readOnly: mode === "plan",
  };

  for (let step = 1; step <= maxSteps; step++) {
    const result = await chat(messages);
    const toolCalls = normalizeToolCalls(
      result.toolCalls,
      result.content,
      mode,
    );

    if (isFinalAnswer(result.content, toolCalls)) {
      return result.content.trim();
    }

    if (toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: result.content,
    });

    for (const toolCall of toolCalls) {
      options?.onStep?.(step, toolCall.name, toolCall.arguments);

      let output: string;

      try {
        output = await executeTool(
          toolCall.name,
          toolCall.arguments,
          toolContext,
        );
      } catch (error) {
        output =
          error instanceof Error ? error.message : "Tool execution failed.";
      }

      const continueHint =
        mode === "plan"
          ? planContinueHint(planPhase)
          : "Continue with another tool (JSON only) or provide your final answer in plain English.";

      messages.push({
        role: "user",
        content: `[Tool result: ${toolCall.name}]\n${output}\n\n${continueHint}`,
      });
    }
  }

  return runFallbackAnswer(question, prior, mode, planPhase);
}

async function runFallbackAnswer(
  question: string,
  history: ChatMessage[],
  mode: AgentMode,
  planPhase?: PlanPhase,
): Promise<string> {
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
      // ignore
    }
  }

  const prompt = buildPrompt(question, chunks, extraContext);
  const systemContent =
    mode === "plan"
      ? `${LOCAL_ASSISTANT_RULES}\n\n${PLAN_MODE_RULES}\n\n${buildPlanSystemPrompt(planPhase ?? "discover")}`
      : `${LOCAL_ASSISTANT_RULES}\n\nYou are a coding assistant. Answer using the provided context and prior conversation. Never claim you cannot access the codebase.`;

  if (history.length === 0) {
    return ask(prompt);
  }

  const result = await chat([
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: prompt },
  ]);

  return result.content.trim();
}

export function formatAgentStep(
  step: number,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const argPreview = JSON.stringify(args);
  const truncated =
    argPreview.length > 80 ? `${argPreview.slice(0, 77)}...` : argPreview;

  return `[step ${step}] ${toolName}(${truncated})`;
}

export async function runPlanner(
  question: string,
  options?: Omit<AgentOptions, "mode">,
): Promise<string> {
  return runAgent(question, { ...options, mode: "plan" });
}

export async function executePlan(
  plan: string,
  options?: Omit<AgentOptions, "mode">,
): Promise<string> {
  const prompt = `Implement the following plan exactly. Use tools to read, edit, and write files as needed.

${plan}`;

  return runAgent(prompt, { ...options, mode: "agent" });
}
