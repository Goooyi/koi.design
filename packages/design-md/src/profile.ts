import type { AstryxBridgeResult, AstryxThemeSpec } from "./astryx.js";
import type { DesignMdDocument } from "./parse.js";

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
