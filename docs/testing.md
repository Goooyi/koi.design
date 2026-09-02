# Koi testing strategy

Status: implemented Stage 1 release candidate and remaining live-host backlog, 2026-09-02.

## Current evidence

Koi's deterministic baseline is implemented and runs within bounded resources:

- Vitest covers the document schema, all nine Element kinds, command atomicity, idempotency,
  preconditions, delete/restore, compensating undo, the 64-Command outbox and 50,000-Command history
  boundaries, fixed-zero rotation, serialization, spatial queries, Astryx registry safety, editor
  store/camera behavior, bounded WebMCP previews and model exports, MCP tools/View ordering,
  animation-frame coalescing, awaited WebMCP durability, hosted outbox replay/checkpoints/conflict
  stops, same-ID host-switch collision protection, byte-identical hosted publish retry,
  outcome-unknown retention/reconciliation and source interaction locking, durable stdio
  restart/idempotency/admission/bounds, hosted cursor reconstruction, REST persistence/security/SSE,
  and hosted MCP authentication, body, batch, read-admission, and mutation-failure bounds.
- A real MCP SDK client negotiates with the stdio server through an in-memory transport, discovers
  the app-only chunk tool, reconstructs a Projection above the direct snapshot boundary, verifies
  every result stays bounded, and retrieves the self-contained UI resource. View tests cover
  paginated assembly, malformed and tampered chunks, mid-transfer changes, host-delivered large
  import results, snapshot-free apply refresh deduplication, preserved acknowledgements when refresh
  fails, and committed-import recovery when the Projection changes before the first or second
  chunk. Deterministic coordination tests also cover exact retry after a commit-then-transport
  failure, preserving optimistic state after two unconfirmed transport attempts, and retaining the
  interaction lock until an authoritative reconciliation. Separate file-repository tests restart
  the repository and verify concurrent command serialization, fail-fast mutation and read
  admission, admission release, command and import replay, corruption refusal, file permissions,
  rollback at the storage limit, syncing newly created path ancestry, and withholding initialization
  or a renamed command/import until its pending directory sync is confirmed. The SDK client also
  observes structured retryable failures from
  all four read tools when admission is full.
- An official Streamable HTTP client exercises a real localhost server through initialize,
  tool/resource discovery, open, apply, import, and restart persistence. The server suite also
  verifies hosted MCP authentication, one-message JSON-RPC admission, structured mutation
  pressure/storage failures, request bounds, post-rename durability and revision wake-up recovery,
  one request per HTTP socket, bounded connections, and stalled-socket destruction.
- Ten Playwright journeys use real pointer and keyboard input to verify bounded virtualized DOM,
  camera-driven visibility, drag persistence through IndexedDB, coherent Frame drag previews
  across DOM/SVG/connectors, focused shortcuts, Frame creation, pen input, text editing, preserving
  a human text draft across an agent update, durable authority-transition ordering, denied browser
  storage, the full `.koi.json` download path, zero automated WCAG A/AA violations, and a complete
  stale-agent conflict/reinspect/replan/reload sequence after a human Frame move.
- Playwright is fixed to one Chromium worker, 30-second test timeouts, video disabled, and traces
  and screenshots retained only on failure.
- `pnpm audit:browser` builds the production web artifact and uses one clean headless Chrome process
  to capture axe results, console/network failures, DOM and mounted-Frame samples, animation-frame
  and long-task distributions, React commit cadence, CDP/trace rendering metrics, compositor-layer
  records, and post-GC retention. The checked-in Stage 1 fixture passes all 35 declared budgets; see
  [`browser-audit.json`](evidence/browser-audit.json). The raw trace stays ignored because browser
  traces can contain sensitive implementation details; the report records its hash and sizes.
- An isolated native Chrome smoke discovered all eight WebMCP tools and executed bounded context
  and element-inspection calls without console or browser-issue errors. The full native mutation
  collaboration journey remains a release-backlog test.

Run the gates from the root:

```sh
pnpm doctor
pnpm build
pnpm check
pnpm test
pnpm test:e2e
pnpm challenge:verify
pnpm audit:browser
# Or run the aggregate gate:
pnpm ready
```

`pnpm check`, `pnpm test`, and `pnpm test:e2e` build workspace dependencies before their
respective checks, so no separate build is required on a clean checkout. `pnpm ready` builds once,
then runs format, lint, type, workspace test, and one-worker Chromium gates.

The current browser suite is a meaningful Stage 1 regression gate, not complete release evidence.
Deployed native WebMCP mutation journeys, manual accessibility checks, interactive third-party MCP
host smoke tests, and cross-browser coverage remain outstanding.

## Testing layers

1. **Domain contracts:** fast deterministic tests for persistent invariants and structured errors.
2. **Adapter contracts:** WebMCP, MCP, IndexedDB, and REST tests prove their mapping to semantic
   commands without faking pointer events.
3. **Browser journeys:** Playwright exercises actual rendered controls and input paths, then checks
   both visible results and durable behavior.
4. **Native protocol diagnostics:** Chrome DevTools MCP discovers and executes the browser's real
   WebMCP catalog and records console/network evidence.
5. **Accessibility and performance:** axe, Lighthouse, Chrome traces, and heap snapshots measure
   assembled-product behavior.
6. **Advisory visual testing:** Midscene may assess qualitative visual outcomes after deterministic
   gates exist; it is never the only merge gate.

## Testing tools

| Tool                      | Current role                                                | Status                                                           |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Vitest through Vite+      | Domain, adapter, component, and protocol tests              | Active                                                           |
| Playwright Test 1.62.1    | Stored Chromium journeys                                    | Active; Chromium only                                            |
| Playwright CLI skill      | Agent exploration and reproduction                          | Operator-local; verify in each agent environment                 |
| Chrome DevTools MCP 1.8.0 | Console, network, Lighthouse, traces, memory, native WebMCP | Pinned in project config; verify runtime access per environment  |
| axe Playwright 4.13.0     | Automated WCAG A/AA checks                                  | Active in E2E and browser audit                                  |
| Chrome trace + CDP        | Bounded production-build rendering/resource evidence        | Active through `pnpm audit:browser`                              |
| Lighthouse CI             | Repeatable load budgets                                     | Planned; DevTools Lighthouse is available for manual diagnostics |
| Midscene                  | Model-assisted web/native-host visual smoke                 | Deferred until deterministic gaps are known                      |
| chrome-agent              | Raw multi-agent CDP subscriptions                           | Not adopted                                                      |

The project-scoped `.codex/config.toml` launches isolated headless Chrome with WebMCP enabled.
Never connect it to a personal Chrome profile or customer workspace. Screenshots, traces, storage
state, heap snapshots, MCP results, and network logs are sensitive artifacts.

## Required next journeys

Add stored regression coverage only for observable behavior or non-trivial boundaries:

1. A native Chrome WebMCP agent inspects a human drag, creates an alternative, and leaves Camera
   and Selection unchanged.
2. A complete `.koi.json` round-trip reopens in a fresh browser profile.
3. The browser connects to a real self-hosted server, persists a command, receives an authenticated
   SSE wake-up, and survives server restart.
4. An external MCP Apps host opens the iframe View, calls tools, handles theme/context changes,
   reconnects, and shows structured failures.
5. Keyboard-only navigation covers tools, canvas, Elements, editing, inspector, import/export, and
   undo.

Use the official MCP Apps basic host for View lifecycle coverage and repeat claimed host support in
the real host before release. Unit fakes prove adapter behavior; they are never described as native
compatibility.

## Performance and resource policy

Representative fixtures should include the six-Frame exploration, one very tall Astryx Frame,
multiple component studies, dense connectors/ink, and supported/offscreen Shader elements.

Measure:

- camera frame time, main-thread long tasks, React commits, layout, paint, and layer count;
- mounted Frame and DOM counts as the viewport moves;
- server body, connection, subscriber, queue, and storage limits;
- retained Frames, observers, event listeners, and future GPU resources after repeated navigation;
- supported, unavailable, and device-loss WebGPU states without loading a WebGL fallback.

The implemented camera coalesces the world-transform hot path to at most one write per animation
frame. Camera listeners also trigger a throttled React visibility commit at most once every 64 ms
and one refresh when a pointer pan ends; tests and traces must distinguish that intended
virtualization work from per-pointer React reconciliation. The Stage 1 welcome fixture now has a
bounded production-build baseline; it is a regression sentinel for that four-Frame fixture, not a
general canvas-capacity claim. Product budgets for live DOM, ink, shader pixels, and memory must
continue to come from measured fixture curves rather than generic Lighthouse DOM warnings.

## Failure evidence

A browser failure should preserve the Playwright trace/action log, a screenshot, console errors,
relevant network requests, and the Koi command/outbox state with secrets removed. Add a Chrome
performance trace or heap snapshot for performance regressions.

No screenshot, AI judgment, DOM snapshot, or state assertion alone is sufficient for the central
human-agent collaboration journey.
