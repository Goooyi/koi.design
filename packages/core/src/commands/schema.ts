import { z } from "zod";

import {
  elementInputSchema,
  geometrySchema,
  jsonObjectSchema,
  stableIdSchema,
} from "../document/schema.js";
import { exceedsUtf8ByteLimit } from "../encoding/utf8.js";

export const MAX_OPERATIONS_PER_COMMAND = 64;
export const MAX_SERIALIZED_COMMAND_BYTES = 512 * 1024;

const createOperationSchema = z.strictObject({
  type: z.literal("create"),
  pageId: stableIdSchema,
  element: elementInputSchema,
  expectedTombstoneVersion: z.number().int().positive().optional(),
});

export const patchChangesSchema = z
  .strictObject({
    name: z.string().min(1).max(512).nullable().optional(),
    parentId: stableIdSchema.nullable().optional(),
    geometry: geometrySchema.partial().optional(),
    properties: jsonObjectSchema.optional(),
  })
  .refine(
    (changes) =>
      changes.name !== undefined ||
      changes.parentId !== undefined ||
      changes.geometry !== undefined ||
      changes.properties !== undefined,
    { message: "A patch must change at least one supported Element field" },
  );

const patchOperationSchema = z.strictObject({
  type: z.literal("patch"),
  pageId: stableIdSchema,
  elementId: stableIdSchema,
  expectedVersion: z.number().int().positive(),
  changes: patchChangesSchema,
});

const deleteOperationSchema = z.strictObject({
  type: z.literal("delete"),
  pageId: stableIdSchema,
  elementId: stableIdSchema,
  expectedVersion: z.number().int().positive(),
});

/**
 * Replaces the Document's design profile token record (`designProfile.tokens`): the record a
 * DESIGN.md compiles to through `@koidesign/design-md`. The inverse restores the previous record.
 */
const designOperationSchema = z.strictObject({
  type: z.literal("design"),
  tokens: jsonObjectSchema,
});

/** The pseudo target a design operation mutates, for once-per-Command accounting. */
export const DESIGN_PROFILE_TARGET = "design-profile";

export const operationSchema = z.discriminatedUnion("type", [
  createOperationSchema,
  patchOperationSchema,
  deleteOperationSchema,
  designOperationSchema,
]);

export function operationTargetId(operation: Operation): string {
  if (operation.type === "create") return operation.element.id;
  if (operation.type === "design") return DESIGN_PROFILE_TARGET;
  return operation.elementId;
}

export const commandSchema = z
  .strictObject({
    documentId: stableIdSchema,
    commandId: stableIdSchema,
    clientId: stableIdSchema,
    clientSeq: z.number().int().nonnegative(),
    baseCursor: z.number().int().nonnegative(),
    origin: z.enum(["human", "agent"]),
    undoOf: stableIdSchema.optional(),
    operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS_PER_COMMAND),
  })
  .superRefine((command, context) => {
    if (exceedsUtf8ByteLimit(JSON.stringify(command), MAX_SERIALIZED_COMMAND_BYTES)) {
      context.addIssue({
        code: "custom",
        message: `A Command may contain at most ${MAX_SERIALIZED_COMMAND_BYTES} UTF-8 bytes`,
        path: [],
      });
    }
    const targets = new Set<string>();
    for (const [index, operation] of command.operations.entries()) {
      const targetId = operationTargetId(operation);
      if (targets.has(targetId)) {
        context.addIssue({
          code: "custom",
          message:
            operation.type === "design"
              ? "A Command may set the design profile only once"
              : `A Command may mutate Element ${targetId} only once`,
          path: ["operations", index],
        });
      }
      targets.add(targetId);
    }
  });

export type CreateOperation = z.infer<typeof createOperationSchema>;
export type PatchChanges = z.infer<typeof patchChangesSchema>;
export type PatchOperation = z.infer<typeof patchOperationSchema>;
export type DeleteOperation = z.infer<typeof deleteOperationSchema>;
export type DesignOperation = z.infer<typeof designOperationSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type Command = z.infer<typeof commandSchema>;
