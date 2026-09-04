import { toAstryxTheme, type AstryxBridgeResult, type BridgeOptions } from "./astryx.js";
import { emitThemeModule, type EmitOptions } from "./emit.js";
import { parseDesignMd, type DesignMdDocument, type ParseOptions } from "./parse.js";
import { toDesignProfile, type DesignProfile } from "./profile.js";

export interface BuildOptions extends ParseOptions, BridgeOptions, EmitOptions {}

export interface BuildResult {
  document: DesignMdDocument;
  bridge: AstryxBridgeResult;
  profile: DesignProfile;
  /** TypeScript source of the `defineTheme` module. */
  module: string;
}

/** Parse, map, and emit in one step. */
export function buildTheme(source: string, options: BuildOptions = {}): BuildResult {
  const document = parseDesignMd(source, options);
  const bridge = toAstryxTheme(document, options);
  const profile = toDesignProfile(document, bridge);
  const module = emitThemeModule(bridge, options);
  return { document, bridge, profile, module };
}
