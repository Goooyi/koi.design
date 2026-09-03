# Devpost submission copy

Replace bracketed values only after the release gates and account-bound publication steps pass.
This copy describes the implemented Stage 1 product, not the Koi 1.0 roadmap.

## Project name

Koi

## Tagline

A shared spatial canvas where people and browser agents edit the same semantic design document.

## One-sentence pitch

Koi replaces fragile click automation with eight native WebMCP tools, so a person and an agent can
inspect, create, arrange, and refine real HTML/CSS designs without silently overwriting each other.

## Short description

Koi is an open-source, local-first spatial design workspace. Its standalone challenge application
is anonymous and browser-local: the canvas starts with an editable example, registers eight native
WebMCP tools, saves to IndexedDB, survives reload, and exports a portable `.koi.json` Document. The
same command and query core receives both direct human gestures and agent tool calls.

## What it does

Koi gives humans a visual infinite canvas and gives agents a semantic interface to that same live
Document. A compatible browser agent can read the active Page and selection, discover trusted
Astryx components, inspect exact Element IDs and versions, create UI alternatives, update or
arrange Elements, delete with preconditions, and export the portable representation. The human can
immediately select, drag, resize, draw, or edit the result through the normal editor.

Every agent mutation uses a stable command ID and expected Element versions. Koi returns a
structured `applied`, `duplicate`, `rejected`, or `ambiguous` outcome and waits for local
persistence before reporting confirmed success. A stale write is rejected instead of silently
replacing a newer human edit.

## Why WebMCP is essential

This workflow needs more than automated clicks. A pixel-driving agent must infer which rectangle
is a Frame, scrape text from rendered output, manipulate the user's camera, and hope the canvas did
not change between observation and action. Koi's WebMCP tools expose the product's own semantic
model: stable IDs, geometry, trusted component metadata, revisions, and version preconditions.

WebMCP is therefore a first-class Koi surface, not a demo adapter. The page registers the catalog
at the top level, and every call enters the same validated command/query core as the human UI. The
agent can work without stealing camera or selection state, while the result remains visible and
directly editable.

## Native WebMCP catalog

- `get_canvas_context` — bounded Document, Page, camera, selection, revision, and sync context.
- `list_components` — the trusted Astryx component registry and editable properties.
- `inspect_elements` — bounded semantic previews for stable Element IDs.
- `create_elements` — one visible, undoable batch creation command.
- `update_elements` — version-checked semantic property, text, or geometry patches.
- `delete_elements` — version-checked bounded deletion.
- `arrange_elements` — version-checked placement and resize operations.
- `export_document` — the validated portable Koi representation within the model-output bound.

## User experience

The live application opens directly into a seeded four-Frame exploration; no account or private
API is required. In the demonstration, the browser agent discovers Koi's tools, reads the current
canvas and Astryx registry, and adds a launch-review card and button. Reload proves IndexedDB
durability. The human then edits a note and moves the button. A second agent read observes those
new semantic values and versions before refining the layout.

This loop keeps the design—not the chat transcript—as the durable collaboration artifact.

## Impact

Koi explores a portable alternative to closed agent-design surfaces. A design can be manipulated
by different compatible agents, directly edited by a person, exported as validated Koi JSON, and
run without making one AI vendor or managed service the source of truth. Because trusted Astryx
components render as native HTML/CSS, the artifact remains connected to the web medium it is
designing for.

## Creativity

The project combines a Paper-style spatial workspace, Miro-like visual exploration, and a semantic
agent protocol. Its central collaboration primitive is optimistic concurrency at the Element
level: human and agent actions share history, but an old agent plan cannot quietly erase a newer
human decision. That turns conflict handling into part of the product experience rather than an
afterthought in an automation script.

## How we built it

Koi is a TypeScript, React, pnpm, and Vite+ workspace. The editor uses real DOM for Frames, text,
notes, and Astryx components; SVG for committed shapes, connectors, and ink; Canvas2D for transient
interaction feedback; and DOM overlays for editing controls. Zod validates the versioned Document
and command schemas. IndexedDB stores the browser-local Projection, history receipts, and outbox.

The human UI, native WebMCP adapter, stdio MCP App, and self-hosted HTTP MCP surface converge on one
shared command/query core. The repository includes deterministic domain and protocol tests,
real-pointer Playwright journeys, accessibility checks, and a stable-Chrome performance and host
configuration audit. The judge build is a static Cloudflare Pages deployment with a visible build
identifier, strict security headers, immutable hashed assets, and a small `/health.json` response.

## Open source and self-hosting

The complete submitted source is available at `[PUBLIC_REPOSITORY_URL]` under
`AGPL-3.0-or-later`. Contributions use DCO 1.1 sign-off, and the Koi name and visual identity are
covered by a separate trademark policy. The repository includes the anonymous static challenge
build, a durable stdio MCP App, and a bounded single-owner self-host topology with authenticated
REST and Streamable HTTP MCP. No private runtime dependency is required to run the submitted code.

## Current limitations

Stage 1 is a working MVP, not a hosted multiplayer product. The challenge deployment is one
browser's local workspace. It has no accounts, organizations, permissions, billing, multiplayer
presence, CRDT merge, or managed hosting. Self-hosting is deliberately bounded to one deployment
owner, one process, and one writer per data directory. Complete Page-to-HTML export, comments,
image upload, manual accessibility review, cross-browser E2E, and programmable WebGPU shader
rendering are not complete. Shader records currently show an explicit fallback; Koi ships no
WebGL runtime.

## Links and release identity

- Live application: `[LIVE_PAGES_URL]`
- Health check: `[LIVE_PAGES_URL]/health.json`
- Public source: `[PUBLIC_REPOSITORY_URL]`
- Public demo video: `[PUBLIC_YOUTUBE_URL]`
- Submitted commit: `[FINAL_COMMIT_SHA]`
- Cloudflare deployment identifier: `[DEPLOYMENT_ID]`
- Devpost submission identifier: `[DEVPOST_SUBMISSION_ID]`

## Rubric evidence map

| Dimension       | Concrete evidence to cite                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| WebMCP leverage | Eight top-level semantic tools; stable IDs; bounded reads/writes; expected versions; structured outcomes |
| User experience | Seeded no-login canvas; visible agent edits; ordinary pointer/text takeover; reload persistence          |
| Impact          | Portable artifact, cross-agent-compatible semantics, no required proprietary runtime                     |
| Creativity      | DOM-native spatial design plus Element-level human-agent concurrency protection                          |
| Implementation  | Shared reducer, IndexedDB durability, MCP App/self-host surfaces, deterministic and browser-level gates  |
| Open source     | Public AGPL-3.0-or-later repository, DCO, provenance inventory, reproducible commands                    |

## Account-bound fields

The project owner must supply these after checking the current Devpost form and rules:

- `[OWNER ACTION]` final challenge category and any team-member metadata;
- `[OWNER ACTION]` any required OpenAI/Google account or challenge registration identifiers;
- `[OWNER ACTION]` public repository URL after visibility is changed;
- `[OWNER ACTION]` public YouTube URL after upload;
- `[OWNER ACTION]` Devpost submission ID and confirmation artifact;
- `[OWNER ACTION]` credentials only if the final live experience unexpectedly requires them. The
  intended challenge build does not require credentials.
