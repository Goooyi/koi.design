import { defineTheme } from "@astryxdesign/core/theme";

/**
 * Koi's theme on Astryx's token contract. It deliberately carries no overrides yet: Koi renders on
 * Astryx's defaults (white surfaces, cool light body, system font stack, blue accent) until a real
 * theming pass derives values from a DESIGN.md. When that happens the values land here, in this
 * one `defineTheme` call, and nowhere else. `pnpm theme:build` regenerates the committed
 * `koi.css`, `koi.js`, and `koi.d.ts` next to this file, and `pnpm theme:check` fails the
 * repository gate when they drift.
 */
export const koiTheme = defineTheme({
  name: "koi",
});
