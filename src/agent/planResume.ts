import readline from "readline/promises";

import {
  formatSavedPlansList,
  formatSavedSessionHint,
  getPlanRecordPaths,
  listSavedPlans,
  loadPlanRecordForResume,
  savePlanRecord,
  type PlanSessionSnapshot,
} from "./planStorage.js";

export async function promptPlanSelection(
  rl: readline.Interface,
  storageDir: string,
): Promise<PlanSessionSnapshot | null> {
  const plans = await listSavedPlans(storageDir);

  if (plans.length === 0) {
    console.log("\nNo saved plans for this project.\n");
    return null;
  }

  console.log(`\n${formatSavedPlansList(plans)}\n`);

  const answer = (await rl.question("Select plan number: ")).trim();
  const selected = Number.parseInt(answer, 10);

  if (selected === 0) {
    console.log("\nResume cancelled.\n");
    return null;
  }

  if (!Number.isFinite(selected) || selected < 1 || selected > plans.length) {
    console.log("\nInvalid selection.\n");
    return null;
  }

  const plan = plans[selected - 1]!;
  const snapshot = await loadPlanRecordForResume(storageDir, plan.id);

  if (!snapshot) {
    console.log("\nCould not load the selected plan.\n");
    return null;
  }

  await savePlanRecord(storageDir, snapshot);

  const { markdownPath } = getPlanRecordPaths(storageDir, snapshot.id);
  console.log(`\n${formatSavedSessionHint(snapshot)}`);
  console.log(`Plan file: ${markdownPath}`);
  console.log(`\nPlan:\n${formatResumedPlanDisplay(snapshot)}\n`);

  return snapshot;
}

export function formatResumedPlanDisplay(snapshot: PlanSessionSnapshot): string {
  if (!snapshot.lastPlan?.trim()) {
    return "(No plan content saved yet — continue the conversation to build one.)";
  }

  return snapshot.lastPlan.trim();
}
