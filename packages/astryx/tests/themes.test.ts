import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const generated = (file: string) =>
  readFileSync(new URL(`../src/theme/generated/${file}`, import.meta.url), "utf8");

describe("themes built from DESIGN.md", () => {
  it("compiles Koi's DESIGN.md into a theme with no overrides", () => {
    expect(generated("koi.theme.ts")).toContain('defineTheme({\n  "name": "koi"\n})');
    expect(generated("koi.css")).toContain('[data-astryx-theme="koi"]');
  });

  it("compiles the Apple DESIGN.md into an Astryx theme with its accent", () => {
    expect(generated("apple.theme.ts")).toContain('"accent": [');
    expect(generated("apple.css")).toContain("#0066cc");
    expect(generated("apple.css")).toContain('[data-astryx-theme="apple"]');
  });
});
