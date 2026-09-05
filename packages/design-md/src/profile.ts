import { z } from "zod";

import type { AstryxBridgeResult, AstryxThemeSpec } from "./astryx.js";
import type { DesignMdDocument } from "./parse.js";

const tokenValueSchema = z.union([z.string(), z.tuple([z.string(), z.string()])]);
const fontRoleSchema = z.object({ family: z.string(), fallbacks: z.string().optional() });
const componentStylesSchema = z.record(
  z.string(),
  z.union([z.string(), z.record(z.string(), z.string())]),
);

/** The JSON shape of `AstryxThemeSpec`, for validating records that come back from a document. */
export const astryxThemeSpecSchema = z.object({
  name: z.string().min(1),
  color: z.object({ accent: tokenValueSchema }).optional(),
  typography: z
    .object({
      body: fontRoleSchema.optional(),
      heading: fontRoleSchema.optional(),
      code: fontRoleSchema.optional(),
    })
    .optional(),
  tokens: z.record(z.string(), tokenValueSchema),
  components: z.record(z.string(), z.record(z.string(), componentStylesSchema)),
});

/** The JSON shape of `DesignProfile`, pinned to the profile and format versions. */
export const designProfileSchema = z.object({
  profile: z.literal("koi.astryx"),
  profileVersion: z.literal("0.5.0"),
  format: z.literal("design-md"),
  formatVersion: z.literal("alpha"),
  name: z.string().min(1),
  description: z.string().nullable(),
  theme: astryxThemeSpecSchema,
  unmapped: z.record(z.string(), z.record(z.string(), z.unknown())),
});

/** Validate a stored design profile record; `null` when it is not one this bridge produced. */
export function parseDesignProfile(value: unknown): DesignProfile | null {
  const parsed = designProfileSchema.safeParse(value);
  return parsed.success ? (parsed.data as DesignProfile) : null;
}

/**
 * The design profile record a Koi document carries: the Astryx theme the design compiles to,
 * pinned to the profile and format versions, plus every DESIGN.md token Astryx has no name for so
 * that nothing the designer wrote is lost.
 */
export interface DesignProfile {
  profile: "koi.astryx";
  profileVersion: "0.5.0";
  format: "design-md";
  formatVersion: "alpha";
  name: string;
  description: string | null;
  theme: AstryxThemeSpec;
  unmapped: Record<string, Record<string, unknown>>;
}

export function toDesignProfile(doc: DesignMdDocument, result: AstryxBridgeResult): DesignProfile {
  const unmapped: Record<string, Record<string, unknown>> = {};
  for (const path of result.coverage.unmapped) {
    const dot = path.indexOf(".");
    const family = path.slice(0, dot);
    const name = path.slice(dot + 1);
    const group = doc.frontMatter[family as keyof typeof doc.frontMatter] as
      | Record<string, unknown>
      | undefined;
    if (!group || !(name in group)) continue;
    (unmapped[family] ??= {})[name] = group[name];
  }
  return {
    profile: result.profile.id,
    profileVersion: result.profile.version,
    format: "design-md",
    formatVersion: result.formatVersion,
    name: doc.name,
    description: doc.description,
    theme: result.theme,
    unmapped,
  };
}
