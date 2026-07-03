import assert from "node:assert/strict";
import test from "node:test";

const { colors, formatUserLine, shouldUseColors } = await import(
  "../../src/core/terminal.js"
);

test("shouldUseColors is false when stdout is not a TTY", () => {
  assert.equal(shouldUseColors(), false);
});

test("formatUserLine returns plain text without color support", () => {
  assert.equal(formatUserLine("hello"), "You: hello");
  assert.equal(colors.green("test"), "test");
});
