import {
  commandReceiptSchema,
  KOI_ASTRYX_PROFILE_VERSION,
  KOI_DOCUMENT_MEDIA_TYPE,
} from "@koi/core";
import { z } from "zod";

import {
  MAX_INSPECTED_ELEMENTS,
  MAX_SNAPSHOT_CHUNK_BASE64_LENGTH,
  MAX_SNAPSHOT_CHUNKS,
  MAX_TOOL_DOCUMENT_BYTES,
  MAX_TOOL_SNAPSHOT_BYTES,
  MAX_TRANSFERABLE_SNAPSHOT_BYTES,
  SNAPSHOT_CHUNK_BYTES,
} from "./protocol.js";

const wireStableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const wireCoordinateSchema = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const wireDimensionSchema = z.number().finite().min(0).max(100_000_000);

const wireGeometrySchema = z.strictObject({
  x: wireCoordinateSchema,
  y: wireCoordinateSchema,
  width: wireDimensionSchema,
  height: wireDimensionSchema,
  rotation: z.literal(0),
});

const wireJsonObjectSchema = z.record(z.string().min(1).max(512), z.json());

const wireElementSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: wireStableIdSchema,
  kind: z.enum([
    "frame",
    "component",
    "text",
    "note",
    "shape",
    "connector",
    "ink",
    "image",
    "shader",
  ]),
  version: z.number().int().positive(),
  name: z.string().min(1).max(512).optional(),
  parentId: wireStableIdSchema.nullable(),
  geometry: wireGeometrySchema,
  properties: wireJsonObjectSchema,
});

const wireElementInputSchema = wireElementSchema.omit({ version: true });

const wirePageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: wireStableIdSchema,
  name: z.string().min(1).max(512),
  elements: z.array(wireElementSchema).max(20_000),
});

const wireDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: wireStableIdSchema,
  workspaceId: wireStableIdSchema,
  name: z.string().min(1).max(512),
  revision: z.number().int().nonnegative(),
  historyId: wireStableIdSchema,
  pages: z.array(wirePageSchema).min(1).max(256),
  assets: z.array(z.record(z.string(), z.json())).max(10_000),
  designProfile: z.strictObject({
    id: z.literal("koi.astryx"),
    version: z.literal(KOI_ASTRYX_PROFILE_VERSION),
    tokens: wireJsonObjectSchema,
  }),
});

const wireProjectionSchema = z.looseObject({
  schemaVersion: z.literal(1),
  document: wireDocumentSchema,
  cursor: z.number().int().nonnegative(),
  history: z.array(z.record(z.string(), z.json())),
  tombstones: z.record(z.string(), z.json()),
  receipts: z.record(z.string(), z.json()),
  outbox: z.array(z.record(z.string(), z.json())),
  clientHeads: z.record(z.string(), z.json()),
});

const wirePatchChangesSchema = z.strictObject({
  name: z.string().min(1).max(512).nullable().optional(),
  parentId: wireStableIdSchema.nullable().optional(),
  geometry: wireGeometrySchema.partial().optional(),
  properties: wireJsonObjectSchema.optional(),
});

const wireOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("create"),
    pageId: wireStableIdSchema,
    element: wireElementInputSchema,
    expectedTombstoneVersion: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal("patch"),
    pageId: wireStableIdSchema,
    elementId: wireStableIdSchema,
    expectedVersion: z.number().int().positive(),
    changes: wirePatchChangesSchema,
  }),
  z.strictObject({
    type: z.literal("delete"),
    pageId: wireStableIdSchema,
    elementId: wireStableIdSchema,
    expectedVersion: z.number().int().positive(),
  }),
]);

const wireCommandSchema = z.strictObject({
  documentId: wireStableIdSchema,
  commandId: wireStableIdSchema,
  clientId: wireStableIdSchema,
  clientSeq: z.number().int().nonnegative(),
  baseCursor: z.number().int().nonnegative(),
  origin: z.enum(["human", "agent"]),
  undoOf: wireStableIdSchema.optional(),
  operations: z.array(wireOperationSchema).min(1).max(64),
});

export const canvasSnapshotSchema = z.strictObject({
  projection: wireProjectionSchema,
});

const snapshotFingerprintSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);

export const snapshotTransferSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    documentId: wireStableIdSchema,
    revision: z.number().int().nonnegative(),
    cursor: z.number().int().nonnegative(),
    totalBytes: z
      .number()
      .int()
      .min(MAX_TOOL_SNAPSHOT_BYTES + 1)
      .max(MAX_TRANSFERABLE_SNAPSHOT_BYTES),
    chunkBytes: z.literal(SNAPSHOT_CHUNK_BYTES),
    chunkCount: z.number().int().min(2).max(MAX_SNAPSHOT_CHUNKS),
    encoding: z.literal("base64"),
    fingerprint: snapshotFingerprintSchema,
  })
  .superRefine((transfer, context) => {
    if (transfer.cursor < transfer.revision) {
      context.addIssue({
        code: "custom",
        path: ["cursor"],
        message: "cursor cannot precede revision",
      });
    }
    if (transfer.chunkCount !== Math.ceil(transfer.totalBytes / SNAPSHOT_CHUNK_BYTES)) {
      context.addIssue({
        code: "custom",
        path: ["chunkCount"],
        message: "chunkCount does not match totalBytes",
      });
    }
  });

export const openCanvasInputShape = {};

export const openCanvasOutputShape = {
  ok: z.literal(true),
  snapshot: canvasSnapshotSchema.optional(),
  snapshotTransfer: snapshotTransferSchema.optional(),
};

const toolFailureFields = {
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(16_384),
  retryable: z.boolean().optional(),
  operationIndex: z.number().int().nonnegative().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  actualVersion: z.number().int().nonnegative().optional(),
};

export const toolFailureSchema = z.strictObject({
  ok: z.literal(false),
  ...toolFailureFields,
});

function createToolOutputSchema(successShape: Record<string, z.ZodType>) {
  const successFields = Object.entries(successShape).filter(([key]) => key !== "ok");
  const requiredSuccessKeys = successFields
    .filter(([, schema]) => !schema.safeParse(undefined).success)
    .map(([key]) => key);
  const failureKeys = Object.keys(toolFailureFields);
  return z
    .strictObject({
      ok: z.boolean(),
      ...Object.fromEntries(successFields.map(([key, schema]) => [key, schema.optional()])),
      ...Object.fromEntries(
        Object.entries(toolFailureFields).map(([key, schema]) => [key, schema.optional()]),
      ),
    })
    .superRefine((value, context) => {
      const record = value as Record<string, unknown>;
      const requiredKeys = value.ok ? requiredSuccessKeys : ["code", "message"];
      const forbiddenKeys = value.ok ? failureKeys : successFields.map(([key]) => key);
      for (const key of requiredKeys) {
        if (record[key] === undefined) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is required` });
        }
      }
      for (const key of forbiddenKeys) {
        if (record[key] !== undefined) {
          context.addIssue({ code: "custom", path: [key], message: `${key} is not allowed` });
        }
      }
    });
}

export const openCanvasOutputSchema = createToolOutputSchema(openCanvasOutputShape).superRefine(
  (value, context) => {
    const record = value as Record<string, unknown>;
    if (value.ok && (record.snapshot === undefined) === (record.snapshotTransfer === undefined)) {
      context.addIssue({
        code: "custom",
        path: [],
        message: "Exactly one of snapshot or snapshotTransfer is required",
      });
    }
  },
);

export const snapshotChunkInputShape = {
  documentId: wireStableIdSchema,
  cursor: z.number().int().nonnegative(),
  totalBytes: z
    .number()
    .int()
    .min(MAX_TOOL_SNAPSHOT_BYTES + 1)
    .max(MAX_TRANSFERABLE_SNAPSHOT_BYTES),
  fingerprint: snapshotFingerprintSchema,
  chunkIndex: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_SNAPSHOT_CHUNKS - 1),
};

export const snapshotChunkOutputShape = {
  ok: z.literal(true),
  ...snapshotChunkInputShape,
  chunkCount: z.number().int().min(2).max(MAX_SNAPSHOT_CHUNKS),
  byteOffset: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_TRANSFERABLE_SNAPSHOT_BYTES - 1),
  byteLength: z.number().int().positive().max(SNAPSHOT_CHUNK_BYTES),
  encoding: z.literal("base64"),
  data: z.string().min(1).max(MAX_SNAPSHOT_CHUNK_BASE64_LENGTH),
};

export const snapshotChunkOutputSchema = createToolOutputSchema(snapshotChunkOutputShape);

export const inspectElementsInputShape = {
  elementIds: z.array(wireStableIdSchema).min(1).max(MAX_INSPECTED_ELEMENTS),
};

export const elementPreviewSchema = z.strictObject({
  id: wireStableIdSchema,
  pageId: wireStableIdSchema,
  pageName: z.string().min(1).max(512),
  kind: wireElementSchema.shape.kind,
  version: z.number().int().positive(),
  name: z.string().min(1).max(512).optional(),
  parentId: wireStableIdSchema.nullable(),
  geometry: wireGeometrySchema,
  properties: wireJsonObjectSchema,
  truncated: z.boolean(),
});

export const inspectElementsOutputShape = {
  ok: z.literal(true),
  documentId: wireStableIdSchema,
  revision: z.number().int().nonnegative(),
  elements: z.array(elementPreviewSchema).max(MAX_INSPECTED_ELEMENTS),
  missingIds: z.array(wireStableIdSchema).max(MAX_INSPECTED_ELEMENTS),
};

export const inspectElementsOutputSchema = createToolOutputSchema(inspectElementsOutputShape);

export const applyCommandInputShape = {
  command: wireCommandSchema,
};

export const applyCommandOutputShape = {
  ok: z.literal(true),
  receipt: commandReceiptSchema,
  replayed: z.boolean(),
  snapshot: canvasSnapshotSchema.optional(),
  refreshRequired: z.boolean(),
};

export const applyCommandOutputSchema = createToolOutputSchema(applyCommandOutputShape);

export const exportDocumentInputShape = {
  expectedRevision: z.number().int().nonnegative().optional(),
};

export const exportDocumentOutputShape = {
  ok: z.literal(true),
  documentId: wireStableIdSchema,
  revision: z.number().int().nonnegative(),
  filename: z.string().min(1).max(256),
  mediaType: z.literal(KOI_DOCUMENT_MEDIA_TYPE),
  documentJson: z.string().max(MAX_TOOL_DOCUMENT_BYTES),
};

export const exportDocumentOutputSchema = createToolOutputSchema(exportDocumentOutputShape);

export const importDocumentInputShape = {
  commandId: wireStableIdSchema,
  expectedDocumentId: wireStableIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  documentJson: z.string().min(1).max(MAX_TOOL_DOCUMENT_BYTES),
};

export const importDocumentOutputShape = {
  ok: z.literal(true),
  commandId: wireStableIdSchema,
  replayed: z.boolean(),
  snapshot: canvasSnapshotSchema.optional(),
  snapshotTransfer: snapshotTransferSchema.optional(),
};

export const importDocumentOutputSchema = createToolOutputSchema(
  importDocumentOutputShape,
).superRefine((value, context) => {
  const record = value as Record<string, unknown>;
  if (value.ok && (record.snapshot === undefined) === (record.snapshotTransfer === undefined)) {
    context.addIssue({
      code: "custom",
      path: [],
      message: "Exactly one of snapshot or snapshotTransfer is required",
    });
  }
});
