import { z } from "zod";

import { commandSchema, operationSchema, type Command, type Operation } from "./schema.js";
import { documentSchema, stableIdSchema, type Document } from "../document/schema.js";

/** Reads stable-ID keyed records without treating Object.prototype names as stored entries. */
export function ownRecordValue<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export const syncStatusSchema = z.enum(["pending", "sending", "acknowledged", "failed"]);

export const MAX_HISTORY_ENTRIES = 50_000;
const MAX_OUTBOX_ENTRIES = 50_000;
const MAX_PROJECTION_RECORDS = 100_000;
export const MAX_PENDING_OUTBOX_COMMANDS = 64;

export const commandReceiptSchema = z.strictObject({
  ok: z.literal(true),
  commandId: stableIdSchema,
  changedIds: z.array(stableIdSchema).max(64),
  viewRevision: z.number().int().nonnegative(),
  historyCursor: z.number().int().nonnegative(),
  syncStatus: syncStatusSchema,
});

export const tombstoneSchema = z.strictObject({
  elementId: stableIdSchema,
  pageId: stableIdSchema,
  version: z.number().int().positive(),
  deletedAtRevision: z.number().int().positive(),
  commandId: stableIdSchema,
});

export const historyEntrySchema = z.strictObject({
  cursor: z.number().int().positive(),
  beforeRevision: z.number().int().nonnegative(),
  afterRevision: z.number().int().positive(),
  command: commandSchema,
  changedIds: z.array(stableIdSchema).max(64),
  inverseOperations: z.array(operationSchema).min(1).max(64),
});

export const outboxEntrySchema = z.strictObject({
  commandId: stableIdSchema,
  status: syncStatusSchema,
  attempts: z.number().int().nonnegative(),
  error: z.string().max(10_000).optional(),
});

export const projectionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    document: documentSchema,
    cursor: z.number().int().nonnegative(),
    history: z.array(historyEntrySchema).max(MAX_HISTORY_ENTRIES),
    tombstones: z.record(stableIdSchema, tombstoneSchema),
    receipts: z.record(stableIdSchema, commandReceiptSchema),
    outbox: z.array(outboxEntrySchema).max(MAX_OUTBOX_ENTRIES),
    clientHeads: z.record(
      stableIdSchema,
      z.strictObject({
        clientSeq: z.number().int().nonnegative(),
        commandId: stableIdSchema,
      }),
    ),
  })
  .superRefine((projection, context) => {
    if (projection.cursor < projection.document.revision) {
      context.addIssue({
        code: "custom",
        message: "Projection cursor cannot precede the Document revision",
        path: ["cursor"],
      });
    }
    if (
      Object.keys(projection.tombstones).length > MAX_PROJECTION_RECORDS ||
      Object.keys(projection.receipts).length > MAX_PROJECTION_RECORDS ||
      Object.keys(projection.clientHeads).length > MAX_PROJECTION_RECORDS
    ) {
      context.addIssue({
        code: "custom",
        message: `Projection record maps may contain at most ${MAX_PROJECTION_RECORDS} entries`,
        path: [],
      });
    }

    const historyByCommandId = new Map<string, HistoryEntry>();
    const latestHistoryByClient = new Map<string, HistoryEntry>();
    let priorCursor = 0;
    for (const [index, entry] of projection.history.entries()) {
      if (entry.cursor <= priorCursor || entry.cursor > projection.cursor) {
        context.addIssue({
          code: "custom",
          message:
            "History cursors must be unique, increasing, and no greater than the Projection cursor",
          path: ["history", index, "cursor"],
        });
      }
      priorCursor = entry.cursor;
      if (
        entry.command.documentId !== projection.document.id ||
        entry.afterRevision !== entry.beforeRevision + 1 ||
        entry.afterRevision > projection.document.revision
      ) {
        context.addIssue({
          code: "custom",
          message: "History entry does not belong to the current Document revision line",
          path: ["history", index],
        });
      }
      if (historyByCommandId.has(entry.command.commandId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate history Command id: ${entry.command.commandId}`,
          path: ["history", index, "command", "commandId"],
        });
      }
      historyByCommandId.set(entry.command.commandId, entry);
      const priorClientEntry = latestHistoryByClient.get(entry.command.clientId);
      if (!priorClientEntry || entry.command.clientSeq > priorClientEntry.command.clientSeq) {
        latestHistoryByClient.set(entry.command.clientId, entry);
      }
      const receipt = ownRecordValue(projection.receipts, entry.command.commandId);
      if (
        !receipt ||
        receipt.commandId !== entry.command.commandId ||
        receipt.historyCursor !== entry.cursor ||
        receipt.viewRevision !== entry.afterRevision ||
        receipt.changedIds.length !== entry.changedIds.length ||
        !receipt.changedIds.every((elementId, changedIndex) =>
          Object.is(elementId, entry.changedIds[changedIndex]),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `History Command ${entry.command.commandId} is missing its matching receipt`,
          path: ["receipts", entry.command.commandId],
        });
      }
    }

    for (const [commandId, receipt] of Object.entries(projection.receipts)) {
      if (commandId !== receipt.commandId || !historyByCommandId.has(commandId)) {
        context.addIssue({
          code: "custom",
          message: `Receipt ${commandId} does not identify a History Command`,
          path: ["receipts", commandId],
        });
      }
    }
    const outboxCommandIds = new Set<string>();
    for (const [index, entry] of projection.outbox.entries()) {
      if (outboxCommandIds.has(entry.commandId) || !historyByCommandId.has(entry.commandId)) {
        context.addIssue({
          code: "custom",
          message: `Outbox entry ${entry.commandId} is duplicate or has no History Command`,
          path: ["outbox", index, "commandId"],
        });
      }
      outboxCommandIds.add(entry.commandId);
    }
    for (const [clientId, head] of Object.entries(projection.clientHeads)) {
      const history = historyByCommandId.get(head.commandId);
      const latest = latestHistoryByClient.get(clientId);
      if (
        !history ||
        history.command.clientId !== clientId ||
        history.command.clientSeq !== head.clientSeq ||
        latest?.command.commandId !== head.commandId
      ) {
        context.addIssue({
          code: "custom",
          message: `Client head ${clientId} does not identify its matching History Command`,
          path: ["clientHeads", clientId],
        });
      }
    }
    for (const clientId of latestHistoryByClient.keys()) {
      if (!ownRecordValue(projection.clientHeads, clientId)) {
        context.addIssue({
          code: "custom",
          message: `History client ${clientId} is missing its Client head`,
          path: ["clientHeads", clientId],
        });
      }
    }
    for (const [elementId, tombstone] of Object.entries(projection.tombstones)) {
      if (elementId !== tombstone.elementId) {
        context.addIssue({
          code: "custom",
          message: "Tombstone key must match its Element id",
          path: ["tombstones", elementId],
        });
      }
    }
  });

export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;
export type Tombstone = z.infer<typeof tombstoneSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type OutboxEntry = z.infer<typeof outboxEntrySchema>;
export type Projection = z.infer<typeof projectionSchema>;

export function createInitialProjection(document: unknown): Projection {
  const parsedDocument = documentSchema.parse(document);
  return {
    schemaVersion: 1,
    document: parsedDocument,
    cursor: parsedDocument.revision,
    history: [],
    tombstones: {},
    receipts: {},
    outbox: [],
    clientHeads: {},
  };
}

export function getPendingOutbox(projection: Projection): OutboxEntry[] {
  return projection.outbox.filter(
    (entry) => entry.status === "pending" || entry.status === "failed",
  );
}

export type OutboxUpdate =
  | { status: "pending" }
  | { status: "sending" }
  | { status: "acknowledged" }
  | { status: "failed"; error: string };

export function updateOutboxEntry(
  projection: Projection,
  commandId: string,
  update: OutboxUpdate,
): Projection {
  const index = projection.outbox.findIndex((entry) => entry.commandId === commandId);
  if (index === -1) {
    throw new Error(`Unknown outbox Command: ${commandId}`);
  }

  const current = projection.outbox[index]!;
  if (current.status === "acknowledged" && update.status !== "acknowledged") {
    throw new Error(`Acknowledged outbox Command cannot return to ${update.status}`);
  }

  const next: OutboxEntry = {
    commandId,
    status: update.status,
    attempts: current.attempts + (update.status === "sending" ? 1 : 0),
    ...(update.status === "failed" ? { error: update.error } : {}),
  };
  const outbox = projection.outbox.slice();
  outbox[index] = next;
  const receipt = ownRecordValue(projection.receipts, commandId);
  const receipts = receipt
    ? {
        ...projection.receipts,
        [commandId]: { ...receipt, syncStatus: update.status },
      }
    : projection.receipts;
  return { ...projection, outbox, receipts };
}

export function acknowledgeOutboxEntry(projection: Projection, commandId: string): Projection {
  const acknowledged = updateOutboxEntry(projection, commandId, { status: "acknowledged" });
  return {
    ...acknowledged,
    outbox: acknowledged.outbox.filter((entry) => entry.commandId !== commandId),
  };
}

export function acknowledgeAllOutboxEntries(projection: Projection): Projection {
  if (projection.outbox.length === 0) return projection;
  const receipts = { ...projection.receipts };
  for (const entry of projection.outbox) {
    const receipt = ownRecordValue(receipts, entry.commandId);
    if (receipt) receipts[entry.commandId] = { ...receipt, syncStatus: "acknowledged" };
  }
  return { ...projection, receipts, outbox: [] };
}

export interface UndoCommandOptions {
  commandId: string;
  clientId: string;
  clientSeq: number;
  origin: Command["origin"];
}

export type UndoCommandResult =
  | { ok: true; command: Command }
  | { ok: false; code: "HISTORY_ENTRY_NOT_FOUND"; message: string };

export function hasHistoryBarrierAfter(projection: Projection, cursor: number): boolean {
  let low = 0;
  let high = projection.history.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (projection.history[middle]!.cursor <= cursor) low = middle + 1;
    else high = middle;
  }
  return projection.history.length - low !== projection.cursor - cursor;
}

function rebaseInverseOperation(projection: Projection, operation: Operation): Operation {
  if (operation.type === "design") return operation;
  if (operation.type === "create") {
    const tombstone = ownRecordValue(projection.tombstones, operation.element.id);
    return tombstone ? { ...operation, expectedTombstoneVersion: tombstone.version } : operation;
  }

  const page = projection.document.pages.find((candidate) => candidate.id === operation.pageId);
  const element = page?.elements.find((candidate) => candidate.id === operation.elementId);
  return element ? { ...operation, expectedVersion: element.version } : operation;
}

export function createUndoCommand(
  projection: Projection,
  targetCommandId: string,
  options: UndoCommandOptions,
): UndoCommandResult {
  const entry = projection.history.find(
    (candidate) => candidate.command.commandId === targetCommandId,
  );
  if (!entry) {
    return {
      ok: false,
      code: "HISTORY_ENTRY_NOT_FOUND",
      message: `Cannot undo unknown Command ${targetCommandId}`,
    };
  }
  if (hasHistoryBarrierAfter(projection, entry.cursor)) {
    return {
      ok: false,
      code: "HISTORY_ENTRY_NOT_FOUND",
      message: `Cannot undo Command ${targetCommandId} across a document replacement`,
    };
  }

  return {
    ok: true,
    command: commandSchema.parse({
      documentId: projection.document.id,
      commandId: options.commandId,
      clientId: options.clientId,
      clientSeq: options.clientSeq,
      baseCursor: projection.cursor,
      origin: options.origin,
      undoOf: targetCommandId,
      operations: entry.inverseOperations.map((operation) =>
        rebaseInverseOperation(projection, operation),
      ),
    }),
  };
}

export type { Command, Document, Operation };
