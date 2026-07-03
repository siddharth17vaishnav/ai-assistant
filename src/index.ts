import { config } from "./config.js";
import { loadProject } from "./loader.js";

async function main() {
  console.log(`Project: ${config.projectPath}\n`);

  const files = await loadProject();

  console.log(`Loaded ${files.length} files\n`);

  for (const file of files.slice(0, 20)) {
    console.log(file.path);
  }
}

main().catch(console.error);