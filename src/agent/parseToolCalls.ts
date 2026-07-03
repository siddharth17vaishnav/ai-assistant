import type { ToolCall } from "../llm/llm.js";

function tryParseObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function objectToToolCall(obj: Record<string, unknown>): ToolCall | null {
  if (typeof obj.name === "string" && obj.arguments != null) {
    return {
      name: obj.name,
      arguments:
        typeof obj.arguments === "object" && obj.arguments !== null
          ? (obj.arguments as Record<string, unknown>)
          : {},
    };
  }

  if (typeof obj.tool === "string") {
    const args = obj.args ?? obj.arguments ?? {};
    return {
      name: obj.tool,
      arguments:
        typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)
          : {},
    };
  }

  const fn = obj.function as Record<string, unknown> | undefined;

  if (fn && typeof fn.name === "string") {
    const args = fn.arguments ?? {};
    return {
      name: fn.name,
      arguments:
        typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)
          : typeof args === "string"
            ? ((tryParseObject(args) as Record<string, unknown>) ?? {})
            : {},
    };
  }

  return null;
}

function extractJsonCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start !== -1 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }

  return candidates;
}

export function parseToolCallsFromText(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  for (const candidate of extractJsonCandidates(content)) {
    const parsed = tryParseObject(candidate);

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const addCall = (call: ToolCall | null) => {
      if (!call) return;
      const key = `${call.name}:${JSON.stringify(call.arguments)}`;
      if (seen.has(key)) return;
      seen.add(key);
      calls.push(call);
    };

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          addCall(objectToToolCall(item as Record<string, unknown>));
        }
      }
      continue;
    }

    addCall(objectToToolCall(parsed as Record<string, unknown>));
  }

  return calls;
}

export function looksLikeToolCallOnly(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return false;

  const calls = parseToolCallsFromText(trimmed);
  if (calls.length === 0) return false;

  const jsonOnly = extractJsonCandidates(trimmed).some((candidate) => {
    const parsed = tryParseObject(candidate);
    return parsed != null;
  });

  return jsonOnly && trimmed.length < 2000;
}

export function isFinalAnswer(content: string, toolCalls: ToolCall[]): boolean {
  if (toolCalls.length > 0) return false;
  if (!content.trim()) return false;
  if (looksLikeToolCallOnly(content)) return false;
  return true;
}
