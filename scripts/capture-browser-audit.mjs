#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "@playwright/test";

import { serveStaticDirectory } from "./lib/serve-static-directory.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionRoot = path.join(repositoryRoot, "apps", "web", "dist");
const evidenceRoot = path.join(repositoryRoot, "docs", "evidence");
const reportPath = path.join(evidenceRoot, "browser-audit.json");
const tracePath = path.join(evidenceRoot, "performance-trace.json.gz");
const viewport = { width: 1_440, height: 900 };

const budgets = {
  accessibilityViolations: 0,
  consoleAndPageErrors: 0,
  failedRequests: 0,
  httpErrors: 0,
  crossOriginResources: 0,
  domNodes: 5_000,
  mountedFrames: 8,
  p95FrameIntervalMs: 100,
  longestTaskMs: 250,
  encodedResourceBytes: 2 * 1_024 * 1_024,
  jsHeapUsedBytes: 128 * 1_024 * 1_024,
  compressedTraceBytes: 4 * 1_024 * 1_024,
};

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function distribution(values) {
  return {
    count: values.length,
    min: values.length === 0 ? 0 : Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? 0 : Math.max(...values),
  };
}

function publicUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

function resolveAuditTarget() {
  const configured = process.env.KOI_AUDIT_URL?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  if (url.username || url.password) throw new Error("KOI_AUDIT_URL must not contain credentials");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("KOI_AUDIT_URL must use HTTPS unless it is a loopback URL");
  }
  return url.href;
}

async function readTrace(client, handle) {
  const chunks = [];
  try {
    for (;;) {
      const chunk = await client.send("IO.read", { handle, size: 1_048_576 });
      chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
      if (chunk.eof) break;
    }
  } finally {
    await client.send("IO.close", { handle });
  }
  return Buffer.concat(chunks);
}

async function settleAnimationFrames(page, count = 3) {
  await page.evaluate(
    (frameCount) =>
      new Promise((resolve) => {
        let remaining = frameCount;
        const tick = () => {
          remaining -= 1;
          if (remaining === 0) resolve(undefined);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    count,
  );
}

async function sampleCanvas(page, label) {
  await settleAnimationFrames(page);
  return page.evaluate(
    (sampleLabel) => ({
      label: sampleLabel,
      domNodes: document.querySelectorAll("*").length,
      mountedFrames: document.querySelectorAll('[data-element-kind="frame"]').length,
      mountedFrameIds: [...document.querySelectorAll('[data-element-kind="frame"]')].map(
        (element) => element.getAttribute("data-element-id"),
      ),
    }),
    label,
  );
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function makeBudgetResults(actual) {
  return Object.entries(budgets).map(([name, maximum]) => ({
    name,
    actual: actual[name],
    maximum,
    pass: actual[name] <= maximum,
  }));
}

const configuredTarget = resolveAuditTarget();
const staticServer = configuredTarget ? null : await serveStaticDirectory(distributionRoot);
const targetUrl = configuredTarget ?? staticServer.url;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    const audit = {
      frameIntervals: [],
      longTasks: [],
      lastFrame: null,
      recording: false,
    };
    Object.defineProperty(window, "__koiBrowserAudit", { value: audit });
    new PerformanceObserver((entries) => {
      if (!audit.recording) return;
      for (const entry of entries.getEntries()) audit.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
    const tick = (timestamp) => {
      if (audit.recording) {
        if (audit.lastFrame !== null) audit.frameIntervals.push(timestamp - audit.lastFrame);
        audit.lastFrame = timestamp;
      } else {
        audit.lastFrame = null;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const consoleAndPageErrors = [];
  const failedRequests = [];
  const httpErrors = [];
  let layerTreeEventCount = 0;
  let maxLayerCount = 0;

  page.on("console", (message) => {
    if (message.type() === "error") consoleAndPageErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleAndPageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: publicUrl(request.url()),
      error: request.failure()?.errorText ?? "request failed",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpErrors.push({ url: publicUrl(response.url()), status: response.status() });
    }
  });
  client.on("LayerTree.layerTreeDidChange", ({ layers }) => {
    layerTreeEventCount += 1;
    maxLayerCount = Math.max(maxLayerCount, layers?.length ?? 0);
  });

  await Promise.all([
    client.send("LayerTree.enable"),
    client.send("Performance.enable"),
    client.send("Tracing.start", {
      categories: [
        "blink.user_timing",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "loading",
      ].join(","),
      options: "record-as-much-as-possible",
      transferMode: "ReturnAsStream",
    }),
  ]);
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: /Explorations infinite canvas/ }).waitFor();
  const canvasSamples = [await sampleCanvas(page, "initial")];

  await page.evaluate(() => {
    window.__koiBrowserAudit.frameIntervals.length = 0;
    window.__koiBrowserAudit.longTasks.length = 0;
    window.__koiBrowserAudit.recording = true;
  });
  await page.getByRole("button", { name: /^Hand/ }).click();
  const canvas = page.getByRole("region", { name: /infinite canvas/ });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The canvas has no measurable browser bounds");
  for (let swipe = 0; swipe < 2; swipe += 1) {
    await page.mouse.move(box.x + box.width - 50, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    canvasSamples.push(await sampleCanvas(page, `pan-${swipe + 1}`));
  }
  await page.locator('[data-element-id="frame-gpu"]').waitFor();
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.locator('[data-element-id="frame-brief"]').waitFor();
  canvasSamples.push(await sampleCanvas(page, "reset"));
  const browserTiming = await page.evaluate(() => {
    window.__koiBrowserAudit.recording = false;
    return {
      frameIntervals: [...window.__koiBrowserAudit.frameIntervals],
      longTasks: [...window.__koiBrowserAudit.longTasks],
    };
  });

  const cdpMetrics = metricMap((await client.send("Performance.getMetrics")).metrics);
  const resourceSummary = await page.evaluate(() => {
    const resources = [
      ...performance.getEntriesByType("navigation"),
      ...performance.getEntriesByType("resource"),
    ];
    const currentOrigin = location.origin;
    const crossOrigin = resources
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          return new URL(name).origin !== currentOrigin;
        } catch {
          return false;
        }
      });
    return {
      count: resources.length,
      encodedBodyBytes: resources.reduce((total, entry) => total + (entry.encodedBodySize ?? 0), 0),
      transferBytes: resources.reduce((total, entry) => total + (entry.transferSize ?? 0), 0),
      crossOrigin,
    };
  });

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const traceComplete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.end");
  const { stream } = await traceComplete;
  if (!stream) throw new Error("Chromium completed tracing without returning a stream");
  const rawTrace = await readTrace(client, stream);
  const compressedTrace = gzipSync(rawTrace, { level: 9 });
  await fs.mkdir(evidenceRoot, { recursive: true });
  await fs.writeFile(tracePath, compressedTrace);

  const frameDistribution = distribution(browserTiming.frameIntervals);
  const longTaskDistribution = distribution(browserTiming.longTasks);
  const actual = {
    accessibilityViolations: accessibility.violations.length,
    consoleAndPageErrors: consoleAndPageErrors.length,
    failedRequests: failedRequests.length,
    httpErrors: httpErrors.length,
    crossOriginResources: resourceSummary.crossOrigin.length,
    domNodes: Math.max(...canvasSamples.map((sample) => sample.domNodes)),
    mountedFrames: Math.max(...canvasSamples.map((sample) => sample.mountedFrames)),
    p95FrameIntervalMs: frameDistribution.p95,
    longestTaskMs: longTaskDistribution.max,
    encodedResourceBytes: resourceSummary.encodedBodyBytes,
    jsHeapUsedBytes: cdpMetrics.JSHeapUsedSize ?? 0,
    compressedTraceBytes: compressedTrace.byteLength,
  };
  const budgetResults = makeBudgetResults(actual);
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    generatedFromCommit: sourceCommit(),
    fixture: {
      id: "stage1-welcome-document",
      interaction: "load, pan twice to distant Frames, reset camera",
      viewport,
    },
    environment: {
      url: publicUrl(targetUrl),
      scope: configuredTarget ? "deployed-https" : "loopback-production-build",
      browser: browser.version(),
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
    },
    accessibility: {
      standard: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      violations: accessibility.violations.map(
        ({ id, impact, description, help, helpUrl, nodes }) => ({
          id,
          impact,
          description,
          help,
          helpUrl,
          nodeCount: nodes.length,
        }),
      ),
      passes: accessibility.passes.length,
      incomplete: accessibility.incomplete.map(
        ({ id, impact, description, help, helpUrl, nodes }) => ({
          id,
          impact,
          description,
          help,
          helpUrl,
          nodeCount: nodes.length,
        }),
      ),
    },
    reliability: { consoleAndPageErrors, failedRequests, httpErrors },
    rendering: {
      canvasSamples,
      compositorLayers: {
        eventCount: layerTreeEventCount,
        maximum: layerTreeEventCount === 0 ? null : maxLayerCount,
      },
      frameIntervalsMs: frameDistribution,
      longTasksMs: longTaskDistribution,
    },
    resources: {
      ...resourceSummary,
      crossOrigin: resourceSummary.crossOrigin.map((url) => publicUrl(url)),
    },
    cdpMetrics,
    trace: {
      path: path.relative(repositoryRoot, tracePath),
      rawBytes: rawTrace.byteLength,
      compressedBytes: compressedTrace.byteLength,
      sha256: createHash("sha256").update(compressedTrace).digest("hex"),
    },
    budgets: budgetResults,
    passed: budgetResults.every(({ pass }) => pass),
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const vitePlus = path.join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vp.cmd" : "vp",
  );
  execFileSync(vitePlus, ["fmt", path.relative(repositoryRoot, reportPath)], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });

  if (!report.passed) {
    const failures = budgetResults
      .filter(({ pass }) => !pass)
      .map(({ name, actual: measured, maximum }) => `${name}: ${measured} > ${maximum}`)
      .join(", ");
    throw new Error(`Browser audit exceeded its Stage 1 budgets: ${failures}`);
  }
  console.log(
    `Browser audit passed ${budgetResults.length} budgets; trace ${compressedTrace.byteLength} bytes compressed.`,
  );
} finally {
  await browser.close();
  await staticServer?.close();
}
