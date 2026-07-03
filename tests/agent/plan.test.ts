import assert from "node:assert/strict";
import test from "node:test";

import { assessPlanOutput, isDisallowedPlanResponse, isPersistablePlanContent, pickBestPlanContent, recoverPlanFromHistory } from "../../src/agent/plan.js";

const DISCOVERY_WITH_QUESTIONS = `
## Understanding
Add auth to the API.

## What I found
\`src/server.ts\` has no auth middleware.

## Approaches
### Option A: JWT
- Summary: Stateless tokens
- Pros: Scales well
- Cons: Revocation is harder

### Option B: Sessions
- Summary: Server-side sessions
- Pros: Easy revoke
- Cons: Needs store

## Questions for you
1. Should auth be JWT or session-based?
2. Which routes must be protected?
`;

const FINAL_PLAN = `
## Goal
Add JWT auth.

## Recommended approach
Option A — JWT fits the stateless API.

## Current state
No auth in \`src/server.ts\`.

## Proposed changes
- \`src/auth/middleware.ts\` — verify JWT

## Steps
1. Add middleware
2. Protect routes

## Risks / tradeoffs
- Token expiry handling

## Open questions
None

## Plan status
ready
`;

test("assessPlanOutput detects open questions in discovery", () => {
  const result = assessPlanOutput(DISCOVERY_WITH_QUESTIONS, "discover");

  assert.equal(result.hasOpenQuestions, true);
  assert.equal(result.openQuestions.length, 2);
  assert.equal(result.hasApproaches, true);
  assert.equal(result.readyToExecute, false);
});

test("assessPlanOutput marks finalize plan as ready", () => {
  const result = assessPlanOutput(FINAL_PLAN, "finalize");

  assert.equal(result.hasOpenQuestions, false);
  assert.equal(result.readyToExecute, true);
});

test("assessPlanOutput blocks execute when finalize plan is blocked", () => {
  const blocked = FINAL_PLAN.replace("## Plan status\nready", "## Plan status\nblocked");

  const result = assessPlanOutput(blocked, "finalize");

  assert.equal(result.readyToExecute, false);
});

test("isDisallowedPlanResponse rejects access disclaimers without plan sections", () => {
  const refusal =
    "I don't have full access to the codebase or execute commands on it.";

  assert.equal(isDisallowedPlanResponse(refusal), true);
  assert.equal(isPersistablePlanContent(refusal), false);
});

test("isDisallowedPlanResponse allows real plans that mention access", () => {
  const plan = `## Goal
Inspect MCP OAuth handlers.

## Steps
1. Read auth middleware
`;

  assert.equal(isDisallowedPlanResponse(plan), false);
  assert.equal(isPersistablePlanContent(plan), true);
});

test("recoverPlanFromHistory returns the latest substantive assistant plan", () => {
  const bad =
    "I don't have full access to the codebase or execute commands on it.";
  const good = FINAL_PLAN.trim();

  const recovered = recoverPlanFromHistory([
    { role: "user", content: "Plan OAuth" },
    { role: "assistant", content: good },
    { role: "user", content: "Add more detail" },
    { role: "assistant", content: bad },
  ]);

  assert.equal(recovered, good);
});

test("pickBestPlanContent prefers longer finalized plans", () => {
  const short = "## Goal\nDo thing";
  const long = FINAL_PLAN.trim();

  const picked = pickBestPlanContent([short, long, null]);

  assert.equal(picked, long);
});
