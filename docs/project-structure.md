# Koi repository and toolchain

Status: toolchain decision accepted and repository topology proposed, 2026-08-27. The target topology does not decide the still-open delivery-order question.

## Decision summary

Koi will use a pnpm workspace driven through Vite+. Vite+ supplies Vite with Rolldown, Vitest, Oxlint, Oxfmt, tsdown, and the workspace task runner. The official name is **Oxlint**, not `oxclint`.

The initial scaffold will pin the current Vite+ release rather than use a floating range. As of this decision that is `vite-plus@0.3.0`, which bundles Vite 8.2.2, Rolldown 1.2.5, Vitest 4.1.11, Oxlint 1.79.0, and Oxfmt 0.64.0. Vite+ is still labeled beta, so upgrades are explicit changes followed by `vp migrate`, `vp toolchain`, and the full project gates.

Koi will not add parallel ESLint, Prettier, standalone Oxlint/Oxfmt, or ordinary standalone Vitest configurations. Static policy belongs in the root `vite.config.ts`; app-specific Vite build and test behavior belongs in that app's config. React uses the maintained `@vitejs/plugin-react`, whose transform path uses Oxc in current Vite.

## Target workspace

```text
koi-design/
├── apps/
│   ├── web/                  # standalone React app and first-class WebMCP
│   ├── mcp-view/             # self-contained iframe View build
│   └── mcp-server/           # one server with stdio and HTTP entrypoints
├── packages/
│   ├── core/                 # environment-neutral document and command domain
│   ├── astryx/               # trusted profile, registry, renderer, and export
│   └── editor/               # reusable React spatial editor
├── tests/
│   ├── contracts/            # entry-surface behavioral parity
│   ├── e2e/                  # web, WebMCP, and MCP App journeys
│   └── fixtures/             # representative canvas documents
├── docs/
├── vite.config.ts                # shared Vite+ check, task, and workspace policy
├── pnpm-workspace.yaml
├── package.json
└── pnpm-lock.yaml
```

Directories are created when their complete vertical slice begins; Koi will not commit empty future apps. If the challenge-first order is accepted, the first physical workspace contains `apps/web` and the three packages. `apps/mcp-view` and `apps/mcp-server` arrive together when the MCP App slice begins. A later Remotion showcase may live in `apps/showcase`; Hyperframes can remain an external production workflow. Neither belongs in the product runtime.

## Dependency direction

```text
core ← astryx ← editor ← web or mcp-view
  ↖──────────────── mcp-server
```

- `packages/core` has no React, DOM, MCP, database, or Astryx runtime dependency. It owns the Document schema, commands, validation, queries, history, persistence ports, and portable Koi serialization.
- `packages/astryx` depends on `core`. It owns the Koi Astryx profile, trusted component registry, browser renderer entrypoint, and supported native export. Browser and Node entrypoints remain explicit.
- `packages/editor` depends on `core` and `astryx`. It owns the React editor shell, canvas interaction, visibility, render layers, overlays, and inspector.
- Apps are composition roots. They may depend on packages, but apps never import another app and packages never import an app.
- IndexedDB, SQLite, and later PostgreSQL implementations stay beside the app that runs them. Only their narrow transactional interfaces belong in `core`.
- The MCP server has one set of handlers with stdio and HTTP transport entrypoints. The MCP View does not own durable storage; it talks through the host bridge and semantic client.
- Packages expose public entrypoints. Cross-package deep imports are prohibited.

## Internal module shape

```text
apps/web/src/
├── app/
├── webmcp/
└── persistence/indexeddb/

apps/mcp-view/src/
├── app/
└── bridge/

apps/mcp-server/src/
├── entrypoints/              # stdio.ts and http.ts
├── mcp/
└── persistence/

packages/core/src/
├── document/
├── commands/
├── queries/
├── history/
├── persistence/
├── agent-api/
└── serialization/

packages/astryx/src/
├── profile/
├── registry/
├── render/
└── export/

packages/editor/src/
├── shell/
├── canvas/
│   ├── camera/
│   ├── interaction/
│   ├── visibility/
│   └── layers/             # DOM, SVG, HUD, and shader modules
├── overlays/
└── inspector/
```

Unit tests sit beside the behavior they exercise. Repository-level `tests/contracts` proves that human UI, WebMCP, and MCP adapters produce equivalent domain outcomes. End-to-end journeys stay outside individual packages because they exercise assembled products.

Do not create generic `shared`, `utils`, or `types` dumping grounds. Camera, geometry, SVG, Canvas2D, shaders, virtualization, and overlays remain modules inside `editor` because they share interaction and geometry invariants. A package is extracted only when there is a real independent contract and consumer.

## Daily commands

- `vp install` installs workspace dependencies through pnpm.
- `vp dev` and `vp build` run the current app's Vite/Rolldown path.
- `vp check` runs Oxfmt, Oxlint, and TypeScript checks.
- `vp test` runs the Vite+-provided Vitest for domain and component tests.
- `vp exec playwright test` runs the separate Playwright Test suite.
- `vp run -r build` or an explicit root task builds workspace members in dependency order.

The MCP server uses normal ESM Node output through `vp pack`; it will not begin with Vite+'s experimental single-executable mode.

## References

- [Vite+ getting started](https://viteplus.dev/guide/)
- [Vite+ monorepo guide](https://viteplus.dev/guide/monorepo)
- [Vite+ check](https://viteplus.dev/guide/check)
- [Vite+ troubleshooting and beta status](https://viteplus.dev/guide/troubleshooting)
- [Vite+ 0.3.0 release](https://github.com/voidzero-dev/vite-plus/releases/tag/v0.3.0)
- [Vite official plugins](https://vite.dev/plugins/)
