import fs from "fs/promises";
import path from "path";

import type { ChatMessage } from "../llm/llm.js";
import type { PlanPhase } from "./plan.js";
import {
  isPersistablePlanContent,
  pickBestPlanContent,
  recoverPlanFromHistory,
} from "./plan.js";

export const PLANS_DIR_NAME = "plans";
export const PLAN_SESSION_FILE = "plan-session.json";
export const PLAN_MARKDOWN_FILE = "plan.md";

export type StoredChatMode = "simple" | "agent" | "plan";

export interface PlanSessionSnapshot {
  version: 2;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  chatMode: StoredChatMode;
  planPhase: PlanPhase;
  readyToExecute: boolean;
  hasPlan: boolean;
  lastPlan: string | null;
  history: ChatMessage[];
}

export interface SavedPlanSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  readyToExecute: boolean;
  chatMode: StoredChatMode;
}

export interface PlanMarkdownMeta {
  projectPath: string;
  updatedAt: string;
  ready: boolean;
  title?: string;
}

interface PlanIndexFile {
  plans: SavedPlanSummary[];
}

export function getPlansRoot(storageDir: string): string {
  return path.join(storageDir, PLANS_DIR_NAME);
}

export function getPlanRecordPaths(storageDir: string, planId: string) {
  const root = path.join(getPlansRoot(storageDir), planId);

  return {
    root,
    sessionPath: path.join(root, "session.json"),
    markdownPath: path.join(root, "plan.md"),
  };
}

/** @deprecated Use getPlanRecordPaths for multi-plan storage. */
export function getPlanStoragePaths(storageDir: string) {
  return {
    sessionPath: path.join(storageDir, PLAN_SESSION_FILE),
    markdownPath: path.join(storageDir, PLAN_MARKDOWN_FILE),
  };
}

export function createPlanId(): string {
  return `plan-${Date.now().toString(36)}`;
}

export function extractPlanBodyFromMarkdown(markdown: string): string {
  const parts = markdown.split(/^---\s*$/m);

  if (parts.length >= 2) {
    return parts.slice(1).join("---").trim();
  }

  return markdown.trim();
}

export async function readPlanMarkdownBody(
  storageDir: string,
  planId: string,
): Promise<string | null> {
  const { markdownPath } = getPlanRecordPaths(storageDir, planId);

  try {
    const markdown = await fs.readFile(markdownPath, "utf8");
    const body = extractPlanBodyFromMarkdown(markdown);

    return isPersistablePlanContent(body) ? body : null;
  } catch {
    return null;
  }
}

export function formatPlanMarkdown(
  plan: string,
  meta: PlanMarkdownMeta,
): string {
  const title = meta.title?.trim() || "Code Plan";

  return `# ${title}

> **Project:** ${meta.projectPath}  
> **Updated:** ${meta.updatedAt}  
> **Status:** ${meta.ready ? "ready" : "draft"}

---

${plan.trim()}
`;
}

export function titleFromPrompt(prompt: string): string {
  const line = prompt.split("\n")[0]?.trim() ?? "";

  if (!line) {
    return "Untitled plan";
  }

  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export function derivePlanTitle(input: {
  history: ChatMessage[];
}): string {
  const firstUserMessage = input.history.find(
    (message) =>
      message.role === "user" &&
      message.content.trim().length > 0 &&
      !message.content.startsWith("/") &&
      message.content !== "[execute plan]" &&
      !message.content.startsWith("Update the current plan based on this feedback") &&
      !message.content.startsWith("Produce the final implementation plan"),
  )?.content;

  if (firstUserMessage) {
    return titleFromPrompt(firstUserMessage);
  }

  return "Untitled plan";
}

async function readPlanIndex(storageDir: string): Promise<PlanIndexFile> {
  const indexPath = path.join(getPlansRoot(storageDir), "index.json");

  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as PlanIndexFile;

    if (!Array.isArray(parsed.plans)) {
      return { plans: [] };
    }

    return parsed;
  } catch {
    return { plans: [] };
  }
}

async function writePlanIndex(
  storageDir: string,
  index: PlanIndexFile,
): Promise<void> {
  const plansRoot = getPlansRoot(storageDir);
  await fs.mkdir(plansRoot, { recursive: true });
  await fs.writeFile(
    path.join(plansRoot, "index.json"),
    JSON.stringify(index, null, 2),
    "utf8",
  );
}

function snapshotToSummary(snapshot: PlanSessionSnapshot): SavedPlanSummary {
  return {
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    readyToExecute: snapshot.readyToExecute,
    chatMode: snapshot.chatMode,
  };
}

interface LegacyPlanSessionSnapshot {
  version: 1;
  updatedAt: string;
  chatMode: StoredChatMode;
  planPhase: PlanPhase;
  readyToExecute: boolean;
  hasPlan: boolean;
  lastPlan: string | null;
  history: ChatMessage[];
}

function isValidSnapshot(parsed: unknown): parsed is PlanSessionSnapshot | LegacyPlanSessionSnapshot {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }

  const snapshot = parsed as { version?: number; history?: unknown };
  return (
    (snapshot.version === 2 || snapshot.version === 1) &&
    Array.isArray(snapshot.history)
  );
}

function normalizeSnapshot(
  parsed: PlanSessionSnapshot | LegacyPlanSessionSnapshot,
): PlanSessionSnapshot {
  if (parsed.version === 2 && "id" in parsed && parsed.id && parsed.title) {
    return parsed;
  }

  const legacy = parsed as LegacyPlanSessionSnapshot;
  const createdAt = legacy.updatedAt ?? new Date().toISOString();

  return {
    version: 2,
    id: createPlanId(),
    title: derivePlanTitle({ history: legacy.history }),
    createdAt,
    updatedAt: legacy.updatedAt ?? createdAt,
    chatMode: legacy.chatMode,
    planPhase: legacy.planPhase,
    readyToExecute: legacy.readyToExecute,
    hasPlan: legacy.hasPlan,
    lastPlan: legacy.lastPlan,
    history: legacy.history,
  };
}

export async function migrateLegacyPlanSessionIfNeeded(
  storageDir: string,
): Promise<void> {
  const legacy = getPlanStoragePaths(storageDir);

  try {
    await fs.access(legacy.sessionPath);
  } catch {
    return;
  }

  const raw = await fs.readFile(legacy.sessionPath, "utf8");
  const parsed = JSON.parse(raw) as PlanSessionSnapshot;

  if (!isValidSnapshot(parsed)) {
    return;
  }

  const snapshot = normalizeSnapshot(parsed);
  snapshot.id = createPlanId();
  await savePlanRecord(storageDir, snapshot);

  await Promise.allSettled([
    fs.unlink(legacy.sessionPath),
    fs.unlink(legacy.markdownPath),
  ]);
}

export async function listSavedPlans(
  storageDir: string,
): Promise<SavedPlanSummary[]> {
  await migrateLegacyPlanSessionIfNeeded(storageDir);
  const index = await readPlanIndex(storageDir);

  return index.plans.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function formatSavedPlansList(plans: SavedPlanSummary[]): string {
  if (plans.length === 0) {
    return "No saved plans for this project.";
  }

  const lines = plans.map((plan, index) => {
    const when = new Date(plan.updatedAt).toLocaleString();
    const status = plan.readyToExecute ? "ready" : "draft";

    return `  ${index + 1}. ${plan.title} [${status}] — ${when}`;
  });

  return ["Saved plans:", ...lines, "", "  0. Cancel"].join("\n");
}

export async function savePlanRecord(
  storageDir: string,
  snapshot: PlanSessionSnapshot,
  options?: { projectPath?: string },
): Promise<string> {
  const { sessionPath, markdownPath, root } = getPlanRecordPaths(
    storageDir,
    snapshot.id,
  );

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(sessionPath, JSON.stringify(snapshot, null, 2), "utf8");

  if (snapshot.lastPlan && isPersistablePlanContent(snapshot.lastPlan)) {
    await fs.writeFile(
      markdownPath,
      formatPlanMarkdown(snapshot.lastPlan, {
        projectPath: options?.projectPath ?? storageDir,
        updatedAt: snapshot.updatedAt,
        ready: snapshot.readyToExecute,
        title: snapshot.title,
      }),
      "utf8",
    );
  }

  const index = await readPlanIndex(storageDir);
  const summary = snapshotToSummary(snapshot);
  const existingIndex = index.plans.findIndex((plan) => plan.id === snapshot.id);

  if (existingIndex >= 0) {
    index.plans[existingIndex] = summary;
  } else {
    index.plans.push(summary);
  }

  await writePlanIndex(storageDir, index);
  return sessionPath;
}

export async function loadPlanRecord(
  storageDir: string,
  planId: string,
): Promise<PlanSessionSnapshot | null> {
  const { sessionPath } = getPlanRecordPaths(storageDir, planId);

  try {
    const raw = await fs.readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as PlanSessionSnapshot;

    if (!isValidSnapshot(parsed)) {
      return null;
    }

    return normalizeSnapshot(parsed);
  } catch {
    return null;
  }
}

export async function loadPlanRecordForResume(
  storageDir: string,
  planId: string,
): Promise<PlanSessionSnapshot | null> {
  const snapshot = await loadPlanRecord(storageDir, planId);

  if (!snapshot) {
    return null;
  }

  const bestPlan = pickBestPlanContent([
    snapshot.lastPlan,
    await readPlanMarkdownBody(storageDir, planId),
    recoverPlanFromHistory(snapshot.history),
  ]);

  if (bestPlan) {
    snapshot.lastPlan = bestPlan;
  }

  return snapshot;
}

export async function deletePlanRecord(
  storageDir: string,
  planId: string,
): Promise<void> {
  const { root } = getPlanRecordPaths(storageDir, planId);
  const index = await readPlanIndex(storageDir);
  index.plans = index.plans.filter((plan) => plan.id !== planId);
  await writePlanIndex(storageDir, index);
  await fs.rm(root, { recursive: true, force: true });
}

export async function savePlanToFile(
  filePath: string,
  plan: string,
  meta: PlanMarkdownMeta,
): Promise<string> {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, formatPlanMarkdown(plan, meta), "utf8");
  return resolved;
}

/** @deprecated Use savePlanRecord. */
export async function savePlanSession(
  storageDir: string,
  snapshot: Omit<PlanSessionSnapshot, "id" | "title" | "createdAt" | "version"> & {
    id?: string;
    title?: string;
    createdAt?: string;
  },
): Promise<string> {
  const fullSnapshot: PlanSessionSnapshot = {
    version: 2,
    id: snapshot.id ?? createPlanId(),
    title:
      snapshot.title ??
      derivePlanTitle({
        history: snapshot.history,
      }),
    createdAt: snapshot.createdAt ?? snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
    chatMode: snapshot.chatMode,
    planPhase: snapshot.planPhase,
    readyToExecute: snapshot.readyToExecute,
    hasPlan: snapshot.hasPlan,
    lastPlan: snapshot.lastPlan,
    history: snapshot.history,
  };

  return savePlanRecord(storageDir, fullSnapshot);
}

/** @deprecated Use loadPlanRecord after listing plans. */
export async function loadPlanSession(
  storageDir: string,
): Promise<PlanSessionSnapshot | null> {
  await migrateLegacyPlanSessionIfNeeded(storageDir);
  const plans = await listSavedPlans(storageDir);

  if (plans.length === 0) {
    return null;
  }

  return loadPlanRecord(storageDir, plans[0]!.id);
}

/** @deprecated Use deletePlanRecord. */
export async function clearPlanSession(storageDir: string): Promise<void> {
  const plans = await listSavedPlans(storageDir);
  await Promise.all(
    plans.map((plan) => deletePlanRecord(storageDir, plan.id)),
  );

  const legacy = getPlanStoragePaths(storageDir);
  await Promise.allSettled([
    fs.unlink(legacy.sessionPath),
    fs.unlink(legacy.markdownPath),
  ]);
}

export function createPlanSnapshot(input: {
  id: string;
  title?: string;
  createdAt: string;
  chatMode: StoredChatMode;
  planPhase: PlanPhase;
  readyToExecute: boolean;
  hasPlan: boolean;
  lastPlan: string | null;
  history: ChatMessage[];
}): PlanSessionSnapshot {
  const title =
    input.title ??
    derivePlanTitle({
      history: input.history,
    });

  return {
    version: 2,
    id: input.id,
    title,
    createdAt: input.createdAt,
    updatedAt: new Date().toISOString(),
    chatMode: input.chatMode,
    planPhase: input.planPhase,
    readyToExecute: input.readyToExecute,
    hasPlan: input.hasPlan,
    lastPlan: input.lastPlan,
    history: input.history,
  };
}

export function formatSavedSessionHint(snapshot: PlanSessionSnapshot): string {
  const when = new Date(snapshot.updatedAt).toLocaleString();
  const status = snapshot.readyToExecute ? "ready" : "draft";

  return `Resumed "${snapshot.title}" (${when}, ${status}).`;
}

export async function writePlanMarkdown(
  storageDir: string,
  planId: string,
  plan: string,
  meta: PlanMarkdownMeta,
): Promise<string> {
  const { markdownPath, root } = getPlanRecordPaths(storageDir, planId);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(markdownPath, formatPlanMarkdown(plan, meta), "utf8");
  return markdownPath;
}
