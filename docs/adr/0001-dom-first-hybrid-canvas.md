# ADR 0001: Use a DOM-first hybrid canvas

- Status: Accepted
- Date: 2026-08-27

## Context

Koi must show many Paper-style Frames on one infinite Page while preserving real Astryx HTML/CSS, flex/grid behavior, editable text, accessibility, and native web export. It must also support connectors, shapes, comments, pen input, and procedural shaders without making camera interaction laggy.

## Decision

Use one positioned DOM world with one CSS camera transform. Render trusted component Frames as actual DOM. Use SVG for committed connectors, shapes, and initial ink; Canvas2D for transient editor feedback; DOM overlays for editing controls; and WebGPU canvas leaves for programmable GPU elements.

Camera updates occur once per animation frame outside React reconciliation. Scale by top-level Frame visibility, containment, record-level subscriptions, cached geometry, and distant previews.

WebGPU leaves, Wasm, React Flow, and a custom pixel renderer are not part of the core canvas foundation. Bounded WebGPU features are added only for an explicit product capability; CPU-heavy Wasm optimizations require a measured workload.

ADR 0005 fixes WebGPU/WGSL as Koi's only programmable GPU backend.

## Consequences

- Koi preserves the real web medium and Astryx behavior.
- The browser owns component layout; Koi owns camera math, semantic interaction, measurement, visibility, and overlays.
- DOM scalability becomes an explicit benchmark and level-of-detail problem.
- Pen, connectors, comments, and shaders can evolve independently behind clear rendering roles.
- Koi must test compositor behavior, retained DOM, paint cost, SVG density, and WebGPU device/resource budgets in real Chrome.

## Rejected alternatives

- A GPU-first renderer would require rebuilding web layout, text, focus, accessibility, and component behavior.
- One iframe per Frame would add browsing contexts, memory, isolation, focus, and communication complexity while preventing natural nested HTML layout.
- React Flow is optimized for node-edge applications rather than nested Paper-style HTML/CSS composition and would impose a second canvas model.
- An enormous HTML element is unnecessary; infinity is world coordinates plus a camera projection.

“Incremental bundle cost” means the additional JavaScript a dependency adds to a cold application/View load. It does not mean those bytes are transferred on every drag; interactions carry small local state changes or semantic messages. React Flow is rejected here because its canvas model is a poor fit, not because its bundle would be resent per action.
