#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { serveStaticDirectory } from "./lib/serve-static-directory.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionRoot = path.join(repositoryRoot, "apps", "web", "dist");
const outputRelativePath = "docs/evidence/webmcp-tools.json";
const outputPath = path.join(repositoryRoot, outputRelativePath);
const generatedEvidencePaths = ["docs/evidence/browser-audit.json", outputRelativePath];

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function assertAuditableSourceTree() {
  const statusWithoutEvidence = execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ...generatedEvidencePaths.map((file) => `:(exclude)${file}`),
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (statusWithoutEvidence) {
    throw new Error(
      `WebMCP evidence requires clean source inputs; commit or remove these changes:\n${statusWithoutEvidence}`,
    );
  }
  const dirtyGeneratedEvidence = generatedEvidencePaths.filter((file) =>
    Boolean(
      execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", file], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim(),
    ),
  );
  return { sourceInputsClean: true, dirtyGeneratedEvidenceBeforeCapture: dirtyGeneratedEvidence };
}

const generatedFromCommit = sourceCommit();
const sourceTree = assertAuditableSourceTree();
const server = await serveStaticDirectory(distributionRoot);
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
  await page.goto(server.url, { waitUntil: "networkidle" });
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
    generatedFromCommit,
    sourceTree,
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
  await server.close();
}
