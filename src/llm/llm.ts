import { config } from "../core/config.js";

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_calls?: OllamaToolCall[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  rawToolCalls?: OllamaToolCall[];
}

interface OllamaChatResponse {
  message: {
    content: string;
    tool_calls?: OllamaToolCall[];
  };
}

export async function ask(prompt: string): Promise<string> {
  const result = await chat([{ role: "user", content: prompt }]);
  return result.content;
}

export async function chat(
  messages: ChatMessage[],
  tools?: unknown[],
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: config.ollama.llm,
    messages,
    stream: false,
  };

  if (tools?.length) {
    body.tools = tools;
  }

  const response = await fetch(`${config.ollama.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama chat error: ${response.status} ${await response.text()}`,
    );
  }

  const json = (await response.json()) as OllamaChatResponse;
  const message = json.message;

  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => {
    const rawArgs = call.function.arguments;
    let parsedArgs: Record<string, unknown> = {};

    if (typeof rawArgs === "string") {
      try {
        parsedArgs = JSON.parse(rawArgs) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
    } else {
      parsedArgs = rawArgs;
    }

    return {
      name: call.function.name,
      arguments: parsedArgs,
    };
  });

  return {
    content: message.content ?? "",
    toolCalls,
    rawToolCalls: message.tool_calls,
  };
}
