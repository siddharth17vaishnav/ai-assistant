import assert from "node:assert/strict";
import test from "node:test";

import { bootstrapTestEnv } from "../helpers/env.js";

bootstrapTestEnv();

const { executeTool, getToolNames, isMutatingTool } = await import(
  "../../src/tools/registry.js"
);

test("getToolNames readOnly excludes mutating tools", () => {
  const all = getToolNames();
  const readOnly = getToolNames({ readOnly: true });

  assert.ok(all.includes("write_file"));
  assert.ok(all.includes("edit_file"));
  assert.ok(!readOnly.includes("write_file"));
  assert.ok(!readOnly.includes("edit_file"));
  assert.ok(readOnly.includes("read_file"));
});

test("executeTool blocks mutating tools in readOnly context", async () => {
  assert.equal(isMutatingTool("write_file"), true);
  assert.equal(isMutatingTool("read_file"), false);

  const result = await executeTool(
    "write_file",
    { path: "test.txt", content: "x" },
    { readOnly: true },
  );

  assert.match(result, /Plan mode is read-only/i);
});
