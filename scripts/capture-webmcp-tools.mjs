#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionRoot = path.join(repositoryRoot, "apps", "web", "dist");
const outputPath = path.join(repositoryRoot, "docs", "evidence", "webmcp-tools.json");
const mediaTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function resolvePublicPath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://127.0.0.1").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = path.resolve(distributionRoot, relativePath);
  return candidate.startsWith(`${distributionRoot}${path.sep}`) ? candidate : null;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    const candidate = resolvePublicPath(request.url);
    if (!candidate) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) throw Object.assign(new Error("Not a file"), { code: "ENOENT" });
      const content = await fs.readFile(candidate);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mediaTypes.get(path.extname(candidate)) ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not resolve capture server");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

const { server, url } = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const registered = new Map();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        async registerTool(tool, options = {}) {
          if (registered.has(tool.name))
            throw new DOMException("Duplicate tool", "InvalidStateError");
          registered.set(tool.name, tool);
          options.signal?.addEventListener("abort", () => registered.delete(tool.name), {
            once: true,
          });
        },
        async getTools() {
          return [...registered.values()].sort((left, right) =>
            left.name.localeCompare(right.name),
          );
        },
      },
    });
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(async () => (await document.modelContext.getTools()).length === 8);
  const tools = await page.evaluate(async () =>
    (await document.modelContext.getTools()).map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  );
  const manifest = {
    schemaVersion: 1,
    generatedFromCommit: sourceCommit(),
    tools,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const vitePlus = path.join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vp.cmd" : "vp",
  );
  execFileSync(vitePlus, ["fmt", "docs/evidence/webmcp-tools.json"], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  console.log(
    `Captured ${tools.length} live WebMCP registrations from ${manifest.generatedFromCommit}.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
