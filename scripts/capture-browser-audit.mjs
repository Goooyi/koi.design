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

const auditStartedAt = Date.now();
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distributionRoot = path.join(repositoryRoot, "apps", "web", "dist");
const evidenceRoot = path.join(repositoryRoot, "docs", "evidence");
const reportRelativePath = "docs/evidence/browser-audit.json";
const reportPath = path.join(repositoryRoot, reportRelativePath);
const tracePath = path.join(repositoryRoot, "test-results", "performance", "chrome-trace.json.gz");
const viewport = { width: 1_440, height: 900 };
const traceCategories = [
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.layers",
];

const fixedBudgets = {
  accessibilityViolations: 0,
  consoleAndPageErrors: 0,
  failedRequests: 0,
  httpErrors: 0,
  crossOriginResources: 0,
  hostConfigurationFailures: 0,
  instrumentationFailures: 0,
  peakDomNodes: 300,
  peakDomElements: 24,
  peakMountedFrames: 4,
  farRightMountedFrames: 2,
  resetStateMismatch: 0,
  p95FrameIntervalMs: 34,
  frameIntervalsOver50MsPercent: 2,
  longTaskCount: 2,
  totalLongTaskMs: 150,
  longestTaskMs: 100,
  runTaskMaximumMs: 75,
  layoutTotalMs: 75,
  layoutMaximumMs: 8,
  updateLayoutTreeTotalMs: 75,
  updateLayoutTreeMaximumMs: 8,
  paintTotalMs: 100,
  paintMaximumMs: 8,
  ccActiveTreeLayerRecords: 200,
  idleTailReactCommits: 2,
  retainedDocuments: 0,
  retainedFrames: 0,
  retainedNodes: 25,
  retainedEventListeners: 25,
  retainedJsHeapBytes: 4 * 1_024 * 1_024,
  encodedResourceBytes: 2 * 1_024 * 1_024,
  finalJsHeapUsedBytes: 128 * 1_024 * 1_024,
  rawTraceBytes: 32 * 1_024 * 1_024,
  harnessRuntimeMs: 30_000,
};

function sourceCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function assertAuditableSourceTree() {
  const statusWithoutOutput = execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      `:(exclude)${reportRelativePath}`,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  if (statusWithoutOutput) {
    throw new Error(
      `Browser evidence requires clean source inputs; commit or remove these changes:\n${statusWithoutOutput}`,
    );
  }
  const priorOutputStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--", reportRelativePath],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).trim();
  return {
    sourceInputsClean: true,
    priorGeneratedReportDirty: Boolean(priorOutputStatus),
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function distribution(values) {
  return {
    count: values.length,
    min: round(values.length === 0 ? 0 : Math.min(...values)),
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(values.length === 0 ? 0 : Math.max(...values)),
    total: round(values.reduce((total, value) => total + value, 0)),
  };
}

function publicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol}`;
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

function selectedHeaders(headers) {
  return {
    cacheControl: headers["cache-control"] ?? null,
    contentSecurityPolicy: headers["content-security-policy"] ?? null,
    contentType: headers["content-type"] ?? null,
    crossOriginOpenerPolicy: headers["cross-origin-opener-policy"] ?? null,
    referrerPolicy: headers["referrer-policy"] ?? null,
    xContentTypeOptions: headers["x-content-type-options"] ?? null,
    xFrameOptions: headers["x-frame-options"] ?? null,
  };
}

async function inspectConfiguredHost(page, mainResponse, targetUrl, expectedBuildId) {
  if (!mainResponse) throw new Error("The challenge navigation returned no HTTP response");
  const assetPath =
    (await page.locator('script[src^="/assets/"]').first().getAttribute("src")) ??
    (await page.locator('link[href^="/assets/"]').first().getAttribute("href"));
  if (!assetPath) throw new Error("The challenge page does not reference a deployable asset");
  const [healthResponse, assetResponse, fallbackResponse] = await Promise.all([
    page.request.get(new URL("/health.json", targetUrl).href),
    page.request.get(new URL(assetPath, targetUrl).href),
    page.request.get(new URL("/__koi_spa_fallback_smoke", targetUrl).href),
  ]);
  const health = await healthResponse.json();
  const fallbackBody = await fallbackResponse.text();
  const observations = {
    root: {
      status: mainResponse.status(),
      headers: selectedHeaders(await mainResponse.allHeaders()),
    },
    health: {
      status: healthResponse.status(),
      headers: selectedHeaders(healthResponse.headers()),
      body: health,
    },
    asset: { status: assetResponse.status(), headers: selectedHeaders(assetResponse.headers()) },
    spaFallback: {
      status: fallbackResponse.status(),
      headers: selectedHeaders(fallbackResponse.headers()),
      servedApplicationShell: fallbackBody.includes('<div id="root"></div>'),
    },
  };
  const failures = [];
  if (observations.root.status !== 200) failures.push("root response is not 200");
  if (!observations.root.headers.contentSecurityPolicy?.includes("script-src 'self'")) {
    failures.push("root response is missing the deployed Content Security Policy");
  }
  if (observations.root.headers.xContentTypeOptions !== "nosniff") {
    failures.push("root response is missing X-Content-Type-Options: nosniff");
  }
  if (observations.root.headers.xFrameOptions !== "DENY") {
    failures.push("root response is missing X-Frame-Options: DENY");
  }
  if (!observations.root.headers.cacheControl?.includes("no-store")) {
    failures.push("root HTML is not served with Cache-Control: no-store");
  }
  if (observations.health.status !== 200 || observations.health.body.status !== "ok") {
    failures.push("health endpoint did not return the expected ok document");
  }
  if (observations.health.body.buildId !== expectedBuildId) {
    failures.push("health endpoint build ID differs from the audited commit");
  }
  if (!observations.health.headers.cacheControl?.includes("no-store")) {
    failures.push("health endpoint is not served with Cache-Control: no-store");
  }
  if (!observations.asset.headers.cacheControl?.includes("immutable")) {
    failures.push("content-hashed asset is not served as immutable");
  }
  if (observations.spaFallback.status !== 200 || !observations.spaFallback.servedApplicationShell) {
    failures.push("Cloudflare Pages SPA fallback did not serve the application shell");
  }
  return { failures, observations };
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
      domElements: document.querySelectorAll(".koi-dom-element").length,
      mountedFrames: document.querySelectorAll('[data-element-kind="frame"]').length,
      mountedFrameIds: [...document.querySelectorAll('[data-element-kind="frame"]')]
        .map((element) => element.getAttribute("data-element-id"))
        .sort((left, right) => (left ?? "").localeCompare(right ?? "")),
    }),
    label,
  );
}

async function panCanvas(page, box, swipes) {
  const samples = [];
  for (let swipe = 0; swipe < swipes; swipe += 1) {
    await page.mouse.move(box.x + box.width - 50, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    samples.push(await sampleCanvas(page, `pan-${swipe + 1}`));
  }
  return samples;
}

function metricMap(metrics) {
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
}

function metricDelta(before, after, name, scale = 1) {
  return round(((after[name] ?? 0) - (before[name] ?? 0)) * scale);
}

function eventDurationWithinWindow(event, start, end) {
  if (event.ph !== "X" || typeof event.ts !== "number" || typeof event.dur !== "number") return 0;
  const overlapStart = Math.max(start, event.ts);
  const overlapEnd = Math.min(end, event.ts + event.dur);
  return Math.max(0, overlapEnd - overlapStart) / 1_000;
}

function traceMetric(events, name, start, end) {
  const durations = events
    .filter((event) => event.name === name)
    .map((event) => eventDurationWithinWindow(event, start, end))
    .filter((duration) => duration > 0);
  return distribution(durations);
}

function summarizeTrace(rawTrace) {
  const parsed = JSON.parse(rawTrace.toString("utf8"));
  const events = parsed.traceEvents;
  if (!Array.isArray(events)) throw new Error("Chrome trace does not contain traceEvents");
  const start = events.find(
    (event) => event.name === "koi-perf-start" && Number.isFinite(event.ts),
  );
  const end = [...events]
    .reverse()
    .find((event) => event.name === "koi-perf-end" && Number.isFinite(event.ts));
  if (!start || !end || end.ts <= start.ts)
    throw new Error("Chrome trace is missing valid Koi marks");
  const rendererThread = events.find(
    (event) =>
      event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain",
  );
  if (!rendererThread) throw new Error("Chrome trace is missing the renderer-main thread marker");
  const rendererEvents = events.filter(
    (event) => event.pid === rendererThread.pid && event.tid === rendererThread.tid,
  );
  return {
    markerWindowMs: round((end.ts - start.ts) / 1_000),
    ccActiveTreeLayerRecords: distribution(
      events
        .filter((event) => event.name === "LayerTreeHostImpl:snapshot")
        .map((event) => event.args?.snapshot?.active_tree?.layers)
        .filter((layers) => Array.isArray(layers))
        .map((layers) => layers.length),
    ),
    rendererMain: {
      RunTask: traceMetric(rendererEvents, "RunTask", start.ts, end.ts),
      Layout: traceMetric(rendererEvents, "Layout", start.ts, end.ts),
      UpdateLayoutTree: traceMetric(rendererEvents, "UpdateLayoutTree", start.ts, end.ts),
      Paint: traceMetric(rendererEvents, "Paint", start.ts, end.ts),
    },
  };
}

function retainedCounters(before, after, performanceBefore, performanceAfter) {
  return {
    documents: Math.max(0, after.dom.documents - before.dom.documents),
    frames: Math.max(0, (performanceAfter.Frames ?? 0) - (performanceBefore.Frames ?? 0)),
    nodes: Math.max(0, after.dom.nodes - before.dom.nodes),
    eventListeners: Math.max(0, after.dom.jsEventListeners - before.dom.jsEventListeners),
    jsHeapBytes: Math.max(0, after.heap.usedSize - before.heap.usedSize),
  };
}

function resetMismatch(initial, reset) {
  return Number(
    initial.domNodes !== reset.domNodes ||
      initial.domElements !== reset.domElements ||
      initial.mountedFrames !== reset.mountedFrames ||
      initial.mountedFrameIds.join("\n") !== reset.mountedFrameIds.join("\n"),
  );
}

function makeBudgetResults(actual, maximums) {
  return Object.entries(maximums).map(([name, maximum]) => ({
    name,
    actual: actual[name],
    maximum,
    pass: actual[name] <= maximum,
  }));
}

const generatedFromCommit = sourceCommit();
const sourceTree = assertAuditableSourceTree();
const configuredTarget = resolveAuditTarget();
const staticServer = configuredTarget ? null : await serveStaticDirectory(distributionRoot);
const targetUrl = configuredTarget ?? staticServer.url;
const targetScope = !configuredTarget
  ? "loopback-production-build"
  : new URL(targetUrl).protocol === "https:"
    ? "deployed-https"
    : "pages-emulator";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    const audit = {
      allReactCommits: [],
      frameIntervals: [],
      longTasks: [],
      reactCommits: [],
      lastFrame: null,
      longTaskObserverSupported: PerformanceObserver.supportedEntryTypes.includes("longtask"),
      recording: false,
    };
    Object.defineProperty(window, "__koiBrowserAudit", { value: audit });
    if (audit.longTaskObserverSupported) {
      new PerformanceObserver((entries) => {
        if (!audit.recording) return;
        for (const entry of entries.getEntries()) audit.longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    }
    let nextRendererId = 0;
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      value: {
        supportsFiber: true,
        renderers: new Map(),
        inject(renderer) {
          nextRendererId += 1;
          this.renderers.set(nextRendererId, renderer);
          return nextRendererId;
        },
        onCommitFiberRoot() {
          const timestamp = performance.now();
          audit.allReactCommits.push(timestamp);
          if (audit.recording) audit.reactCommits.push(timestamp);
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
      },
    });
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
    client.send("HeapProfiler.enable"),
    client.send("LayerTree.enable"),
    client.send("Performance.enable"),
  ]);
  const mainResponse = await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: /Explorations infinite canvas/ }).waitFor();
  await page.getByText("Challenge demo · browser-local", { exact: true }).waitFor();
  await page.getByTestId("koi-build-identifier").waitFor();
  if ((await page.getByRole("button", { name: "Connect hosting" }).count()) !== 0) {
    throw new Error("The challenge deployment unexpectedly exposes the self-host connection flow");
  }
  const hostInspection = configuredTarget
    ? await inspectConfiguredHost(page, mainResponse, targetUrl, generatedFromCommit)
    : { failures: [], observations: null };
  await page.getByRole("button", { name: /^Hand/ }).click();
  const canvas = page.getByRole("region", { name: /infinite canvas/ });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The canvas has no measurable browser bounds");

  // Warm the camera/virtualization path before measuring it.
  await panCanvas(page, box, 2);
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.locator('[data-element-id="frame-brief"]').waitFor();
  await settleAnimationFrames(page, 15);
  const initialSample = await sampleCanvas(page, "initial-after-warmup");
  await client.send("HeapProfiler.collectGarbage");
  const memoryBefore = {
    dom: await client.send("Memory.getDOMCounters"),
    heap: await client.send("Runtime.getHeapUsage"),
  };
  const performanceBefore = metricMap((await client.send("Performance.getMetrics")).metrics);

  await client.send("Tracing.start", {
    categories: traceCategories.join(","),
    options: "record-as-much-as-possible",
    transferMode: "ReturnAsStream",
  });
  await settleAnimationFrames(page, 15);
  const instrumentationBefore = await page.evaluate(() => ({
    initialReactCommits: window.__koiBrowserAudit.allReactCommits.length,
    longTaskObserverSupported: window.__koiBrowserAudit.longTaskObserverSupported,
  }));
  await page.evaluate(() => {
    const audit = window.__koiBrowserAudit;
    audit.frameIntervals.length = 0;
    audit.longTasks.length = 0;
    audit.reactCommits.length = 0;
    audit.recording = true;
    performance.mark("koi-perf-start");
  });

  const panSamples = await panCanvas(page, box, 3);
  await page.locator('[data-element-id="frame-gpu"]').waitFor();
  await page.locator('[data-element-id="frame-brief"]').waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.locator('[data-element-id="frame-brief"]').waitFor();
  const resetSample = await sampleCanvas(page, "reset");
  await settleAnimationFrames(page, 15);
  const browserTiming = await page.evaluate(() => {
    performance.mark("koi-perf-end");
    const audit = window.__koiBrowserAudit;
    audit.recording = false;
    return {
      endedAt: performance.now(),
      frameIntervals: [...audit.frameIntervals],
      longTasks: [...audit.longTasks],
      reactCommits: [...audit.reactCommits],
    };
  });
  const performanceAfter = metricMap((await client.send("Performance.getMetrics")).metrics);

  const traceComplete = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.end");
  const { stream } = await traceComplete;
  if (!stream) throw new Error("Chrome completed tracing without returning a stream");
  const rawTrace = await readTrace(client, stream);
  const traceSummary = summarizeTrace(rawTrace);
  const compressedTrace = gzipSync(rawTrace, { level: 9 });
  await fs.mkdir(path.dirname(tracePath), { recursive: true });
  await fs.writeFile(tracePath, compressedTrace);

  await client.send("HeapProfiler.collectGarbage");
  const memoryAfter = {
    dom: await client.send("Memory.getDOMCounters"),
    heap: await client.send("Runtime.getHeapUsage"),
  };
  const performanceAfterGc = metricMap((await client.send("Performance.getMetrics")).metrics);
  const retained = retainedCounters(
    memoryBefore,
    memoryAfter,
    performanceBefore,
    performanceAfterGc,
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
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

  const instrumentationFailures = [];
  if (!instrumentationBefore.longTaskObserverSupported) {
    instrumentationFailures.push("Chrome did not expose PerformanceObserver longtask entries");
  }
  if (instrumentationBefore.initialReactCommits === 0) {
    instrumentationFailures.push("The React commit hook was not observed during application load");
  }
  for (const [name, metric] of Object.entries(traceSummary.rendererMain)) {
    if (metric.count === 0) instrumentationFailures.push(`Chrome trace did not contain ${name}`);
  }
  if (traceSummary.ccActiveTreeLayerRecords.count === 0) {
    instrumentationFailures.push("Chrome trace did not contain compositor layer snapshots");
  }

  const canvasSamples = [initialSample, ...panSamples, resetSample];
  const farRightSample = panSamples.at(-1);
  if (!farRightSample)
    throw new Error("The performance journey did not produce a far-right sample");
  const frameDistribution = distribution(browserTiming.frameIntervals);
  const longTaskDistribution = distribution(browserTiming.longTasks);
  const idleTailReactCommits = browserTiming.reactCommits.filter(
    (timestamp) => timestamp >= browserTiming.endedAt - 250,
  ).length;
  const maximums = {
    ...fixedBudgets,
    reactCommits: Math.ceil(traceSummary.markerWindowMs / 64) + 8,
  };
  const actual = {
    accessibilityViolations: accessibility.violations.length,
    consoleAndPageErrors: consoleAndPageErrors.length,
    failedRequests: failedRequests.length,
    httpErrors: httpErrors.length,
    crossOriginResources: resourceSummary.crossOrigin.length,
    hostConfigurationFailures: hostInspection.failures.length,
    instrumentationFailures: instrumentationFailures.length,
    peakDomNodes: Math.max(...canvasSamples.map((sample) => sample.domNodes)),
    peakDomElements: Math.max(...canvasSamples.map((sample) => sample.domElements)),
    peakMountedFrames: Math.max(...canvasSamples.map((sample) => sample.mountedFrames)),
    farRightMountedFrames: farRightSample.mountedFrames,
    resetStateMismatch: resetMismatch(initialSample, resetSample),
    p95FrameIntervalMs: frameDistribution.p95,
    frameIntervalsOver50MsPercent: round(
      (browserTiming.frameIntervals.filter((duration) => duration > 50).length /
        Math.max(1, browserTiming.frameIntervals.length)) *
        100,
    ),
    longTaskCount: longTaskDistribution.count,
    totalLongTaskMs: longTaskDistribution.total,
    longestTaskMs: longTaskDistribution.max,
    runTaskMaximumMs: traceSummary.rendererMain.RunTask.max,
    layoutTotalMs: traceSummary.rendererMain.Layout.total,
    layoutMaximumMs: traceSummary.rendererMain.Layout.max,
    updateLayoutTreeTotalMs: traceSummary.rendererMain.UpdateLayoutTree.total,
    updateLayoutTreeMaximumMs: traceSummary.rendererMain.UpdateLayoutTree.max,
    paintTotalMs: traceSummary.rendererMain.Paint.total,
    paintMaximumMs: traceSummary.rendererMain.Paint.max,
    ccActiveTreeLayerRecords: traceSummary.ccActiveTreeLayerRecords.max,
    reactCommits: browserTiming.reactCommits.length,
    idleTailReactCommits,
    retainedDocuments: retained.documents,
    retainedFrames: retained.frames,
    retainedNodes: retained.nodes,
    retainedEventListeners: retained.eventListeners,
    retainedJsHeapBytes: retained.jsHeapBytes,
    encodedResourceBytes: resourceSummary.encodedBodyBytes,
    finalJsHeapUsedBytes: memoryAfter.heap.usedSize,
    rawTraceBytes: rawTrace.byteLength,
    harnessRuntimeMs: Date.now() - auditStartedAt,
  };
  const budgetResults = makeBudgetResults(actual, maximums);
  const report = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    generatedFromCommit,
    sourceTree,
    fixture: {
      id: "stage1-welcome-document",
      documentId: "welcome-document",
      frameCount: 4,
      elementCount: 22,
      interaction: "warm up, then pan three times to the far-right Frame and reset the camera",
      viewport,
      claimScope: "Stage 1 demo regression sentinel; not a general canvas-capacity claim",
    },
    environment: {
      url: publicUrl(targetUrl),
      scope: targetScope,
      browser: browser.version(),
      node: process.version,
      playwright: "1.62.1",
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
    hostConfiguration: hostInspection,
    instrumentation: {
      failures: instrumentationFailures,
      initialReactCommits: instrumentationBefore.initialReactCommits,
      compositorLayers: {
        eventCount: layerTreeEventCount,
        maximum: layerTreeEventCount === 0 ? null : maxLayerCount,
      },
    },
    rendering: {
      canvasSamples,
      markerWindowMs: traceSummary.markerWindowMs,
      frameIntervalsMs: frameDistribution,
      frameIntervalsOver50MsPercent: actual.frameIntervalsOver50MsPercent,
      longTasksMs: longTaskDistribution,
      reactCommits: {
        total: browserTiming.reactCommits.length,
        idleTail250Ms: idleTailReactCommits,
      },
      rendererMainTraceEvents: traceSummary.rendererMain,
      ccActiveTreeLayerRecords: traceSummary.ccActiveTreeLayerRecords,
    },
    memory: {
      before: memoryBefore,
      after: memoryAfter,
      retained,
    },
    performanceMetricDeltas: {
      LayoutCount: metricDelta(performanceBefore, performanceAfter, "LayoutCount"),
      RecalcStyleCount: metricDelta(performanceBefore, performanceAfter, "RecalcStyleCount"),
      LayoutDurationMs: metricDelta(performanceBefore, performanceAfter, "LayoutDuration", 1_000),
      RecalcStyleDurationMs: metricDelta(
        performanceBefore,
        performanceAfter,
        "RecalcStyleDuration",
        1_000,
      ),
      ScriptDurationMs: metricDelta(performanceBefore, performanceAfter, "ScriptDuration", 1_000),
      TaskDurationMs: metricDelta(performanceBefore, performanceAfter, "TaskDuration", 1_000),
    },
    resources: {
      ...resourceSummary,
      crossOrigin: resourceSummary.crossOrigin.map((url) => publicUrl(url)),
    },
    trace: {
      categories: traceCategories,
      localPath: path.relative(repositoryRoot, tracePath),
      rawTracePublished: false,
      rawBytes: rawTrace.byteLength,
      compressedBytes: compressedTrace.byteLength,
      sha256: createHash("sha256").update(compressedTrace).digest("hex"),
    },
    budgets: budgetResults,
    passed: budgetResults.every(({ pass }) => pass),
  };
  await fs.mkdir(evidenceRoot, { recursive: true });
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
    `Browser audit passed ${budgetResults.length} budgets; local trace ${compressedTrace.byteLength} bytes compressed.`,
  );
} finally {
  await browser.close();
  await staticServer?.close();
}
