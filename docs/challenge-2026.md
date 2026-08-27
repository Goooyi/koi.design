# WebMCP Challenge 2026

Status: product MVP implemented; submission packaging remains, 2026-08-27.

## Submission thesis

Koi demonstrates a workflow that conventional browser automation cannot express as cleanly: a
human and an agent operate the same live spatial Document through semantic WebMCP tools, preserve
each other's edits through version preconditions, and export a portable artifact made of real web
elements.

WebMCP is a first-class product surface, not an experimental adapter. The page registers a stable
catalog centrally and routes tool calls through the same command reducer used by direct human
interaction.

## Golden story

1. Open a prepared Page containing several HTML-native Astryx Frames.
2. Ask the browser agent to inspect context and selected Elements through native WebMCP.
3. The agent creates a branded alternative Frame beside the originals.
4. The human drags a component, edits a note, and draws an ink stroke.
5. The agent reinspects exact IDs and versions, then continues without stealing Camera or
   Selection.
6. A stale agent edit receives a structured conflict instead of overwriting the human move.
7. Export the portable `.koi.json` Document and open the same product through the MCP App View.

This story exercises agent leverage, human takeover, semantic collaboration, real HTML/CSS,
history, and portability without a private service dependency.

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

- run and record the golden story through native Chrome WebMCP, not only the unit adapter;
- add the stale human-versus-agent browser journey and accessibility scan;
- capture a representative Chrome performance trace and verify deployment limits;
- publish a live HTTPS URL and test it in a fresh browser session;
- choose and add the repository license, then make the source public;
- record a public video shorter than three minutes using Hyperframes or Remotion;
- complete the current Devpost fields and recheck the official rules at submission time.

Licensing is intentionally undecided. The repository must not be described as open source until a
license file is present.

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
- [ ] Native Chrome discovers and executes all Koi WebMCP tools on the built deployment.
- [ ] A stored journey proves stale-agent conflict and replan after a human move.
- [ ] Accessibility and representative performance evidence pass.
- [ ] Live HTTPS URL works in a fresh session.
- [ ] Repository is public with an approved visible license and setup instructions.
- [ ] Public demonstration video is under three minutes.

## Official references

Recheck the [Devpost challenge page](https://webmcp.devpost.com/) and
[OpenAI challenge page](https://openai.com/webmcp-challenge/) immediately before submission; rules,
dates, and required fields are external and may change.
