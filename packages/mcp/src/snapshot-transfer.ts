import { createHash } from "node:crypto";

import type { Projection } from "@koi/core";

import {
  MAX_TOOL_SNAPSHOT_BYTES,
  MAX_TRANSFERABLE_SNAPSHOT_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  type CanvasSnapshot,
  type SnapshotChunkRequest,
  type SnapshotChunkSuccess,
  type SnapshotTransferDescriptor,
  type ToolFailure,
} from "./protocol.js";

export type CanvasOpenPayload =
  | { snapshot: CanvasSnapshot; snapshotTransfer?: never }
  | { snapshot?: never; snapshotTransfer: SnapshotTransferDescriptor };

function serializeProjection(projection: Projection): Buffer {
  return Buffer.from(JSON.stringify(projection), "utf8");
}

function fingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createCanvasOpenPayload(projection: Projection): CanvasOpenPayload | undefined {
  const bytes = serializeProjection(projection);
  if (bytes.byteLength <= MAX_TOOL_SNAPSHOT_BYTES) {
    return { snapshot: { projection: structuredClone(projection) } };
  }
  if (bytes.byteLength > MAX_TRANSFERABLE_SNAPSHOT_BYTES) {
    return undefined;
  }

  return {
    snapshotTransfer: {
      schemaVersion: 1,
      documentId: projection.document.id,
      revision: projection.document.revision,
      cursor: projection.cursor,
      totalBytes: bytes.byteLength,
      chunkBytes: SNAPSHOT_CHUNK_BYTES,
      chunkCount: Math.ceil(bytes.byteLength / SNAPSHOT_CHUNK_BYTES),
      encoding: "base64",
      fingerprint: fingerprint(bytes),
    },
  };
}

export function createSnapshotChunk(
  projection: Projection,
  request: SnapshotChunkRequest,
): SnapshotChunkSuccess | ToolFailure {
  if (projection.document.id !== request.documentId || projection.cursor !== request.cursor) {
    return {
      ok: false,
      code: "SNAPSHOT_CHANGED",
      message: "The canvas changed during snapshot transfer. Reopen it and retry.",
      retryable: true,
    };
  }

  const bytes = serializeProjection(projection);
  if (bytes.byteLength > MAX_TRANSFERABLE_SNAPSHOT_BYTES) {
    return {
      ok: false,
      code: "DOCUMENT_TOO_LARGE",
      message: `The Projection exceeds the ${MAX_TRANSFERABLE_SNAPSHOT_BYTES} byte MCP View transfer limit.`,
    };
  }
  if (bytes.byteLength !== request.totalBytes || fingerprint(bytes) !== request.fingerprint) {
    return {
      ok: false,
      code: "SNAPSHOT_CHANGED",
      message: "The canvas changed during snapshot transfer. Reopen it and retry.",
      retryable: true,
    };
  }

  const chunkCount = Math.ceil(bytes.byteLength / SNAPSHOT_CHUNK_BYTES);
  if (request.chunkIndex < 0 || request.chunkIndex >= chunkCount) {
    return {
      ok: false,
      code: "INVALID_CHUNK",
      message: `Snapshot chunk ${request.chunkIndex} is outside the 0-${chunkCount - 1} range.`,
    };
  }

  const byteOffset = request.chunkIndex * SNAPSHOT_CHUNK_BYTES;
  const chunk = bytes.subarray(byteOffset, byteOffset + SNAPSHOT_CHUNK_BYTES);
  return {
    ok: true,
    ...request,
    chunkCount,
    byteOffset,
    byteLength: chunk.byteLength,
    encoding: "base64",
    data: chunk.toString("base64"),
  };
}
