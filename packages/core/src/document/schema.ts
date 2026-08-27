import { z } from "zod";

export const KOI_SCHEMA_VERSION = 1 as const;
export const KOI_ASTRYX_PROFILE_VERSION = "0.5.0" as const;

const MAX_NAME_LENGTH = 512;
const MAX_TEXT_LENGTH = 100_000;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 10_000;
const MAX_JSON_COLLECTION_SIZE = 256;
const MAX_NESTING_DEPTH = 64;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

function isBoundedJson(value: unknown): value is JsonValue {
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  const seenObjects = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || ++nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      return false;
    }

    const candidate = current.value;
    if (
      candidate === null ||
      typeof candidate === "boolean" ||
      (typeof candidate === "string" && candidate.length <= MAX_TEXT_LENGTH) ||
      (typeof candidate === "number" && Number.isFinite(candidate))
    ) {
      continue;
    }

    if (Array.isArray(candidate)) {
      if (seenObjects.has(candidate) || candidate.length > MAX_JSON_COLLECTION_SIZE) {
        return false;
      }
      seenObjects.add(candidate);
      for (const item of candidate) {
        stack.push({ depth: current.depth + 1, value: item });
      }
      continue;
    }

    if (typeof candidate !== "object") {
      return false;
    }

    const prototype = Object.getPrototypeOf(candidate);
    if (seenObjects.has(candidate) || (prototype !== Object.prototype && prototype !== null)) {
      return false;
    }
    seenObjects.add(candidate);

    const entries = Object.entries(candidate);
    if (entries.length > MAX_JSON_COLLECTION_SIZE) {
      return false;
    }
    for (const [key, item] of entries) {
      if (key.length === 0 || key.length > MAX_NAME_LENGTH) {
        return false;
      }
      stack.push({ depth: current.depth + 1, value: item });
    }
  }

  return true;
}

export const jsonValueSchema = z.custom<JsonValue>(isBoundedJson, {
  message: "Expected bounded JSON data",
});

export const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    isBoundedJson(value) && value !== null && !Array.isArray(value) && typeof value === "object",
  { message: "Expected a bounded JSON object" },
);

export const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Expected a stable, portable identifier");

const nameSchema = z.string().min(1).max(MAX_NAME_LENGTH);
const colorSchema = z.string().min(1).max(256);
const coordinateSchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const dimensionSchema = z.number().finite().min(0).max(100_000_000);

export const pointSchema = z.strictObject({
  x: coordinateSchema,
  y: coordinateSchema,
});

export const geometrySchema = z.strictObject({
  x: coordinateSchema,
  y: coordinateSchema,
  width: dimensionSchema,
  height: dimensionSchema,
  rotation: z.literal(0).default(0),
});

const commonElementInputShape = {
  schemaVersion: z.literal(KOI_SCHEMA_VERSION),
  id: stableIdSchema,
  name: nameSchema.optional(),
  parentId: stableIdSchema.nullable().default(null),
  geometry: geometrySchema,
};

const commonElementShape = {
  ...commonElementInputShape,
  version: z.number().int().positive(),
};

const framePropertiesSchema = z.strictObject({
  clipContent: z.boolean().default(false),
  background: colorSchema.optional(),
});

const componentPropertiesSchema = z.strictObject({
  profile: z.literal("koi.astryx"),
  profileVersion: z.literal(KOI_ASTRYX_PROFILE_VERSION),
  componentId: stableIdSchema,
  props: jsonObjectSchema.default({}),
});

const textStyleSchema = z.strictObject({
  fontFamily: z.string().min(1).max(256).optional(),
  fontSize: z.number().finite().positive().max(10_000).optional(),
  fontWeight: z.number().int().min(1).max(1_000).optional(),
  color: colorSchema.optional(),
  align: z.enum(["start", "center", "end", "justify"]).optional(),
});

const textPropertiesSchema = z.strictObject({
  content: z.string().max(MAX_TEXT_LENGTH),
  style: textStyleSchema.default({}),
});

const notePropertiesSchema = z.strictObject({
  content: z.string().max(MAX_TEXT_LENGTH),
  color: colorSchema.optional(),
});

const shapePropertiesSchema = z.strictObject({
  shape: z.enum(["rectangle", "ellipse", "line", "arrow"]),
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(10_000).default(1),
});

const connectorEndpointSchema = z.strictObject({
  elementId: stableIdSchema,
  anchor: z.enum(["auto", "top", "right", "bottom", "left", "center"]).default("auto"),
});

const connectorPropertiesSchema = z.strictObject({
  from: connectorEndpointSchema,
  to: connectorEndpointSchema,
  route: z.enum(["straight", "orthogonal", "bezier"]).default("straight"),
  points: z.array(pointSchema).max(1_024).default([]),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().finite().positive().max(10_000).default(1),
});

const inkPointSchema = pointSchema.extend({
  pressure: z.number().finite().min(0).max(1).optional(),
});

const inkPropertiesSchema = z.strictObject({
  points: z.array(inkPointSchema).min(2).max(4_096),
  color: colorSchema,
  width: z.number().finite().positive().max(10_000),
});

const imagePropertiesSchema = z.strictObject({
  assetId: stableIdSchema,
  alt: z.string().max(10_000).default(""),
  fit: z.enum(["contain", "cover", "fill", "none"]).default("contain"),
});

const shaderPropertiesSchema = z.strictObject({
  shaderId: stableIdSchema,
  parameters: jsonObjectSchema.default({}),
  playbackSpeed: z.number().finite().min(-100).max(100).default(1),
  deterministicFrame: z.number().int().nonnegative().default(0),
  quality: z.number().finite().min(0.1).max(2).default(1),
  fallbackAssetId: stableIdSchema.optional(),
});

function defineInputElement<const Kind extends string, Properties extends z.ZodType>(
  kind: Kind,
  properties: Properties,
) {
  return z.strictObject({
    ...commonElementInputShape,
    kind: z.literal(kind),
    properties,
  });
}

function defineElement<const Kind extends string, Properties extends z.ZodType>(
  kind: Kind,
  properties: Properties,
) {
  return z.strictObject({
    ...commonElementShape,
    kind: z.literal(kind),
    properties,
  });
}

export const frameElementInputSchema = defineInputElement("frame", framePropertiesSchema);
export const componentElementInputSchema = defineInputElement(
  "component",
  componentPropertiesSchema,
);
export const textElementInputSchema = defineInputElement("text", textPropertiesSchema);
export const noteElementInputSchema = defineInputElement("note", notePropertiesSchema);
export const shapeElementInputSchema = defineInputElement("shape", shapePropertiesSchema);
export const connectorElementInputSchema = defineInputElement(
  "connector",
  connectorPropertiesSchema,
);
export const inkElementInputSchema = defineInputElement("ink", inkPropertiesSchema);
export const imageElementInputSchema = defineInputElement("image", imagePropertiesSchema);
export const shaderElementInputSchema = defineInputElement("shader", shaderPropertiesSchema);

export const elementInputSchema = z.discriminatedUnion("kind", [
  frameElementInputSchema,
  componentElementInputSchema,
  textElementInputSchema,
  noteElementInputSchema,
  shapeElementInputSchema,
  connectorElementInputSchema,
  inkElementInputSchema,
  imageElementInputSchema,
  shaderElementInputSchema,
]);

export const frameElementSchema = defineElement("frame", framePropertiesSchema);
export const componentElementSchema = defineElement("component", componentPropertiesSchema);
export const textElementSchema = defineElement("text", textPropertiesSchema);
export const noteElementSchema = defineElement("note", notePropertiesSchema);
export const shapeElementSchema = defineElement("shape", shapePropertiesSchema);
export const connectorElementSchema = defineElement("connector", connectorPropertiesSchema);
export const inkElementSchema = defineElement("ink", inkPropertiesSchema);
export const imageElementSchema = defineElement("image", imagePropertiesSchema);
export const shaderElementSchema = defineElement("shader", shaderPropertiesSchema);

export const elementSchema = z.discriminatedUnion("kind", [
  frameElementSchema,
  componentElementSchema,
  textElementSchema,
  noteElementSchema,
  shapeElementSchema,
  connectorElementSchema,
  inkElementSchema,
  imageElementSchema,
  shaderElementSchema,
]);

export const assetSchema = z.strictObject({
  schemaVersion: z.literal(KOI_SCHEMA_VERSION),
  id: stableIdSchema,
  kind: z.enum(["image", "font", "video"]),
  mediaType: z.string().min(1).max(256),
  uri: z.string().min(1).max(4_096),
  checksum: z.string().min(1).max(256).optional(),
  width: dimensionSchema.optional(),
  height: dimensionSchema.optional(),
});

export const designProfileSchema = z.strictObject({
  id: z.literal("koi.astryx"),
  version: z.literal(KOI_ASTRYX_PROFILE_VERSION),
  tokens: jsonObjectSchema.default({}),
});

export const pageSchema = z.strictObject({
  schemaVersion: z.literal(KOI_SCHEMA_VERSION),
  id: stableIdSchema,
  name: nameSchema,
  elements: z.array(elementSchema).max(20_000),
});

const documentShape = {
  schemaVersion: z.literal(KOI_SCHEMA_VERSION),
  id: stableIdSchema,
  workspaceId: stableIdSchema,
  name: nameSchema,
  revision: z.number().int().nonnegative(),
  historyId: stableIdSchema,
  pages: z.array(pageSchema).min(1).max(256),
  assets: z.array(assetSchema).max(10_000).default([]),
  designProfile: designProfileSchema,
};

function addDuplicateIssue(
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  entity: string,
  id: string,
) {
  context.addIssue({
    code: "custom",
    message: `Duplicate ${entity} id: ${id}`,
    path,
  });
}

export const documentSchema = z.strictObject(documentShape).superRefine((document, context) => {
  const pageIds = new Set<string>();
  const assetIds = new Set<string>();
  const elementIds = new Set<string>();
  const assetsById = new Map(document.assets.map((asset) => [asset.id, asset]));

  for (const [assetIndex, asset] of document.assets.entries()) {
    if (assetIds.has(asset.id)) {
      addDuplicateIssue(context, ["assets", assetIndex, "id"], "asset", asset.id);
    }
    assetIds.add(asset.id);
  }

  for (const [pageIndex, page] of document.pages.entries()) {
    if (pageIds.has(page.id)) {
      addDuplicateIssue(context, ["pages", pageIndex, "id"], "page", page.id);
    }
    pageIds.add(page.id);

    const elementsById = new Map(page.elements.map((element) => [element.id, element]));
    for (const [elementIndex, element] of page.elements.entries()) {
      const path = ["pages", pageIndex, "elements", elementIndex] as PropertyKey[];
      if (elementIds.has(element.id)) {
        addDuplicateIssue(context, [...path, "id"], "element", element.id);
      }
      elementIds.add(element.id);

      if (element.parentId !== null) {
        const parent = elementsById.get(element.parentId);
        if (!parent) {
          context.addIssue({
            code: "custom",
            message: `Parent does not exist on this Page: ${element.parentId}`,
            path: [...path, "parentId"],
          });
        } else if (parent.kind !== "frame") {
          context.addIssue({
            code: "custom",
            message: `Only Frames can contain Elements: ${element.parentId}`,
            path: [...path, "parentId"],
          });
        }
      }

      if (element.kind === "connector") {
        for (const endpoint of [element.properties.from, element.properties.to]) {
          if (endpoint.elementId === element.id || !elementsById.has(endpoint.elementId)) {
            context.addIssue({
              code: "custom",
              message: `Connector endpoint does not identify another Element on this Page: ${endpoint.elementId}`,
              path: [...path, "properties"],
            });
          }
        }
      }

      if (element.kind === "image") {
        const asset = assetsById.get(element.properties.assetId);
        if (!asset || asset.kind !== "image") {
          context.addIssue({
            code: "custom",
            message: `Image asset does not exist: ${element.properties.assetId}`,
            path: [...path, "properties", "assetId"],
          });
        }
      }

      if (element.kind === "shader" && element.properties.fallbackAssetId) {
        const asset = assetsById.get(element.properties.fallbackAssetId);
        if (!asset || asset.kind !== "image") {
          context.addIssue({
            code: "custom",
            message: `Shader fallback image does not exist: ${element.properties.fallbackAssetId}`,
            path: [...path, "properties", "fallbackAssetId"],
          });
        }
      }
    }

    const resolvedDepths = new Map<string, number>();
    const elementIndexes = new Map(page.elements.map((element, index) => [element.id, index]));
    for (const element of page.elements) {
      if (resolvedDepths.has(element.id)) continue;

      const trail: typeof page.elements = [];
      const trailIndexes = new Map<string, number>();
      let current: (typeof page.elements)[number] | undefined = element;
      let baseDepth = -1;

      while (current) {
        const resolved = resolvedDepths.get(current.id);
        if (resolved !== undefined) {
          baseDepth = resolved;
          break;
        }

        const cycleStart = trailIndexes.get(current.id);
        if (cycleStart !== undefined) {
          const cycleIds = trail.slice(cycleStart).map((candidate) => candidate.id);
          const cycleIndex = elementIndexes.get(current.id) ?? 0;
          context.addIssue({
            code: "custom",
            message: `Element nesting contains a cycle: ${cycleIds.join(" -> ")}`,
            path: ["pages", pageIndex, "elements", cycleIndex, "parentId"],
          });
          baseDepth = -1;
          break;
        }

        trailIndexes.set(current.id, trail.length);
        trail.push(current);
        current = current.parentId === null ? undefined : elementsById.get(current.parentId);
      }

      for (let trailIndex = trail.length - 1; trailIndex >= 0; trailIndex--) {
        const candidate = trail[trailIndex]!;
        baseDepth += 1;
        resolvedDepths.set(candidate.id, baseDepth);
        if (baseDepth > MAX_NESTING_DEPTH) {
          context.addIssue({
            code: "custom",
            message: `Element nesting exceeds the maximum depth of ${MAX_NESTING_DEPTH}`,
            path: [
              "pages",
              pageIndex,
              "elements",
              elementIndexes.get(candidate.id) ?? 0,
              "parentId",
            ],
          });
        }
      }
    }
  }
});

export const workspaceSchema = z
  .strictObject({
    schemaVersion: z.literal(KOI_SCHEMA_VERSION),
    id: stableIdSchema,
    name: nameSchema,
    documents: z.array(documentSchema).max(1_000),
  })
  .superRefine((workspace, context) => {
    const documentIds = new Set<string>();
    for (const [index, document] of workspace.documents.entries()) {
      if (documentIds.has(document.id)) {
        addDuplicateIssue(context, ["documents", index, "id"], "document", document.id);
      }
      documentIds.add(document.id);
      if (document.workspaceId !== workspace.id) {
        context.addIssue({
          code: "custom",
          message: `Document ${document.id} belongs to Workspace ${document.workspaceId}, not ${workspace.id}`,
          path: ["documents", index, "workspaceId"],
        });
      }
    }
  });

export type Point = z.infer<typeof pointSchema>;
export type Geometry = z.infer<typeof geometrySchema>;
export type ElementInput = z.infer<typeof elementInputSchema>;
export type KoiElement = z.infer<typeof elementSchema>;
export type Element = KoiElement;
export type ElementKind = KoiElement["kind"];
export type FrameElement = Extract<KoiElement, { kind: "frame" }>;
export type ComponentElement = Extract<KoiElement, { kind: "component" }>;
export type TextElement = Extract<KoiElement, { kind: "text" }>;
export type NoteElement = Extract<KoiElement, { kind: "note" }>;
export type ShapeElement = Extract<KoiElement, { kind: "shape" }>;
export type ConnectorElement = Extract<KoiElement, { kind: "connector" }>;
export type InkElement = Extract<KoiElement, { kind: "ink" }>;
export type ImageElement = Extract<KoiElement, { kind: "image" }>;
export type ShaderElement = Extract<KoiElement, { kind: "shader" }>;
export type Asset = z.infer<typeof assetSchema>;
export type DesignProfile = z.infer<typeof designProfileSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Document = z.infer<typeof documentSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
