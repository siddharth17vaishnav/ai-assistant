import dotenv from "dotenv";
import path from "path";

import { getProjectPathFromArgs, resolveProjectPath } from "./cliArgs.js";
import { getProjectStoragePaths } from "./projectStorage.js";

dotenv.config({ quiet: true });

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function resolveConfigProjectPath(): string {
  const fromArgs = getProjectPathFromArgs();

  if (fromArgs) {
    return fromArgs;
  }

  const fromEnv = process.env.PROJECT_PATH;

  if (fromEnv) {
    return resolveProjectPath(path.resolve(fromEnv));
  }

  throw new Error(
    "Project path required. Pass --project <path> or set PROJECT_PATH in .env",
  );
}

const projectPath = resolveConfigProjectPath();
dotenv.config({ path: path.join(projectPath, ".env"), quiet: true });

const indexStorage = getProjectStoragePaths(projectPath);

export const config = {
  projectPath,
  storageDir: "./storage",
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