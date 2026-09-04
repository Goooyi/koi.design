import { z } from "zod";

/** The DESIGN.md format version this bridge implements. */
export const DESIGN_MD_FORMAT_VERSION = "alpha";

const DIMENSION = /^-?(?:\d+|\d*\.\d+)(?:px|em|rem)$/;
const REFERENCE = /^\{[A-Za-z0-9_.-]+\}$/;

/** A dimension per the spec: a number with a px, em, or rem suffix. */
export const dimensionSchema = z
  .string()
  .regex(DIMENSION, "expected a dimension with a px, em, or rem suffix");
const referenceSchema = z.string().regex(REFERENCE, "expected a {path.to.token} reference");
const colorSchema = z.string().trim().min(1, "expected a CSS color");

/** A typography entry. Unknown keys are kept, as the spec asks consumers to preserve them. */
export const typographySchema = z.looseObject({
  fontFamily: z.string().optional(),
  fontSize: z.union([dimensionSchema, referenceSchema]).optional(),
  fontWeight: z.union([z.number(), z.string().regex(/^\d{3}$/)]).optional(),
  lineHeight: z
    .union([dimensionSchema, z.number(), z.string().regex(/^(?:\d+|\d*\.\d+)$/)])
    .optional(),
  letterSpacing: z.union([dimensionSchema, z.number()]).optional(),
  fontFeature: z.string().optional(),
  fontVariation: z.string().optional(),
});

export const omittedSchema = z.array(
  z.union([z.string(), z.object({ section: z.string(), reason: z.string().optional() })]),
);

export const componentSchema = z.record(z.string(), z.union([z.string(), z.number()]));

/** The front-matter schema for DESIGN.md `alpha`. */
export const frontMatterSchema = z.looseObject({
  version: z.string().optional(),
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  omitted: omittedSchema.optional(),
  colors: z.record(z.string(), colorSchema).optional(),
  typography: z.record(z.string(), typographySchema).optional(),
  rounded: z.record(z.string(), z.union([dimensionSchema, z.number()])).optional(),
  spacing: z.record(z.string(), z.union([dimensionSchema, z.number(), z.string()])).optional(),
  components: z.record(z.string(), componentSchema).optional(),
});

export type DesignMdFrontMatter = z.infer<typeof frontMatterSchema>;
export type DesignMdTypography = z.infer<typeof typographySchema>;

export function isTokenReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

export function isDimension(value: unknown): value is string {
  return typeof value === "string" && DIMENSION.test(value);
}
