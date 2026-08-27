# Koi open decision queue

Decisions are discussed one at a time. This order reflects what can block the WebMCP Challenge slice, not the eventual importance of each feature.

## 1. Challenge delivery order

Status: owner decision needed now.

Question: should Koi temporarily build standalone web + WebMCP before the originally planned stdio MCP App?

Recommendation: yes. Finish the judged web journey first, then reuse the shared core for stdio. The challenge deadline is imminent and requires a live WebMCP product; parallel surface polish would reduce the chance of completing the coherent story.

## 2. Open-source license and source boundary

Status: next owner decision.

Recommendation: license the complete self-hostable product under Apache-2.0, including the editor, WebMCP, stdio/HTTP MCP, authentication, Workspaces, Documents, collaboration, and deployment path. The judged WebMCP flow must build and run without hidden private source.

Monetize Koi Cloud through managed availability, storage, synchronization, backups, AI usage, support, and later organization features. Do not create a private `koi-cloud` repository until its first real control-plane slice exists. That repository may own billing, entitlements, tenant provisioning, abuse controls, production operations, and compliance integrations; it must consume released public artifacts rather than fork Koi's product core.

Owner decision: accept the adoption-oriented Apache-2.0 recommendation, or prefer AGPL-3.0 network copyleft despite its greater embedding and enterprise-adoption friction. Do not publish or accept outside contributions until the license and contributor-rights policy are approved.

## 3. Minimum challenge document schema

Status: architecture workshop required before implementation.

Recommendation: define only Page, Frame, component instance, text, note, and the minimum spatial relationships needed by the golden story. Stable IDs, nesting, geometry, z-order, and per-field revisions are mandatory. Add connector and ink records after the first end-to-end product works.

## 4. Exact WebMCP catalog and confirmation boundary

Status: validate against the demo script.

Recommendation: begin with context, registry listing, inspect, create, update, arrange, and export. Keep delete behind explicit UI confirmation for the challenge. Make the active web Document implicit; require explicit Document identity in remote MCP.

## 5. Challenge persistence and authentication

Status: hosting decision.

Recommendation: use a no-login sample workspace with IndexedDB persistence for judging, because ChatGPT's built-in browser may use a separate cookie store. Add authenticated hosted synchronization after the challenge.

## 6. Canvas performance limits

Status: measured decision after the interaction prototype.

Recommendation: accept the DOM-first hybrid architecture now, then set live-Frame, DOM, ink, and shader budgets from the fixture curves in the testing strategy. Do not substitute Lighthouse DOM warnings for product measurements.

## 7. Midscene privacy and model provider

Status: deferred until deterministic journeys pass.

Recommendation: use synthetic workspaces and an explicitly approved model provider, or self-hosted vision, for the advisory lane. Never send customer workspaces by default.

## 8. Shader dependency timing

Status: after the challenge cut.

Recommendation: study Paper Shaders' lifecycle and resource-budget patterns, but do not adopt its WebGL runtime. Build a WebGPU/WGSL implementation only after the base Shader element contract and global resource budget exist. Shader authoring is not part of the challenge slice.

## 9. Rich-text collaboration boundary

Status: later product evidence needed.

Recommendation: keep server-ordered semantic commands for canvas geometry and ordinary labels. Introduce Yjs only for genuinely high-contention rich text; do not expand a text CRDT to the whole Page without evidence.
