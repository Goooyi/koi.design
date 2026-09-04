# @koidesign/design-md

Bridge a [DESIGN.md](https://github.com/google-labs-code/design.md), Google's design-system format
for coding agents, onto [Astryx](https://astryx.atmeta.com)'s token contract and Koi's design
profile. Koi uses it for its own theme, for the themes designers bring, and for the projects it
exports, so all three go through one mapping.

- **Format pin:** DESIGN.md `alpha` (front matter `version: alpha`).
- **Astryx pin:** the `koi.astryx/0.5.0` profile, Astryx core 0.5.0.

## Use

```bash
koi-design-md build DESIGN.md --out src/theme/generated/my.theme.ts --name my
astryx theme build src/theme/generated/my.theme.ts --out src/theme/generated/my.css
koi-design-md build DESIGN.md --out src/theme/generated/my.theme.ts --name my --check   # drift check
koi-design-md inspect DESIGN.md            # what mapped where, and what stayed in the profile
```

```ts
import { buildTheme } from "@koidesign/design-md";

const { bridge, profile, module } = buildTheme(source, { name: "my" });
bridge.theme; // JSON-serializable input for Astryx's defineTheme
bridge.coverage; // DESIGN.md path → Astryx target, plus what Astryx has no name for
profile; // the record a Koi document carries, pinned to both versions
module; // TypeScript calling defineTheme, deterministic, ready to commit
```

## What maps where

| DESIGN.md                                                                                                                                                                                                | Astryx                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `colors.primary` (also `accent`, `brand`), with a `-on-dark` or `-dark` sibling as the dark value                                                                                                        | `color.accent`, which Astryx expands into the accent scale with contrast checks, so the rendered accent may be tone-adjusted (Apple's `#0066cc` renders as `#005CC1` on light); component overrides keep the exact value |
| `on-primary`, `background`/`canvas`, `surface`/`card`, `ink`/`text`, `text-secondary`, `border`/`hairline`, `error`/`danger`, `success`, `warning`, `neutral`, `on-dark`, `on-light`, `overlay`, `focus` | the matching `--color-*` and `--focus-outline-color` tokens; text colours also fill the icon tokens                                                                                                                      |
| `typography.h1…h6`, `headline-lg/md/sm`, `body`, `body-lg`/`lead`, `body-sm`/`caption`, `label`/`button`, `code`                                                                                         | `--text-<type>-size/leading/weight` for the matching Astryx text type                                                                                                                                                    |
| the largest `display*`/`hero*` entries                                                                                                                                                                   | `display-1`, `display-2`, `display-3`, by size                                                                                                                                                                           |
| the body, heading, and code entries' `fontFamily`                                                                                                                                                        | `typography.body/heading/code` with `family` and `fallbacks`                                                                                                                                                             |
| `rounded.none/sm/md/lg/xl/full`                                                                                                                                                                          | `--radius-none/inner/element/container/page/full`                                                                                                                                                                        |
| `components.button-primary`, `button-secondary-hover`, …                                                                                                                                                 | `components.button["variant:primary"]`, with `-hover/-active/-focus/-disabled` as pseudo-class overrides                                                                                                                 |
| `spacing.*`, and any name above that Astryx has no role for                                                                                                                                              | kept in the design profile only, reported as `kept-in-profile`                                                                                                                                                           |

The mapping is by name, not by guess: a token either has an Astryx role or it is reported and
kept. That is the rule Koi's master plan sets in §2.4: no parallel token vocabulary, ever.

## Fixture

`fixtures/apple/DESIGN.md` is the Apple design analysis from
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT), a real
third-party file that names things the way designers do. The tests pin what it maps to.
