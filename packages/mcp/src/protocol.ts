import {
  KOI_DOCUMENT_MEDIA_TYPE,
  type CommandReceipt,
  type ElementKind,
  type Geometry,
  type JsonObject,
  type Projection,
} from "@koi/core";

export const KOI_MCP_APP_RESOURCE_URI = "ui://koi.design/canvas.html";

export const KOI_MCP_TOOL_NAMES = {
  openCanvas: "koi_canvas_open",
  readSnapshotChunk: "koi_canvas_read_snapshot_chunk",
  inspectElements: "koi_canvas_inspect",
  applyCommand: "koi_canvas_apply",
  exportDocument: "koi_document_export",
  importDocument: "koi_document_import",
} as const;

export const MAX_TOOL_DOCUMENT_BYTES = 1_000_000;
export const MAX_TOOL_SNAPSHOT_BYTES = 1_000_000;
export const MAX_TRANSFERABLE_SNAPSHOT_BYTES = 32_000_000;
export const SNAPSHOT_CHUNK_BYTES = 512_000;
export const MAX_SNAPSHOT_CHUNKS = Math.ceil(
  MAX_TRANSFERABLE_SNAPSHOT_BYTES / SNAPSHOT_CHUNK_BYTES,
);
export const MAX_SNAPSHOT_CHUNK_BASE64_LENGTH = 4 * Math.ceil(SNAPSHOT_CHUNK_BYTES / 3);
export const MAX_INSPECTED_ELEMENTS = 32;

export interface CanvasSnapshot {
  projection: Projection;
}

export interface SnapshotTransferDescriptor {
  schemaVersion: 1;
  documentId: string;
  revision: number;
  cursor: number;
  totalBytes: number;
  chunkBytes: typeof SNAPSHOT_CHUNK_BYTES;
  chunkCount: number;
  encoding: "base64";
  fingerprint: string;
}

export interface SnapshotChunkRequest {
  documentId: string;
  cursor: number;
  totalBytes: number;
  fingerprint: string;
  chunkIndex: number;
}

export interface SnapshotChunkSuccess extends SnapshotChunkRequest {
  ok: true;
  chunkCount: number;
  byteOffset: number;
  byteLength: number;
  encoding: "base64";
  data: string;
}

export interface ElementPreview {
  id: string;
  pageId: string;
  pageName: string;
  kind: ElementKind;
  version: number;
  name?: string;
  parentId: string | null;
  geometry: Geometry;
  properties: JsonObject;
  truncated: boolean;
}

export interface ToolFailure {
  ok: false;
  code: string;
  message: string;
  /** The same idempotent request may be attempted again after transient pressure subsides. */
  retryable?: boolean;
  operationIndex?: number;
  expectedVersion?: number;
  actualVersion?: number;
}

export type OpenCanvasSuccess =
  | { ok: true; snapshot: CanvasSnapshot; snapshotTransfer?: never }
  | { ok: true; snapshot?: never; snapshotTransfer: SnapshotTransferDescriptor };

export interface InspectElementsSuccess {
  ok: true;
  documentId: string;
  revision: number;
  elements: ElementPreview[];
  missingIds: string[];
}

export interface ApplyCommandSuccess {
  ok: true;
  receipt: CommandReceipt;
  replayed: boolean;
  snapshot?: CanvasSnapshot;
  refreshRequired: boolean;
}

export interface ExportDocumentSuccess {
  ok: true;
  documentId: string;
  revision: number;
  filename: string;
  mediaType: typeof KOI_DOCUMENT_MEDIA_TYPE;
  documentJson: string;
}

interface ImportDocumentSuccessFields {
  ok: true;
  commandId: string;
  replayed: boolean;
}

export type ImportDocumentSuccess = ImportDocumentSuccessFields &
  (
    | { snapshot: CanvasSnapshot; snapshotTransfer?: never }
    | { snapshot?: never; snapshotTransfer: SnapshotTransferDescriptor }
  );

export type OpenCanvasOutput = OpenCanvasSuccess | ToolFailure;
export type SnapshotChunkOutput = SnapshotChunkSuccess | ToolFailure;
export type InspectElementsOutput = InspectElementsSuccess | ToolFailure;
export type ApplyCommandOutput = ApplyCommandSuccess | ToolFailure;
export type ExportDocumentOutput = ExportDocumentSuccess | ToolFailure;
export type ImportDocumentOutput = ImportDocumentSuccess | ToolFailure;
