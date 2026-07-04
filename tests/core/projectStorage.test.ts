import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resetCodeHomeCache } from "../../src/core/codeHome.js";
import {
  getProjectStorageId,
  getProjectStoragePaths,
  migrateWorkspaceStorageToCodeHomeIfNeeded,
  normalizeProjectPath,
} from "../../src/core/projectStorage.js";

test("normalizeProjectPath lowercases and normalizes slashes", () => {
  const normalized = normalizeProjectPath("D:\\Projects\\MyApp");

  assert.match(normalized, /^d:\/projects\/myapp$/i);
});

test("getProjectStorageId is stable for the same project path", () => {
  const projectPath = path.resolve("D:/Projects/stable-app");
  const first = getProjectStorageId(projectPath);
  const second = getProjectStorageId("d:\\projects\\stable-app");

  assert.equal(first, second);
  assert.equal(first.length, 16);
});

test("getProjectStoragePaths returns per-project storage layout", () => {
  const previousCodeHome = process.env.CODE_HOME;

  try {
    process.env.CODE_HOME = path.join(os.tmpdir(), "code-home-layout-test");
    resetCodeHomeCache();

    const projectPath = path.resolve("D:/Projects/layout-app");
    const storage = getProjectStoragePaths(projectPath);

    assert.equal(storage.id, getProjectStorageId(projectPath));
    assert.match(storage.rootDir, new RegExp(`projects[/\\\\]${storage.id}$`));
    assert.match(storage.lanceDbDir, /lancedb$/);
    assert.match(storage.manifestPath, /manifest\.json$/);
  } finally {
    if (previousCodeHome === undefined) {
      delete process.env.CODE_HOME;
    } else {
      process.env.CODE_HOME = previousCodeHome;
    }

    resetCodeHomeCache();
  }
});

test("migrateWorkspaceStorageToCodeHomeIfNeeded moves ./storage into code home", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "code-workspace-"));
  const codeHome = path.join(workspace, "user-code-home");
  const previousCwd = process.cwd();
  const previousCodeHome = process.env.CODE_HOME;

  try {
    process.chdir(workspace);
    process.env.CODE_HOME = codeHome;
    resetCodeHomeCache();

    await fs.mkdir(path.join(workspace, "storage", "projects", "abc123"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace, "storage", "projects.json"),
      JSON.stringify({ projects: {} }),
      "utf8",
    );

    await migrateWorkspaceStorageToCodeHomeIfNeeded();

    assert.equal(
      await fs
        .access(path.join(codeHome, "projects.json"))
        .then(() => true)
        .catch(() => false),
      true,
    );
    assert.equal(
      await fs
        .access(path.join(codeHome, "projects", "abc123"))
        .then(() => true)
        .catch(() => false),
      true,
    );
  } finally {
    process.chdir(previousCwd);

    if (previousCodeHome === undefined) {
      delete process.env.CODE_HOME;
    } else {
      process.env.CODE_HOME = previousCodeHome;
    }

    resetCodeHomeCache();
  }
});
