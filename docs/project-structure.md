# Koi repository and toolchain

Status: implemented workspace, 2026-08-27.

## Decision summary

Koi is a pnpm 11.21 workspace driven through Vite+ 0.3.0. Vite+ supplies the Vite/Rolldown build,
Vitest, Oxlint, Oxfmt, tsdown packaging, and workspace task runner. The repository does not add
parallel ESLint, Prettier, or standalone Vitest configurations.

Node.js 22.18 or newer plus the pinned pnpm release is required; Node.js 24 LTS is the CI and release
reference. Corepack is an optional package-manager bootstrap path, not a runtime requirement.
Versions are pinned in `package.json`,
`pnpm-workspace.yaml`, and `pnpm-lock.yaml`; upgrades are explicit changes followed by the full
repository gates.

## Workspace map

```text
koi-design/
├── apps/
│   ├── web/                  # React shell, IndexedDB authority/outbox, hosting, native WebMCP
│   ├── mcp-view/             # self-contained iframe MCP View
│   ├── mcp-server/           # stdio MCP + durable single-Projection repository
│   └── server/               # authenticated REST/HTTP MCP persistence + static serving
├── packages/
│   ├── core/                 # document, commands, history, queries, serialization
│   ├── astryx/               # Koi's Astryx layer: registry, Koi theme, glyphs, Astryx-style components
│   ├── editor/               # canvas/ (Koi's spatial surface), chrome/ (Astryx composition), store/
│   └── mcp/                  # shared MCP tools, resources, bounds, demo repository
├── tests/
│   └── e2e/                  # assembled browser journeys
├── docs/
│   └── adr/
├── Dockerfile
├── compose.yaml
├── playwright.config.ts
├── pnpm-workspace.yaml
├── package.json
└── vite.config.ts
```

Unit and protocol tests sit beside the package or app behavior they exercise. Repository-level
browser journeys live in `tests/e2e`.

## Dependency direction

```text
core ← astryx ← editor ← web
core ← mcp
core + editor + mcp ← mcp-view
core + mcp + mcp-view ← mcp-server
core + mcp + mcp-view ← server
```

- `packages/core` has no React, DOM, MCP, database, or Astryx runtime dependency. It owns all nine
  Element kinds, validation, semantic operations, deterministic replay, undo, queries, and the
  portable Koi representation. The current cross-surface geometry contract fixes rotation at `0`,
  and one Projection may retain at most 64 undelivered Commands and 50,000 lifetime Commands.
- `packages/astryx` is Koi's Astryx layer: the `koi.astryx/0.5.0` trusted registry and HTML helpers,
  the Koi theme (`src/theme/koi.ts`, values only on Astryx's token contract, built into
  `src/theme/generated` by `astryx theme build` and drift-checked by `pnpm theme:check`), Koi's
  glyphs for Astryx's `Icon`, and Astryx-style components Astryx lacks, such as `ColorInput`.
- `packages/editor` owns the store, camera, DOM/SVG/Canvas2D/overlay layers, direct interaction,
  Frame visibility, shared drag-preview offsets, and inspector. `src/canvas` is Koi's own product
  surface, authored in StyleX on Astryx token groups; `src/chrome` composes Astryx components and
  owns no visual styling of its own (ADR 0006). Its per-Element subscriptions are
  useful but do not isolate every committed render because the Canvas shell also consumes the full
  Projection.
- `packages/mcp` maps MCP tools to core commands, registers the MCP App resource, defines direct
  and fingerprint-pinned paginated snapshot bounds, and provides an injectable in-memory demo
  repository.
- Apps are composition roots. Browser-only Projection, authority, and outbox persistence plus
  hosted recovery stay in `apps/web`; file-backed REST and HTTP MCP persistence stay in
  `apps/server`; the bounded single-Projection stdio file stays in `apps/mcp-server`.
- Cross-package imports use public package exports. Packages do not import apps.

The self-host server and stdio MCP server are deliberately separate entrypoints. The self-host
server gives each durable Document an authenticated stateless Streamable HTTP MCP endpoint and
also supports the browser REST client. The stdio MCP server embeds the same interactive View and
persists its one current Projection to `.koi/mcp/projection.json` or `KOI_MCP_DATA_FILE`. The two
servers do not share a repository file. The stdio transport caps inbound messages at 4 MiB and the
file repository separately admits four active-or-waiting mutations and four active-or-waiting
Projection reads by default. Both MCP transports expose five semantic/model-visible tools and one
app-only chunk reader; the latter reopens complete Views up to 32,000,000 bytes without placing
pagination in the model tool catalog.

## Build outputs

- `apps/web/dist` — standalone web assets.
- `apps/mcp-view/dist/mcp-app.html` — one self-contained MCP App document.
- `apps/mcp-server/dist/cli.mjs` — executable stdio server; `dist/index.mjs` is its module export.
- `apps/server/dist/main.js` — bundled Node REST/static server.
- `packages/core/dist/index.mjs` and `packages/astryx/dist/index.mjs` — public package entrypoints;
  `@koi/astryx/theme.css` and `@koi/astryx/components.css` are the Koi theme and Astryx-style
  component styles that hosts import with the editor stylesheet.
- `packages/editor/dist/index.mjs` and `dist/style.css` — editor module and required stylesheet.
- `packages/mcp/dist/index.mjs` and `dist/protocol.mjs` — MCP implementation and protocol-only
  entrypoints.

Generated `dist` directories are not source artifacts. Reusable `packages/*` exports and the MCP
View/server exports resolve to those built files, so build before running a direct app task,
configuring an MCP host, starting a Node service, or producing a deployment image. The root `dev`,
`check`, `test`, and `ready` scripts perform their required workspace builds.

## Daily commands

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm check
pnpm test
pnpm test:e2e
pnpm ready
```

- `pnpm dev` builds the workspace, then starts the web app at `127.0.0.1:4173`.
- `pnpm build` builds all workspace members.
- `pnpm check` builds first, then runs Oxfmt, Oxlint, and TypeScript checks.
- `pnpm test` builds first, then runs the workspace Vitest and MCP protocol suites.
- `pnpm test:e2e` builds first, then runs one bounded Chromium Playwright worker.
- `pnpm ready` builds once, then runs checks, workspace tests, and the Chromium suite.

After building its workspace dependencies, run a single member through the Vite+ task runner, for
example
`pnpm exec vp run @koi/web#dev` or `pnpm exec vp run @koi/mcp-server#build`.

## Structure rules

- Do not create generic `shared`, `utils`, or `types` dumping grounds.
- Keep camera, geometry, rendering, virtualization, and overlays together in `editor` while they
  share interaction invariants.
- Add a package only when it has an independent contract and more than one real consumer.
- Keep protocol mapping at app edges; domain behavior belongs in `core`.
- Compose editor chrome from Astryx components and Koi's theme; write styles only for the spatial
  canvas, and only on Astryx tokens.
- Remove obsolete paths instead of adding compatibility layers.

## References

- [Vite+ getting started](https://viteplus.dev/guide/)
- [Vite+ monorepo guide](https://viteplus.dev/guide/monorepo)
- [Vite+ check](https://viteplus.dev/guide/check)
- [Vite+ 0.3.0 release](https://github.com/voidzero-dev/vite-plus/releases/tag/v0.3.0)
