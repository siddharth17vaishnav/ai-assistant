import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getQueryText,
  hasFlag,
  parseCli,
  resetCliCache,
  resolveConfigProjectPath,
} from "../../src/core/cliArgs.js";

function withArgv(args: string[], run: () => void) {
  const previous = process.argv;

  try {
    process.argv = ["node", "test", ...args];
    resetCliCache();
    run();
  } finally {
    process.argv = previous;
    resetCliCache();
  }
}

test("parseCli strips subcommand before parsing flags", () => {
  withArgv(["chat", "--simple", "hello"], () => {
    const parsed = parseCli();

    assert.equal(parsed.flags.has("--simple"), true);
    assert.deepEqual(parsed.positionals, ["hello"]);
  });
});

test("parseCli reads --project flag", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-cli-test-"));

  withArgv(["--project", projectDir], () => {
    const parsed = parseCli();

    assert.equal(parsed.projectPath, path.resolve(projectDir));
    assert.equal(parsed.positionals.length, 0);
  });
});

test("parseCli treats first positional directory as project path", () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-cli-test-"));

  withArgv([projectDir, "extra", "args"], () => {
    const parsed = parseCli();

    assert.equal(parsed.projectPath, path.resolve(projectDir));
    assert.deepEqual(parsed.positionals, ["extra", "args"]);
  });
});

test("hasFlag detects short and long flags", () => {
  withArgv(["index", "--full"], () => {
    assert.equal(hasFlag("--full"), true);
    assert.equal(hasFlag("--simple"), false);
  });
});

test("getQueryText joins remaining positional args", () => {
  withArgv(["query", "how", "does", "auth", "work"], () => {
    assert.equal(getQueryText(), "how does auth work");
  });
});

test("resolveConfigProjectPath defaults to the current working directory", () => {
  const previousEnv = process.env.PROJECT_PATH;
  const previousArgv = process.argv;

  try {
    delete process.env.PROJECT_PATH;
    process.argv = ["node", "test", "chat"];
    resetCliCache();

    assert.equal(resolveConfigProjectPath(), path.resolve(process.cwd()));
  } finally {
    process.argv = previousArgv;
    resetCliCache();

    if (previousEnv === undefined) {
      delete process.env.PROJECT_PATH;
    } else {
      process.env.PROJECT_PATH = previousEnv;
    }
  }
});
