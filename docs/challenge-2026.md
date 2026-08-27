# WebMCP Challenge 2026 plan

Status: recommended delivery plan pending owner confirmation, 2026-08-27.

## Outcome

Submit one coherent Koi workflow that could not be demonstrated as well with conventional browser automation: the agent and human operate the same live spatial document through semantic WebMCP tools, preserve each other's edits, and export the result as real web content.

The [official Devpost page](https://webmcp.devpost.com/) and [OpenAI challenge page](https://openai.com/webmcp-challenge/) state a deadline of September 3, 2026 at 1:00 PM PDT, which is September 4 at 4:00 AM in Singapore. Devpost requires a live URL, a public source repository with a visible open-source license and setup instructions, and a public demonstration video shorter than three minutes.

## Golden story

1. Open a prepared Page containing several Astryx component Frames and a brand design source.
2. Ask the browser agent to inspect the active selection and nearby composition through WebMCP.
3. The agent creates a branded alternative Frame beside the originals and explains the semantic changes.
4. The human directly drags a component, edits its label, and adds a note.
5. The agent reinspects the exact changed IDs and revisions, then continues without overwriting the human edit or stealing Camera/Selection.
6. The human reverts one agent operation as a single undo group.
7. Export the portable Koi document and supported native HTML/CSS.

This demonstrates first-class WebMCP leverage, actual human-agent collaboration, HTML/CSS-native design, local-first responsiveness, history, and portability in one short narrative.

## Challenge cut line

Build:

- one local Workspace and Document with one Page;
- multiple Frames containing trusted Astryx DOM;
- pan, zoom, selection, create, move, resize, text edit, and undo;
- IndexedDB projection/outbox and reload persistence;
- semantic history with human/agent attribution;
- top-level WebMCP context, inspect, create/update, arrange, and export tools;
- one design-profile input and native web export path;
- deterministic Playwright journey plus native Chrome and ChatGPT smoke tests;
- a public deployment, repository documentation, license, and demo video.

Defer:

- authentication and organization management;
- real-time multiplayer and hosted sync;
- full stdio MCP App product polish;
- arbitrary component packages;
- comments beyond the golden-story note primitive;
- dense drawing tools, WebGPU, Wasm, and shader authoring UI.

## Recommended delivery order

1. Shared document/command core and standalone DOM canvas.
2. IndexedDB projection/outbox and deterministic undo.
3. Complete WebMCP vertical slice in real Chrome.
4. Golden Playwright journey, performance trace, and ChatGPT browser smoke.
5. Export, deployment, README, public license, and sub-three-minute video.
6. Stdio MCP App adapter on the same core immediately after the submission slice.
7. Hosted HTTP MCP and collaboration afterward.

This changes delivery order, not product status: stdio MCP Apps and hosted MCP remain first-class surfaces in the system design.

## Proposed WebMCP catalog for the demo

Keep the catalog stable and small:

- `get_canvas_context` — active Document/Page, Camera, Selection, visible Frames, and Revision.
- `list_components` — trusted component kinds and validated editable properties.
- `inspect_elements` — bounded semantic details for stable IDs.
- `create_elements` — bounded creation with placement intent.
- `update_elements` — validated property/text/geometry edits with preconditions.
- `arrange_elements` — one reversible layout operation over protected targets.
- `export_document` — portable Koi and supported native web output.

Deletion can remain a deliberately confirmed UI action for the challenge unless the golden story proves it is necessary.

## Acceptance checklist

- [ ] The top-level page registers native WebMCP tools; no browser-extension automation is needed for the demo.
- [ ] Tool calls use the same commands, validation, history, conflict, and undo paths as human edits.
- [ ] A mutating tool resolves only after local projection/outbox commit and returns command ID, changed IDs, revision, and sync status.
- [ ] Agent work is visibly attributed and does not steal Camera or Selection.
- [ ] The human edit is communicated as a semantic Koi event, not inferred from pixels.
- [ ] A stale agent geometry update fails and replans without overwriting the human.
- [ ] Reload restores the Page locally.
- [ ] Native web export opens independently of Koi.
- [ ] Playwright golden journey, Chrome native WebMCP smoke, accessibility scan, and representative performance trace pass.
- [ ] Live URL works in a fresh synthetic account/session.
- [ ] The submitter has confirmed eligibility under the country-of-residence and other official rules.
- [ ] Repository is public with install/run/test instructions and a visible approved license.
- [ ] Public video is shorter than three minutes and shows WebMCP, human takeover, undo, and export.

## Submission risks

The largest risk is schedule dilution: implementing stdio, hosted collaboration, general whiteboard tools, and a universal component system before the judged WebMCP story works. The second is relying only on mocked WebMCP or AI visual tests. The third is publishing without a license that satisfies the challenge.

The open-source license and final source boundary require owner approval. Apache-2.0 is the current recommendation because it permits commercial use while providing explicit patent terms; the hosted service can remain a separate commercial offering.
