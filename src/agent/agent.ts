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

function buildSystemPrompt(): string {
  const toolNames = getToolNames().join(", ");

  return `You are an expert coding assistant exploring a local codebase.

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
): ToolCall[] {
  if (native.length > 0) {
    return native;
  }

  return parseToolCallsFromText(content).filter((call) =>
    getToolNames().includes(call.name),
  );
}

export interface AgentOptions {
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
  const maxSteps = options?.maxSteps ?? config.agent.maxSteps;
  const prior = trimHistory(
    (options?.history ?? []).filter(
      (message) => message.role === "user" || message.role === "assistant",
    ),
  );

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...prior,
    { role: "user", content: question },
  ];

  for (let step = 1; step <= maxSteps; step++) {
    const result = await chat(messages);
    const toolCalls = normalizeToolCalls(result.toolCalls, result.content);

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
          options?.toolContext,
        );
      } catch (error) {
        output =
          error instanceof Error ? error.message : "Tool execution failed.";
      }

      messages.push({
        role: "user",
        content: `[Tool result: ${toolCall.name}]\n${output}\n\nContinue with another tool (JSON only) or provide your final answer in plain English.`,
      });
    }
  }

  return runFallbackAnswer(question, prior);
}

async function runFallbackAnswer(
  question: string,
  history: ChatMessage[],
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

  if (history.length === 0) {
    return ask(prompt);
  }

  const result = await chat([
    {
      role: "system",
      content:
        "You are a coding assistant. Answer using the provided context and prior conversation.",
    },
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
