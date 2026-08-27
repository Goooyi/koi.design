import {
  applyCommand,
  createInitialProjection,
  documentSchema,
  exportDocument,
  projectionSchema,
  type Command,
  type Projection,
} from "@koi/core";
import { describe, expect, it } from "vite-plus/test";

import {
  MAX_TOOL_SNAPSHOT_BYTES,
  SNAPSHOT_CHUNK_BYTES,
  type SnapshotTransferDescriptor,
} from "../src/protocol.js";
import {
  acknowledgeApplyResult,
  InMemoryKoiDocumentRepository,
  type KoiDocumentRepository,
} from "../src/repository.js";
import { importDocumentOutputSchema } from "../src/schemas.js";
import { createDemoDocument } from "../src/demo.js";
import { createKoiToolHandlers } from "../src/tools.js";

function structured(result: { structuredContent?: Record<string, unknown> }) {
  return result.structuredContent ?? {};
}

function oversizedProjection(): Projection {
  const document = createDemoDocument();
  const page = document.pages[0]!;
  return createInitialProjection(
    documentSchema.parse({
      ...document,
      pages: [
        {
          ...page,
          elements: [
            ...page.elements,
            ...Array.from({ length: 12 }, (_, index) => ({
              schemaVersion: 1,
              id: `snapshot-note-${index}`,
              kind: "note",
              version: 1,
              parentId: null,
              geometry: { x: index * 20, y: 700, width: 200, height: 100, rotation: 0 },
              properties: { content: `${"界".repeat(33_333)}x`, color: "#ffe694" },
            })),
          ],
        },
      ],
    }),
  );
}

function importableLargeHistoryProjection(): Projection {
  const document = createDemoDocument();
  const page = document.pages[0]!;
  let projection = createInitialProjection(
    documentSchema.parse({
      ...document,
      pages: [
        {
          ...page,
          elements: [
            ...page.elements,
            ...Array.from({ length: 8 }, (_, index) => ({
              schemaVersion: 1,
              id: `importable-note-${index}`,
              kind: "note",
              version: 1,
              parentId: null,
              geometry: { x: index * 20, y: 800, width: 200, height: 100, rotation: 0 },
              properties: { content: "x".repeat(90_000), color: "#ffe694" },
            })),
          ],
        },
      ],
    }),
  );

  for (let index = 0; index < 1_000; index += 1) {
    const result = acknowledgeApplyResult(
      applyCommand(projection, {
        documentId: projection.document.id,
        commandId: `history-command-${index}`,
        clientId: "history-client",
        clientSeq: index + 1,
        baseCursor: projection.cursor,
        origin: "human",
        operations: [
          {
            type: "patch",
            pageId: page.id,
            elementId: "frame-welcome",
            expectedVersion: index + 1,
            changes: { geometry: { x: 1_000 + index } },
          },
        ],
      }),
    );
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    projection = result.projection;
    if (
      index % 25 === 24 &&
      Buffer.byteLength(JSON.stringify(projection), "utf8") > MAX_TOOL_SNAPSHOT_BYTES
    ) {
      return projection;
    }
  }
  throw new Error("The test Projection did not cross the snapshot boundary");
}

describe("semantic MCP tool handlers", () => {
  it("provides structured data and concise text fallbacks for UI and text-only hosts", async () => {
    const handlers = createKoiToolHandlers(new InMemoryKoiDocumentRepository());
    const opened = await handlers.openCanvas();

    expect(opened.isError).not.toBe(true);
    expect(opened.content).toEqual([
      {
        type: "text",
        text: "Opened “Koi component studies” at revision 0 with 1 Page(s).",
      },
    ]);
    expect(structured(opened)).toMatchObject({
      ok: true,
      snapshot: { projection: { document: { id: "document-demo" }, cursor: 0 } },
    });

    const inspected = await handlers.inspectElements({
      elementIds: ["frame-welcome", "missing-element"],
    });
    expect(structured(inspected)).toMatchObject({
      ok: true,
      elements: [{ id: "frame-welcome", kind: "frame", version: 1 }],
      missingIds: ["missing-element"],
    });
  });

  it("returns version conflicts as structured domain errors without mutating state", async () => {
    const repository = new InMemoryKoiDocumentRepository();
    const handlers = createKoiToolHandlers(repository);
    const command: Command = {
      documentId: "document-demo",
      commandId: "agent-stale-move",
      clientId: "agent-test",
      clientSeq: 1,
      baseCursor: 0,
      origin: "agent",
      operations: [
        {
          type: "patch",
          pageId: "page-explorations",
          elementId: "frame-welcome",
          expectedVersion: 99,
          changes: { geometry: { x: 900 } },
        },
      ],
    };

    const result = await handlers.applyCommand({ command });
    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({
      ok: false,
      code: "VERSION_CONFLICT",
      expectedVersion: 99,
      actualVersion: 1,
    });
    expect((await repository.readProjection()).document.revision).toBe(0);
  });

  it("reopens an oversized Projection through bounded fingerprint-pinned chunks", async () => {
    const projection = oversizedProjection();
    const handlers = createKoiToolHandlers(new InMemoryKoiDocumentRepository(projection));
    const opened = await handlers.openCanvas();
    const transfer = structured(opened).snapshotTransfer as SnapshotTransferDescriptor;

    expect(opened.isError).not.toBe(true);
    expect(structured(opened)).not.toHaveProperty("snapshot");
    expect(transfer).toMatchObject({
      schemaVersion: 1,
      documentId: projection.document.id,
      cursor: projection.cursor,
      chunkBytes: SNAPSHOT_CHUNK_BYTES,
      encoding: "base64",
    });
    expect(transfer.totalBytes).toBeGreaterThan(MAX_TOOL_SNAPSHOT_BYTES);

    const chunks: Buffer[] = [];
    for (let chunkIndex = 0; chunkIndex < transfer.chunkCount; chunkIndex += 1) {
      const result = await handlers.readSnapshotChunk({
        documentId: transfer.documentId,
        cursor: transfer.cursor,
        totalBytes: transfer.totalBytes,
        fingerprint: transfer.fingerprint,
        chunkIndex,
      });
      expect(result.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
        MAX_TOOL_SNAPSHOT_BYTES,
      );
      const output = structured(result);
      chunks.push(Buffer.from(output.data as string, "base64"));
    }

    const reconstructed = projectionSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    expect(reconstructed).toEqual(projection);
  });

  it("rejects same-cursor chunk reads when the serialized fingerprint changed", async () => {
    let projection = oversizedProjection();
    const repository: KoiDocumentRepository = {
      async readProjection() {
        return structuredClone(projection);
      },
      async apply() {
        throw new Error("not used");
      },
      async replaceDocument() {
        throw new Error("not used");
      },
    };
    const handlers = createKoiToolHandlers(repository);
    const opened = await handlers.openCanvas();
    const transfer = structured(opened).snapshotTransfer as SnapshotTransferDescriptor;
    projection = {
      ...projection,
      document: {
        ...projection.document,
        name: "x".repeat(projection.document.name.length),
      },
    };

    const result = await handlers.readSnapshotChunk({
      documentId: transfer.documentId,
      cursor: transfer.cursor,
      totalBytes: transfer.totalBytes,
      fingerprint: transfer.fingerprint,
      chunkIndex: 0,
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { ok: false, code: "SNAPSHOT_CHANGED", retryable: true },
    });
  });

  it("returns a paginated import result when retained history exceeds one snapshot", async () => {
    const projection = importableLargeHistoryProjection();
    const handlers = createKoiToolHandlers(new InMemoryKoiDocumentRepository(projection));
    const documentJson = exportDocument({ ...projection.document, name: "Imported large history" });
    expect(Buffer.byteLength(documentJson, "utf8")).toBeLessThanOrEqual(1_000_000);

    const result = await handlers.importDocument({
      commandId: "large-history-import",
      expectedDocumentId: projection.document.id,
      expectedRevision: projection.document.revision,
      documentJson,
    });
    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      ok: true,
      commandId: "large-history-import",
      replayed: false,
      snapshotTransfer: { documentId: projection.document.id },
    });
    expect(structured(result)).not.toHaveProperty("snapshot");
    expect(importDocumentOutputSchema.safeParse(structured(result)).success).toBe(true);
  });

  it("preserves retry guidance for fail-fast repository admission errors", async () => {
    const projection = await new InMemoryKoiDocumentRepository().readProjection();
    const repository: KoiDocumentRepository = {
      async readProjection() {
        return projection;
      },
      async apply() {
        return {
          ok: false,
          error: {
            ok: false,
            code: "SERVER_BUSY",
            message: "The mutation limit has been reached",
            retryable: true,
          },
        };
      },
      async replaceDocument() {
        return {
          ok: false,
          code: "SERVER_BUSY",
          message: "The mutation limit has been reached",
          retryable: true,
        };
      },
    };
    const handlers = createKoiToolHandlers(repository);

    const applyResult = await handlers.applyCommand({ command: {} });
    expect(applyResult).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "SERVER_BUSY: The mutation limit has been reached" }],
      structuredContent: { ok: false, code: "SERVER_BUSY", retryable: true },
    });

    const importResult = await handlers.importDocument({
      commandId: "busy-import",
      expectedDocumentId: projection.document.id,
      expectedRevision: projection.document.revision,
      documentJson: "{}",
    });
    expect(importResult).toMatchObject({
      isError: true,
      structuredContent: { ok: false, code: "SERVER_BUSY", retryable: true },
    });
  });
});
