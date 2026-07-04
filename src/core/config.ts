import dotenv from "dotenv";
import path from "path";

import { getCodeHomeDir } from "./codeHome.js";
import { getProjectStoragePaths } from "./projectStorage.js";
import { resolveConfigProjectPath } from "./cliArgs.js";

dotenv.config({ quiet: true });

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

const projectPath = resolveConfigProjectPath();
dotenv.config({ path: path.join(projectPath, ".env"), quiet: true });

const indexStorage = getProjectStoragePaths(projectPath);

export const config = {
  projectPath,
  storageDir: getCodeHomeDir(),
  projectStorageId: indexStorage.id,
  projectStorageDir: indexStorage.rootDir,
  lanceDbDir: indexStorage.lanceDbDir,
  manifestPath: indexStorage.manifestPath,

  ollama: {
    llm: envOrDefault("LLM_MODEL", "qwen2.5-coder:14b"),
    embedding: envOrDefault("EMBED_MODEL", "nomic-embed-text"),
    baseUrl: envOrDefault("OLLAMA_BASE_URL", "http://localhost:11434"),
  },

  chunking: {
    maxLines: 80,
    overlap: 20,
  },

  retrieval: {
    topK: 8,
  },

  watch: {
    debounceMs: 2000,
  },

  agent: {
    maxSteps: 8,
    maxHistoryTurns: 10,
  },

  plan: {
    maxSteps: 12,
  },

  preview: {
    enabled: true,
    host: "127.0.0.1",
    port: 3847,
    timeoutMs: 5 * 60 * 1000,
  },

  include: [
    "**/*.ts",
    "**/*.tsx",
    "**/*.js",
    "**/*.jsx",
    "**/*.json",
    "**/*.md",
    "**/*.css",
    "**/*.scss",
    "**/*.html",
  ],

  exclude: [
    "**/node_modules/**",
    "**/.git/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/.cache/**",
    "**/*.png",
    "**/*.jpg",
    "**/*.jpeg",
    "**/*.gif",
    "**/*.svg",
    "**/*.ico",
    "**/*.lock",
    "**/package-lock.json",
    "**/pnpm-lock.yaml",
    "**/yarn.lock",
  ],
};