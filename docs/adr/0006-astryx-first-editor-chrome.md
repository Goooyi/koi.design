# ADR 0006: Compose the editor chrome from Astryx; author only the spatial canvas

- Status: Accepted
- Date: 2026-09-04

## Context

Koi is built on Astryx and its product promise is that designers bring their own design tokens to
restyle Astryx components. The first editor chrome was written as custom CSS on raw elements, with
its own colors, and later as StyleX with a Koi-owned token layer. Both shapes drifted from the
system Koi asks its users to adopt, and neither could serve as a reference for what Koi exports.

Astryx already ships the pieces a design tool's chrome needs: layout regions, toolbars, toggle and
icon buttons, form controls, lists, overlays, and a token system compiled from `defineTheme`. What
it has no vocabulary for is the spatial editor itself: an infinite canvas, a camera, world-space
layers, and the overlays that live in canvas coordinates.

## Decision

Koi's user interface has exactly three layers, and the repository layout states them:

1. `packages/astryx` is Koi's Astryx layer. It holds the trusted component registry, the Koi theme
   expressed only as token values on Astryx's contract (`src/theme/koi.ts`, built and drift-checked
   by `astryx theme build`), starting from Astryx's defaults rather than a shipped theme so that
   every value in it is a Koi decision, Koi's glyphs shaped for Astryx's `Icon`, and Koi-authored
   components that follow Astryx conventions because Astryx lacks them. Anything here is a candidate
   for publishing or upstreaming.
2. `packages/editor/src/chrome` composes Astryx components. It owns no visual styling beyond the
   shell box and the interaction lock; sizes, colors, radii, shadows, and motion come from Astryx.
3. `packages/editor/src/canvas` is Koi's product surface. It is authored in StyleX, references only
   Astryx token groups, and follows Astryx's styling rules, including the `@media (hover: hover)`
   guard for hover states.

Koi keeps no token layer of its own. Where a value is Koi's, it lives in the Koi theme; where a
name is missing, the Astryx token families are extended through the theme's `localTokens`, never
through parallel variables. Per-document design tokens will apply through a nested Astryx `Theme`
around the canvas so that a design's theme never restyles the editor.

The editor's width budget follows Astryx's layout guide: structural widths are pixels, everything
inside them uses the spacing scale, and a region is dropped rather than left to compete for space.
Tools have their own place, a 48px vertical rail beside the canvas (an Astryx `Toolbar`), as in
Figma, Paper, and Blender; it never drops. The pages panel (256) and the inspector (380) resize
within their budgets through `useResizable` and `ResizeHandle`; at 1024 the inspector is dropped and
at 768 the pages panel follows, and the app bar's panel toggles bring either back. Koi keeps the
inspector as a collapsible panel rather than the guide's Dialog because it stays open while editing.

## Consequences

- The editor looks and behaves like an Astryx application, and exported projects can reuse the
  same theme and component conventions.
- Component composition adds HTML elements compared with hand-styled elements; the browser audit's
  whole-page budget (`peakPageHtmlElements`) is reviewed against measured peaks rather than
  assumed, and the canvas is measured on its own (`peakCanvasHtmlElements` and
  `peakMountedKoiElements`) so that a chrome change never moves the canvas sentinels.
- Missing Astryx controls, such as a color input, are built to Astryx conventions inside
  `packages/astryx` instead of as one-off fields.
- Upgrading Astryx is a deliberate change that re-runs the theme build and the audit.
