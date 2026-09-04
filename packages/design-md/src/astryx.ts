import type { Diagnostic } from "./diagnostics.js";
import { resolveReference, type DesignMdDocument } from "./parse.js";
import { isDimension, isTokenReference, type DesignMdTypography } from "./schema.js";

/** The Astryx profile the mapping targets. Token names below are that profile's names. */
export const ASTRYX_PROFILE = { id: "koi.astryx", version: "0.5.0" } as const;

export type TokenValue = string | [light: string, dark: string];

export interface FontRole {
  family: string;
  fallbacks?: string;
}

export type ComponentStyles = Record<string, string | Record<string, string>>;

/** A JSON-serializable subset of Astryx's `DefineThemeInput`. */
export interface AstryxThemeSpec {
  name: string;
  color?: { accent: TokenValue };
  typography?: { body?: FontRole; heading?: FontRole; code?: FontRole };
  tokens: Record<string, TokenValue>;
  components: Record<string, Record<string, ComponentStyles>>;
}

export interface Coverage {
  /** DESIGN.md token path → Astryx target, e.g. `colors.primary` → `color.accent`. */
  mapped: Record<string, string>;
  /** DESIGN.md token paths Astryx has no name for; they stay in the design profile. */
  unmapped: string[];
}

export interface AstryxBridgeResult {
  formatVersion: "alpha";
  profile: typeof ASTRYX_PROFILE;
  theme: AstryxThemeSpec;
  diagnostics: Diagnostic[];
  coverage: Coverage;
}

export interface BridgeOptions {
  /** Theme name; defaults to a slug of the DESIGN.md name. */
  name?: string;
}

interface ColorRole {
  target: string;
  names: readonly string[];
}

/**
 * Colour roles Astryx names, and the DESIGN.md names that fill them. The first name present wins,
 * and a `<name>-dark` or `<name>-on-dark` sibling supplies the dark value of a light/dark pair.
 * The spec's recommended names (`primary`, `secondary`, `neutral`, `surface`, `on-surface`,
 * `error`) are included; `secondary` and `tertiary` have no Astryx role and stay in the profile.
 */
const COLOR_ROLES: readonly ColorRole[] = [
  { target: "color.accent", names: ["primary", "accent", "brand", "interactive"] },
  {
    target: "--color-on-accent",
    names: ["on-primary", "on-accent", "primary-foreground", "primary-contrast"],
  },
  {
    target: "--color-background-body",
    names: ["background", "canvas", "page", "background-body", "body-background"],
  },
  {
    target: "--color-background-surface",
    names: ["surface", "card", "background-surface", "surface-primary"],
  },
  {
    target: "--color-background-muted",
    names: [
      "background-muted",
      "surface-muted",
      "muted",
      "background-secondary",
      "surface-secondary",
      "surface-container",
    ],
  },
  {
    target: "--color-text-primary",
    names: [
      "ink",
      "text",
      "foreground",
      "text-primary",
      "on-surface",
      "on-background",
      "body-text",
    ],
  },
  {
    target: "--color-text-secondary",
    names: [
      "text-secondary",
      "secondary-text",
      "text-muted",
      "ink-muted",
      "muted-text",
      "on-surface-variant",
      "subtle",
    ],
  },
  { target: "--color-text-disabled", names: ["text-disabled", "disabled"] },
  {
    target: "--color-border",
    names: ["border", "hairline", "divider", "outline", "stroke", "line"],
  },
  {
    target: "--color-border-emphasized",
    names: ["border-emphasized", "border-strong", "outline-strong", "border-emphasis"],
  },
  { target: "--color-error", names: ["error", "danger", "destructive", "critical"] },
  { target: "--color-on-error", names: ["on-error", "on-danger"] },
  { target: "--color-success", names: ["success", "positive"] },
  { target: "--color-on-success", names: ["on-success"] },
  { target: "--color-warning", names: ["warning", "caution"] },
  { target: "--color-on-warning", names: ["on-warning"] },
  { target: "--color-neutral", names: ["neutral"] },
  { target: "--color-on-dark", names: ["on-dark"] },
  { target: "--color-on-light", names: ["on-light"] },
  { target: "--color-overlay", names: ["overlay", "scrim", "backdrop"] },
  { target: "--focus-outline-color", names: ["focus", "focus-ring", "focus-outline"] },
];

/** Astryx text types and the DESIGN.md names that fill them, in priority order. */
const TEXT_TYPE_NAMES: ReadonlyArray<[type: string, names: readonly string[]]> = [
  ["heading-1", ["h1", "headline-lg", "heading", "title"]],
  ["heading-2", ["h2", "headline-md", "subtitle"]],
  ["heading-3", ["h3", "headline-sm"]],
  ["heading-4", ["h4"]],
  ["heading-5", ["h5"]],
  ["heading-6", ["h6"]],
  ["body", ["body", "body-md", "paragraph", "text", "base"]],
  ["large", ["body-lg", "lead", "large", "body-large"]],
  ["supporting", ["body-sm", "caption", "supporting", "small", "footnote", "body-small"]],
  ["label", ["label", "label-md", "label-lg", "label-sm", "button", "button-md", "button-label"]],
  ["code", ["code", "mono", "monospace", "code-md"]],
];

const DISPLAY_NAME = /^(hero|display|headline-display)/;

/** The spec's recommended rounded levels, by name, onto Astryx's radius steps. */
const ROUNDED_LEVELS: Record<string, string> = {
  none: "--radius-none",
  sm: "--radius-inner",
  md: "--radius-element",
  lg: "--radius-container",
  xl: "--radius-page",
  "2xl": "--radius-page",
  pill: "--radius-full",
  full: "--radius-full",
};

/** Astryx components whose `components` overrides this bridge knows how to address. */
const COMPONENT_VARIANTS: Record<string, readonly string[]> = {
  button: ["primary", "secondary", "ghost", "destructive"],
  badge: [
    "neutral",
    "info",
    "success",
    "warning",
    "error",
    "blue",
    "cyan",
    "green",
    "orange",
    "pink",
    "purple",
    "red",
  ],
  link: [],
  card: [],
  banner: [],
  "text-input": [],
  textarea: [],
  tooltip: [],
  popover: [],
  dialog: [],
  kbd: [],
  token: [],
};

const COMPONENT_STATES: Record<string, string> = {
  hover: ":hover",
  active: ":active",
  pressed: ":active",
  focus: ":focus-visible",
  disabled: ":disabled",
};

const COMPONENT_PROPERTIES: Record<string, string> = {
  backgroundColor: "backgroundColor",
  textColor: "color",
  rounded: "borderRadius",
  padding: "padding",
  height: "height",
  width: "width",
};

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "theme"
  );
}

function px(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function sizeInPx(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?(?:\d+|\d*\.\d+))(px|em|rem)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "px" ? amount : amount * 16;
}

function splitFamily(fontFamily: string): FontRole {
  const parts = fontFamily
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const family = parts[0] ?? fontFamily.trim();
  return parts.length > 1 ? { family, fallbacks: parts.slice(1).join(", ") } : { family };
}

interface Mapper {
  theme: AstryxThemeSpec;
  diagnostics: Diagnostic[];
  coverage: Coverage;
  doc: DesignMdDocument;
}

function summarize(mapper: Mapper, family: string, unmapped: string[]): void {
  if (unmapped.length === 0) return;
  mapper.diagnostics.push({
    severity: "info",
    code: "kept-in-profile",
    message: `${family}: ${unmapped.length} name${unmapped.length === 1 ? "" : "s"} Astryx has no role for stay in the design profile: ${unmapped.join(", ")}`,
    path: family,
  });
}

function mapColors(mapper: Mapper): void {
  const colors = mapper.doc.frontMatter.colors;
  if (!colors) return;
  const byName = new Map(
    Object.entries(colors).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const used = new Set<string>();
  const pick = (names: readonly string[]) => names.find((name) => byName.has(name));

  for (const role of COLOR_ROLES) {
    const name = pick(role.names);
    if (!name) continue;
    used.add(name);
    const light = byName.get(name)!;
    const darkName = [`${name}-dark`, `${name}-on-dark`].find((candidate) => byName.has(candidate));
    let value: TokenValue = light;
    if (darkName) {
      used.add(darkName);
      value = [light, byName.get(darkName)!];
      mapper.coverage.mapped[`colors.${darkName}`] = `${role.target} (dark)`;
    }
    mapper.coverage.mapped[`colors.${name}`] = role.target;
    if (role.target === "color.accent") {
      mapper.theme.color = { accent: value };
    } else {
      mapper.theme.tokens[role.target] = value;
    }
  }

  const textPrimary = mapper.theme.tokens["--color-text-primary"];
  if (textPrimary !== undefined) mapper.theme.tokens["--color-icon-primary"] = textPrimary;
  const textSecondary = mapper.theme.tokens["--color-text-secondary"];
  if (textSecondary !== undefined) mapper.theme.tokens["--color-icon-secondary"] = textSecondary;

  const unmapped = [...byName.keys()].filter((name) => !used.has(name));
  mapper.coverage.unmapped.push(...unmapped.map((name) => `colors.${name}`));
  summarize(mapper, "colors", unmapped);
}

function resolvedTypography(
  mapper: Mapper,
  entry: DesignMdTypography,
): { size?: string; leading?: string; weight?: string; family?: string; tracking?: string } {
  const out: {
    size?: string;
    leading?: string;
    weight?: string;
    family?: string;
    tracking?: string;
  } = {};
  const size = isTokenReference(entry.fontSize)
    ? resolveReference(mapper.doc.frontMatter, entry.fontSize)
    : entry.fontSize;
  if (typeof size === "string" && isDimension(size)) out.size = size;
  if (entry.lineHeight !== undefined) out.leading = String(entry.lineHeight);
  if (entry.fontWeight !== undefined) out.weight = String(entry.fontWeight);
  if (entry.fontFamily) out.family = entry.fontFamily;
  if (entry.letterSpacing !== undefined) out.tracking = px(entry.letterSpacing);
  return out;
}

function mapTypography(mapper: Mapper): void {
  const typography = mapper.doc.frontMatter.typography;
  if (!typography) return;
  const byName = new Map(
    Object.entries(typography).map(([name, entry]) => [name.toLowerCase(), entry]),
  );
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  for (const [type, names] of TEXT_TYPE_NAMES) {
    const name = names.find((candidate) => byName.has(candidate) && !used.has(candidate));
    if (!name) continue;
    assigned.set(type, name);
    used.add(name);
  }
  const displays = [...byName.keys()]
    .filter((name) => DISPLAY_NAME.test(name) && !used.has(name))
    .sort(
      (a, b) =>
        (sizeInPx(resolvedTypography(mapper, byName.get(b)!).size) ?? 0) -
        (sizeInPx(resolvedTypography(mapper, byName.get(a)!).size) ?? 0),
    );
  displays.slice(0, 3).forEach((name, index) => {
    assigned.set(`display-${index + 1}`, name);
    used.add(name);
  });

  for (const [type, name] of assigned) {
    const entry = resolvedTypography(mapper, byName.get(name)!);
    if (entry.size) mapper.theme.tokens[`--text-${type}-size`] = entry.size;
    if (entry.leading) mapper.theme.tokens[`--text-${type}-leading`] = entry.leading;
    if (entry.weight) mapper.theme.tokens[`--text-${type}-weight`] = entry.weight;
    mapper.coverage.mapped[`typography.${name}`] = `--text-${type}-*`;
  }

  const roles: NonNullable<AstryxThemeSpec["typography"]> = {};
  const familyOf = (type: string) => {
    const name = assigned.get(type);
    return name ? resolvedTypography(mapper, byName.get(name)!).family : undefined;
  };
  const body = familyOf("body");
  const heading = familyOf("heading-1") ?? familyOf("display-1");
  const code = familyOf("code");
  if (body) roles.body = splitFamily(body);
  if (heading) roles.heading = splitFamily(heading);
  if (code) roles.code = splitFamily(code);
  if (Object.keys(roles).length > 0) mapper.theme.typography = roles;

  const unmapped = [...byName.keys()].filter((name) => !used.has(name));
  mapper.coverage.unmapped.push(...unmapped.map((name) => `typography.${name}`));
  summarize(mapper, "typography", unmapped);
}

function mapRounded(mapper: Mapper): void {
  const rounded = mapper.doc.frontMatter.rounded;
  if (!rounded) return;
  const unmapped: string[] = [];
  for (const [level, value] of Object.entries(rounded)) {
    const target = ROUNDED_LEVELS[level.toLowerCase()];
    if (!target || target in mapper.theme.tokens) {
      unmapped.push(level);
      continue;
    }
    mapper.theme.tokens[target] = px(value)!;
    mapper.coverage.mapped[`rounded.${level}`] = target;
  }
  mapper.coverage.unmapped.push(...unmapped.map((level) => `rounded.${level}`));
  summarize(mapper, "rounded", unmapped);
}

function mapSpacing(mapper: Mapper): void {
  const spacing = mapper.doc.frontMatter.spacing;
  if (!spacing) return;
  const levels = Object.keys(spacing);
  mapper.coverage.unmapped.push(...levels.map((level) => `spacing.${level}`));
  mapper.diagnostics.push({
    severity: "info",
    code: "spacing-profile-only",
    message: `spacing: Astryx components lay out on its fixed 4px step scale, so the ${levels.length} DESIGN.md levels stay in the design profile`,
    path: "spacing",
  });
}

function parseComponentName(
  name: string,
): { component: string; key: string; pseudo: string | null } | null {
  const segments = name.toLowerCase().split("-");
  for (const width of [2, 1]) {
    const component = segments.slice(0, width).join("-");
    const variants = COMPONENT_VARIANTS[component];
    if (!variants) continue;
    const rest = segments.slice(width);
    if (rest.length === 0) return { component, key: "base", pseudo: null };
    const [first, second, ...extra] = rest;
    if (extra.length > 0) return null;
    if (first! in COMPONENT_STATES && second === undefined) {
      return { component, key: "base", pseudo: COMPONENT_STATES[first!]! };
    }
    if (variants.includes(first!)) {
      if (second === undefined) return { component, key: `variant:${first}`, pseudo: null };
      if (second in COMPONENT_STATES) {
        return { component, key: `variant:${first}`, pseudo: COMPONENT_STATES[second]! };
      }
    }
    return null;
  }
  return null;
}

function componentValue(mapper: Mapper, value: string | number): unknown {
  if (typeof value === "number") return `${value}px`;
  return isTokenReference(value) ? resolveReference(mapper.doc.frontMatter, value) : value;
}

function mapComponents(mapper: Mapper): void {
  const components = mapper.doc.frontMatter.components;
  if (!components) return;
  const unmapped: string[] = [];

  for (const [name, properties] of Object.entries(components)) {
    const parsed = parseComponentName(name);
    if (!parsed) {
      unmapped.push(name);
      continue;
    }
    const styles: Record<string, string> = {};
    for (const [property, raw] of Object.entries(properties)) {
      const value = componentValue(mapper, raw);
      if (property === "typography") {
        if (value && typeof value === "object") {
          const text = resolvedTypography(mapper, value as DesignMdTypography);
          if (text.family) styles.fontFamily = text.family;
          if (text.size) styles.fontSize = text.size;
          if (text.weight) styles.fontWeight = text.weight;
          if (text.leading) styles.lineHeight = text.leading;
          if (text.tracking) styles.letterSpacing = text.tracking;
        }
        continue;
      }
      const target = COMPONENT_PROPERTIES[property];
      if (!target) {
        mapper.diagnostics.push({
          severity: property === "size" ? "info" : "warning",
          code: "component-property-unknown",
          message: `components.${name}.${property} is not a property this bridge maps; it is kept in the design profile`,
          path: `components.${name}.${property}`,
        });
        continue;
      }
      if (typeof value === "string") styles[target] = value;
    }
    if (Object.keys(styles).length === 0) continue;
    const component = (mapper.theme.components[parsed.component] ??= {});
    const bucket = (component[parsed.key] ??= {});
    if (parsed.pseudo) {
      bucket[parsed.pseudo] = {
        ...(bucket[parsed.pseudo] as Record<string, string> | undefined),
        ...styles,
      };
    } else {
      Object.assign(bucket, styles);
    }
    mapper.coverage.mapped[`components.${name}`] =
      `components.${parsed.component}.${parsed.key}${parsed.pseudo ?? ""}`;
  }

  mapper.coverage.unmapped.push(...unmapped.map((name) => `components.${name}`));
  summarize(mapper, "components", unmapped);
}

/**
 * Map a parsed DESIGN.md onto Astryx's token contract for the pinned profile. Everything Astryx
 * has a name for lands in the theme; everything else is reported and kept for the design profile.
 */
export function toAstryxTheme(
  doc: DesignMdDocument,
  options: BridgeOptions = {},
): AstryxBridgeResult {
  const mapper: Mapper = {
    doc,
    theme: { name: options.name ?? slug(doc.name), tokens: {}, components: {} },
    diagnostics: [...doc.diagnostics],
    coverage: { mapped: {}, unmapped: [] },
  };
  mapColors(mapper);
  mapTypography(mapper);
  mapRounded(mapper);
  mapSpacing(mapper);
  mapComponents(mapper);
  mapper.theme.tokens = Object.fromEntries(
    Object.entries(mapper.theme.tokens).sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    formatVersion: doc.formatVersion,
    profile: ASTRYX_PROFILE,
    theme: mapper.theme,
    diagnostics: mapper.diagnostics,
    coverage: mapper.coverage,
  };
}
