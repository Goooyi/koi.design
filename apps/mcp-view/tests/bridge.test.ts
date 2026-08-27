import { createInitialProjection } from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vite-plus/test";

import { createDemoDocument } from "@koi/mcp";
import { SNAPSHOT_CHUNK_BYTES } from "@koi/mcp/protocol";
import {
  readApplyAcknowledgement,
  readExport,
  readImportAcknowledgement,
  readProjection,
  readSnapshotChunk,
  readSnapshotTransfer,
  readToolFailure,
} from "../src/bridge.js";

describe("MCP View result boundary", () => {
  it("accepts a valid Projection and rejects malformed structured content", () => {
    const projection = createInitialProjection(createDemoDocument());
    const valid: CallToolResult = {
      content: [{ type: "text", text: "opened" }],
      structuredContent: { ok: true, snapshot: { projection } },
    };
    expect(readProjection(valid)).toEqual(projection);

    const invalid: CallToolResult = {
      content: [{ type: "text", text: "bad" }],
      structuredContent: { ok: true, snapshot: { projection: { cursor: -1 } } },
    };
    expect(readProjection(invalid)).toBeUndefined();
  });

  it("reads structured errors and portable exports without trusting unrelated fields", () => {
    const failed: CallToolResult = {
      isError: true,
      content: [{ type: "text", text: "fallback" }],
      structuredContent: { ok: false, code: "CONFLICT", message: "Revision changed" },
    };
    expect(readToolFailure(failed)).toBe("Revision changed");

    const exported: CallToolResult = {
      content: [{ type: "text", text: "exported" }],
      structuredContent: {
        ok: true,
        filename: "study.koi.json",
        mediaType: "application/vnd.koi.document+json",
        documentJson: "{}",
      },
    };
    expect(readExport(exported)).toEqual({
      filename: "study.koi.json",
      mediaType: "application/vnd.koi.document+json",
      documentJson: "{}",
    });
  });

  it("validates snapshot-free Command acknowledgements", () => {
    const result: CallToolResult = {
      content: [{ type: "text", text: "committed" }],
      structuredContent: {
        ok: true,
        replayed: false,
        refreshRequired: true,
        receipt: {
          ok: true,
          commandId: "command-1",
          changedIds: ["element-1"],
          viewRevision: 2,
          historyCursor: 2,
          syncStatus: "acknowledged",
        },
      },
    };

    expect(readApplyAcknowledgement(result)).toEqual({
      receipt: result.structuredContent?.receipt,
      refreshRequired: true,
    });
    expect(
      readApplyAcknowledgement({
        ...result,
        structuredContent: { ...result.structuredContent, refreshRequired: "yes" },
      }),
    ).toBeUndefined();
  });

  it("identifies committed import results without confusing apply receipts", () => {
    const imported: CallToolResult = {
      content: [{ type: "text", text: "imported" }],
      structuredContent: {
        ok: true,
        commandId: "import-command-1",
        replayed: false,
      },
    };
    expect(readImportAcknowledgement(imported)).toEqual({
      commandId: "import-command-1",
      replayed: false,
    });
    expect(
      readImportAcknowledgement({
        ...imported,
        structuredContent: { ...imported.structuredContent, commandId: "not valid" },
      }),
    ).toBeUndefined();
  });

  it("validates bounded snapshot transfer descriptors and chunks", () => {
    const fingerprint = "a".repeat(64);
    const transferResult: CallToolResult = {
      content: [{ type: "text", text: "paginated" }],
      structuredContent: {
        ok: true,
        snapshotTransfer: {
          schemaVersion: 1,
          documentId: "document-demo",
          revision: 2,
          cursor: 2,
          totalBytes: 1_000_001,
          chunkBytes: SNAPSHOT_CHUNK_BYTES,
          chunkCount: 2,
          encoding: "base64",
          fingerprint,
        },
      },
    };
    expect(readSnapshotTransfer(transferResult)).toMatchObject({
      documentId: "document-demo",
      totalBytes: 1_000_001,
      fingerprint,
    });
    expect(
      readSnapshotTransfer({
        ...transferResult,
        structuredContent: {
          ...transferResult.structuredContent,
          snapshotTransfer: {
            ...(transferResult.structuredContent?.snapshotTransfer as Record<string, unknown>),
            chunkCount: 3,
          },
        },
      }),
    ).toBeUndefined();
    expect(
      readSnapshotTransfer({
        ...transferResult,
        structuredContent: {
          ...transferResult.structuredContent,
          snapshotTransfer: {
            ...(transferResult.structuredContent?.snapshotTransfer as Record<string, unknown>),
            revision: 3,
          },
        },
      }),
    ).toBeUndefined();

    const chunkResult: CallToolResult = {
      content: [{ type: "text", text: "chunk" }],
      structuredContent: {
        ok: true,
        documentId: "document-demo",
        cursor: 2,
        totalBytes: 1_000_001,
        fingerprint,
        chunkIndex: 1,
        chunkCount: 2,
        byteOffset: SNAPSHOT_CHUNK_BYTES,
        byteLength: 1,
        encoding: "base64",
        data: "eA==",
      },
    };
    expect(readSnapshotChunk(chunkResult)).toMatchObject({ chunkIndex: 1, byteLength: 1 });
    expect(
      readSnapshotChunk({
        ...chunkResult,
        structuredContent: { ...chunkResult.structuredContent, fingerprint: "not-a-hash" },
      }),
    ).toBeUndefined();
  });
});
