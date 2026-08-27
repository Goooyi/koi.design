import { projectionSchema, type Projection } from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  SNAPSHOT_CHUNK_BYTES,
  type SnapshotChunkRequest,
  type SnapshotTransferDescriptor,
} from "@koi/mcp/protocol";

import { readSnapshotChunk, readToolFailure } from "./bridge.js";

export type SnapshotChunkCaller = (request: SnapshotChunkRequest) => Promise<CallToolResult>;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseProjection(bytes: Uint8Array): Projection {
  const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsedJson: unknown = JSON.parse(json);
  const parsed = projectionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("The MCP server returned an invalid paginated canvas snapshot");
  }
  return parsed.data;
}

export async function loadSnapshotTransfer(
  transfer: SnapshotTransferDescriptor,
  callChunk: SnapshotChunkCaller,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
): Promise<Projection> {
  const assembled = new Uint8Array(transfer.totalBytes);

  // Sequential reads keep both stdio and the hosted server's bounded read admission predictable.
  for (let chunkIndex = 0; chunkIndex < transfer.chunkCount; chunkIndex += 1) {
    const request: SnapshotChunkRequest = {
      documentId: transfer.documentId,
      cursor: transfer.cursor,
      totalBytes: transfer.totalBytes,
      fingerprint: transfer.fingerprint,
      chunkIndex,
    };
    const result = await callChunk(request);
    const failure = readToolFailure(result);
    if (failure) {
      throw new Error(failure);
    }
    const chunk = readSnapshotChunk(result);
    if (!chunk) {
      throw new Error("The MCP server returned an invalid canvas snapshot chunk");
    }

    const expectedOffset = chunkIndex * SNAPSHOT_CHUNK_BYTES;
    const expectedLength = Math.min(SNAPSHOT_CHUNK_BYTES, transfer.totalBytes - expectedOffset);
    if (
      chunk.documentId !== transfer.documentId ||
      chunk.cursor !== transfer.cursor ||
      chunk.totalBytes !== transfer.totalBytes ||
      chunk.fingerprint !== transfer.fingerprint ||
      chunk.chunkIndex !== chunkIndex ||
      chunk.chunkCount !== transfer.chunkCount ||
      chunk.byteOffset !== expectedOffset ||
      chunk.byteLength !== expectedLength
    ) {
      throw new Error("The canvas snapshot changed or returned inconsistent chunk metadata");
    }

    let decoded: Uint8Array;
    try {
      decoded = decodeBase64(chunk.data);
    } catch {
      throw new Error("The MCP server returned invalid base64 snapshot data");
    }
    if (decoded.byteLength !== expectedLength) {
      throw new Error("The MCP server returned a snapshot chunk with the wrong byte length");
    }
    assembled.set(decoded, expectedOffset);
    onProgress?.(chunkIndex + 1, transfer.chunkCount);
  }

  const projection = parseProjection(assembled);
  if (
    projection.document.id !== transfer.documentId ||
    projection.document.revision !== transfer.revision ||
    projection.cursor !== transfer.cursor
  ) {
    throw new Error("The assembled canvas snapshot does not match its transfer descriptor");
  }
  return projection;
}
