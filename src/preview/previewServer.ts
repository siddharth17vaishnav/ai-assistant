import http from "http";
import { exec } from "child_process";
import { randomUUID } from "crypto";

import { config } from "../core/config.js";
import type { DiffPreview } from "../core/types.js";
import { renderDiffPage } from "./diffHtml.js";

interface PendingPreview {
  preview: DiffPreview;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

let server: http.Server | null = null;
let serverStartPromise: Promise<void> | null = null;
const pending = new Map<string, PendingPreview>();

function openBrowser(url: string) {
  const platform = process.platform;

  if (platform === "win32") {
    exec(`start "" "${url}"`);
    return;
  }

  if (platform === "darwin") {
    exec(`open "${url}"`);
    return;
  }

  exec(`xdg-open "${url}"`);
}

async function ensureServer(): Promise<void> {
  if (server) return;

  if (!serverStartPromise) {
    serverStartPromise = new Promise((resolve, reject) => {
      server = http.createServer(async (req, res) => {
        try {
          await handleRequest(req, res);
        } catch (error) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(error instanceof Error ? error.message : "Server error");
        }
      });

      server.listen(config.preview.port, config.preview.host, () => resolve());

      server.on("error", reject);
    });
  }

  await serverStartPromise;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = new URL(req.url ?? "/", `http://${config.preview.host}`);

  if (req.method === "GET" && url.pathname === "/preview") {
    const id = url.searchParams.get("id");
    const entry = id ? pending.get(id) : undefined;

    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Preview expired or not found.");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDiffPage(entry.preview, id!));
    return;
  }

  const actionMatch = url.pathname.match(/^\/api\/preview\/([^/]+)\/(approve|reject)$/);

  if (req.method === "POST" && actionMatch) {
    const [, id, action] = actionMatch;
    const entry = pending.get(id);

    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }

    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve(action === "approve");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

export async function requestWebPreviewApproval(
  preview: DiffPreview,
): Promise<boolean> {
  await ensureServer();

  const id = randomUUID();
  const url = `http://${config.preview.host}:${config.preview.port}/preview?id=${id}`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Preview timed out."));
    }, config.preview.timeoutMs);

    pending.set(id, { preview, resolve, timer });

    openBrowser(url);
  });
}

export async function shutdownPreviewServer() {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve(false);
  }

  pending.clear();

  if (!server) return;

  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
  });

  server = null;
  serverStartPromise = null;
}
