#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionRoot = path.join(repositoryRoot, "apps", "web", "dist");
const maximumFiles = 20_000;
const maximumFileBytes = 25 * 1_024 * 1_024;

function git(...arguments_) {
  return execFileSync("git", arguments_, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(absolutePath)));
    else if (entry.isFile()) files.push(absolutePath);
  }
  return files;
}

async function read(relativePath) {
  return fs.readFile(path.join(distributionRoot, relativePath), "utf8");
}

function requireText(source, expected, file) {
  if (!source.includes(expected)) throw new Error(`${file} is missing ${JSON.stringify(expected)}`);
}

const dirty = git("status", "--porcelain=v1");
if (dirty && process.env.KOI_ALLOW_DIRTY_STANDALONE_BUILD !== "1") {
  throw new Error("Standalone verification requires a clean Git worktree");
}

const files = await listFiles(distributionRoot);
if (files.length > maximumFiles) {
  throw new Error(`Cloudflare Pages file limit exceeded: ${files.length} > ${maximumFiles}`);
}
let totalBytes = 0;
let largestFile = { path: "", bytes: 0 };
for (const file of files) {
  const stat = await fs.stat(file);
  totalBytes += stat.size;
  if (stat.size > largestFile.bytes) {
    largestFile = { path: path.relative(distributionRoot, file), bytes: stat.size };
  }
  if (stat.size > maximumFileBytes) {
    throw new Error(`${path.relative(distributionRoot, file)} exceeds the 25 MiB Pages limit`);
  }
  if (file.endsWith(".map")) throw new Error("Standalone output must not publish source maps");
}

const relativeFiles = new Set(files.map((file) => path.relative(distributionRoot, file)));
for (const required of [
  "_headers",
  "health.json",
  "index.html",
  "NOTICE.txt",
  "llms.txt",
  "robots.txt",
]) {
  if (!relativeFiles.has(required)) throw new Error(`Standalone output is missing ${required}`);
}
if (relativeFiles.has("404.html")) {
  throw new Error("A top-level 404.html would disable Cloudflare Pages' default SPA fallback");
}

const commit = git("rev-parse", "HEAD");
const health = JSON.parse(await read("health.json"));
if (
  health.status !== "ok" ||
  health.deploymentMode !== "standalone" ||
  health.buildId !== commit ||
  typeof health.version !== "string"
) {
  throw new Error("health.json does not identify this exact standalone commit and version");
}

const html = await read("index.html");
const assetReferences = [...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)"/g)].map(
  (match) => match[1],
);
if (assetReferences.length < 2) throw new Error("index.html is missing hashed JS/CSS assets");
for (const asset of assetReferences) {
  if (!/[-_][A-Za-z0-9_-]{8}\.(?:css|js)$/.test(asset)) {
    throw new Error(`Standalone asset is not content-hashed: ${asset}`);
  }
  if (!relativeFiles.has(asset)) throw new Error(`index.html references missing asset ${asset}`);
}

const headers = await read("_headers");
for (const requirement of [
  "Content-Security-Policy:",
  "Cross-Origin-Opener-Policy: same-origin",
  "Referrer-Policy: no-referrer",
  "X-Content-Type-Options: nosniff",
  "X-Frame-Options: DENY",
  "Cache-Control: no-store",
  "Cache-Control: public, max-age=31556952, immutable",
]) {
  requireText(headers, requirement, "_headers");
}
const headerRules = headers.split("\n").filter((line) => line && !/^\s/.test(line));
if (headerRules.length > 100) throw new Error("_headers exceeds the Cloudflare Pages rule limit");
for (const line of headers.split("\n")) {
  if (line.length > 2_000) throw new Error("_headers contains a line above the Pages limit");
}

console.log(
  JSON.stringify(
    {
      buildId: commit,
      deploymentMode: health.deploymentMode,
      version: health.version,
      files: files.length,
      totalBytes,
      largestFile,
      hashedAssets: assetReferences,
      csp: true,
      spaFallback: "Cloudflare Pages default (no top-level 404.html)",
      worktree: dirty ? "dirty override" : "clean",
    },
    null,
    2,
  ),
);
