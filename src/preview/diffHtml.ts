import type { DiffPreview } from "../core/types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLine(line: DiffPreview["lines"][number]): string {
  const oldNo =
    line.oldLineNumber !== undefined
      ? String(line.oldLineNumber).padStart(4, " ")
      : "    ";
  const newNo =
    line.newLineNumber !== undefined
      ? String(line.newLineNumber).padStart(4, " ")
      : "    ";

  return `<div class="diff-line ${line.type}">
    <span class="line-no">${oldNo}</span>
    <span class="line-no">${newNo}</span>
    <span class="sign">${line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}</span>
    <code>${escapeHtml(line.content) || " "}</code>
  </div>`;
}

export function renderDiffPage(preview: DiffPreview, previewId: string): string {
  const lines = preview.lines.map(renderLine).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Review change — ${escapeHtml(preview.path)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111111;
      --panel: #171717;
      --border: #2d2d2d;
      --text: #ececec;
      --muted: #9ca3af;
      --add-bg: rgba(34, 197, 94, 0.14);
      --add-text: #86efac;
      --remove-bg: rgba(239, 68, 68, 0.14);
      --remove-text: #fca5a5;
      --accept: #d97757;
      --accept-hover: #c9684a;
      --reject: #2a2a2a;
      --reject-hover: #3a3a3a;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    .shell {
      max-width: 980px;
      margin: 0 auto;
      padding: 24px 20px 40px;
    }

    .header {
      margin-bottom: 18px;
    }

    .eyebrow {
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      font-weight: 600;
    }

    .summary {
      color: var(--muted);
      font-size: 14px;
    }

    .file-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-bottom: none;
      border-radius: 10px 10px 0 0;
      background: var(--panel);
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .panel {
      border: 1px solid var(--border);
      border-radius: 0 12px 12px 12px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }

    .diff-scroll {
      overflow: auto;
      max-height: calc(100vh - 240px);
    }

    .diff-line {
      display: grid;
      grid-template-columns: 44px 44px 18px 1fr;
      gap: 8px;
      align-items: start;
      padding: 2px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.55;
      border-left: 3px solid transparent;
    }

    .diff-line.context {
      color: #cbd5e1;
      background: transparent;
    }

    .diff-line.add {
      background: var(--add-bg);
      color: var(--add-text);
      border-left-color: #22c55e;
    }

    .diff-line.remove {
      background: var(--remove-bg);
      color: var(--remove-text);
      border-left-color: #ef4444;
    }

    .line-no {
      color: var(--muted);
      text-align: right;
      user-select: none;
    }

    .sign {
      opacity: 0.8;
      user-select: none;
    }

    code {
      white-space: pre-wrap;
      word-break: break-word;
    }

    .actions {
      display: flex;
      gap: 12px;
      margin-top: 18px;
    }

    button {
      border: none;
      border-radius: 999px;
      padding: 12px 22px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .accept {
      background: var(--accept);
      color: #111;
    }

    .accept:hover { background: var(--accept-hover); }

    .reject {
      background: var(--reject);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .reject:hover { background: var(--reject-hover); }

    .status {
      margin-top: 14px;
      color: var(--muted);
      font-size: 13px;
      min-height: 18px;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <div class="eyebrow">code · Review change</div>
      <h1>${escapeHtml(preview.title)}</h1>
      <div class="summary">${escapeHtml(preview.summary)}</div>
    </div>

    <div class="file-tab">${escapeHtml(preview.path)}</div>
    <div class="panel">
      <div class="diff-scroll">
        ${lines || '<div class="diff-line context"><span></span><span></span><span></span><code>No visible changes</code></div>'}
      </div>
    </div>

    <div class="actions">
      <button class="accept" id="accept">Accept change</button>
      <button class="reject" id="reject">Reject</button>
    </div>
    <div class="status" id="status">Choose whether to apply this change.</div>
  </div>

  <script>
    const previewId = ${JSON.stringify(previewId)};

    async function decide(approved) {
      const status = document.getElementById("status");
      status.textContent = approved ? "Applying change..." : "Rejected.";

      document.getElementById("accept").disabled = true;
      document.getElementById("reject").disabled = true;

      await fetch("/api/preview/" + previewId + "/" + (approved ? "approve" : "reject"), {
        method: "POST",
      });

      status.textContent = approved
        ? "Accepted. You can return to the terminal."
        : "Rejected. You can return to the terminal.";
    }

    document.getElementById("accept").addEventListener("click", () => decide(true));
    document.getElementById("reject").addEventListener("click", () => decide(false));
  </script>
</body>
</html>`;
}
