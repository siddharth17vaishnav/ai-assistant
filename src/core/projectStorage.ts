import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

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

const LEGACY_LANCE_DB_DIR = "./storage/lancedb";
const LEGACY_MANIFEST_PATH = "./storage/manifest.json";
const PROJECTS_DIR = "./storage/projects";
const REGISTRY_PATH = "./storage/projects.json";

export function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath).replace(/\\/g, "/").toLowerCase();
}

export function getProjectStorageId(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath);

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function getProjectStoragePaths(projectPath: string): ProjectStoragePaths {
  const id = getProjectStorageId(projectPath);
  const rootDir = path.join(PROJECTS_DIR, id);

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

export async function migrateLegacyStorageIfNeeded(
  projectPath: string,
): Promise<void> {
  const storage = getProjectStoragePaths(projectPath);

  if (await pathExists(storage.manifestPath)) {
    return;
  }

  if (!(await pathExists(LEGACY_MANIFEST_PATH))) {
    return;
  }

  const raw = await fs.readFile(LEGACY_MANIFEST_PATH, "utf8");
  const legacyManifest = JSON.parse(raw) as { projectPath?: string };

  if (
    !legacyManifest.projectPath ||
    normalizeProjectPath(legacyManifest.projectPath) !==
      normalizeProjectPath(projectPath)
  ) {
    return;
  }

  await fs.mkdir(storage.rootDir, { recursive: true });

  await fs.rename(LEGACY_MANIFEST_PATH, storage.manifestPath);

  if (await pathExists(LEGACY_LANCE_DB_DIR)) {
    await fs.rename(LEGACY_LANCE_DB_DIR, storage.lanceDbDir);
  }

  await touchProjectRegistry(projectPath);
}

export async function loadProjectRegistry(): Promise<ProjectRegistry> {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, "utf8");
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

  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2));
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
        `  storage: storage/projects/${project.id}`,
        `  updated: ${updated}`,
      ].join("\n");
    })
    .join("\n\n");
}
