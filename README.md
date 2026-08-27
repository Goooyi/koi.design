# Koi Design

Koi is a self-hostable, local-first spatial design workspace where people and agents edit the
same structured document. It combines a Paper-style HTML/CSS canvas, Miro-style visual
exploration, native WebMCP tools, and an interactive stdio MCP App without making one AI host or
hosted service the source of truth.

This repository contains a working MVP. It is suitable for local exploration and a bounded
single-owner self-hosted deployment; it is not yet a multi-user cloud service.

## What works

- One infinite Page with virtualized top-level Frames and real Astryx HTML/CSS components.
- Pan, zoom, select, drag, resize, text/note editing, shapes, connectors, freehand ink, delete,
  and compensating undo.
- A versioned semantic document model with stable IDs, validation, conflict preconditions,
  idempotent commands, ordered history, and bounded `.koi.json` import/export.
- IndexedDB persistence for each browser Projection and its local/hosted authority metadata.
- Eight first-class WebMCP tools registered by the top-level page.
- A self-contained MCP App View with five semantic/model-visible tools, one app-only bounded
  snapshot-transfer tool, and one durable local Projection file.
- An authenticated, file-backed service with REST sync, revision notifications, and stateless
  Streamable HTTP MCP for one-owner hosting.
- Deterministic unit, protocol, and real-pointer Playwright coverage.

The editor remains usable when WebMCP or WebGPU is unavailable. Shader records currently render
an explicit fallback; Koi ships no WebGL runtime.

## Run locally

Requirements: Node.js 22.18 or newer and pnpm 11.21.0.

```sh
npm install --global pnpm@11.21.0 # Skip when this pnpm version is already installed.
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:4173>. The starter Document is stored in IndexedDB. Use the editor's
Import and Export actions to move a `.koi.json` file between browsers or agents.

Before the first browser test run, install Playwright's pinned Chromium build:

```sh
pnpm exec playwright install chromium
```

On Debian or Ubuntu machines that do not already have the browser system libraries, use
`pnpm exec playwright install --with-deps chromium` instead.

Useful repository gates:

```sh
pnpm build
pnpm check
pnpm test
pnpm test:e2e
pnpm ready
```

`pnpm check`, `pnpm test`, and `pnpm test:e2e` build workspace dependencies before running their
checks, so no separate build is required on a clean checkout. `pnpm ready` is the aggregate build,
check, unit/protocol test, and browser test gate. Workspace tasks run at most two at a time;
Playwright uses one Chromium worker and retains traces and screenshots only on failure to keep
development bounded on small machines.
GitHub Actions runs the same gate with a frozen lockfile on Node 24.

## Self-host

The supported container topology runs the built web app and REST service on one origin, persists
data in a named volume, and binds only to loopback by default.

```sh
cp .env.example .env
openssl rand -hex 32
# Paste the result into KOI_AUTH_TOKEN in .env
docker compose up --build
```

Open <http://127.0.0.1:8787>, choose **Connect hosting**, and enter that deployment token. The
token exists only in the running page's memory and must be entered again after a reload. IndexedDB
stores the active Document's non-secret local/hosted authority and hosted base URL beside its
Projection. A tab-scoped `sessionStorage` copy only prefills the connection form; neither storage
path contains the token, and authority metadata is not part of a portable Koi Document.

The Compose service is capped at 768 MiB RAM, 2 CPUs, 256 PIDs, and a 512 MiB Node heap. It uses
a persistent `/data` volume and bounded log rotation. Set `KOI_PUBLIC_ORIGIN` to the external
HTTPS origin when deploying behind a reverse proxy. Do not expose the service directly over
plaintext public HTTP.

To run without Docker:

```sh
pnpm build
export KOI_AUTH_TOKEN="$(openssl rand -hex 32)"
export KOI_STATIC_DIR="apps/web/dist"
export KOI_DATA_DIR=".koi/server"
node apps/server/dist/main.js
```

The service defaults to `127.0.0.1:8787`. See [the server contract](apps/server/README.md) for
configuration, endpoints, security rules, and hard limits.

### Local and hosted canvas choices

Connecting never silently merges two canvases. The connection panel makes the transition
explicit:

| Choice                   | Canvas shown after the action                                                              | What happens to the local canvas                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Keep working locally** | The current IndexedDB-backed canvas                                                        | No server request is made                                                                                                                                                                                                                              |
| **Open hosted canvas**   | The first Document in the first hosted Workspace, creating them if the deployment is empty | The prior local Document remains in IndexedDB and can be reopened with **Return to local** when it has a different ID                                                                                                                                  |
| **Publish this canvas**  | The hosted Document containing the current local content                                   | Koi imports the local content while preserving the hosted Document's ID, Workspace ID, and History ID. A differently identified local Document remains available through **Return to local**; a same-ID record becomes the refreshed hosted Projection |

After either hosted choice, new edits are submitted through authenticated REST and revision SSE
wake-ups trigger full-Projection refreshes. If **Open hosted canvas** would hide divergent local
content with the same Document ID, Koi refuses the transition and asks the user to publish or stay
local. Before switching between hosts, Koi also checks any inactive browser record with the target
Document ID: it recovers a pending outbox only for that exact host and refuses a collision that
would make a local or differently hosted canvas unreachable. This check happens before a remote
publish. Importing a `.koi.json` file always returns the editor to local mode; publishing it later
is a separate explicit action.

Each Publish action carries one stable command ID, expected Revision, and exact Document payload.
Koi retries an ambiguous transport or server failure once with those same bytes. If both responses
are ambiguous, the UI reports **Publish outcome unknown**, keeps the source canvas visible but
interaction-locked, and only allows retrying that exact intent or authoritatively opening its hosted
target. Definite conflicts, server-busy responses, and storage-limit responses are not retried for a
new intent; they cannot clear an already ambiguous intent. The unresolved intent currently lives in
page memory: reloading or closing the page loses the automatic retry identity, so durable
publish-intent recovery across reload remains a documented follow-up.

Hosted edits are checkpointed to IndexedDB before REST delivery. A failed delivery remains in the
durable browser outbox. Reconnecting to the same hosted authority replays undelivered Commands in
history order and checkpoints each acknowledgement before continuing; a conflict stops recovery
and leaves that Command and all later Commands pending. SSE is only a wake-up: Koi does not replace
the browser Projection while its outbox is non-empty. This is crash/reconnect recovery for one
browser, not automatic offline multi-client merging.

## Connect an MCP host

Build the workspace, then configure an MCP client to launch the stdio entrypoint with an absolute
path:

```json
{
  "mcpServers": {
    "koi": {
      "command": "node",
      "args": ["/absolute/path/to/koi-design/apps/mcp-server/dist/cli.mjs"],
      "env": {
        "KOI_MCP_DATA_FILE": "/absolute/path/to/koi-data/projection.json"
      }
    }
  }
}
```

The server exposes the self-contained `ui://koi.design/canvas.html` View and five semantic tools:
`koi_canvas_open`, `koi_canvas_inspect`, `koi_canvas_apply`, `koi_document_export`, and
`koi_document_import`. The View can additionally call the app-only
`koi_canvas_read_snapshot_chunk`; it is hidden from the model-facing tool catalog.

The stdio server persists one Projection plus bounded import receipts across process restarts.
`KOI_MCP_DATA_FILE` accepts an absolute path or a path relative to the server process's working
directory; when unset, Koi uses `.koi/mcp/projection.json`. Use one stdio process per file. The
persisted file is capped at 32,000,000 bytes and created with mode `0600`. Before the first write
to a newly created path, Koi syncs each new directory entry through the pre-existing ancestry. Each
replacement then syncs the temporary file, renames it atomically within the same directory, and
syncs that directory on platforms and filesystems that support directory fsync. A failed directory
sync remains pending and prevents a later read or write from claiming durability until the sync
succeeds. Directories Koi creates use `0700`; Koi does not chmod a pre-existing configured parent.
The SDK rejects inbound stdio messages above `4 MiB`. At most four mutation payloads are active or
waiting by default; excess apply/import calls
fail fast as retryable `SERVER_BUSY` results. At most four Projection reads are active or waiting;
excess open/chunk/inspect/export calls receive the same structured retry guidance. See
[the local MCP contract](apps/mcp-server/README.md) for details.

Portable Document JSON and a directly returned Projection are each capped at 1,000,000 UTF-8
bytes. A complete Projection above that direct boundary and at most 32,000,000 bytes reopens in the
View through sequential 512,000-byte raw chunks (at most 63). Every chunk result remains below the
direct boundary and repeats a SHA-256 fingerprint of the serialized Projection. The stateless
server recomputes that fingerprint on every read; if the Projection changes, it returns retryable
`SNAPSHOT_CHANGED` and the View asks the user to reopen or retry. Both open and import results use
this snapshot-or-transfer contract. Hosted MCP has the same transfer protocol, but its 8 MiB
stored-Document limit remains the tighter persistence boundary.

A self-hosted Document also exposes the same tool catalog and MCP App resource through authenticated
stateless Streamable HTTP at:

```text
http://127.0.0.1:8787/api/v1/documents/{documentId}/mcp
```

Configure the MCP client to send `Authorization: Bearer <KOI_AUTH_TOKEN>`. The Document ID comes
from the REST create/list response. This endpoint shares the durable file-backed Document used by
the web app. It accepts POST exchanges only and creates no server-side MCP session.

## WebMCP

In a browser with native WebMCP enabled, the standalone page registers:

- `get_canvas_context`, `list_components`, and `inspect_elements` for bounded reads;
- `create_elements`, `update_elements`, `delete_elements`, and `arrange_elements` for semantic,
  version-checked edits;
- `export_document` for the portable Koi representation.

WebMCP calls use the same editor store and command reducer as direct manipulation. Mutations are
attributed to an agent, grouped as one undoable command, await local persistence, and return
structured conflicts instead of silently replacing a newer human edit.

`inspect_elements` accepts at most 32 stable IDs and returns depth-, node-, key-, array-, string-,
and total-byte-bounded property previews with a `truncated` marker. Both the bounded inspect
response and `export_document` are capped at 1,000,000 UTF-8 bytes, so `export_document` refuses a
larger result and directs the user to the editor download. The human-triggered `.koi.json` download
still exports the complete validated Document and is not subject to the model-output cap.

## Architecture

```text
Human UI ─┐
WebMCP ───┼─> shared command/query core ─> projection, history, outbox
MCP tools ┘

Editor rendering: DOM Frames + SVG scene + Canvas2D transient HUD + DOM overlays
Future programmable GPU leaves: WebGPU/WGSL only
```

The repository is a pnpm/Vite+ workspace:

- `packages/core` — document schemas, commands, replay, queries, and serialization;
- `packages/astryx` — trusted Astryx 0.5.0 registry and HTML rendering/export helpers;
- `packages/editor` — reusable React canvas, interactions, virtualization, and inspector;
- `packages/mcp` — shared MCP tools, UI resource registration, bounded snapshot transfer, and an
  injectable demo repository;
- `apps/web` — standalone browser app, IndexedDB, hosting client, and WebMCP adapter;
- `apps/mcp-view` and `apps/mcp-server` — single-file MCP View and durable stdio composition;
- `apps/server` — authenticated file-backed REST/HTTP MCP persistence and static hosting.

Start with [the domain language](CONTEXT.md), [system design](docs/system-design.md),
[repository map](docs/project-structure.md), and [testing strategy](docs/testing.md). Accepted
decisions live in [docs/adr](docs/adr); remaining product choices are tracked in
[docs/open-questions.md](docs/open-questions.md).

## Current boundaries

- Self-hosting is one deployment owner, one process, and one writer per data directory.
- Local stdio persistence is one process and one current Projection per
  `KOI_MCP_DATA_FILE`; it is not a multi-project database.
- There are no accounts, organizations, permissions, billing, multiplayer presence, or horizontal
  replicas yet.
- REST revision events are wake-ups; they are not a collaborative CRDT protocol.
- One Projection retains at most 64 undelivered Commands; the next mutation fails without changing
  the last valid Projection.
- One Projection retains at most 50,000 Commands across its lifetime. At that boundary, standalone
  local export then import starts a fresh Projection with empty history. Hosted and stdio storage
  have no in-place compaction in this release; create a new hosted Document or data file and import
  the portable Document there.
- Hosted MCP is stateless per exchange and scoped to one explicit Document URL.
- Geometry rotation is fixed to `0` in this release until every DOM, SVG, overlay, hit-test, and
  connector path shares one affine-transform model.
- Native HTML export is available only as trusted component-level helpers, not yet as a complete
  Page export workflow.
- WebGPU shaders, comments, image upload, accessibility audits, cross-browser E2E, and managed
  hosting remain incomplete.

## License

The project license is intentionally undecided. No `LICENSE` file has been added yet. Decide and
publish a license before describing the repository as open source or accepting external
contributions.
