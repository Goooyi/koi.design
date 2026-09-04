---
version: alpha
name: Koi
description: Koi's own visual identity. Koi is built on Astryx and, until its first deliberate theming pass, renders on Astryx's defaults on purpose. This file is the source of Koi's theme, compiled by @koidesign/design-md, and the design guidance agents working on Koi should follow.
omitted:
  - section: colors
    reason: Koi renders on Astryx's default palette until its first theming pass; the values are documented in prose below.
  - section: typography
    reason: Koi uses Astryx's system font stack and type scale unchanged.
  - section: rounded
    reason: Koi uses Astryx's radius steps unchanged.
  - section: spacing
    reason: Koi lays out on Astryx's fixed 4px spacing steps.
  - section: components
    reason: Koi composes Astryx components as shipped and overrides none of them.
---

# Koi

## Overview

Koi is a portable, HTML-native design canvas where people and agents work on the same semantic
document. Its interface is built from Astryx components on Astryx's token contract, and its own
identity is deliberately quiet: white surfaces, a cool light body, one blue accent, the system font
stack. Chrome recedes so the canvas can speak. Anything that draws attention should be the
document, never the editor.

Three layers make up the interface, and the repository states them:

- `packages/astryx` holds Koi's Astryx layer: the trusted component registry, this theme compiled
  from this file, glyphs shaped for Astryx's `Icon`, and controls Astryx lacks.
- `packages/editor/src/chrome` composes Astryx components and owns no visual styling of its own.
- `packages/editor/src/canvas` is the one Koi-authored surface, styled in StyleX on Astryx's
  token groups only.

## Colors

Koi inherits Astryx's default palette. The values below are Astryx's, listed so that an agent
knows what it is looking at; do not copy them into code, reference the tokens.

- Accent `--color-accent` #0064E0 (dark #2694FE): primary actions, selected rows, the selection
  outline on the canvas, focus rings.
- Body `--color-background-body` #F1F4F7 (dark #111112): the page behind panels and the canvas
  ground.
- Surface `--color-background-surface` #FFFFFF (dark #1F1F22): panels, cards, the app bar.
- Text `--color-text-primary` #0A1317 and `--color-text-secondary` #4E606F.
- Border `--color-border` rgba(5, 54, 89, 0.1) and `--color-border-emphasized` #CCD3DB.
- Status uses Astryx's `success`, `warning`, and `error` tokens; the canvas grid dots use the
  emphasized border colour.

Rule: a colour is always a token. No hex values in components, no colour that is not on Astryx's
contract.

## Typography

Astryx's system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
Arial, sans-serif`) for body and headings, `"SF Mono", Monaco, Consolas, monospace` for code. The
type scale is Astryx's, with a 0.875rem base. Use the `Text` and `Heading` components with their
`size` and `weight` props; never set font sizes directly. Section titles in panels are extra-small,
semibold, secondary-coloured text.

## Layout

Structural widths are pixels; everything inside them uses Astryx's 4px spacing steps. A region is
dropped rather than left to compete for width it does not have.

| Region | Width | Behaviour |
| --- | --- | --- |
| Pages and library panel | 256 (208–320) | resizable; dropped at 768px |
| Tool rail | 48 | never drops |
| Canvas | fills | the product |
| Inspector | 380 (372–480) | resizable; dropped at 1024px |

Containers own padding; children have zero margins. One control size per row. Sidebars are lists
of rows: icon, label, end slot. Tools live in the rail beside the canvas, not in a panel.

## Elevation & Depth

Astryx's three shadow levels, one per surface: `--shadow-low` for frames and notes on the canvas,
`--shadow-med` for popovers, `--shadow-high` for dialogs. Nothing else casts a shadow. Depth on
the canvas comes from the document, not the chrome.

## Shapes

Astryx's radius steps unchanged: inner 4px, element 8px, container 12px, page 28px, full for pills.
Do not mix rounded and sharp corners in one surface.

## Components

Astryx components first, always. A Koi-authored component is justified only when Astryx has
nothing for the job; it lives in `packages/astryx`, follows Astryx's styling rules, and is written
as an upstream candidate. The first is `ColorInput`. Every insert on the canvas is an Astryx
component instance from the trusted registry, and Web Builds export those components unchanged.

## Do's and Don'ts

- Do reach for the installed Astryx export before writing markup or styles.
- Do style through `xstyle` with Astryx token groups; guard `:hover` with `@media (hover: hover)`.
- Do keep the accent for the single most important action and for selection.
- Don't hardcode colours, sizes, or shadows; don't use `style={{}}` or `!important`.
- Don't add a token vocabulary of Koi's own; a missing name is a diagnostic, not a new variable.
- Don't put tools in a panel; the rail is their place.
