import os from "os";
import path from "path";

let cachedHome: string | undefined;

export function resetCodeHomeCache(): void {
  cachedHome = undefined;
}

/** User-level data directory: ~/.code on macOS/Linux, %USERPROFILE%\.code on Windows. */
export function getCodeHomeDir(): string {
  if (cachedHome) {
    return cachedHome;
  }

  const override = process.env.CODE_HOME?.trim();

  cachedHome = override
    ? path.resolve(override)
    : path.join(os.homedir(), ".code");

  return cachedHome;
}

export function getProjectsDir(): string {
  return path.join(getCodeHomeDir(), "projects");
}

export function getProjectsRegistryPath(): string {
  return path.join(getCodeHomeDir(), "projects.json");
}
