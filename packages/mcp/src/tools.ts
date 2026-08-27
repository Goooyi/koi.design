import { exportDocument, KOI_DOCUMENT_MEDIA_TYPE, type Projection } from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  MAX_TOOL_DOCUMENT_BYTES,
  MAX_TRANSFERABLE_SNAPSHOT_BYTES,
  type ApplyCommandOutput,
  type ExportDocumentOutput,
  type ImportDocumentOutput,
  type InspectElementsOutput,
  type OpenCanvasOutput,
  type SnapshotChunkOutput,
  type SnapshotChunkRequest,
  type ToolFailure,
} from "./protocol.js";
import { createCanvasSnapshot, createElementPreviews } from "./preview.js";
import {
  mapRepositoryErrorToToolFailure,
  type ImportDocumentRequest,
  type KoiDocumentRepository,
} from "./repository.js";
import { createCanvasOpenPayload, createSnapshotChunk } from "./snapshot-transfer.js";

function failureResult(failure: ToolFailure): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${failure.code}: ${failure.message}` }],
    structuredContent: failure as unknown as Record<string, unknown>,
  };
}

function successResult(output: Record<string, unknown>, fallback: string): CallToolResult {
  return {
    content: [{ type: "text", text: fallback }],
    structuredContent: output,
  };
}

type ProjectionReadResult =
  | { ok: true; projection: Projection }
  | { ok: false; result: CallToolResult };

async function readProjectionForTool(
  repository: KoiDocumentRepository,
  signal?: AbortSignal,
): Promise<ProjectionReadResult> {
  try {
    return { ok: true, projection: await repository.readProjection(signal) };
  } catch (error) {
    const failure = mapRepositoryErrorToToolFailure(error);
    if (!failure) throw error;
    return { ok: false, result: failureResult(failure) };
  }
}

function snapshotTooLarge(): ToolFailure {
  return {
    ok: false,
    code: "DOCUMENT_TOO_LARGE",
    message: `The Projection exceeds the ${MAX_TRANSFERABLE_SNAPSHOT_BYTES} byte paginated MCP View limit. Use koi_canvas_inspect for bounded reads.`,
  };
}

function documentTooLarge(): ToolFailure {
  return {
    ok: false,
    code: "DOCUMENT_TOO_LARGE",
    message: `The Document exceeds the ${MAX_TOOL_DOCUMENT_BYTES} byte MCP import/export limit.`,
  };
}

function safeFilename(name: string, id: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `${base || id}.koi.json`;
}

export interface KoiToolHandlers {
  openCanvas(signal?: AbortSignal): Promise<CallToolResult>;
  readSnapshotChunk(args: SnapshotChunkRequest, signal?: AbortSignal): Promise<CallToolResult>;
  inspectElements(args: { elementIds: string[] }, signal?: AbortSignal): Promise<CallToolResult>;
  applyCommand(args: { command: unknown }, signal?: AbortSignal): Promise<CallToolResult>;
  exportDocument(
    args: { expectedRevision?: number },
    signal?: AbortSignal,
  ): Promise<CallToolResult>;
  importDocument(args: ImportDocumentRequest, signal?: AbortSignal): Promise<CallToolResult>;
}

export function createKoiToolHandlers(repository: KoiDocumentRepository): KoiToolHandlers {
  return {
    async openCanvas(signal) {
      const read = await readProjectionForTool(repository, signal);
      if (!read.ok) return read.result;
      const { projection } = read;
      const payload = createCanvasOpenPayload(projection);
      if (!payload) {
        return failureResult(snapshotTooLarge());
      }
      const output: OpenCanvasOutput = { ok: true, ...payload };
      if (payload.snapshotTransfer) {
        return successResult(
          output as unknown as Record<string, unknown>,
          `Prepared “${projection.document.name}” at revision ${projection.document.revision} as ${payload.snapshotTransfer.chunkCount} bounded MCP View chunk(s).`,
        );
      }
      return successResult(
        output as unknown as Record<string, unknown>,
        `Opened “${payload.snapshot.projection.document.name}” at revision ${payload.snapshot.projection.document.revision} with ${payload.snapshot.projection.document.pages.length} Page(s).`,
      );
    },

    async readSnapshotChunk(args, signal) {
      const read = await readProjectionForTool(repository, signal);
      if (!read.ok) return read.result;
      const { projection } = read;
      const output: SnapshotChunkOutput = createSnapshotChunk(projection, args);
      if (!output.ok) {
        return failureResult(output);
      }
      return successResult(
        output as unknown as Record<string, unknown>,
        `Read canvas snapshot chunk ${output.chunkIndex + 1} of ${output.chunkCount}.`,
      );
    },

    async inspectElements({ elementIds }, signal) {
      const read = await readProjectionForTool(repository, signal);
      if (!read.ok) return read.result;
      const { projection } = read;
      const { elements, missingIds } = createElementPreviews(projection.document, elementIds);
      const output: InspectElementsOutput = {
        ok: true,
        documentId: projection.document.id,
        revision: projection.document.revision,
        elements,
        missingIds,
      };
      return successResult(
        output as unknown as Record<string, unknown>,
        `Inspected ${elements.length} Element(s) at revision ${projection.document.revision}; ${missingIds.length} requested id(s) were missing.`,
      );
    },

    async applyCommand({ command }, signal) {
      const result = await repository.apply(command, signal);
      if (!result.ok) {
        const retryable = "retryable" in result.error ? result.error.retryable : undefined;
        const failure: ToolFailure = {
          ok: false,
          code: result.error.code,
          message: result.error.message,
          ...(retryable === undefined ? {} : { retryable }),
          ...(result.error.operationIndex === undefined
            ? {}
            : { operationIndex: result.error.operationIndex }),
          ...(result.error.expectedVersion === undefined
            ? {}
            : { expectedVersion: result.error.expectedVersion }),
          ...(result.error.actualVersion === undefined
            ? {}
            : { actualVersion: result.error.actualVersion }),
        };
        return failureResult(failure);
      }

      const snapshot = createCanvasSnapshot(result.projection);
      const output: ApplyCommandOutput = {
        ok: true,
        receipt: result.receipt,
        replayed: result.replayed,
        ...(snapshot ? { snapshot } : {}),
        refreshRequired: !snapshot,
      };
      return successResult(
        output as unknown as Record<string, unknown>,
        `${result.replayed ? "Replayed" : "Committed"} Command ${result.receipt.commandId}; revision is ${result.receipt.viewRevision}.`,
      );
    },

    async exportDocument({ expectedRevision }, signal) {
      const read = await readProjectionForTool(repository, signal);
      if (!read.ok) return read.result;
      const { projection } = read;
      if (expectedRevision !== undefined && expectedRevision !== projection.document.revision) {
        return failureResult({
          ok: false,
          code: "REVISION_CONFLICT",
          message: `Expected revision ${expectedRevision}, not ${projection.document.revision}`,
          expectedVersion: expectedRevision,
          actualVersion: projection.document.revision,
        });
      }

      const documentJson = exportDocument(projection.document);
      if (Buffer.byteLength(documentJson, "utf8") > MAX_TOOL_DOCUMENT_BYTES) {
        return failureResult(documentTooLarge());
      }
      const output: ExportDocumentOutput = {
        ok: true,
        documentId: projection.document.id,
        revision: projection.document.revision,
        filename: safeFilename(projection.document.name, projection.document.id),
        mediaType: KOI_DOCUMENT_MEDIA_TYPE,
        documentJson,
      };
      return successResult(
        output as unknown as Record<string, unknown>,
        `Exported ${output.filename} at revision ${output.revision}.\n\n${documentJson}`,
      );
    },

    async importDocument(args, signal) {
      const result = await repository.replaceDocument(args, signal);
      if (!result.ok) {
        return failureResult({
          ok: false,
          code: result.code,
          message: result.message,
          ...(result.retryable === undefined ? {} : { retryable: result.retryable }),
          ...(result.expectedVersion === undefined
            ? {}
            : { expectedVersion: result.expectedVersion }),
          ...(result.actualVersion === undefined ? {} : { actualVersion: result.actualVersion }),
        });
      }

      const payload = createCanvasOpenPayload(result.projection);
      if (!payload) {
        return failureResult(snapshotTooLarge());
      }
      const output: ImportDocumentOutput = {
        ok: true,
        commandId: args.commandId,
        replayed: result.replayed,
        ...payload,
      };
      return successResult(
        output as unknown as Record<string, unknown>,
        `${result.replayed ? "Replayed" : "Imported"} Document “${result.projection.document.name}” at revision ${result.projection.document.revision}.`,
      );
    },
  };
}
