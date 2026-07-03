import assert from "node:assert/strict";
import test from "node:test";

import { formatSavedPlansList } from "../../src/agent/planStorage.js";

test("formatSavedPlansList includes numbered entries and cancel option", () => {
  const text = formatSavedPlansList([
    {
      id: "plan-a",
      title: "Add OAuth",
      createdAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-07-03T13:00:00.000Z",
      readyToExecute: true,
      chatMode: "plan",
    },
    {
      id: "plan-b",
      title: "Refactor auth",
      createdAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T14:00:00.000Z",
      readyToExecute: false,
      chatMode: "plan",
    },
  ]);

  assert.match(text, /1\. Add OAuth \[ready\]/);
  assert.match(text, /2\. Refactor auth \[draft\]/);
  assert.match(text, /0\. Cancel/);
});

test("formatResumedPlanDisplay returns the full saved plan text", async () => {
  const { formatResumedPlanDisplay } = await import("../../src/agent/planResume.js");

  const longPlan = "## Goal\nAdd OAuth\n\n" + "detail line\n".repeat(100);
  const text = formatResumedPlanDisplay({
    version: 2,
    id: "plan-test",
    title: "Add OAuth",
    createdAt: "2026-07-03T12:00:00.000Z",
    updatedAt: "2026-07-03T13:00:00.000Z",
    chatMode: "plan",
    planPhase: "finalize",
    readyToExecute: true,
    hasPlan: true,
    lastPlan: longPlan,
    history: [],
  });

  assert.equal(text, longPlan.trim());
  assert.ok(text.length > 400);
});
