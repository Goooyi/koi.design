# ADR 0005: Standardize programmable GPU work on WebGPU

- Status: Accepted
- Date: 2026-08-27

## Context

Koi may eventually need programmable rendering or computation for procedural graphics, dense ink, particles, and image processing. Supporting both WebGL2/GLSL and WebGPU/WGSL would multiply shader sources, resource lifecycles, tests, host-compatibility behavior, and failure modes. WebGPU still does not accelerate DOM layout, flex/grid, text editing, or ordinary Canvas2D work.

## Decision

All Koi-authored programmable GPU rendering and computation uses WebGPU and WGSL. Koi ships no WebGL2/GLSL runtime backend. WebGPU remains a capability-gated leaf beside the DOM-first canvas rather than its foundation; DOM, SVG, Canvas2D, and the browser compositor keep their existing responsibilities.

Unsupported hosts preserve the semantic Element and show a static preview or explicit diagnostic. Koi does not silently substitute a WebGL renderer. Any imported shader format must become validated WGSL before runtime and retain required license and provenance information.

## Consequences

- Koi maintains one programmable GPU stack and one shader language.
- Paper Shaders is reference material, not a runtime dependency while it requires WebGL.
- GPU features must handle capability detection, device loss, resource cleanup, offscreen suspension, and Page-wide budgets.
- Browsers or MCP hosts without WebGPU still support the complete non-GPU editor.
