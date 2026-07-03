import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPlanId,
  createPlanSnapshot,
  deletePlanRecord,
  derivePlanTitle,
  formatPlanMarkdown,
  formatSavedPlansList,
  listSavedPlans,
  loadPlanRecord,
  loadPlanRecordForResume,
  migrateLegacyPlanSessionIfNeeded,
  savePlanRecord,
  savePlanToFile,
  titleFromPrompt,
} from "../../src/agent/planStorage.js";

test("formatPlanMarkdown includes metadata and plan body", () => {
  const markdown = formatPlanMarkdown("## Goal\nDo thing", {
    projectPath: "/tmp/app",
    updatedAt: "2026-07-03T12:00:00.000Z",
    ready: true,
    title: "Add auth",
  });

  assert.match(markdown, /# Add auth/);
  assert.match(markdown, /Status:\*\* ready/);
  assert.match(markdown, /## Goal/);
});

test("titleFromPrompt uses the first line and truncates long text", () => {
  assert.equal(titleFromPrompt("Add JWT auth"), "Add JWT auth");
  assert.equal(titleFromPrompt("x".repeat(90)).length, 80);
});

test("derivePlanTitle uses the first user prompt, not plan goal headings", () => {
  const title = derivePlanTitle({
    history: [
      { role: "user", content: "Add OAuth login" },
      {
        role: "assistant",
        content: "## Goal\nAdd JWT authentication",
      },
    ],
  });

  assert.equal(title, "Add OAuth login");
});

test("save, list, load, and delete plan records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-plan-test-"));
  const planId = createPlanId();
  const snapshot = createPlanSnapshot({
    id: planId,
    createdAt: "2026-07-03T12:00:00.000Z",
    chatMode: "plan",
    planPhase: "finalize",
    readyToExecute: true,
    hasPlan: true,
    lastPlan: "## Goal\nTest plan",
    history: [
      { role: "user", content: "Add auth" },
      { role: "assistant", content: "## Goal\nTest plan" },
    ],
  });

  await savePlanRecord(dir, snapshot, { projectPath: "/tmp/app" });

  const listed = await listSavedPlans(dir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.title, "Add auth");

  const loaded = await loadPlanRecord(dir, planId);
  assert.equal(loaded?.readyToExecute, true);
  assert.equal(loaded?.history.length, 2);

  assert.match(formatSavedPlansList(listed), /1\. Add auth/);

  const exported = path.join(dir, "export.md");
  await savePlanToFile(exported, snapshot.lastPlan!, {
    projectPath: "/tmp/app",
    updatedAt: snapshot.updatedAt,
    ready: true,
    title: snapshot.title,
  });
  const exportContent = await fs.readFile(exported, "utf8");
  assert.match(exportContent, /Test plan/);

  await deletePlanRecord(dir, planId);
  assert.equal((await listSavedPlans(dir)).length, 0);
});

test("migrateLegacyPlanSessionIfNeeded imports old single-plan files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-plan-legacy-"));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "plan-session.json"),
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-03T12:00:00.000Z",
      chatMode: "plan",
      planPhase: "finalize",
      readyToExecute: false,
      hasPlan: true,
      lastPlan: "## Goal\nLegacy plan",
      history: [{ role: "user", content: "Old request" }],
    }),
    "utf8",
  );

  await migrateLegacyPlanSessionIfNeeded(dir);

  const plans = await listSavedPlans(dir);
  assert.equal(plans.length, 1);
  assert.match(plans[0]?.title ?? "", /Old request/);
});

test("loadPlanRecordForResume recovers plan from markdown and history", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-plan-recover-"));
  const planId = createPlanId();
  const goodPlan = "## Goal\nAdd OAuth\n\n## Steps\n1. Read auth code";
  const badPlan =
    "I don't have full access to the codebase or execute commands on it.";
  const snapshot = createPlanSnapshot({
    id: planId,
    createdAt: "2026-07-03T12:00:00.000Z",
    chatMode: "plan",
    planPhase: "finalize",
    readyToExecute: true,
    hasPlan: true,
    lastPlan: badPlan,
    history: [
      { role: "user", content: "Explain MCP OAuth" },
      { role: "assistant", content: goodPlan },
      { role: "user", content: "Add more detail" },
      { role: "assistant", content: badPlan },
    ],
  });

  await savePlanRecord(dir, {
    ...snapshot,
    lastPlan: goodPlan,
  }, { projectPath: "/tmp/app" });

  await fs.writeFile(
    path.join(dir, "plans", planId, "session.json"),
    JSON.stringify({ ...snapshot, lastPlan: badPlan }, null, 2),
    "utf8",
  );

  const loaded = await loadPlanRecordForResume(dir, planId);

  assert.equal(loaded?.lastPlan, goodPlan);
});

test("savePlanRecord skips markdown when lastPlan is a refusal", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-plan-refusal-"));
  const planId = createPlanId();
  const snapshot = createPlanSnapshot({
    id: planId,
    createdAt: "2026-07-03T12:00:00.000Z",
    chatMode: "plan",
    planPhase: "finalize",
    readyToExecute: false,
    hasPlan: true,
    lastPlan:
      "I don't have full access to the codebase or execute commands on it.",
    history: [{ role: "user", content: "Plan OAuth" }],
  });

  await savePlanRecord(dir, snapshot, { projectPath: "/tmp/app" });

  const markdownPath = path.join(dir, "plans", planId, "plan.md");
  await assert.rejects(() => fs.access(markdownPath));
});
