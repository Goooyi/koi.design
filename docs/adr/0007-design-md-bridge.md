# ADR 0007: DESIGN.md is the source of every theme, bridged by one published package

Status: accepted (2026-09-04)

## Context

Koi's promise is that designers bring a design system and Koi renders and exports it on Astryx.
The emerging convention for describing a design system to agents is DESIGN.md, Google Labs'
open format (YAML front matter of tokens plus prose sections). ADR 0004 keeps raw DESIGN.md as
portable design intent and maps it through the pinned `koi.astryx` profile; ADR 0006 settles that
Koi has no token layer of its own. What was missing was the mapping itself, and a place for it
that Koi, exported Web Builds, and third parties can all use.

## Decision

1. **One published package owns the mapping:** `@koidesign/design-md` in `packages/design-md`.
   It parses a DESIGN.md (format `alpha`, pinned), maps it onto Astryx's token contract for the
   pinned `koi.astryx/0.5.0` profile, emits a deterministic `defineTheme` module for the Astryx
   CLI, and produces the design profile record a Koi document carries. The mapping is by name:
   a DESIGN.md token either has an Astryx role or it is reported and kept in the profile. There
   is no parallel token vocabulary.
2. **The public scope is `@koidesign`.** It mirrors `@astryxdesign` and matches the product's
   domain; `@koi` is a three-letter scope that is likely to be taken and would be ambiguous.
   Workspace-private packages keep the `@koi/*` names. Nothing is published until the licence
   for this package is decided (see Consequences); the package is publishable in shape only.
3. **Koi's own DESIGN.md lives at the repository root.** That is where the format's consumers
   (agents, the `design.md` linter) look, and the file describes Koi the product, not one package.
   `packages/astryx` consumes it: `pnpm theme:build` compiles `DESIGN.md` into
   `src/theme/generated/koi.theme.ts` and then into CSS, and `pnpm theme:check` fails the gate on
   drift at either stage. Until Koi's first theming pass the front matter omits every token
   section with a stated reason, so the compiled theme is `defineTheme({ name: "koi" })` and Koi
   renders on Astryx's defaults; the prose sections still carry the width budget and the styling
   rules for agents.
4. **The Apple DESIGN.md is the worked example.** VoltAgent's MIT-licensed Apple design analysis
   is vendored as a fixture with its licence and compiled into a second theme,
   `@koi/astryx/themes/apple.css`, so the mapping is proven on a real third-party file rather
   than on Koi's own, deliberately empty, one.

## Consequences

- Theme changes are DESIGN.md edits; hand-editing a generated theme module fails the gate.
- Unmapped tokens are visible (`koi-design-md inspect`) and survive in the profile, which is the
  input Milestone 2.1's per-document themes and Milestone 2.8's Web Builds consume.
- Astryx 0.5.0 has no `localTokens`; earlier wording that relied on it is withdrawn.
- The package inherits the repository's AGPL-3.0-or-later licence. A library meant to be embedded
  in exported projects and third-party tools may warrant a permissive licence; that is a
  decision for the maintainer before the first npm publish, not one this ADR makes.
