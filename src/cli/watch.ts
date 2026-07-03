import { config } from "../core/config.js";
import { startWatcher } from "../indexing/watcher.js";

async function main() {
  console.log(`Project: ${config.projectPath}`);
  startWatcher();
}

main().catch(console.error);
