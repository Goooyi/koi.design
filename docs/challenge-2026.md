# WebMCP Challenge 2026

Status: final application build and 2:48 demonstration media certified; public video publication
and Devpost submission remain, 2026-09-03.

## Submission thesis

Koi demonstrates a workflow that conventional browser automation cannot express as cleanly: a
human and an agent operate the same live spatial Document through semantic WebMCP tools, preserve
each other's edits through version preconditions, and export a portable artifact made of real web
elements.

WebMCP is a first-class product surface, not an experimental adapter. The page registers a stable
catalog centrally and routes tool calls through the same command reducer used by direct human
interaction.

## Golden story

1. Open the seeded Page containing several HTML-native Astryx Frames.
2. A deterministic release harness discovers the eight native WebMCP tools, reads bounded canvas
   context, lists trusted components, and inspects exact Element IDs and versions.
3. One semantic command creates a launch-review card and button inside an existing Frame.
4. Reload the page and verify that IndexedDB restores both Elements.
5. The recorded harness exercises the human interaction path by editing a note and moving the
   button with ordinary keyboard and pointer events.
6. The harness reinspects the newer values and versions, then refines the card and aligns the
   button without stealing Camera or Selection.
7. Show how Human UI, native WebMCP, and the MCP App converge on the shared command/query core.

This story exercises agent leverage, the human interaction path, semantic collaboration, real HTML/CSS,
version-safe writes, and browser-local durability without a private service dependency. Separate
tests cover stale-write rejection, delete, export, ink, and the MCP App lifecycle; the video does
not present those paths as executed in its main take.

## Implemented challenge surface

- standalone infinite DOM-first canvas and trusted Astryx registry;
- pan, zoom, select, drag, resize, text/note editing, shapes, connectors, ink, delete, and undo;
- IndexedDB persistence and portable `.koi.json` import/export;
- stable semantic commands, idempotency, expected-version conflicts, attribution, and outbox;
- native WebMCP context, component-list, inspect, create, update, delete, arrange, and export tools;
- self-contained, durable stdio MCP App and text fallbacks;
- bounded public self-host topology with single-owner REST and Streamable HTTP MCP persistence;
- deterministic domain, adapter, protocol, server, and real-input browser tests.

## Submission work remaining

- publish the certified 2:48 video with audio to a public YouTube URL;
- complete the current Devpost fields and recheck the official rules at submission time.

The repository is licensed under `AGPL-3.0-or-later`, uses DCO 1.1 contributor sign-off, reserves
the Koi trademarks separately, and carries a reproducible dependency and asset provenance report.

## Stable WebMCP catalog

- `get_canvas_context` — Document/Page, Camera, Selection, Revision, and pending sync summary.
- `list_components` — trusted Astryx component kinds and editable properties.
- `inspect_elements` — bounded semantic records for stable IDs.
- `create_elements` — bounded creation as one agent command.
- `update_elements` — validated property/text/geometry patches with expected versions.
- `delete_elements` — bounded, version-checked deletion.
- `arrange_elements` — one reversible placement operation over protected targets.
- `export_document` — validated portable Koi JSON.

## Acceptance checklist

- [x] Human UI and WebMCP mutate through the same editor/core command path.
- [x] Mutating calls use stable command IDs, bounded batches, versions, and structured receipts.
- [x] WebMCP mutation completion awaits the local persistence callback.
- [x] Agent work is attributed and does not mutate Camera or Selection.
- [x] Reload restores the standalone Page from IndexedDB.
- [x] Stdio MCP exposes a sandboxed, self-contained View with deny-by-default resource CSP.
- [x] Stdio MCP preserves its validated Projection and idempotency receipts across process restarts.
- [x] An official client verifies authenticated hosted MCP and restart persistence.
- [x] The public self-host build has no private runtime dependency.
- [x] Real-pointer Playwright covers drag persistence, pen, editing, and portable export.
- [x] Repository licensing, contributor sign-off, trademark terms, and dependency provenance are
      release-ready.
- [x] Native Chrome discovers all eight Koi WebMCP tools on the deployed build; the production
      release capture executes the six used by the golden story, while the local production-CSP
      journey executes all eight.
- [x] A stored journey proves stale-agent conflict and replan after a human move.
- [x] Automated accessibility and representative performance evidence pass; the bounded manual
      review records known keyboard and 200%-zoom limitations.
- [x] Live HTTPS URL works in a fresh session.
- [x] Repository is public with an approved visible license and setup instructions.
- [ ] Public demonstration video is under three minutes.

## Official references

Recheck the [Devpost challenge page](https://webmcp.devpost.com/) and
[OpenAI challenge page](https://openai.com/webmcp-challenge/) immediately before submission; rules,
dates, and required fields are external and may change.
