import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

import {
  getCodeHomeDir,
  getProjectsDir,
  getProjectsRegistryPath,
} from "./codeHome.js";

export interface ProjectStoragePaths {
  id: string;
  rootDir: string;
  lanceDbDir: string;
  manifestPath: string;
}

export interface ProjectRegistryEntry {
  projectPath: string;
  updatedAt: string;
}

export interface IndexedProjectInfo extends ProjectRegistryEntry {
  id: string;
}

export interface ProjectRegistry {
  projects: Record<string, ProjectRegistryEntry>;
}

function getLegacyWorkspaceStoragePaths(workspaceDir = process.cwd()) {
  const storageDir = path.join(workspaceDir, "storage");

  return {
    storageDir,
    lanceDbDir: path.join(storageDir, "lancedb"),
    manifestPath: path.join(storageDir, "manifest.json"),
    projectsDir: path.join(storageDir, "projects"),
    registryPath: path.join(storageDir, "projects.json"),
  };
}

async function movePath(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "EXDEV") {
      throw error;
    }
  }

  await fs.cp(source, destination, { recursive: true });
  await fs.rm(source, { recursive: true, force: true });
}

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath).replace(/\\/g, "/").toLowerCase();
}

export function getProjectStorageId(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function getProjectStoragePaths(projectPath: string): ProjectStoragePaths {
  const id = getProjectStorageId(projectPath);
  const rootDir = path.join(getProjectsDir(), id);

  return {
    id,
    rootDir,
    lanceDbDir: path.join(rootDir, "lancedb"),
    manifestPath: path.join(rootDir, "manifest.json"),
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/** Move ./storage from the current working directory into ~/.code on first run. */
export async function migrateWorkspaceStorageToCodeHomeIfNeeded(): Promise<void> {
  const registryPath = getProjectsRegistryPath();
  const projectsDir = getProjectsDir();
  const legacy = getLegacyWorkspaceStoragePaths();

  if (await pathExists(registryPath)) {
    return;
  }

  const hasLegacyRegistry = await pathExists(legacy.registryPath);
  const hasLegacyProjects = await pathExists(legacy.projectsDir);

  if (!hasLegacyRegistry && !hasLegacyProjects) {
    return;
  }

  await fs.mkdir(getCodeHomeDir(), { recursive: true });

  if (hasLegacyProjects && !(await pathExists(projectsDir))) {
    await movePath(legacy.projectsDir, projectsDir);
  }

  if (hasLegacyRegistry && !(await pathExists(registryPath))) {
    await movePath(legacy.registryPath, registryPath);
  }
}

export async function ensureStorageReady(projectPath: string): Promise<void> {
  await migrateWorkspaceStorageToCodeHomeIfNeeded();
  await migrateLegacyStorageIfNeeded(projectPath);
}

export async function migrateLegacyStorageIfNeeded(
  projectPath: string,
): Promise<void> {
  const storage = getProjectStoragePaths(projectPath);
  const legacy = getLegacyWorkspaceStoragePaths();

  if (await pathExists(storage.manifestPath)) {
    return;
  }

  if (!(await pathExists(legacy.manifestPath))) {
    return;
  }

  const raw = await fs.readFile(legacy.manifestPath, "utf8");
  const legacyManifest = JSON.parse(raw) as { projectPath?: string };

  if (
    !legacyManifest.projectPath ||
    normalizeProjectPath(legacyManifest.projectPath) !==
      normalizeProjectPath(projectPath)
  ) {
    return;
  }

  await fs.mkdir(storage.rootDir, { recursive: true });

  await movePath(legacy.manifestPath, storage.manifestPath);

  if (await pathExists(legacy.lanceDbDir)) {
    await movePath(legacy.lanceDbDir, storage.lanceDbDir);
  }

  await touchProjectRegistry(projectPath);
}

export async function loadProjectRegistry(): Promise<ProjectRegistry> {
  try {
    const raw = await fs.readFile(getProjectsRegistryPath(), "utf8");
    return JSON.parse(raw) as ProjectRegistry;
  } catch {
    return { projects: {} };
  }
}

export async function touchProjectRegistry(projectPath: string): Promise<void> {
  const storage = getProjectStoragePaths(projectPath);
  const registry = await loadProjectRegistry();

  registry.projects[storage.id] = {
    projectPath: path.resolve(projectPath),
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(getCodeHomeDir(), { recursive: true });
  await fs.writeFile(getProjectsRegistryPath(), JSON.stringify(registry, null, 2));
}

export async function listIndexedProjects(): Promise<IndexedProjectInfo[]> {
  const registry = await loadProjectRegistry();

  return Object.entries(registry.projects).map(([id, entry]) => ({
    id,
    ...entry,
  }));
}

export function formatIndexedProjects(
  projects: IndexedProjectInfo[],
  activeProjectPath: string,
): string {
  if (projects.length === 0) {
    return "No indexed projects yet.\nRun: npm run index -- <path>";
  }

  const activeKey = normalizeProjectPath(activeProjectPath);

  return [...projects]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((project) => {
      const isActive =
        normalizeProjectPath(project.projectPath) === activeKey;
      const marker = isActive ? " (active)" : "";
      const updated = new Date(project.updatedAt).toLocaleString();

      return [
        `- ${project.projectPath}${marker}`,
        `  storage: ${path.join(getProjectsDir(), project.id)}`,
        `  updated: ${updated}`,
      ].join("\n");
    })
    .join("\n\n");
}
