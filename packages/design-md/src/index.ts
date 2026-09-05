export {
  ASTRYX_PROFILE,
  toAstryxTheme,
  type AstryxBridgeResult,
  type AstryxThemeSpec,
  type BridgeOptions,
  type ComponentStyles,
  type Coverage,
  type FontRole,
  type TokenValue,
} from "./astryx.js";
export { buildTheme, type BuildOptions, type BuildResult } from "./build.js";
export { DesignMdError, formatDiagnostic, type Diagnostic, type Severity } from "./diagnostics.js";
export {
  emitProfileModule,
  emitThemeModule,
  themeExportName,
  themeInput,
  type EmitOptions,
} from "./emit.js";
export {
  SECTION_ORDER,
  canonicalSectionName,
  parseDesignMd,
  resolveReference,
  type DesignMdDocument,
  type DesignMdSection,
  type ParseOptions,
} from "./parse.js";
export {
  astryxThemeSpecSchema,
  designProfileSchema,
  parseDesignProfile,
  toDesignProfile,
  type DesignProfile,
} from "./profile.js";
export {
  DESIGN_MD_FORMAT_VERSION,
  frontMatterSchema,
  isDimension,
  isTokenReference,
  typographySchema,
  type DesignMdFrontMatter,
  type DesignMdTypography,
} from "./schema.js";
