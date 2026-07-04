import assert from "node:assert/strict";
import os from "os";
import path from "path";
import test from "node:test";

import {
  getCodeHomeDir,
  getProjectsDir,
  getProjectsRegistryPath,
  resetCodeHomeCache,
} from "../../src/core/codeHome.js";

function withCodeHomeEnv(
  env: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = { CODE_HOME: process.env.CODE_HOME };

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    resetCodeHomeCache();
    run();
  } finally {
    if (previous.CODE_HOME === undefined) {
      delete process.env.CODE_HOME;
    } else {
      process.env.CODE_HOME = previous.CODE_HOME;
    }

    resetCodeHomeCache();
  }
}

test("getCodeHomeDir defaults to ~/.code", () => {
  withCodeHomeEnv({ CODE_HOME: undefined }, () => {
    assert.equal(getCodeHomeDir(), path.join(os.homedir(), ".code"));
  });
});

test("getCodeHomeDir respects CODE_HOME override", () => {
  withCodeHomeEnv({ CODE_HOME: "D:/tmp/custom-code-home" }, () => {
    assert.equal(
      getCodeHomeDir(),
      path.resolve("D:/tmp/custom-code-home"),
    );
  });
});

test("getProjectsDir and registry path are under code home", () => {
  withCodeHomeEnv({ CODE_HOME: "D:/tmp/code-home-layout" }, () => {
    const home = getCodeHomeDir();

    assert.equal(getProjectsDir(), path.join(home, "projects"));
    assert.equal(getProjectsRegistryPath(), path.join(home, "projects.json"));
  });
});
