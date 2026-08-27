import {
  commandReceiptSchema,
  projectionSchema,
  type CommandReceipt,
  type Projection,
} from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_SNAPSHOT_CHUNK_BASE64_LENGTH,
  MAX_SNAPSHOT_CHUNKS,
  MAX_TOOL_SNAPSHOT_BYTES,
  MAX_TRANSFERABLE_SNAPSHOT_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  type SnapshotChunkSuccess,
  type SnapshotTransferDescriptor,
} from "@koi/mcp/protocol";

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SNAPSHOT_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    STABLE_ID_PATTERN.test(value)
  );
}

export function readProjection(result: CallToolResult): Projection | undefined {
  const structured = result.structuredContent;
  if (!isRecord(structured) || !isRecord(structured.snapshot)) {
    return undefined;
  }
  const parsed = projectionSchema.safeParse(structured.snapshot.projection);
  return parsed.success ? parsed.data : undefined;
}

export function readSnapshotTransfer(
  result: CallToolResult,
): SnapshotTransferDescriptor | undefined {
  const structured = result.structuredContent;
  if (!isRecord(structured) || structured.ok !== true || !isRecord(structured.snapshotTransfer)) {
    return undefined;
  }
  const transfer = structured.snapshotTransfer;
  if (
    transfer.schemaVersion !== 1 ||
    !isStableId(transfer.documentId) ||
    !isNonnegativeInteger(transfer.revision) ||
    !isNonnegativeInteger(transfer.cursor) ||
    transfer.cursor < transfer.revision ||
    !isNonnegativeInteger(transfer.totalBytes) ||
    transfer.totalBytes <= MAX_TOOL_SNAPSHOT_BYTES ||
    transfer.totalBytes > MAX_TRANSFERABLE_SNAPSHOT_BYTES ||
    transfer.chunkBytes !== SNAPSHOT_CHUNK_BYTES ||
    !isNonnegativeInteger(transfer.chunkCount) ||
    transfer.chunkCount < 2 ||
    transfer.chunkCount > MAX_SNAPSHOT_CHUNKS ||
    transfer.chunkCount !== Math.ceil(transfer.totalBytes / SNAPSHOT_CHUNK_BYTES) ||
    transfer.encoding !== "base64" ||
    typeof transfer.fingerprint !== "string" ||
    !SNAPSHOT_FINGERPRINT_PATTERN.test(transfer.fingerprint)
  ) {
    return undefined;
  }
  return transfer as unknown as SnapshotTransferDescriptor;
}

export function readSnapshotChunk(result: CallToolResult): SnapshotChunkSuccess | undefined {
  const chunk = result.structuredContent;
  if (
    !isRecord(chunk) ||
    chunk.ok !== true ||
    !isStableId(chunk.documentId) ||
    !isNonnegativeInteger(chunk.cursor) ||
    !isNonnegativeInteger(chunk.totalBytes) ||
    chunk.totalBytes <= MAX_TOOL_SNAPSHOT_BYTES ||
    chunk.totalBytes > MAX_TRANSFERABLE_SNAPSHOT_BYTES ||
    typeof chunk.fingerprint !== "string" ||
    !SNAPSHOT_FINGERPRINT_PATTERN.test(chunk.fingerprint) ||
    !isNonnegativeInteger(chunk.chunkIndex) ||
    chunk.chunkIndex >= MAX_SNAPSHOT_CHUNKS ||
    !isNonnegativeInteger(chunk.chunkCount) ||
    chunk.chunkCount < 2 ||
    chunk.chunkCount > MAX_SNAPSHOT_CHUNKS ||
    !isNonnegativeInteger(chunk.byteOffset) ||
    chunk.byteOffset >= MAX_TRANSFERABLE_SNAPSHOT_BYTES ||
    !isNonnegativeInteger(chunk.byteLength) ||
    chunk.byteLength < 1 ||
    chunk.byteLength > SNAPSHOT_CHUNK_BYTES ||
    chunk.encoding !== "base64" ||
    typeof chunk.data !== "string" ||
    chunk.data.length < 1 ||
    chunk.data.length > MAX_SNAPSHOT_CHUNK_BASE64_LENGTH
  ) {
    return undefined;
  }
  return chunk as unknown as SnapshotChunkSuccess;
}

export function readToolFailure(result: CallToolResult): string | undefined {
  const structured = result.structuredContent;
  if (isRecord(structured) && structured.ok === false && typeof structured.message === "string") {
    return structured.message;
  }
  if (!result.isError) {
    return undefined;
  }
  const text = result.content?.find((block) => block.type === "text");
  return text?.type === "text" ? text.text : "The MCP tool call failed";
}

export function readApplyAcknowledgement(
  result: CallToolResult,
): { receipt: CommandReceipt; refreshRequired: boolean } | undefined {
  const structured = result.structuredContent;
  if (
    !isRecord(structured) ||
    structured.ok !== true ||
    typeof structured.refreshRequired !== "boolean"
  ) {
    return undefined;
  }
  const receipt = commandReceiptSchema.safeParse(structured.receipt);
  return receipt.success
    ? { receipt: receipt.data, refreshRequired: structured.refreshRequired }
    : undefined;
}

export function readImportAcknowledgement(
  result: CallToolResult,
): { commandId: string; replayed: boolean } | undefined {
  const structured = result.structuredContent;
  if (
    !isRecord(structured) ||
    structured.ok !== true ||
    !isStableId(structured.commandId) ||
    typeof structured.replayed !== "boolean"
  ) {
    return undefined;
  }
  return { commandId: structured.commandId, replayed: structured.replayed };
}

export function readExport(
  result: CallToolResult,
): { filename: string; mediaType: string; documentJson: string } | undefined {
  const structured = result.structuredContent;
  if (
    !isRecord(structured) ||
    structured.ok !== true ||
    typeof structured.filename !== "string" ||
    typeof structured.mediaType !== "string" ||
    typeof structured.documentJson !== "string"
  ) {
    return undefined;
  }
  return {
    filename: structured.filename,
    mediaType: structured.mediaType,
    documentJson: structured.documentJson,
  };
}
