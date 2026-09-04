import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

/**
 * Koi's identity expressed as values on Astryx's token contract. Only tokens that differ from the
 * neutral theme are listed; typography, radius, spacing, and the categorical palette stay Astryx's.
 * `pnpm theme:build` regenerates the committed `koi.css`, `koi.js`, and `koi.d.ts` next to this
 * file, and `pnpm theme:check` fails the repository gate when they drift.
 */
export const koiTheme = defineTheme({
  name: "koi",
  extends: neutralTheme,
  tokens: {
    "--color-accent": ["#2f5fe8", "#6d9cfe"],
    "--color-on-accent": ["#ffffff", "#0b1226"],
    "--color-accent-muted": ["#e8eeff", "#2f5fe83d"],
    "--color-background-body": ["#e9ebef", "#111112"],
    "--focus-outline-color": "var(--color-accent)",
  },
});
