import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createInitialProjection, documentSchema, projectionSchema } from "@koi/core";
import {
  KOI_MCP_APP_RESOURCE_URI,
  KOI_MCP_TOOL_NAMES,
  MAX_TOOL_SNAPSHOT_BYTES,
  type SnapshotTransferDescriptor,
} from "@koi/mcp/protocol";
import {
  createDemoDocument,
  InMemoryKoiDocumentRepository,
  RepositoryBusyError,
  type KoiDocumentRepository,
} from "@koi/mcp";
import { createKoiLocalMcpServer } from "../src/server.js";

describe("stdio-compatible MCP composition", () => {
  const closeCallbacks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()));
  });

  it("negotiates tools, calls the canvas, and serves a self-contained View resource", async () => {
    const server = createKoiLocalMcpServer({
      repository: new InMemoryKoiDocumentRepository(),
      loadViewHtml: async () => "<!doctype html><html><title>Koi test View</title></html>",
    });
    const client = new Client({ name: "koi-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(
      () => server.close(),
      () => client.close(),
    );

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(Object.values(KOI_MCP_TOOL_NAMES));
    expect(listed.tools[0]?._meta).toMatchObject({
      ui: { resourceUri: KOI_MCP_APP_RESOURCE_URI },
      "ui/resourceUri": KOI_MCP_APP_RESOURCE_URI,
    });

    const opened = await client.callTool({
      name: KOI_MCP_TOOL_NAMES.openCanvas,
      arguments: {},
    });
    expect(opened.isError).not.toBe(true);
    expect(opened.structuredContent).toMatchObject({
      ok: true,
      snapshot: { projection: { document: { id: "document-demo" } } },
    });
    expect(opened.content).toEqual([
      {
        type: "text",
        text: "Opened “Koi component studies” at revision 0 with 1 Page(s).",
      },
    ]);

    const conflict = await client.callTool({
      name: KOI_MCP_TOOL_NAMES.applyCommand,
      arguments: {
        command: {
          documentId: "document-demo",
          commandId: "stale-command",
          clientId: "protocol-test-client",
          clientSeq: 1,
          baseCursor: 0,
          origin: "agent",
          operations: [
            {
              type: "patch",
              pageId: "page-explorations",
              elementId: "note-agent",
              expectedVersion: 99,
              changes: { geometry: { x: 900 } },
            },
          ],
        },
      },
    });
    expect(conflict).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        code: "VERSION_CONFLICT",
        operationIndex: 0,
        expectedVersion: 99,
        actualVersion: 1,
      },
    });

    const resource = await client.readResource({ uri: KOI_MCP_APP_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: KOI_MCP_APP_RESOURCE_URI,
      mimeType: "text/html;profile=mcp-app",
      text: "<!doctype html><html><title>Koi test View</title></html>",
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: [],
            baseUriDomains: [],
          },
        },
      },
    });
  });

  it("returns structured retryable failures when read admission is full", async () => {
    const repository: KoiDocumentRepository = {
      readProjection() {
        return Promise.reject(new RepositoryBusyError("The local MCP read limit has been reached"));
      },
      async apply() {
        throw new Error("not used");
      },
      async replaceDocument() {
        throw new Error("not used");
      },
    };
    const server = createKoiLocalMcpServer({
      repository,
      loadViewHtml: async () => "<!doctype html><title>Koi busy View</title>",
    });
    const client = new Client({ name: "koi-busy-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(
      () => server.close(),
      () => client.close(),
    );

    const calls = [
      { name: KOI_MCP_TOOL_NAMES.openCanvas, arguments: {} },
      {
        name: KOI_MCP_TOOL_NAMES.readSnapshotChunk,
        arguments: {
          documentId: "document-demo",
          cursor: 0,
          totalBytes: MAX_TOOL_SNAPSHOT_BYTES + 1,
          fingerprint: "a".repeat(64),
          chunkIndex: 0,
        },
      },
      {
        name: KOI_MCP_TOOL_NAMES.inspectElements,
        arguments: { elementIds: ["frame-welcome"] },
      },
      { name: KOI_MCP_TOOL_NAMES.exportDocument, arguments: {} },
    ];

    for (const request of calls) {
      const result = await client.callTool(request);
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "SERVER_BUSY: The local MCP read limit has been reached" }],
        structuredContent: {
          ok: false,
          code: "SERVER_BUSY",
          retryable: true,
        },
      });
    }
  });

  it("accepts a successful bounded acknowledgement without an oversized snapshot", async () => {
    const document = createDemoDocument();
    const page = document.pages[0]!;
    const oversizedDocument = documentSchema.parse({
      ...document,
      pages: [
        {
          ...page,
          elements: [
            ...page.elements,
            ...Array.from({ length: 12 }, (_, index) => ({
              schemaVersion: 1,
              id: `large-note-${index}`,
              kind: "note",
              version: 1,
              parentId: null,
              geometry: { x: index * 20, y: 700, width: 200, height: 100, rotation: 0 },
              properties: { content: "x".repeat(100_000), color: "#ffe694" },
            })),
          ],
        },
      ],
    });
    const server = createKoiLocalMcpServer({
      repository: new InMemoryKoiDocumentRepository(createInitialProjection(oversizedDocument)),
      loadViewHtml: async () => "<!doctype html><title>Koi bounded View</title>",
    });
    const client = new Client({ name: "koi-bounded-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(
      () => server.close(),
      () => client.close(),
    );
    const listed = await client.listTools();
    expect(
      listed.tools.find((tool) => tool.name === KOI_MCP_TOOL_NAMES.readSnapshotChunk)?._meta,
    ).toMatchObject({ ui: { visibility: ["app"] } });

    const opened = await client.callTool({
      name: KOI_MCP_TOOL_NAMES.openCanvas,
      arguments: {},
    });
    expect(opened.isError).not.toBe(true);
    expect(opened.structuredContent).not.toHaveProperty("snapshot");
    const openedStructured = opened.structuredContent as Record<string, unknown> | undefined;
    const transfer = openedStructured?.snapshotTransfer as SnapshotTransferDescriptor;
    expect(transfer.totalBytes).toBeGreaterThan(MAX_TOOL_SNAPSHOT_BYTES);

    const chunks: Buffer[] = [];
    for (let chunkIndex = 0; chunkIndex < transfer.chunkCount; chunkIndex += 1) {
      const chunk = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.readSnapshotChunk,
        arguments: {
          documentId: transfer.documentId,
          cursor: transfer.cursor,
          totalBytes: transfer.totalBytes,
          fingerprint: transfer.fingerprint,
          chunkIndex,
        },
      });
      expect(chunk.isError).not.toBe(true);
      expect(Buffer.byteLength(JSON.stringify(chunk), "utf8")).toBeLessThan(
        MAX_TOOL_SNAPSHOT_BYTES,
      );
      const chunkStructured = chunk.structuredContent as Record<string, unknown> | undefined;
      chunks.push(Buffer.from(chunkStructured?.data as string, "base64"));
    }
    expect(
      projectionSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).document,
    ).toEqual(oversizedDocument);

    const applied = await client.callTool({
      name: KOI_MCP_TOOL_NAMES.applyCommand,
      arguments: {
        command: {
          documentId: "document-demo",
          commandId: "bounded-ack-command",
          clientId: "bounded-test-client",
          clientSeq: 1,
          baseCursor: 0,
          origin: "agent",
          operations: [
            {
              type: "patch",
              pageId: "page-explorations",
              elementId: "note-agent",
              expectedVersion: 1,
              changes: { geometry: { x: 900 } },
            },
          ],
        },
      },
    });

    expect(applied.isError).not.toBe(true);
    expect(applied.structuredContent).toMatchObject({
      ok: true,
      receipt: { commandId: "bounded-ack-command" },
      replayed: false,
      refreshRequired: true,
    });
    expect(applied.structuredContent).not.toHaveProperty("snapshot");
  });
});
