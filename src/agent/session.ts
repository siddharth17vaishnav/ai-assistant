import type { ChatMessage } from "../llm/llm.js";
import { config } from "../core/config.js";

export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const maxMessages = config.agent.maxHistoryTurns * 2;
  return messages.slice(-maxMessages);
}

export function appendTurn(
  history: ChatMessage[],
  question: string,
  answer: string,
): ChatMessage[] {
  return trimHistory([
    ...history,
    { role: "user", content: question },
    { role: "assistant", content: answer },
  ]);
}

export function formatHistorySummary(history: ChatMessage[]): string {
  if (history.length === 0) return "";

  return history
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      const text =
        message.content.length > 400
          ? `${message.content.slice(0, 397)}...`
          : message.content;
      return `${label}: ${text}`;
    })
    .join("\n\n");
}
