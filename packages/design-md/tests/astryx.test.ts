import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { ASTRYX_PROFILE, parseDesignMd, toAstryxTheme, toDesignProfile } from "../src/index.js";

const apple = readFileSync(new URL("../fixtures/apple/DESIGN.md", import.meta.url), "utf8");
const bridge = toAstryxTheme(parseDesignMd(apple), { name: "apple" });

describe("toAstryxTheme (Apple fixture)", () => {
  it("pins the format and the Astryx profile", () => {
    expect(bridge.formatVersion).toBe("alpha");
    expect(bridge.profile).toEqual(ASTRYX_PROFILE);
    expect(bridge.theme.name).toBe("apple");
  });

  it("maps colours by role and pairs the accent with its on-dark sibling", () => {
    expect(bridge.theme.color).toEqual({ accent: ["#0066cc", "#2997ff"] });
    expect(bridge.theme.tokens).toMatchObject({
      "--color-on-accent": "#ffffff",
      "--color-background-body": "#ffffff",
      "--color-text-primary": "#1d1d1f",
      "--color-icon-primary": "#1d1d1f",
      "--color-border": "#e0e0e0",
      "--color-on-dark": "#ffffff",
    });
    expect(bridge.coverage.mapped["colors.primary"]).toBe("color.accent");
    expect(bridge.coverage.mapped["colors.primary-on-dark"]).toBe("color.accent (dark)");
    expect(bridge.coverage.unmapped).toContain("colors.canvas-parchment");
    expect(bridge.coverage.unmapped).toContain("colors.ink-muted-48");
  });

  it("assigns text types by name and display types by size", () => {
    expect(bridge.theme.tokens["--text-body-size"]).toBe("17px");
    expect(bridge.theme.tokens["--text-large-size"]).toBe("28px");
    expect(bridge.theme.tokens["--text-display-1-size"]).toBe("56px");
    expect(bridge.theme.tokens["--text-display-2-size"]).toBe("40px");
    expect(bridge.theme.tokens["--text-display-3-size"]).toBe("34px");
    expect(bridge.theme.tokens["--text-display-1-weight"]).toBe("600");
    expect(bridge.theme.tokens["--text-display-1-leading"]).toBe("1.07");
    expect(bridge.theme.typography).toEqual({
      body: { family: "SF Pro Text", fallbacks: "system-ui, -apple-system, sans-serif" },
      heading: { family: "SF Pro Display", fallbacks: "system-ui, -apple-system, sans-serif" },
    });
    expect(bridge.coverage.unmapped).toContain("typography.micro-legal");
  });

  it("maps the spec's rounded levels by name and keeps spacing in the profile", () => {
    expect(bridge.theme.tokens).toMatchObject({
      "--radius-none": "0px",
      "--radius-inner": "8px",
      "--radius-element": "11px",
      "--radius-container": "18px",
      "--radius-full": "9999px",
    });
    expect(bridge.coverage.unmapped).toContain("rounded.xs");
    expect(bridge.coverage.unmapped).toContain("spacing.section");
    expect(bridge.diagnostics.map((d) => d.code)).toContain("spacing-profile-only");
  });

  it("maps button variants and states onto Astryx component overrides", () => {
    const button = bridge.theme.components.button!;
    expect(button["variant:primary"]).toMatchObject({
      backgroundColor: "#0066cc",
      color: "#ffffff",
      borderRadius: "9999px",
      padding: "11px 22px",
      fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif",
      fontSize: "17px",
      ":focus-visible": { backgroundColor: "#0066cc" },
      ":active": { backgroundColor: "#0066cc" },
    });
    expect(bridge.coverage.unmapped).toContain("components.button-dark-utility");
    expect(bridge.coverage.unmapped).toContain("components.product-tile-light");
    expect(bridge.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps every unmapped token in the design profile", () => {
    const profile = toDesignProfile(parseDesignMd(apple), bridge);
    expect(profile).toMatchObject({
      profile: "koi.astryx",
      profileVersion: "0.5.0",
      format: "design-md",
      formatVersion: "alpha",
      name: "Apple-design-analysis",
    });
    expect(profile.unmapped.colors?.["canvas-parchment"]).toBe("#f5f5f7");
    expect(profile.unmapped.spacing?.section).toBe("80px");
    expect(profile.theme).toBe(bridge.theme);
  });
});
