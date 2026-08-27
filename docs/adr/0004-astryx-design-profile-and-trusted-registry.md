# ADR 0004: Use an Astryx design profile and trusted registry

- Status: Accepted
- Date: 2026-08-27

## Context

Koi needs portable design intent without flattening everything to pixels or binding the canonical document to internal React component names. The first product specifically targets Astryx, whose API and the emerging DESIGN.md convention may evolve.

## Decision

Keep portable design intent in the Koi document and raw DESIGN.md source. Map it through a versioned, namespaced `koi.astryx` profile to the single Astryx runtime Koi supports. Instantiate components only through renderer code compiled into Koi's trusted component registry, with validated serializable properties, slots, defaults, token bindings, inspector definitions, preview fixtures, licensing metadata, and export behavior.

Do not build a universal framework adapter now. Mitosis, Panda, Tailwind-oriented projects, and other editors remain reference material unless a later requirement adopts them.

Profile upgrades are explicit one-way transformations to the current runtime. Obsolete runtime paths are removed instead of preserved as compatibility layers.

## Consequences

- Imported documents remain data, not executable third-party code.
- Astryx can be integrated deeply without pretending its props are a universal interchange standard.
- DESIGN.md can advance independently while Koi owns a narrow, testable mapping.
- Registry generation from a design-system release can be added later without creating a manually maintained parallel library.
- Supporting a second component system requires an explicit product decision and a new profile/registry implementation.
