export type PlanPhase = "discover" | "finalize";

export interface PlanAssessment {
  hasOpenQuestions: boolean;
  openQuestions: string[];
  hasApproaches: boolean;
  readyToExecute: boolean;
  statusMessage: string;
}

const NONE_PATTERN = /^(none|n\/a|no open questions?|nothing)\.?$/i;

export function buildPlanSystemPrompt(phase: PlanPhase): string {
  const toolHint = `When you need a tool, respond with ONLY a JSON object (no markdown, no explanation):
{"name": "tool_name", "arguments": {...}}`;

  if (phase === "discover") {
    return `You are an expert coding assistant in PLAN MODE — DISCOVERY PHASE.

Explore the codebase with read-only tools. Do NOT edit or write files.
Do NOT produce implementation steps yet. Your job is to understand the request and align with the user.

${toolHint}

When you have explored enough, respond in plain English using EXACTLY this structure:

## Understanding
What the user is asking for in your own words.

## What I found
Relevant codebase findings (cite file paths and line numbers).

## Approaches
Present at least 2 viable options when the task is non-trivial.

### Option A: [short name]
- Summary: one sentence
- Pros: bullet points
- Cons: bullet points

### Option B: [short name]
- Summary: one sentence
- Pros: bullet points
- Cons: bullet points

(Add Option C if helpful.)

## Questions for you
Numbered questions the user must answer before you can produce a solid plan.
Ask about preferences, constraints, scope, and which approach they prefer.
If the task is trivial and fully unambiguous, write "None" and add a "## Recommended approach" section instead.

## Recommended approach
(Only when Questions for you is "None" — pick one option and explain why.)

Rules:
- Prefer asking 2–5 focused questions over guessing.
- Always present tradeoffs between approaches.
- Use read-only tools to inspect the codebase before answering — never claim you cannot access files.
- Do NOT include "## Steps" or "## Proposed changes" in discovery — wait for user answers.
- Do NOT return JSON for your final discovery response.`;
  }

  return `You are an expert coding assistant in PLAN MODE — FINALIZE PHASE.

The user has answered your questions, or is revising an existing plan. Produce a solid, actionable implementation plan.
If revising, incorporate the feedback and output the full updated plan (all sections), not a partial diff.
You may use read-only tools if you need to verify details.

${toolHint}

Respond in plain English using EXACTLY this structure:

## Goal
Clear statement of what will be built or changed.

## Recommended approach
Which option the user chose (or your recommendation based on their answers) and why.

## Current state
What exists today (cite file paths and line numbers).

## Proposed changes
- \`path/to/file.ts\` — specific change

## Steps
1. Numbered implementation steps in dependency order.

## Risks / tradeoffs
- What could go wrong and mitigations.

## Open questions
Write "None" if nothing blocks implementation.

## Plan status
Write "ready" when the plan is complete and safe to execute, or "blocked" with reason.

End with: "Run /execute to implement this plan."

Do NOT return JSON for your final plan. Do not invent code that is not in the project.`;
}

function extractSection(content: string, ...headings: string[]): string | null {
  for (const heading of headings) {
    const pattern = new RegExp(
      `(?:^|\\n)## ${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
      "i",
    );
    const match = content.match(pattern);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNumberedItems(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s+/, "").trim())
    .filter((line) => line.length > 0 && !NONE_PATTERN.test(line));
}

function sectionIsNone(section: string | null): boolean {
  if (!section) {
    return true;
  }

  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return true;
  }

  return lines.every((line) => NONE_PATTERN.test(line.replace(/^[-*]\s*/, "")));
}

function isPlanStatusReady(content: string): boolean {
  const status = extractSection(content, "Plan status");

  if (!status) {
    return false;
  }

  if (/\bblocked\b/i.test(status)) {
    return false;
  }

  return /\bready\b/i.test(status);
}

export function assessPlanOutput(
  content: string,
  phase: PlanPhase,
): PlanAssessment {
  const questionsSection =
    extractSection(content, "Questions for you", "Open questions") ?? "";
  const openQuestions = parseNumberedItems(questionsSection);
  const hasOpenQuestions =
    !sectionIsNone(questionsSection) && openQuestions.length > 0;
  const approachesSection = extractSection(content, "Approaches") ?? "";
  const hasApproaches =
    /### Option [A-Z]/i.test(approachesSection) ||
    /^### Option/m.test(approachesSection);

  if (phase === "discover") {
    if (hasOpenQuestions) {
      return {
        hasOpenQuestions: true,
        openQuestions,
        hasApproaches,
        readyToExecute: false,
        statusMessage:
          "Answer the questions above and pick an approach — I'll produce a final plan next.",
      };
    }

    const hasSteps = extractSection(content, "Steps") != null;
    const hasChanges = extractSection(content, "Proposed changes") != null;
    const readyToExecute =
      !hasOpenQuestions &&
      (isPlanStatusReady(content) || (hasSteps && hasChanges));

    return {
      hasOpenQuestions: false,
      openQuestions: [],
      hasApproaches,
      readyToExecute,
      statusMessage: readyToExecute
        ? "Plan ready — run /execute to implement."
        : "Review the approaches above and reply with your preferences.",
    };
  }

  const readyToExecute =
    isPlanStatusReady(content) ||
    (!hasOpenQuestions &&
      !extractSection(content, "Plan status")?.match(/\bblocked\b/i) &&
      extractSection(content, "Steps") != null &&
      extractSection(content, "Proposed changes") != null);

  return {
    hasOpenQuestions,
    openQuestions,
    hasApproaches,
    readyToExecute,
    statusMessage: readyToExecute
      ? "Plan ready — run /execute to implement."
      : hasOpenQuestions
        ? "Still blocked — answer the remaining open questions."
        : "Plan needs more detail — reply with clarifications or run /finalize.",
  };
}

export function formatPlanFollowUpHint(assessment: PlanAssessment): string {
  if (assessment.readyToExecute) {
    return "Plan ready — run /execute to implement.";
  }

  if (assessment.openQuestions.length > 0) {
    const preview = assessment.openQuestions.slice(0, 3).join("; ");
    return `Answer the open questions (e.g. ${preview}) and I'll finalize the plan.`;
  }

  return assessment.statusMessage;
}

const DISALLOWED_PLAN_PATTERNS = [
  /don't have full access/i,
  /do not have full access/i,
  /cannot access the codebase/i,
  /can't access the codebase/i,
  /only provide information/i,
  /as an ai language model/i,
  /i'm unable to access/i,
];

export function isDisallowedPlanResponse(content: string): boolean {
  const trimmed = content.trim();

  if (!trimmed) {
    return true;
  }

  const looksLikeRefusal = DISALLOWED_PLAN_PATTERNS.some((pattern) =>
    pattern.test(trimmed),
  );

  if (!looksLikeRefusal) {
    return false;
  }

  return !/^## /m.test(trimmed);
}

export function isPersistablePlanContent(content: string): boolean {
  const trimmed = content.trim();

  if (!trimmed || isDisallowedPlanResponse(trimmed)) {
    return false;
  }

  return /^## /m.test(trimmed);
}

export function recoverPlanFromHistory(
  history: Array<{ role: string; content: string }>,
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];

    if (message?.role !== "assistant") {
      continue;
    }

    if (isPersistablePlanContent(message.content)) {
      return message.content.trim();
    }
  }

  return null;
}

export function pickBestPlanContent(candidates: Array<string | null | undefined>): string | null {
  const scored = candidates
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate))
    .filter((candidate) => isPersistablePlanContent(candidate))
    .map((candidate) => ({
      content: candidate,
      score:
        candidate.length +
        (/^## Goal/im.test(candidate) ? 1000 : 0) +
        (/^## Steps/im.test(candidate) ? 500 : 0) +
        (/^## Proposed changes/im.test(candidate) ? 250 : 0),
    }))
    .sort((left, right) => right.score - left.score);

  return scored[0]?.content ?? null;
}
