import assert from "node:assert/strict";
import test from "node:test";

import {
  isFinalAnswer,
  looksLikeToolCallOnly,
  parseToolCallsFromText,
} from "../../src/agent/parseToolCalls.js";

test("parseToolCallsFromText parses name/arguments JSON", () => {
  const calls = parseToolCallsFromText(
    JSON.stringify({
      name: "read_file",
      arguments: { path: "src/index.ts" },
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "read_file");
  assert.deepEqual(calls[0]?.arguments, { path: "src/index.ts" });
});

test("parseToolCallsFromText parses fenced JSON blocks", () => {
  const calls = parseToolCallsFromText(
    'Here is the tool call:\n```json\n{"tool":"grep","args":{"pattern":"auth"}}\n```',
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "grep");
  assert.deepEqual(calls[0]?.arguments, { pattern: "auth" });
});

test("parseToolCallsFromText deduplicates identical calls", () => {
  const calls = parseToolCallsFromText(
    JSON.stringify([
      { name: "grep", arguments: { pattern: "foo" } },
      { name: "grep", arguments: { pattern: "foo" } },
    ]),
  );

  assert.equal(calls.length, 1);
});

test("parseToolCallsFromText parses multiple JSON objects in one response", () => {
  const calls = parseToolCallsFromText(`{
  "name": "write_file",
  "arguments": {
    "path": "app/blog/index.tsx",
    "content": "export default function BlogPage() {}"
  }
}

{
  "name": "edit_file",
  "arguments": {
    "path": "app/page.tsx",
    "start_line": 1,
    "end_line": 5,
    "content": "updated"
  }
}`);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.name, "write_file");
  assert.equal(calls[1]?.name, "edit_file");
});

test("isFinalAnswer rejects multiple tool JSON blocks", () => {
  const content = `{"name":"write_file","arguments":{"path":"a.ts","content":"x"}}

{"name":"write_file","arguments":{"path":"b.ts","content":"y"}}`;

  assert.equal(looksLikeToolCallOnly(content), true);
  assert.equal(isFinalAnswer(content, []), false);
});

test("isFinalAnswer rejects tool-only JSON responses", () => {
  const content = JSON.stringify({
    name: "read_file",
    arguments: { path: "src/main.ts" },
  });

  assert.equal(looksLikeToolCallOnly(content), true);
  assert.equal(isFinalAnswer(content, []), false);
});

test("isFinalAnswer accepts normal assistant text", () => {
  const content = "Auth is handled in src/auth/service.ts.";

  assert.equal(isFinalAnswer(content, []), true);
});
