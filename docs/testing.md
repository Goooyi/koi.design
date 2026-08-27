# Koi testing strategy

Status: working agreement, 2026-08-27.

## Decision summary

Koi will use real browsers and real input paths, but “human-like” does not mean replacing assertions with an AI watching screenshots. The reliable stack is layered:

1. Playwright Test is the deterministic regression and CI foundation.
2. Playwright CLI and its agent skills become the coding agent's routine browser interface once a runnable app exists.
3. Chrome DevTools MCP is the Chrome diagnostic, performance, memory, and native WebMCP interface.
4. Playwright's CDP session covers deterministic Chromium protocol gaps.
5. axe and Lighthouse add accessibility and performance checks.
6. Midscene is an advisory visual and desktop-host lane, never the only merge gate.
7. `captivus/chrome-agent` is deferred until a concrete multi-agent raw-CDP event-stream need appears.

Vitest remains useful for pure reducers and schemas, but it cannot prove that pan, drag, focus, iframe bridges, accessibility, painting, or WebMCP work in a browser.

## Tool choices

| Tool | Koi role | Why | Constraint |
| --- | --- | --- | --- |
| [Playwright Test](https://playwright.dev/docs/intro) | Stored end-to-end tests and CI | Real Chromium/Firefox/WebKit input, auto-waiting, role locators, traces, video, screenshots, iframe support, deterministic assertions | Visual baselines need pinned browser/OS/fonts |
| [Playwright CLI](https://playwright.dev/agent-cli/capabilities) | Routine agent exploration and reproduction | Named isolated sessions, accessibility snapshots, screenshots, traces, network inspection, and optional live human takeover | Exploratory commands are not stored regression assertions |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Autonomous diagnosis and exploratory testing | Input automation, screenshots, console/network, Lighthouse, Chrome traces, heap snapshots, and native `list_webmcp_tools` / `execute_webmcp_tool` | Chrome-only; browser contents are exposed to the MCP client |
| [Playwright CDP session](https://playwright.dev/docs/api/class-cdpsession) | Deterministic WebMCP protocol coverage | Invokes Chromium domains from the same test runner without building a custom driver | Tip-of-tree CDP is not a compatibility contract |
| [Midscene](https://github.com/web-infra-dev/midscene) | Nightly visual semantics and real desktop-host smoke | Screenshot-based location can inspect canvas, cross-origin iframe, and opaque native-host UI; desktop mode can use OS mouse/keyboard | Model-dependent, slower, less reproducible, and may send screenshots to a model provider |
| [chrome-agent](https://github.com/captivus/chrome-agent) | Deferred protocol probe | Lightweight raw CDP and multi-agent event subscriptions | No locators, assertions, reports, cross-browser runner, or actionability model |
| [axe with Playwright](https://playwright.dev/docs/accessibility-testing) | Accessibility regression checks | Catches machine-detectable violations after important UI states | Cannot understand painted Canvas pixels or replace manual review |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | Repeatable loading budgets | Automates multiple Lighthouse runs and reports regression | Canvas gesture performance needs Chrome traces and custom marks instead |

Chrome DevTools MCP is the right immediate installation for this empty repository because it helps development before a test package exists. Playwright CLI becomes the default exploration path and Playwright Test becomes a repository dependency as soon as the web scaffold and package manager exist. Midscene should enter only after deterministic golden journeys are working.

## Codex setup completed

[`.codex/config.toml`](../.codex/config.toml) pins Chrome DevTools MCP 1.8.0 and enables:

- isolated temporary browser profiles;
- headless operation suitable for SSH development;
- coordinate-based vision tools;
- heap/memory diagnostics;
- Chrome's experimental native WebMCP domain;
- disabled usage statistics and CrUX lookups;
- redacted network headers and bounded WebP screenshots.

The configuration uses Chrome's `--enable-features=WebMCP` flag. Chrome 150 or newer is required by the current DevTools MCP integration. Start a new Codex task or restart the app after configuration changes; MCP servers are not guaranteed to hot-load into an existing task.

Do not connect this tooling to a personal Chrome profile. Use isolated profiles and synthetic accounts. Treat screenshots, traces, video, storage state, heap snapshots, MCP results, and network logs as sensitive artifacts.

## Test layers

### 1. Domain contracts

Fast tests cover observable invariants in the command core:

- stable IDs and bounded operations;
- idempotent command replay;
- record- and field-level preconditions;
- delete versus stale update;
- one agent command per undo group;
- compensating undo;
- projection plus outbox atomicity;
- deterministic replay.

The same create, move, conflict, undo, and export scenario must produce equivalent domain results when entered through human UI, WebMCP, or MCP adapters.

### 2. Deterministic browser journeys

Playwright uses actual `mouse`, `keyboard`, `touchscreen`, and wheel events against the rendered application. Assertions observe both the visual result and Koi's public semantic state; tests do not call reducers directly to imitate interaction.

Required golden journeys are:

1. Create several Frames, pan, zoom, select, drag, resize, edit text, undo, reload, and observe the same Document.
2. A human performs a coordinate drag; an agent reads the exact moved Element and revision, then creates an alternative without changing human Camera or Selection.
3. An agent command conflicts with a newer human geometry edit, receives a structured failure, reinspects, and replans.
4. Export a Page to the portable Koi document and supported native web output, then reopen it.
5. Navigate by keyboard through canvas controls, Frames, text editing, dialogs, and undo history.

State and command-log assertions come first. Intentional screenshots then catch rendering regressions that state cannot express.

### 3. MCP App host tests

Run the official MCP Apps `basic-host` against the hosted HTTP adapter and assert:

- tool and `ui://` resource registration;
- sandboxed iframe initialization;
- View-to-host tool calls and results;
- host context, theme, display mode, and resize updates;
- cancellation, reconnect, CSP, and error states;
- handlers are registered before the View connects.

Local stdio still needs protocol integration tests and a release smoke test in each host Koi claims to support. The View is tested as disposable; persistence belongs to the MCP server's durable store.

### 4. Native WebMCP tests

CI unit tests may inject a small `document.modelContext` fake to prove Koi's adapter behavior, but passing them is not described as native compatibility.

A Chrome lane launches with WebMCP enabled and uses DevTools MCP or Playwright CDP to verify:

- stable top-level tool discovery and exact schemas;
- success, structured failure, cancellation, and oversized-batch rejection;
- registration removal after navigation/unmount;
- immediate read-after-local-write consistency;
- visible attribution and undo grouping;
- adversarial document labels are returned as untrusted data, never instructions;
- unsupported browsers retain the full human web app without fake compatibility.

Before a release, repeat the golden challenge journey in ChatGPT's built-in browser. That real-host smoke cannot be replaced by a mock.

### 5. Visual, accessibility, performance, and memory

Use a pinned Linux/browser/font image for exact screenshots. Use Midscene only for qualitative assertions such as “the selected Frame is visually obvious” or “the connector does not obscure its label.” When Midscene finds a concrete regression, add a deterministic test.

axe runs after every important application state. Because Canvas2D and WebGL pixels have no inherent accessibility tree, Koi must expose semantic Element navigation and descriptions in DOM.

Chrome performance traces cover representative fixtures:

- the six-Frame Paper exploration;
- one very tall Astryx foundations Frame;
- multiple live component Frames;
- dense connectors and committed ink;
- several visible and offscreen shader elements.

The initial camera acceptance criterion is a 60 Hz baseline: one camera style write per animation frame, no React commit caused by pan/zoom, and no avoidable layout or paint caused by the camera path. Budgets for live DOM, shader pixels, and ink density are set from measured fixture curves rather than Lighthouse's generic DOM warnings.

Heap tests open, edit, navigate away, and return repeatedly to catch retained Frames, observers, WebGL contexts, and event listeners.

## Failure evidence

Every browser failure should preserve enough evidence for an agent and a human to reconstruct the event:

- Playwright trace and action log;
- screenshot and video around the failure;
- console and relevant network requests;
- Koi command/event/outbox log with sensitive data removed;
- Chrome performance trace or heap snapshot for performance lanes;
- browser, viewport, device scale, fonts, locale, timezone, and feature flags.

No individual screenshot assertion, AI assertion, DOM snapshot, or state assertion is sufficient alone for the core collaborative journeys.

## Deferred installation

Once the application scaffold chooses its package manager, add pinned development dependencies for `@playwright/test`, `@axe-core/playwright`, and `@lhci/cli`, then install the three Playwright browser engines. Configure traces on first retry, one CI worker initially, reduced motion, fixed locale/timezone/color scheme, and a dedicated `chrome-webmcp` project.

Install a pinned `@playwright/cli` for agent exploration and install its official skills at that point. Keep exploratory CLI sessions separate per agent and use its live dashboard when human supervision or takeover is useful.

Add Midscene only for the advisory lane and decide its model/privacy boundary first. Do not add chrome-agent unless raw long-running CDP subscriptions across multiple agents become an observed requirement.
