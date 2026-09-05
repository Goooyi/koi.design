import { z } from "zod";

import {
  commandSchema,
  operationSchema,
  type Command,
  type Operation,
  DESIGN_PROFILE_TARGET,
} from "./schema.js";
import {
  type CommandReceipt,
  type HistoryEntry,
  type Projection,
  type Tombstone,
  hasHistoryBarrierAfter,
  MAX_HISTORY_ENTRIES,
  MAX_PENDING_OUTBOX_COMMANDS,
  ownRecordValue,
} from "./projection.js";
import {
  documentSchema,
  elementSchema,
  type Document,
  type Element,
  type ElementInput,
  type Page,
} from "../document/schema.js";

export type CommandErrorCode =
  | "INVALID_COMMAND"
  | "DOCUMENT_MISMATCH"
  | "DUPLICATE_COMMAND_ID"
  | "CLIENT_SEQUENCE_CONFLICT"
  | "CURSOR_AHEAD"
  | "CURSOR_EPOCH_CONFLICT"
  | "UNDO_CONFLICT"
  | "PAGE_NOT_FOUND"
  | "ELEMENT_ALREADY_EXISTS"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_DELETED"
  | "ELEMENT_PAGE_MISMATCH"
  | "VERSION_CONFLICT"
  | "TOMBSTONE_CONFLICT"
  | "INTEGRITY_CONFLICT"
  | "RESOURCE_LIMIT";

export interface CommandError {
  ok: false;
  code: CommandErrorCode;
  message: string;
  operationIndex?: number;
  issues?: z.core.$ZodIssue[];
  expectedVersion?: number;
  actualVersion?: number;
}

export type ApplyCommandResult =
  | { ok: true; projection: Projection; receipt: CommandReceipt; replayed: boolean }
  | { ok: false; projection: Projection; error: CommandError };

interface ElementLocation {
  pageIndex: number;
  elementIndex: number;
  page: Page;
  element: Element;
}

interface OperationResult {
  document: Document;
  tombstones: Record<string, Tombstone>;
  inverse: Operation;
  elementId: string;
}

function isCommandError(result: OperationResult | CommandError): result is CommandError {
  return "ok" in result && result.ok === false;
}

function failure(
  projection: Projection,
  code: CommandErrorCode,
  message: string,
  details: Omit<CommandError, "ok" | "code" | "message"> = {},
): ApplyCommandResult {
  return { ok: false, projection, error: { ok: false, code, message, ...details } };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function commandsEqual(left: Command, right: Command): boolean {
  return valuesEqual(left, right);
}

function compensationOperationsEqual(left: Operation[], right: Operation[]): boolean {
  const withoutConcurrencyToken = (operation: Operation): Record<string, unknown> => {
    if (operation.type === "create") {
      const { expectedTombstoneVersion: _expectedTombstoneVersion, ...semantic } = operation;
      return semantic;
    }
    if (operation.type === "design") return operation;
    const { expectedVersion: _expectedVersion, ...semantic } = operation;
    return semantic;
  };

  return (
    left.length === right.length &&
    left.every((operation, index) =>
      valuesEqual(withoutConcurrencyToken(operation), withoutConcurrencyToken(right[index]!)),
    )
  );
}

function hasNewerActiveMutation(projection: Projection, target: HistoryEntry): boolean {
  const compensated = new Set(
    projection.history.flatMap((entry) => (entry.command.undoOf ? [entry.command.undoOf] : [])),
  );
  const targetIds = new Set(target.changedIds);
  return projection.history.some(
    (entry) =>
      entry.cursor > target.cursor &&
      entry.command.undoOf === undefined &&
      !compensated.has(entry.command.commandId) &&
      entry.changedIds.some((elementId) => targetIds.has(elementId)),
  );
}

function findElement(document: Document, elementId: string): ElementLocation | undefined {
  for (const [pageIndex, page] of document.pages.entries()) {
    const elementIndex = page.elements.findIndex((element) => element.id === elementId);
    if (elementIndex !== -1) {
      return { pageIndex, elementIndex, page, element: page.elements[elementIndex]! };
    }
  }
  return undefined;
}

function findPageIndex(document: Document, pageId: string): number {
  return document.pages.findIndex((page) => page.id === pageId);
}

function replacePage(document: Document, pageIndex: number, page: Page): Document {
  const pages = document.pages.slice();
  pages[pageIndex] = page;
  return { ...document, pages };
}

function withoutVersion(element: Element): ElementInput {
  const { version: _version, ...input } = element;
  return input;
}

function createElement(
  document: Document,
  tombstones: Record<string, Tombstone>,
  operation: Extract<Operation, { type: "create" }>,
  operationIndex: number,
): OperationResult | CommandError {
  const pageIndex = findPageIndex(document, operation.pageId);
  if (pageIndex === -1) {
    return {
      ok: false,
      code: "PAGE_NOT_FOUND",
      message: `Page ${operation.pageId} does not exist`,
      operationIndex,
    };
  }

  if (findElement(document, operation.element.id)) {
    return {
      ok: false,
      code: "ELEMENT_ALREADY_EXISTS",
      message: `Element ${operation.element.id} already exists`,
      operationIndex,
    };
  }

  const tombstone = ownRecordValue(tombstones, operation.element.id);
  if (tombstone) {
    if (operation.expectedTombstoneVersion === undefined) {
      return {
        ok: false,
        code: "ELEMENT_DELETED",
        message: `Element ${operation.element.id} was deleted at version ${tombstone.version}`,
        operationIndex,
        actualVersion: tombstone.version,
      };
    }
    if (
      tombstone.version !== operation.expectedTombstoneVersion ||
      tombstone.pageId !== operation.pageId
    ) {
      return {
        ok: false,
        code: "TOMBSTONE_CONFLICT",
        message: `Element ${operation.element.id} no longer has the expected tombstone`,
        operationIndex,
        expectedVersion: operation.expectedTombstoneVersion,
        actualVersion: tombstone.version,
      };
    }
  } else if (operation.expectedTombstoneVersion !== undefined) {
    return {
      ok: false,
      code: "TOMBSTONE_CONFLICT",
      message: `Element ${operation.element.id} has no tombstone to restore`,
      operationIndex,
      expectedVersion: operation.expectedTombstoneVersion,
    };
  }

  const version = tombstone ? tombstone.version + 1 : 1;
  const parsed = elementSchema.safeParse({ ...operation.element, version });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INTEGRITY_CONFLICT",
      message: `Element ${operation.element.id} is not valid for its kind`,
      operationIndex,
      issues: parsed.error.issues,
    };
  }

  const page = document.pages[pageIndex]!;
  const nextPage = { ...page, elements: [...page.elements, parsed.data] };
  const nextTombstones = tombstone ? { ...tombstones } : tombstones;
  if (tombstone) {
    delete nextTombstones[operation.element.id];
  }

  return {
    document: replacePage(document, pageIndex, nextPage),
    tombstones: nextTombstones,
    inverse: operationSchema.parse({
      type: "delete",
      pageId: operation.pageId,
      elementId: operation.element.id,
      expectedVersion: version,
    }),
    elementId: operation.element.id,
  };
}

function patchElement(
  document: Document,
  tombstones: Record<string, Tombstone>,
  operation: Extract<Operation, { type: "patch" }>,
  operationIndex: number,
): OperationResult | CommandError {
  const location = findElement(document, operation.elementId);
  if (!location) {
    const tombstone = ownRecordValue(tombstones, operation.elementId);
    return tombstone
      ? {
          ok: false,
          code: "ELEMENT_DELETED",
          message: `Element ${operation.elementId} was deleted at version ${tombstone.version}`,
          operationIndex,
          actualVersion: tombstone.version,
        }
      : {
          ok: false,
          code: "ELEMENT_NOT_FOUND",
          message: `Element ${operation.elementId} does not exist`,
          operationIndex,
        };
  }
  if (location.page.id !== operation.pageId) {
    return {
      ok: false,
      code: "ELEMENT_PAGE_MISMATCH",
      message: `Element ${operation.elementId} belongs to Page ${location.page.id}`,
      operationIndex,
    };
  }
  if (location.element.version !== operation.expectedVersion) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message: `Element ${operation.elementId} is version ${location.element.version}, not ${operation.expectedVersion}`,
      operationIndex,
      expectedVersion: operation.expectedVersion,
      actualVersion: location.element.version,
    };
  }

  const { changes } = operation;
  const nextCandidate: Record<string, unknown> = {
    ...location.element,
    version: location.element.version + 1,
    geometry: changes.geometry
      ? { ...location.element.geometry, ...changes.geometry }
      : location.element.geometry,
    parentId: changes.parentId === undefined ? location.element.parentId : changes.parentId,
    properties: changes.properties ?? location.element.properties,
  };
  if (changes.name === null) {
    delete nextCandidate.name;
  } else if (changes.name !== undefined) {
    nextCandidate.name = changes.name;
  }

  const parsed = elementSchema.safeParse(nextCandidate);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INTEGRITY_CONFLICT",
      message: `Patch is not valid for ${location.element.kind} Element ${operation.elementId}`,
      operationIndex,
      issues: parsed.error.issues,
    };
  }

  const inverseChanges: Record<string, unknown> = {};
  if (changes.name !== undefined) {
    inverseChanges.name = location.element.name ?? null;
  }
  if (changes.parentId !== undefined) {
    inverseChanges.parentId = location.element.parentId;
  }
  if (changes.geometry !== undefined) {
    inverseChanges.geometry = Object.fromEntries(
      Object.keys(changes.geometry).map((key) => [
        key,
        location.element.geometry[key as keyof typeof location.element.geometry],
      ]),
    );
  }
  if (changes.properties !== undefined) {
    inverseChanges.properties = location.element.properties;
  }

  const elements = location.page.elements.slice();
  elements[location.elementIndex] = parsed.data;
  return {
    document: replacePage(document, location.pageIndex, { ...location.page, elements }),
    tombstones,
    inverse: operationSchema.parse({
      type: "patch",
      pageId: operation.pageId,
      elementId: operation.elementId,
      expectedVersion: parsed.data.version,
      changes: inverseChanges,
    }),
    elementId: operation.elementId,
  };
}

function deleteElement(
  document: Document,
  tombstones: Record<string, Tombstone>,
  operation: Extract<Operation, { type: "delete" }>,
  command: Command,
  operationIndex: number,
): OperationResult | CommandError {
  const location = findElement(document, operation.elementId);
  if (!location) {
    const tombstone = ownRecordValue(tombstones, operation.elementId);
    return tombstone
      ? {
          ok: false,
          code: "ELEMENT_DELETED",
          message: `Element ${operation.elementId} was deleted at version ${tombstone.version}`,
          operationIndex,
          actualVersion: tombstone.version,
        }
      : {
          ok: false,
          code: "ELEMENT_NOT_FOUND",
          message: `Element ${operation.elementId} does not exist`,
          operationIndex,
        };
  }
  if (location.page.id !== operation.pageId) {
    return {
      ok: false,
      code: "ELEMENT_PAGE_MISMATCH",
      message: `Element ${operation.elementId} belongs to Page ${location.page.id}`,
      operationIndex,
    };
  }
  if (location.element.version !== operation.expectedVersion) {
    return {
      ok: false,
      code: "VERSION_CONFLICT",
      message: `Element ${operation.elementId} is version ${location.element.version}, not ${operation.expectedVersion}`,
      operationIndex,
      expectedVersion: operation.expectedVersion,
      actualVersion: location.element.version,
    };
  }

  const elements = location.page.elements.slice();
  elements.splice(location.elementIndex, 1);
  const tombstone: Tombstone = {
    elementId: operation.elementId,
    pageId: operation.pageId,
    version: location.element.version + 1,
    deletedAtRevision: document.revision + 1,
    commandId: command.commandId,
  };

  return {
    document: replacePage(document, location.pageIndex, { ...location.page, elements }),
    tombstones: { ...tombstones, [operation.elementId]: tombstone },
    inverse: operationSchema.parse({
      type: "create",
      pageId: operation.pageId,
      element: withoutVersion(location.element),
      expectedTombstoneVersion: tombstone.version,
    }),
    elementId: operation.elementId,
  };
}

function setDesignProfile(
  document: Document,
  tombstones: Record<string, Tombstone>,
  operation: Extract<Operation, { type: "design" }>,
): OperationResult {
  return {
    document: {
      ...document,
      designProfile: { ...document.designProfile, tokens: operation.tokens },
    },
    tombstones,
    inverse: operationSchema.parse({ type: "design", tokens: document.designProfile.tokens }),
    elementId: DESIGN_PROFILE_TARGET,
  };
}

function applyOperation(
  document: Document,
  tombstones: Record<string, Tombstone>,
  operation: Operation,
  command: Command,
  operationIndex: number,
): OperationResult | CommandError {
  switch (operation.type) {
    case "create":
      return createElement(document, tombstones, operation, operationIndex);
    case "patch":
      return patchElement(document, tombstones, operation, operationIndex);
    case "delete":
      return deleteElement(document, tombstones, operation, command, operationIndex);
    case "design":
      return setDesignProfile(document, tombstones, operation);
  }
}

export function applyCommand(projection: Projection, input: unknown): ApplyCommandResult {
  const parsedCommand = commandSchema.safeParse(input);
  if (!parsedCommand.success) {
    return failure(projection, "INVALID_COMMAND", "Command validation failed", {
      issues: parsedCommand.error.issues,
    });
  }
  const command = parsedCommand.data;

  const priorEntry = projection.history.find(
    (entry) => entry.command.commandId === command.commandId,
  );
  if (priorEntry) {
    if (!commandsEqual(priorEntry.command, command)) {
      return failure(
        projection,
        "DUPLICATE_COMMAND_ID",
        `Command id ${command.commandId} was already used for different content`,
      );
    }
    return {
      ok: true,
      projection,
      receipt: ownRecordValue(projection.receipts, command.commandId)!,
      replayed: true,
    };
  }

  if (command.documentId !== projection.document.id) {
    return failure(
      projection,
      "DOCUMENT_MISMATCH",
      `Command targets Document ${command.documentId}, not ${projection.document.id}`,
    );
  }
  if (command.baseCursor > projection.cursor) {
    return failure(
      projection,
      "CURSOR_AHEAD",
      `Command observed future cursor ${command.baseCursor}; current cursor is ${projection.cursor}`,
    );
  }
  if (hasHistoryBarrierAfter(projection, command.baseCursor)) {
    return failure(
      projection,
      "CURSOR_EPOCH_CONFLICT",
      `Command observed cursor ${command.baseCursor} before the current document replacement`,
    );
  }

  const clientHead = ownRecordValue(projection.clientHeads, command.clientId);
  if (clientHead && command.clientSeq <= clientHead.clientSeq) {
    return failure(
      projection,
      "CLIENT_SEQUENCE_CONFLICT",
      `Client ${command.clientId} already committed sequence ${clientHead.clientSeq}`,
    );
  }
  if (projection.history.length >= MAX_HISTORY_ENTRIES) {
    return failure(
      projection,
      "RESOURCE_LIMIT",
      `At most ${MAX_HISTORY_ENTRIES} Commands may be retained in one Projection`,
    );
  }
  if (projection.outbox.length >= MAX_PENDING_OUTBOX_COMMANDS) {
    return failure(
      projection,
      "RESOURCE_LIMIT",
      `At most ${MAX_PENDING_OUTBOX_COMMANDS} undelivered Commands may be retained`,
    );
  }

  if (command.undoOf) {
    const target = projection.history.find((entry) => entry.command.commandId === command.undoOf);
    const alreadyCompensated = projection.history.some(
      (entry) => entry.command.undoOf === command.undoOf,
    );
    if (
      !target ||
      target.command.undoOf !== undefined ||
      alreadyCompensated ||
      hasHistoryBarrierAfter(projection, target.cursor) ||
      hasNewerActiveMutation(projection, target) ||
      !compensationOperationsEqual(target.inverseOperations, command.operations)
    ) {
      return failure(
        projection,
        "UNDO_CONFLICT",
        `Command cannot safely compensate ${command.undoOf}`,
      );
    }
  }

  let document = projection.document;
  let tombstones = projection.tombstones;
  const inverseOperations: Operation[] = [];
  const changedIds: string[] = [];

  for (const [operationIndex, operation] of command.operations.entries()) {
    const result = applyOperation(document, tombstones, operation, command, operationIndex);
    if (isCommandError(result)) {
      return { ok: false, projection, error: result };
    }
    document = result.document;
    tombstones = result.tombstones;
    inverseOperations.unshift(result.inverse);
    changedIds.push(result.elementId);
  }

  const nextRevision = projection.document.revision + 1;
  document = { ...document, revision: nextRevision };
  const integrity = documentSchema.safeParse(document);
  if (!integrity.success) {
    return failure(
      projection,
      "INTEGRITY_CONFLICT",
      "Command would leave the Document with broken references or nesting",
      { issues: integrity.error.issues },
    );
  }

  const cursor = projection.cursor + 1;
  const receipt: CommandReceipt = {
    ok: true,
    commandId: command.commandId,
    changedIds,
    viewRevision: nextRevision,
    historyCursor: cursor,
    syncStatus: "pending",
  };
  const historyEntry: HistoryEntry = {
    cursor,
    beforeRevision: projection.document.revision,
    afterRevision: nextRevision,
    command,
    changedIds,
    inverseOperations,
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    projection: {
      ...projection,
      document,
      cursor,
      tombstones,
      history: [...projection.history, historyEntry],
      receipts: { ...projection.receipts, [command.commandId]: receipt },
      outbox: [
        ...projection.outbox,
        { commandId: command.commandId, status: "pending", attempts: 0 },
      ],
      clientHeads: {
        ...projection.clientHeads,
        [command.clientId]: { clientSeq: command.clientSeq, commandId: command.commandId },
      },
    },
  };
}
