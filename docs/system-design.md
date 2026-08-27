# Koi system design

Status: working agreement, 2026-08-27.

## Decision summary

Koi will be a DOM-first, local-first spatial editor with one shared command/query core. Human UI, WebMCP, and MCP servers are equal entry surfaces over that core. The browser renders actual HTML/CSS and Astryx components; SVG, Canvas2D, and WebGL2 are used only where they are the right visual medium.

This gives Koi the product property that matters most: a human can directly edit a real web composition, and an agent can read the exact semantic result and continue without overwriting it.

## Product boundary

The first product is a Paper-style UI exploration surface that dogfoods Miro-style visual collaboration. A Page contains many independent Frames, like the six numbered Paper frames and the Astryx component studies in the reference screenshots. Frames can later coexist with connectors, notes, comments, freehand ink, shapes, and other whiteboard utilities.

The following are deliberately outside the first vertical slice:

- arbitrary untrusted React packages or arbitrary JavaScript renderers;
- a Figma-compatible vector engine;
- full multiplayer, general-purpose CRDT state, and hosted organization features;
- WebGPU or Wasm in the core rendering path;
- arbitrary shader post-processing of live DOM subtrees.

Wasm remains a reserved optimization boundary. It must be justified by a measured CPU-heavy workload and must work across the intended MCP host security policies before adoption.

## Shared application core

```mermaid
flowchart LR
  Human[Human UI] --> CQ[Command and query service]
  WebMCP[Top-level WebMCP adapter] --> CQ
  View[MCP App View] --> Host[MCP host bridge]
  Host --> Server[Local stdio or hosted HTTP MCP adapter]
  Server --> CQ
  CQ --> Projection[Local projection]
  CQ --> Outbox[Durable outbox]
  Projection --> Renderer[Canvas renderer]
  Outbox --> Sync[Persistence and sync]
```

Adapters translate protocol requests; they do not mutate React state, dispatch pointer events, or own document semantics. The same command must produce equivalent validation, history, projection, and undo behavior regardless of its entry surface.

The browser API behind WebMCP remains isolated because it is evolving. That isolation does not make WebMCP experimental within Koi: WebMCP has product parity, documentation, acceptance tests, and a challenge release gate.

## Spatial and rendering architecture

```text
Viewport
├── background and grid
├── WorldRoot — one CSS camera transform
│   ├── SVG relationship plane
│   ├── positioned DOM Frames
│   │   ├── real HTML/CSS and Astryx component trees
│   │   └── optional WebGL2 shader canvas leaves
│   └── committed SVG shapes and ink
├── Canvas2D HUD — active ink, guides, selection and cursors
└── DOM overlay — handles, text editing, comments and toolbars
```

### Why one camera transform

Pan and zoom update one transform on `WorldRoot` once per animation frame, outside React reconciliation. A transform can stay in the compositor path; it is not intrinsically a source of lag. The common causes of lag are synchronous layout reads, React commits during gestures, paint-heavy effects, main-thread long tasks, excessive compositor layers, and repeated rerasterization while zooming.

`will-change` belongs only on the world root when evidence shows it helps. Koi must not promote every Element to its own layer.

### Why real DOM Frames

HTML/CSS fidelity is the product, not an implementation accident. Actual DOM preserves flex/grid behavior, editable text, semantics, accessibility, browser layout, Astryx rendering, and useful native web export. Replacing it with a custom pixel renderer would require Koi to rebuild layout, font shaping, focus, text editing, accessibility, and component behavior while losing source-of-truth fidelity.

The DOM does have a cost. Koi will scale at top-level Frame boundaries:

1. Subscribe renderers to individual records so a node edit does not rerender the Page.
2. Batch layout reads and writes; cache geometry through `ResizeObserver`.
3. Use containment at fixed-size Frame boundaries.
4. Maintain a world-space visibility index and mount visible Frames plus overscan.
5. Keep selected, edited, dragged, or agent-highlighted Frames live.
6. Show cached previews for distant or dense Frames while retaining bounds, labels, selection, and connector anchors.
7. Treat `content-visibility` as a secondary browser optimization, not the visibility model.

There is no useful universal DOM-node cap for an editor. Koi will establish limits from representative Page benchmarks, including the six-Frame Paper study, a tall Astryx foundations Frame, multiple component Frames, dense ink, and shader fixtures.

### Shapes, connectors, text, comments, and pen

SVG is the initial committed medium for connectors, geometric shapes, and simplified pen paths because it remains inspectable, selectable, and easy to anchor to DOM geometry. It is not the only non-DOM feature.

- Text being designed is a DOM Text element.
- Comments and editing controls use the screen-space DOM overlay.
- An active pen stroke is drawn in the Canvas2D HUD for low-latency input, simplified on pointer-up, then committed as an SVG path.
- Selection outlines, snap guides, remote cursors, and transient feedback use the Canvas2D HUD.
- If measured stroke density eventually exceeds SVG's viable range, committed ink can move behind the same scene abstraction to Canvas2D or WebGPU.

### WebGPU

WebGPU does not accelerate DOM style calculation, flex/grid layout, text editing, or DOM hit testing. It is therefore not a canvas foundation. A future optional GPU renderer may serve dense ink, particles, procedural graphics, image processing, or computation after a benchmark proves the need.

### Paper-style shaders

The DOM-first design supports Paper-style shaders directly: a normal Frame can contain an absolutely positioned WebGL2 canvas plus normal DOM children. A Shader element stores a trusted shader identity, serializable uniforms, playback speed, deterministic frame, and quality settings.

Paper's implementation gives each mount its own WebGL2 context and animation loop, observes size, caps backing pixels, and pauses static, hidden, or offscreen work. Koi should use the same principles while adding a Page-wide pixel and animation budget. Offscreen and distant shaders become snapshots; resolution is refreshed after zoom settles rather than reallocating every camera frame.

WebGL2 is sufficient for this feature. WebGPU is not required. Applying a shader to a rasterized snapshot of arbitrary live DOM is a different feature and is not part of the initial contract.

## Document and command model

The persistent hierarchy is:

```text
Workspace
└── Document
    ├── Page
    │   └── Elements, including nested Frames
    ├── assets
    ├── design profile
    └── history identity
```

A command has this conceptual envelope:

```ts
type Command = {
  documentId: string
  commandId: string
  clientId: string
  clientSeq: number
  baseCursor: number
  origin: "human" | "agent"
  operations: Operation[]
}
```

Stable Element IDs and bounded semantic operations are the interoperability contract. DOM selectors, raw JavaScript, and whole-document replacement are not agent APIs.

## Local-first change flow

```mermaid
sequenceDiagram
  participant Actor as Human or agent
  participant Core as Command service
  participant DB as Local transaction
  participant View as Projection
  participant Sync as Remote persistence
  Actor->>Core: command with preconditions
  Core->>DB: validate and atomically append change + outbox
  DB-->>View: committed local revision
  View-->>Actor: visible result and command receipt
  DB->>Sync: asynchronous outbox delivery
  Sync-->>DB: acknowledgement or structured conflict
```

Pointer movement and text composition are transient interactions. A drag commits one move when it ends; typing is grouped at meaningful pauses and editor boundaries. This grouping is an undo policy, separate from sync, although both operate on the same semantic commands.

A successful mutating WebMCP call means the change is durably committed to the local Projection and outbox, not necessarily acknowledged by a remote server:

```json
{
  "ok": true,
  "commandId": "01...",
  "changedIds": ["element-7"],
  "viewRevision": 42,
  "syncStatus": "pending"
}
```

Mutations serialize per Document; snapshot queries may run concurrently. Cancellation is honored before commit. Once the local transaction commits, cancellation cannot truthfully pretend the mutation never occurred.

## Conflicts, collaboration, and undo

Koi uses record- or field-specific preconditions rather than rejecting every change when the global Document revision advances:

- unrelated property edits may merge;
- absolute move, resize, and agent layout require the expected geometry version;
- deletion wins over a stale update;
- an agent layout fails with a structured conflict when a human moved a protected target;
- one bounded agent command becomes one visible undo group;
- undo appends a compensating command rather than rewinding history.

This adopts the important lesson from DeltaDB-style ordered logs: stable identity, explicit causality, small deltas, deterministic replay, and local materialized state are more valuable than putting every field in a general CRDT. A server-ordered semantic event stream is the initial collaboration model. Yjs is reserved for genuinely concurrent rich text if measurements and product use demonstrate that need.

Agent activity is attributed in history and visible on the Page. It must not silently steal a human's Camera or Selection.

## First-class WebMCP contract

The top-level web app registers a stable tool catalog centrally. Tools do not appear and disappear with React component lifecycles or current selection. Selection, Camera, current Page, and Revision are returned as context.

The proposed challenge catalog is:

- `get_canvas_context`
- `list_components`
- `inspect_elements`
- `create_elements`
- `update_elements`
- `delete_elements`
- `arrange_elements`
- `export_document`

Every mutating tool uses bounded batches, stable IDs, preconditions, idempotency, structured failures, and the same undo/history rules as human edits. A retry without a reliable browser invocation ID is handled by Koi command IDs and operation semantics, not by guessing caller identity.

Tool descriptions are static and precise. Document text and agent-returned labels are untrusted content and are never interpolated into tool instructions.

## MCP App contract

An MCP server registers a tool with UI metadata and exposes a `ui://` resource containing a complete HTML document. The MCP host retrieves that resource, renders the View in a sandboxed iframe, and bridges JSON-RPC messages through `postMessage`. The host then proxies permitted MCP tool calls to the local stdio or hosted HTTP server.

`postMessage` is the universal View-to-host browser channel; it is not an agent protocol. A View never assumes that its `localhost` is the MCP server machine. Durable application work travels View → host bridge → MCP tool unless an explicitly allowed network origin is declared in the UI resource policy.

The View is an optimistic projection, not the only durable store. Tool handlers must exist before the View connects, and host capabilities such as theme, display mode, context, and available tools are negotiated rather than assumed.

## Persistence topology

| Surface | Durable design storage | Immediate projection |
| --- | --- | --- |
| Standalone local web + WebMCP | IndexedDB and `.koi.json` export | Browser local projection/outbox |
| Local or SSH stdio MCP | SQLite or files on the MCP server machine | MCP View projection through host calls |
| Hosted web app | IndexedDB replica/outbox converging with the service | Browser local projection |
| Hosted HTTP MCP App | PostgreSQL plus object storage | MCP View projection backed by tools |

MCP server processes are treated as stateless request handlers: document identity, idempotency, preconditions, and durable state are explicit rather than hidden in a long-lived session.

## Astryx, DESIGN.md, and export

Koi initially targets one trusted Astryx integration, not a universal component framework. Registry code is compiled with Koi and a registry entry describes:

- component kind and trusted renderer;
- validated serializable properties and slots;
- defaults and inspector controls;
- supported token bindings and preview fixtures;
- source version and licensing metadata;
- export behavior.

Raw DESIGN.md remains portable source intent. A versioned `koi.astryx` profile maps that intent to the exact Astryx concepts Koi supports. Koi does not fork DESIGN.md and does not invent a parallel universal token system. Profile upgrades are explicit one-way transformations to the currently supported runtime; obsolete runtime paths are removed rather than maintained as compatibility layers.

Mitosis and Panda may inform the design, but neither is currently required. The trusted registry is narrower, safer, and more faithful to Koi's first product.

## References

- [Astryx: Who needs a Figma library?](https://astryx.atmeta.com/blog/who-needs-a-figma-library)
- [MCP Apps API](https://apps.extensions.modelcontextprotocol.io/api/)
- [MCP Apps testing guide](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/testing-mcp-apps.md)
- [OpenAI WebMCP/site tools documentation](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome rendering architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture)
- [CSS animation performance](https://web.dev/articles/animations-guide)
- [DOM size and interactivity](https://web.dev/articles/dom-size-and-interactivity)
- [`content-visibility`](https://web.dev/articles/content-visibility)
- [WebGPU API](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [Paper Shaders](https://github.com/paper-design/shaders)
- [Zed: Introducing DeltaDB](https://zed.dev/blog/introducing-deltadb)
