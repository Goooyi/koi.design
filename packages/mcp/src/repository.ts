import { createHash } from "node:crypto";

import {
  applyCommand,
  createInitialProjection,
  exportDocument,
  importDocument,
  type ApplyCommandResult,
  type Projection,
} from "@koi/core";

import { createDemoDocument } from "./demo.js";
import {
  MAX_TOOL_DOCUMENT_BYTES,
  MAX_TRANSFERABLE_SNAPSHOT_BYTES,
  type ToolFailure,
} from "./protocol.js";

export const MAX_IMPORT_RECEIPTS = 128;
const MAX_IN_MEMORY_PROJECTION_BYTES = 32_000_000;

/** A fail-fast repository admission rejection that callers may safely retry unchanged. */
export class RepositoryBusyError extends Error {
  readonly code = "SERVER_BUSY" as const;
  readonly retryable = true as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryBusyError";
  }
}

export function mapRepositoryErrorToToolFailure(error: unknown): ToolFailure | undefined {
  if (!(error instanceof RepositoryBusyError)) return undefined;
  return {
    ok: false,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
}

export interface ImportDocumentRequest {
  commandId: string;
  expectedDocumentId: string;
  expectedRevision: number;
  documentJson: string;
}

export type ImportRepositoryResult =
  | { ok: true; projection: Projection; replayed: boolean }
  | {
      ok: false;
      code:
        | "DUPLICATE_IMPORT_ID"
        | "DOCUMENT_MISMATCH"
        | "REVISION_CONFLICT"
        | "DOCUMENT_TOO_LARGE"
        | "INVALID_DOCUMENT"
        | "SERVER_BUSY";
      message: string;
      retryable?: boolean;
      expectedVersion?: number;
      actualVersion?: number;
    };

export type RepositoryApplyResult =
  | ApplyCommandResult
  | {
      ok: false;
      projection?: Projection;
      error: {
        ok: false;
        code: "RESOURCE_LIMIT" | "SERVER_BUSY";
        message: string;
        retryable?: boolean;
        operationIndex?: number;
        expectedVersion?: number;
        actualVersion?: number;
      };
    };

export interface KoiDocumentRepository {
  readProjection(signal?: AbortSignal): Promise<Projection>;
  apply(input: unknown, signal?: AbortSignal): Promise<RepositoryApplyResult>;
  replaceDocument(
    request: ImportDocumentRequest,
    signal?: AbortSignal,
  ): Promise<ImportRepositoryResult>;
}

/** A repository is the durable authority, so a successful write has no pending outbox work. */
export function acknowledgeApplyResult(result: ApplyCommandResult): ApplyCommandResult {
  if (!result.ok) return result;

  const receipt = { ...result.receipt, syncStatus: "acknowledged" as const };
  return {
    ...result,
    receipt,
    projection: {
      ...result.projection,
      receipts: { ...result.projection.receipts, [receipt.commandId]: receipt },
      outbox: result.projection.outbox.filter((entry) => entry.commandId !== receipt.commandId),
    },
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("MCP request was cancelled", { cause: signal.reason });
  error.name = "AbortError";
  throw error;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function importRequestFingerprint(request: ImportDocumentRequest): string {
  return createHash("sha256")
    .update(request.expectedDocumentId)
    .update("\0")
    .update(String(request.expectedRevision))
    .update("\0")
    .update(request.documentJson)
    .digest("hex");
}

export type PreparedDocumentImport =
  | { ok: true; projection: Projection }
  | Exclude<ImportRepositoryResult, { ok: true }>;

/**
 * Validates a portable import and binds it to the current hosted Document identity.
 * Importing replaces content, but the URL-stable Document, Workspace, and History ids stay put.
 */
export function prepareDocumentImport(
  current: Projection,
  request: ImportDocumentRequest,
): PreparedDocumentImport {
  if (request.expectedDocumentId !== current.document.id) {
    return {
      ok: false,
      code: "DOCUMENT_MISMATCH",
      message: `Expected current Document ${request.expectedDocumentId}, not ${current.document.id}`,
    };
  }
  if (request.expectedRevision !== current.document.revision) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      message: `Expected revision ${request.expectedRevision}, not ${current.document.revision}`,
      expectedVersion: request.expectedRevision,
      actualVersion: current.document.revision,
    };
  }
  if (utf8Bytes(request.documentJson) > MAX_TOOL_DOCUMENT_BYTES) {
    return {
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
      message: `Document JSON exceeds the ${MAX_TOOL_DOCUMENT_BYTES} byte MCP import limit`,
    };
  }

  const imported = importDocument(request.documentJson);
  if (!imported.ok) {
    const issueSummary = imported.issues
      .slice(0, 4)
      .map((issue) => issue.message)
      .join("; ");
    return {
      ok: false,
      code: "INVALID_DOCUMENT",
      message: issueSummary || "Document import validation failed",
    };
  }

  const nextDocument = {
    ...imported.document,
    id: current.document.id,
    workspaceId: current.document.workspaceId,
    historyId: current.document.historyId,
    revision: current.document.revision + 1,
  };
  const normalizedJson = exportDocument(nextDocument);
  if (utf8Bytes(normalizedJson) > MAX_TOOL_DOCUMENT_BYTES) {
    return {
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
      message: `Normalized Document exceeds the ${MAX_TOOL_DOCUMENT_BYTES} byte MCP import limit`,
    };
  }

  const nextProjection: Projection = {
    ...current,
    document: nextDocument,
    cursor: current.cursor + 1,
    // Imported content starts a new undo epoch, represented by a deliberate cursor gap.
    // Earlier history remains available for idempotent replay and client ordering only.
    outbox: [],
  };
  if (utf8Bytes(JSON.stringify(nextProjection)) > MAX_TRANSFERABLE_SNAPSHOT_BYTES) {
    return {
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
      message: `Imported Projection exceeds the ${MAX_TRANSFERABLE_SNAPSHOT_BYTES} byte MCP View transfer limit`,
    };
  }
  return { ok: true, projection: nextProjection };
}

export class InMemoryKoiDocumentRepository implements KoiDocumentRepository {
  #projection: Projection;
  readonly #importReceipts = new Map<string, string>();

  constructor(initialProjection: Projection = createInitialProjection(createDemoDocument())) {
    this.#projection = structuredClone(initialProjection);
  }

  async readProjection(signal?: AbortSignal): Promise<Projection> {
    throwIfAborted(signal);
    return structuredClone(this.#projection);
  }

  async apply(input: unknown, signal?: AbortSignal): Promise<RepositoryApplyResult> {
    throwIfAborted(signal);
    const result = acknowledgeApplyResult(applyCommand(this.#projection, input));
    throwIfAborted(signal);

    if (result.ok) {
      const projectionBytes = utf8Bytes(JSON.stringify(result.projection));
      if (projectionBytes > MAX_IN_MEMORY_PROJECTION_BYTES) {
        return {
          ok: false,
          projection: structuredClone(this.#projection),
          error: {
            ok: false,
            code: "RESOURCE_LIMIT",
            message: `The local in-memory Projection would exceed ${MAX_IN_MEMORY_PROJECTION_BYTES} bytes`,
          },
        };
      }
      this.#projection = result.projection;
    }
    return structuredClone(result);
  }

  async replaceDocument(
    request: ImportDocumentRequest,
    signal?: AbortSignal,
  ): Promise<ImportRepositoryResult> {
    throwIfAborted(signal);
    const nextFingerprint = importRequestFingerprint(request);
    const priorFingerprint = this.#importReceipts.get(request.commandId);
    if (priorFingerprint !== undefined) {
      if (priorFingerprint !== nextFingerprint) {
        return {
          ok: false,
          code: "DUPLICATE_IMPORT_ID",
          message: `Import command id ${request.commandId} was already used for different content`,
        };
      }
      return { ok: true, projection: structuredClone(this.#projection), replayed: true };
    }

    const prepared = prepareDocumentImport(this.#projection, request);
    if (!prepared.ok) {
      return prepared;
    }
    throwIfAborted(signal);
    this.#projection = prepared.projection;
    this.#importReceipts.set(request.commandId, nextFingerprint);
    if (this.#importReceipts.size > MAX_IMPORT_RECEIPTS) {
      const oldestCommandId = this.#importReceipts.keys().next().value;
      if (oldestCommandId !== undefined) {
        this.#importReceipts.delete(oldestCommandId);
      }
    }

    return { ok: true, projection: structuredClone(prepared.projection), replayed: false };
  }
}
