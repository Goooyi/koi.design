import { createInitialProjection, documentSchema, type Projection } from "@koi/core";
import { createDemoDocument } from "@koi/mcp";
import {
  SNAPSHOT_CHUNK_BYTES,
  type SnapshotChunkRequest,
  type SnapshotTransferDescriptor,
} from "@koi/mcp/protocol";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { reconcileCommittedProjectionResult } from "../src/commit-sync.js";
import { loadInitialProjection, loadProjectionResult } from "../src/initial-load.js";

function paginatedFixture(): {
  projection: Projection;
  bytes: Uint8Array;
  transfer: SnapshotTransferDescriptor;
} {
  const document = createDemoDocument();
  const page = document.pages[0]!;
  const projection = createInitialProjection(
    documentSchema.parse({
      ...document,
      pages: [
        {
          ...page,
          elements: [
            ...page.elements,
            ...Array.from({ length: 12 }, (_, index) => ({
              schemaVersion: 1,
              id: `view-transfer-note-${index}`,
              kind: "note",
              version: 1,
              parentId: null,
              geometry: { x: index * 10, y: 900, width: 220, height: 120, rotation: 0 },
              properties: { content: `${"界".repeat(33_333)}x`, color: "#ffe694" },
            })),
          ],
        },
      ],
    }),
  );
  const bytes = new TextEncoder().encode(JSON.stringify(projection));
  return {
    projection,
    bytes,
    transfer: {
      schemaVersion: 1,
      documentId: projection.document.id,
      revision: projection.document.revision,
      cursor: projection.cursor,
      totalBytes: bytes.byteLength,
      chunkBytes: SNAPSHOT_CHUNK_BYTES,
      chunkCount: Math.ceil(bytes.byteLength / SNAPSHOT_CHUNK_BYTES),
      encoding: "base64",
      fingerprint: "a".repeat(64),
    },
  };
}

function openTransferResult(transfer: SnapshotTransferDescriptor): CallToolResult {
  return {
    content: [{ type: "text", text: "paginated" }],
    structuredContent: { ok: true, snapshotTransfer: transfer },
  };
}

function chunkResult(
  transfer: SnapshotTransferDescriptor,
  bytes: Uint8Array,
  request: SnapshotChunkRequest,
): CallToolResult {
  const byteOffset = request.chunkIndex * SNAPSHOT_CHUNK_BYTES;
  const chunk = bytes.slice(byteOffset, byteOffset + SNAPSHOT_CHUNK_BYTES);
  return {
    content: [{ type: "text", text: "chunk" }],
    structuredContent: {
      ok: true,
      ...request,
      chunkCount: transfer.chunkCount,
      byteOffset,
      byteLength: chunk.byteLength,
      encoding: "base64",
      data: Buffer.from(chunk).toString("base64"),
    },
  };
}

function snapshotChangedResult(): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: "SNAPSHOT_CHANGED: reopen" }],
    structuredContent: {
      ok: false,
      code: "SNAPSHOT_CHANGED",
      message: "The canvas changed during snapshot transfer. Reopen it and retry.",
      retryable: true,
    },
  };
}

describe("MCP View initial load", () => {
  it("turns a rejected refresh into renderable retry state", async () => {
    await expect(
      loadInitialProjection(() => Promise.reject(new Error("stdio server disconnected"))),
    ).resolves.toEqual({ ok: false, message: "stdio server disconnected" });
  });

  it("accepts a valid snapshot and reports malformed successful responses", async () => {
    const projection = createInitialProjection(createDemoDocument());
    await expect(
      loadInitialProjection(() =>
        Promise.resolve({
          content: [{ type: "text", text: "opened" }],
          structuredContent: { ok: true, snapshot: { projection } },
        }),
      ),
    ).resolves.toEqual({ ok: true, projection });

    await expect(
      loadInitialProjection(() =>
        Promise.resolve({
          content: [{ type: "text", text: "opened" }],
          structuredContent: { ok: true },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "The MCP server returned an invalid canvas snapshot",
    });
  });

  it("assembles and validates a bounded paginated Projection", async () => {
    const { projection, bytes, transfer } = paginatedFixture();
    const requested: number[] = [];
    const progress: string[] = [];
    await expect(
      loadInitialProjection(
        () => Promise.resolve(openTransferResult(transfer)),
        (request) => {
          requested.push(request.chunkIndex);
          return Promise.resolve(chunkResult(transfer, bytes, request));
        },
        (completed, total) => progress.push(`${completed}/${total}`),
      ),
    ).resolves.toEqual({ ok: true, projection });
    expect(requested).toEqual(Array.from({ length: transfer.chunkCount }, (_, index) => index));
    expect(progress.at(-1)).toBe(`${transfer.chunkCount}/${transfer.chunkCount}`);
  });

  it("assembles a host-delivered large import result without reopening the canvas", async () => {
    const { projection, bytes, transfer } = paginatedFixture();
    let chunkCalls = 0;
    await expect(
      loadProjectionResult(openTransferResult(transfer), (request) => {
        chunkCalls += 1;
        return Promise.resolve(chunkResult(transfer, bytes, request));
      }),
    ).resolves.toEqual({ ok: true, projection });
    expect(chunkCalls).toBe(transfer.chunkCount);
  });

  it("rejects a tampered chunk before parsing the assembled Projection", async () => {
    const { bytes, transfer } = paginatedFixture();
    const loaded = await loadInitialProjection(
      () => Promise.resolve(openTransferResult(transfer)),
      (request) => {
        const result = chunkResult(transfer, bytes, request);
        if (request.chunkIndex === 0 && result.structuredContent) {
          result.structuredContent.data = Buffer.from("short").toString("base64");
        }
        return Promise.resolve(result);
      },
    );
    expect(loaded).toEqual({
      ok: false,
      message: "The MCP server returned a snapshot chunk with the wrong byte length",
    });
  });

  it("rejects an assembled Projection whose revision differs from the pinned descriptor", async () => {
    const fixture = paginatedFixture();
    const projection = {
      ...fixture.projection,
      document: { ...fixture.projection.document, revision: 1 },
      cursor: 1,
    } satisfies Projection;
    const bytes = new TextEncoder().encode(JSON.stringify(projection));
    const transfer: SnapshotTransferDescriptor = {
      ...fixture.transfer,
      revision: 0,
      cursor: 1,
      totalBytes: bytes.byteLength,
      chunkCount: Math.ceil(bytes.byteLength / SNAPSHOT_CHUNK_BYTES),
    };
    await expect(
      loadProjectionResult(openTransferResult(transfer), (request) =>
        Promise.resolve(chunkResult(transfer, bytes, request)),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "The assembled canvas snapshot does not match its transfer descriptor",
    });
  });

  it("surfaces a mid-transfer snapshot change as retryable render state", async () => {
    const { bytes, transfer } = paginatedFixture();
    const loaded = await loadInitialProjection(
      () => Promise.resolve(openTransferResult(transfer)),
      (request) => {
        if (request.chunkIndex === 1) {
          return Promise.resolve(snapshotChangedResult());
        }
        return Promise.resolve(chunkResult(transfer, bytes, request));
      },
    );
    expect(loaded).toEqual({
      ok: false,
      message: "The canvas changed during snapshot transfer. Reopen it and retry.",
    });
  });

  it.each([0, 1])(
    "recovers a committed import when the snapshot changes before chunk %i",
    async (changedChunk) => {
      const { bytes, transfer } = paginatedFixture();
      const acceptProjection = vi.fn(() => true);
      const refreshLatest = vi.fn(async () => true);

      const outcome = await reconcileCommittedProjectionResult(
        openTransferResult(transfer),
        (request) =>
          Promise.resolve(
            request.chunkIndex === changedChunk
              ? snapshotChangedResult()
              : chunkResult(transfer, bytes, request),
          ),
        acceptProjection,
        refreshLatest,
      );

      expect(outcome).toEqual({ kind: "refreshed" });
      expect(acceptProjection).not.toHaveBeenCalled();
      expect(refreshLatest).toHaveBeenCalledOnce();
    },
  );

  it("preserves the visible canvas when a committed import and its recovery refresh cannot load", async () => {
    const { bytes, transfer } = paginatedFixture();
    const acceptProjection = vi.fn(() => true);

    const outcome = await reconcileCommittedProjectionResult(
      openTransferResult(transfer),
      (request) =>
        Promise.resolve(
          request.chunkIndex === 1
            ? snapshotChangedResult()
            : chunkResult(transfer, bytes, request),
        ),
      acceptProjection,
      async () => false,
    );

    expect(outcome).toEqual({
      kind: "refresh-unavailable",
      message: "The canvas changed during snapshot transfer. Reopen it and retry.",
    });
    expect(acceptProjection).not.toHaveBeenCalled();
  });
});
