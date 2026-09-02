#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, arguments_ = []) {
  try {
    return {
      available: true,
      output: execFileSync(command, arguments_, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      }).trim(),
    };
  } catch {
    return { available: false, output: null };
  }
}

function executableFile(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function majorMinorPatch(version) {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function atLeast(actual, required) {
  if (!actual) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] > required[index]) return true;
    if (actual[index] < required[index]) return false;
  }
  return true;
}

const git = run("git", ["--version"]);
const corepack = run("corepack", ["--version"]);
const pnpm = run("pnpm", ["--version"]);
const vitePlus = run(path.join(repositoryRoot, "node_modules", ".bin", "vp"), ["--version"]);
const playwright = run(path.join(repositoryRoot, "node_modules", ".bin", "playwright"), [
  "--version",
]);
const wrangler = run(path.join(repositoryRoot, "node_modules", ".bin", "wrangler"), ["--version"]);
const sqlite = run("sqlite3", ["--version"]);
const docker = run("docker", ["--version"]);
const ffprobe = run("ffprobe", ["-version"]);
const chromeCandidates =
  process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["google-chrome", "google-chrome-stable"];
const chrome = chromeCandidates
  .map((candidate) => run(candidate, ["--version"]))
  .find(({ available }) => available) ?? { available: false, output: null };
const bundledChromiumPath = chromium.executablePath();
const bundledChromium = executableFile(bundledChromiumPath);
const nodeVersion = process.version.slice(1);
const platformSupported = ["darwin", "linux"].includes(process.platform);
const architectureSupported = ["arm64", "x64"].includes(process.arch);
const status = run("git", ["status", "--porcelain=v1"]);
const branch = run("git", ["branch", "--show-current"]);
const head = run("git", ["rev-parse", "HEAD"]);
const remote = run("git", ["remote", "get-url", "origin"]);
const worktrees = run("git", ["worktree", "list", "--porcelain"]);

const requiredChecks = [
  { name: "git", pass: git.available, detail: git.output },
  {
    name: "node",
    pass: atLeast(majorMinorPatch(nodeVersion), [22, 18, 0]),
    detail: process.version,
  },
  { name: "corepack", pass: corepack.available, detail: corepack.output },
  { name: "pnpm", pass: pnpm.output === "11.21.0", detail: pnpm.output },
  { name: "vitePlus", pass: vitePlus.available, detail: vitePlus.output },
  { name: "playwright", pass: playwright.available, detail: playwright.output },
  { name: "bundledChromium", pass: bundledChromium, detail: bundledChromiumPath },
  { name: "stableChrome", pass: chrome.available, detail: chrome.output },
  { name: "wrangler", pass: wrangler.available, detail: wrangler.output },
  {
    name: "platform",
    pass: platformSupported && architectureSupported,
    detail: `${process.platform}/${process.arch}`,
  },
  {
    name: "cleanWorktree",
    pass: status.available && status.output === "",
    detail: status.output || "clean",
  },
];

const report = {
  schemaVersion: 1,
  ok: requiredChecks.every(({ pass }) => pass),
  requiredChecks,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  repository: {
    branch: branch.output,
    head: head.output,
    origin: remote.output,
    worktreeCount: worktrees.output?.split("\nworktree ").length ?? 0,
    status: status.output || "clean",
  },
  optionalOrLaterGateChecks: {
    sqlite: sqlite.output,
    docker: docker.output,
    ffprobe: ffprobe.output?.split("\n", 1)[0] ?? null,
    cloudflareAccountEnvironment: {
      CLOUDFLARE_ACCOUNT_ID: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID),
      CLOUDFLARE_API_TOKEN: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    },
    ownerInteractiveChecks: [
      "Wrangler account authentication or scoped CI credentials",
      "Chrome native WebMCP capability",
      "ChatGPT in-app browser access",
      "microphone and screen recording",
      "YouTube and Devpost accounts",
    ],
  },
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
