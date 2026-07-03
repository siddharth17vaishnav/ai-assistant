import { config } from "./config.js";
import { syncIndex } from "./syncIndex.js";

import { hasFlag } from "./cliArgs.js";

const forceFull = hasFlag("--full");

async function main() {
  console.log(`Project: ${config.projectPath}`);
  console.log(`Index storage: ${config.projectStorageDir}`);
  console.log(forceFull ? "Mode: full (--full flag)" : "Mode: incremental");

  await syncIndex({ forceFull });
}

main().catch(console.error);
