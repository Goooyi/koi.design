import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { KOI_MCP_APP_RESOURCE_URI, KOI_MCP_TOOL_NAMES } from "@koi/mcp/protocol";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createKoiApp } from "../src/app.js";
import { RepositoryError } from "../src/errors.js";
import { FileKoiRepository } from "../src/repository.js";
import { RevisionHub } from "../src/revision-hub.js";
import { configureKoiHttpServer, type KoiHttpServerOptions } from "../src/server-config.js";
import { createStaticHandler } from "../src/static.js";

const TOKEN = "test-token-with-at-least-thirty-two-bytes";
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "koi-server-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function authenticatedJson(body?: unknown): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function authenticatedMcpJson(body: unknown): RequestInit {
  return {
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

async function provisionDocument() {
  const directory = await temporaryDirectory();
  const repository = new FileKoiRepository(directory);
  await repository.initialize();
  const app = createKoiApp({
    repository,
    authToken: TOKEN,
    mcpViewHtml: "<!doctype html><html><title>Koi hosted View</title></html>",
    logger: { error: () => undefined },
  });

  const workspaceResponse = await app.request("/api/v1/workspaces", {
    method: "POST",
    ...authenticatedJson({ id: "workspace_1", name: "Studio" }),
  });
  expect(workspaceResponse.status).toBe(201);
  const documentResponse = await app.request("/api/v1/workspaces/workspace_1/documents", {
    method: "POST",
    ...authenticatedJson({ id: "document_1", pageId: "page_1", name: "Exploration" }),
  });
  expect(documentResponse.status).toBe(201);
  return { app, directory, repository };
}

async function listen(
  app: ReturnType<typeof createKoiApp>,
  options?: KoiHttpServerOptions,
): Promise<{
  server: Server;
  origin: string;
}> {
  return new Promise((resolve, reject) => {
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0, createServer },
      (info) => resolve({ server: server as Server, origin: `http://127.0.0.1:${info.port}` }),
    ) as Server;
    configureKoiHttpServer(server, options);
    server.once("error", reject);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createFrameCommand(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "document_1",
    commandId: "command_1",
    clientId: "browser_1",
    clientSeq: 1,
    baseCursor: 0,
    origin: "human",
    operations: [
      {
        type: "create",
        pageId: "page_1",
        element: {
          schemaVersion: 1,
          id: "frame_1",
          kind: "frame",
          parentId: null,
          geometry: { x: 10, y: 20, width: 320, height: 240, rotation: 0 },
          properties: { clipContent: false, background: "#ffffff" },
        },
      },
    ],
    ...overrides,
  };
}

function initializeMcpRequest(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "koi-test", version: "0.1.0" },
    },
  };
}

async function sendRawRequests(origin: string, requests: string): Promise<string> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    let response = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      response += chunk;
      if ([...response.matchAll(/HTTP\/1\.1 \d{3}/g)].length >= 2) {
        socket.destroy();
        finish();
      }
    });
    socket.once("error", (error) => (response.length > 0 ? finish() : reject(error)));
    socket.once("end", finish);
    socket.once("close", finish);
    socket.once("connect", () => socket.write(requests));
  });
}

describe("self-hosted API", () => {
  it("serves at most one authenticated Projection request per socket", async () => {
    const { app } = await provisionDocument();
    const marker = "large-projection-over-pipelined-http";
    const committed = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(
        createFrameCommand({
          commandId: "large_projection_command",
          operations: [
            {
              type: "create",
              pageId: "page_1",
              element: {
                schemaVersion: 1,
                id: "large_text",
                kind: "text",
                parentId: null,
                geometry: { x: 0, y: 0, width: 800, height: 600, rotation: 0 },
                properties: {
                  content: marker + "x".repeat(99_000),
                  style: {},
                },
              },
            },
          ],
        }),
      ),
    });
    expect(committed.status).toBe(200);
    const { server, origin } = await listen(app);

    try {
      const url = new URL(origin);
      const request = [
        "GET /api/v1/documents/document_1 HTTP/1.1",
        `Host: ${url.host}`,
        `Authorization: Bearer ${TOKEN}`,
        "Connection: keep-alive",
        "",
        "",
      ].join("\r\n");
      const response = await sendRawRequests(origin, request + request);
      const statuses = [...response.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) =>
        Number(match[1]),
      );

      expect(response.length).toBeGreaterThan(100_000);
      expect(response).toContain(marker);
      expect(statuses[0]).toBe(200);
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.slice(1).every((status) => status === 503)).toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("destroys a response socket after finite inactivity", async () => {
    let reportResponseStarted: () => void = () => undefined;
    const responseStarted = new Promise<void>((resolve) => {
      reportResponseStarted = resolve;
    });
    const payloadChunk = Buffer.alloc(64 * 1024, "x");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Length": 64 * 1024 * 1024 });
      const writeUntilBackpressured = () => {
        while (response.write(payloadChunk)) {
          // Keep the response active until a non-reading peer creates backpressure.
        }
        reportResponseStarted();
        response.once("drain", writeUntilBackpressured);
      };
      writeUntilBackpressured();
    });
    configureKoiHttpServer(server, { socketInactivityTimeoutMs: 25 });
    expect(server.maxRequestsPerSocket).toBe(1);
    expect(server.maxConnections).toBe(8);
    expect(server.timeout).toBe(25);
    const timedOut = new Promise<void>((resolve) => {
      server.once("timeout", () => resolve());
    });
    const serverSocketClosed = new Promise<void>((resolve) => {
      server.once("connection", (socket) => socket.once("close", () => resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      throw new Error("Expected a TCP server address");
    }
    const socket = connect({ host: "127.0.0.1", port: address.port });
    socket.on("error", () => undefined);
    socket.pause();

    try {
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await responseStarted;
      await timedOut;
      await serverSocketClosed;
    } finally {
      socket.destroy();
      await closeServer(server);
    }
  });

  it("syncs the parent directory after atomically creating repository state", async () => {
    const directory = await temporaryDirectory();
    const probe = await open(directory, "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();

    try {
      const repository = new FileKoiRepository(directory);
      await repository.initialize();
      expect(syncSpy).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 3);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("syncs every newly created data-directory entry before initialization succeeds", async () => {
    const parent = await temporaryDirectory();
    const directory = join(parent, "fresh", "nested");
    const probe = await open(parent, "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();

    try {
      const repository = new FileKoiRepository(directory);
      await repository.initialize();
      expect(syncSpy).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 5);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it("keeps initialization unavailable until newly created directory entries are durable", async () => {
    if (process.platform === "win32") return;

    const parent = await temporaryDirectory();
    const directory = join(parent, "fresh", "nested");
    const probe = await open(parent, "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();
    syncSpy
      .mockRejectedValueOnce(new Error("directory entry sync failed"))
      .mockRejectedValueOnce(new Error("directory entry sync still failed"));

    const repository = new FileKoiRepository(directory);
    await expect(repository.initialize()).rejects.toThrow("directory entry sync failed");
    expect(repository.isReady()).toBe(false);
    await expect(repository.initialize()).rejects.toThrow("directory entry sync still failed");
    expect(repository.isReady()).toBe(false);
    syncSpy.mockRestore();

    await repository.initialize();
    expect(repository.isReady()).toBe(true);
    const restarted = new FileKoiRepository(directory);
    await restarted.initialize();
    expect(restarted.isReady()).toBe(true);
  });

  it("withholds a renamed index update until its directory sync succeeds", async () => {
    if (process.platform === "win32") return;

    const directory = await temporaryDirectory();
    const repository = new FileKoiRepository(directory);
    await repository.initialize();
    const probe = await open(directory, "r");
    const syncSpy = vi.spyOn(Object.getPrototypeOf(probe) as typeof probe, "sync");
    await probe.close();
    syncSpy
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("directory sync failed"))
      .mockRejectedValueOnce(new Error("directory sync failed"));

    await expect(
      repository.createWorkspace({ id: "workspace_before_sync_failure", name: "First" }),
    ).rejects.toThrow("could not sync its parent directory");
    await expect(repository.listWorkspaces()).rejects.toThrow("directory sync failed");
    syncSpy.mockRestore();
    await expect(repository.listWorkspaces()).resolves.toMatchObject([
      { id: "workspace_before_sync_failure" },
    ]);
    await repository.createWorkspace({ id: "workspace_after_sync_failure", name: "Second" });

    const restarted = new FileKoiRepository(directory);
    await restarted.initialize();
    expect((await restarted.listWorkspaces()).map((workspace) => workspace.id)).toEqual([
      "workspace_before_sync_failure",
      "workspace_after_sync_failure",
    ]);
  });

  it("withholds post-rename Commands and imports until exact retries confirm durability", async () => {
    if (process.platform === "win32") return;

    const directory = await temporaryDirectory();
    const repository = new FileKoiRepository(directory);
    await repository.initialize();
    await repository.createWorkspace({ id: "workspace_1", name: "Studio" });
    await repository.createDocument("workspace_1", {
      id: "document_1",
      pageId: "page_1",
      name: "Exploration",
    });
    const hub = new RevisionHub();
    const subscription = hub.subscribe("document_1");
    const app = createKoiApp({
      repository,
      revisionHub: hub,
      authToken: TOKEN,
      logger: { error: () => undefined },
    });

    const probe = await open(directory, "r");
    const syncPrototype = Object.getPrototypeOf(probe) as typeof probe;
    await probe.close();
    const commandSyncSpy = vi.spyOn(syncPrototype, "sync");
    commandSyncSpy
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("directory sync failed"))
      .mockRejectedValueOnce(new Error("directory sync still failed"))
      .mockRejectedValueOnce(new Error("directory sync failed"));
    const command = createFrameCommand();
    const uncertainCommand = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(command),
    });
    expect(uncertainCommand.status).toBe(500);
    await expect(repository.getProjection("document_1")).rejects.toThrow(
      "directory sync still failed",
    );
    const stillUncertainCommand = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(command),
    });
    expect(stillUncertainCommand.status).toBe(500);
    commandSyncSpy.mockRestore();

    const commandReplay = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(command),
    });
    expect(await commandReplay.json()).toMatchObject({ replayed: true, cursor: 1 });
    await expect(subscription.next()).resolves.toMatchObject({
      type: "revision",
      event: { commandId: "command_1", cursor: 1 },
    });

    const current = await repository.getProjection("document_1");
    const importRequest = {
      commandId: "import_after_sync_failure",
      expectedDocumentId: "document_1",
      expectedRevision: current.document.revision,
      documentJson: JSON.stringify({ ...current.document, name: "Recovered import" }),
    };
    const importSyncSpy = vi.spyOn(syncPrototype, "sync");
    importSyncSpy
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error("directory sync failed"))
      .mockRejectedValueOnce(new Error("directory sync still failed"))
      .mockRejectedValueOnce(new Error("directory sync failed"));
    const uncertainImport = await app.request("/api/v1/documents/document_1/import", {
      method: "POST",
      ...authenticatedJson(importRequest),
    });
    expect(uncertainImport.status).toBe(500);
    await expect(repository.getProjection("document_1")).rejects.toThrow(
      "directory sync still failed",
    );
    const stillUncertainImport = await app.request("/api/v1/documents/document_1/import", {
      method: "POST",
      ...authenticatedJson(importRequest),
    });
    expect(stillUncertainImport.status).toBe(500);
    importSyncSpy.mockRestore();

    const importReplay = await app.request("/api/v1/documents/document_1/import", {
      method: "POST",
      ...authenticatedJson(importRequest),
    });
    expect(await importReplay.json()).toMatchObject({ replayed: true });
    await expect(subscription.next()).resolves.toMatchObject({
      type: "revision",
      event: { commandId: "import_after_sync_failure", cursor: 2 },
    });
    subscription.close();

    const restarted = new FileKoiRepository(directory);
    await restarted.initialize();
    const persisted = await restarted.getProjection("document_1");
    expect(persisted.document).toMatchObject({ name: "Recovered import", revision: 2 });
    expect(persisted.history.map((entry) => entry.command.commandId)).toContain("command_1");
    await expect(restarted.replaceDocument("document_1", importRequest)).resolves.toMatchObject({
      ok: true,
      replayed: true,
    });
  });

  it("protects API routes while keeping bounded health probes public", async () => {
    const directory = await temporaryDirectory();
    const repository = new FileKoiRepository(directory);
    await repository.initialize();
    const app = createKoiApp({ repository, authToken: TOKEN });

    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");

    const unauthorized = await app.request("/api/v1/workspaces");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe('Bearer realm="koi"');

    const session = await app.request("/api/v1/session", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(await session.json()).toEqual({
      session: { mode: "single-user", subject: "deployment-owner" },
    });

    const crossOrigin = await app.request("/api/v1/workspaces", {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://attacker.example" },
    });
    expect(crossOrigin.status).toBe(403);
  });

  it("rejects oversized streamed JSON before application validation", async () => {
    const directory = await temporaryDirectory();
    const repository = new FileKoiRepository(directory);
    await repository.initialize();
    const app = createKoiApp({ repository, authToken: TOKEN, maxBodyBytes: 64 });

    const response = await app.request("/api/v1/workspaces", {
      method: "POST",
      ...authenticatedJson({ name: "x".repeat(256) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("persists a command once and returns the stored receipt for an exact retry", async () => {
    const { app, directory } = await provisionDocument();
    const command = createFrameCommand();

    const responses = await Promise.all(
      [command, command].map((candidate) =>
        Promise.resolve(
          app.request("/api/v1/documents/document_1/commands", {
            method: "POST",
            ...authenticatedJson(candidate),
          }),
        ),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const results = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      replayed: boolean;
    }>;
    expect(
      results.map((result) => result.replayed).sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revision: 1,
          cursor: 1,
          receipt: expect.objectContaining({
            commandId: "command_1",
            syncStatus: "acknowledged",
          }),
        }),
      ]),
    );

    const conflictingReuse = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(createFrameCommand({ origin: "agent" })),
    });
    expect(conflictingReuse.status).toBe(409);
    expect(await conflictingReuse.json()).toMatchObject({
      error: { code: "DUPLICATE_COMMAND_ID" },
    });

    const restartedRepository = new FileKoiRepository(directory);
    await restartedRepository.initialize();
    const stored = await restartedRepository.getProjection("document_1");
    expect(stored.document.revision).toBe(1);
    expect(stored.document.pages[0]?.elements).toHaveLength(1);
    expect(stored.receipts.command_1?.syncStatus).toBe("acknowledged");
    expect(stored.outbox).toEqual([]);
  });

  it("preserves the current snapshot when an element version precondition fails", async () => {
    const { app } = await provisionDocument();
    await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(createFrameCommand()),
    });

    const conflict = await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson({
        documentId: "document_1",
        commandId: "command_2",
        clientId: "browser_1",
        clientSeq: 2,
        baseCursor: 1,
        origin: "human",
        operations: [
          {
            type: "patch",
            pageId: "page_1",
            elementId: "frame_1",
            expectedVersion: 99,
            changes: { geometry: { x: 50 } },
          },
        ],
      }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: {
        code: "VERSION_CONFLICT",
        details: { expectedVersion: 99, actualVersion: 1 },
      },
    });

    const snapshot = await app.request("/api/v1/documents/document_1", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(await snapshot.json()).toMatchObject({
      snapshot: {
        projection: {
          cursor: 1,
          document: { revision: 1, pages: [{ elements: [{ geometry: { x: 10 } }] }] },
        },
      },
    });
  });

  it("publishes a portable local Document only through the explicit import route", async () => {
    const { app, repository } = await provisionDocument();
    const current = await repository.getProjection("document_1");
    const request = {
      commandId: "publish_local_1",
      expectedDocumentId: "document_1",
      expectedRevision: 0,
      documentJson: JSON.stringify({
        ...current.document,
        id: "local_document",
        workspaceId: "local_workspace",
        historyId: "local_history",
        name: "Published local canvas",
      }),
    };

    const response = await app.request("/api/v1/documents/document_1/import", {
      method: "POST",
      ...authenticatedJson(request),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      replayed: false,
      snapshot: {
        projection: {
          cursor: 1,
          document: {
            id: "document_1",
            workspaceId: "workspace_1",
            historyId: current.document.historyId,
            name: "Published local canvas",
            revision: 1,
          },
        },
      },
    });

    const replay = await app.request("/api/v1/documents/document_1/import", {
      method: "POST",
      ...authenticatedJson(request),
    });
    expect(await replay.json()).toMatchObject({ replayed: true });
  });

  it("exposes committed revisions as authenticated SSE wake-ups", async () => {
    const { app } = await provisionDocument();
    await app.request("/api/v1/documents/document_1/commands", {
      method: "POST",
      ...authenticatedJson(createFrameCommand()),
    });

    const abortController = new AbortController();
    const response = await app.request("/api/v1/documents/document_1/events?after=0", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      signal: abortController.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    const message = new TextDecoder().decode(firstChunk.value);
    expect(message).toContain("event: revision");
    expect(message).toContain('"cursor":1');
    abortController.abort();
    await reader.cancel();
  });

  it("serves the durable Document through authenticated stateless Streamable HTTP MCP", async () => {
    const { app, directory, repository } = await provisionDocument();
    const { server, origin } = await listen(app);
    const endpoint = new URL("/api/v1/documents/document_1/mcp", origin);
    const client = new Client({ name: "koi-hosted-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });

    try {
      const unauthorized = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(initializeMcpRequest(1)),
      });
      expect(unauthorized.status).toBe(401);

      const noSse = await fetch(endpoint, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${TOKEN}`,
        },
      });
      expect(noSse.status).toBe(405);
      expect(noSse.headers.get("allow")).toBe("POST");

      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(Object.values(KOI_MCP_TOOL_NAMES));
      expect(tools.tools[0]?._meta).toMatchObject({
        ui: { resourceUri: KOI_MCP_APP_RESOURCE_URI },
      });

      const resource = await client.readResource({ uri: KOI_MCP_APP_RESOURCE_URI });
      expect(resource.contents[0]).toMatchObject({
        uri: KOI_MCP_APP_RESOURCE_URI,
        mimeType: "text/html;profile=mcp-app",
        text: "<!doctype html><html><title>Koi hosted View</title></html>",
      });

      const opened = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.openCanvas,
        arguments: {},
      });
      expect(opened.structuredContent).toMatchObject({
        ok: true,
        snapshot: { projection: { document: { id: "document_1", revision: 0 } } },
      });

      const applied = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.applyCommand,
        arguments: { command: createFrameCommand({ origin: "agent" }) },
      });
      expect(applied.structuredContent).toMatchObject({
        ok: true,
        replayed: false,
        snapshot: { projection: { document: { revision: 1 } } },
      });

      const current = await repository.getProjection("document_1");
      const importRequest = {
        commandId: "import_http_1",
        expectedDocumentId: "document_1",
        expectedRevision: 1,
        documentJson: JSON.stringify({
          ...current.document,
          id: "portable_source_document",
          workspaceId: "portable_source_workspace",
          name: "Imported over HTTP",
        }),
      };
      const imported = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.importDocument,
        arguments: importRequest,
      });
      expect(imported.structuredContent).toMatchObject({
        ok: true,
        replayed: false,
        snapshot: {
          projection: {
            document: {
              id: "document_1",
              workspaceId: "workspace_1",
              name: "Imported over HTTP",
              revision: 2,
            },
          },
        },
      });

      const restartedRepository = new FileKoiRepository(directory);
      await restartedRepository.initialize();
      const persisted = await restartedRepository.getProjection("document_1");
      expect(persisted.document).toMatchObject({
        id: "document_1",
        workspaceId: "workspace_1",
        name: "Imported over HTTP",
        revision: 2,
      });
      await expect(
        restartedRepository.replaceDocument("document_1", importRequest),
      ).resolves.toMatchObject({ ok: true, replayed: true });
    } finally {
      await client.close();
      await closeServer(server);
    }
  });

  it("bounds hosted MCP request bodies before protocol processing", async () => {
    const directory = await temporaryDirectory();
    const repository = new FileKoiRepository(directory);
    await repository.initialize();
    await repository.createWorkspace({ id: "workspace_1", name: "Studio" });
    await repository.createDocument("workspace_1", {
      id: "document_1",
      pageId: "page_1",
      name: "Exploration",
    });
    const app = createKoiApp({
      repository,
      authToken: TOKEN,
      maxMcpBodyBytes: 64,
      mcpViewHtml: "<!doctype html><title>Koi</title>",
    });

    const response = await app.request("/api/v1/documents/document_1/mcp", {
      method: "POST",
      ...authenticatedJson({ payload: "x".repeat(256) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("rejects JSON-RPC batches before reading the hosted Document", async () => {
    const { repository } = await provisionDocument();
    let projectionReads = 0;
    const observedRepository = new Proxy(repository, {
      get(target, property) {
        if (property === "getProjection") {
          return async (documentId: string) => {
            projectionReads += 1;
            return target.getProjection(documentId);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = createKoiApp({
      repository: observedRepository,
      authToken: TOKEN,
      mcpViewHtml: "<!doctype html><title>Koi</title>",
    });

    const response = await app.request("/api/v1/documents/document_1/mcp", {
      method: "POST",
      ...authenticatedMcpJson([initializeMcpRequest(1), initializeMcpRequest(2)]),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "MCP_BATCH_UNSUPPORTED" },
    });
    expect(projectionReads).toBe(0);
  });

  it("returns structured retry guidance when hosted MCP read admission is full", async () => {
    const { repository } = await provisionDocument();
    let armed = false;
    let readsAfterArming = 0;
    const constrainedRepository = new Proxy(repository, {
      get(target, property) {
        if (property === "getProjection") {
          return async (documentId: string) => {
            if (armed) {
              readsAfterArming += 1;
              if (readsAfterArming === 2) {
                armed = false;
                throw new RepositoryError(
                  "SERVER_BUSY",
                  "The concurrent repository read limit has been reached",
                );
              }
            }
            return target.getProjection(documentId);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = createKoiApp({
      repository: constrainedRepository,
      authToken: TOKEN,
      mcpViewHtml: "<!doctype html><title>Koi</title>",
    });
    const { server, origin } = await listen(app);
    const endpoint = new URL("/api/v1/documents/document_1/mcp", origin);
    const client = new Client({ name: "koi-hosted-busy-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });

    try {
      await client.connect(transport);
      armed = true;
      readsAfterArming = 0;
      const opened = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.openCanvas,
        arguments: {},
      });
      expect(opened).toMatchObject({
        isError: true,
        structuredContent: {
          ok: false,
          code: "SERVER_BUSY",
          retryable: true,
        },
      });
    } finally {
      await client.close();
      await closeServer(server);
    }
  });

  it("returns definite hosted MCP mutation admission and capacity failures as tool results", async () => {
    const { repository } = await provisionDocument();
    let nextMutationFailure: RepositoryError | undefined;
    const constrainedRepository = new Proxy(repository, {
      get(target, property) {
        if (property === "submitCommand") {
          return async (...arguments_: Parameters<FileKoiRepository["submitCommand"]>) => {
            if (nextMutationFailure) throw nextMutationFailure;
            return target.submitCommand(...arguments_);
          };
        }
        if (property === "replaceDocument") {
          return async (...arguments_: Parameters<FileKoiRepository["replaceDocument"]>) => {
            if (nextMutationFailure) throw nextMutationFailure;
            return target.replaceDocument(...arguments_);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = createKoiApp({
      repository: constrainedRepository,
      authToken: TOKEN,
      mcpViewHtml: "<!doctype html><title>Koi</title>",
    });
    const { server, origin } = await listen(app);
    const client = new Client({ name: "koi-hosted-mutation-bound-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("/api/v1/documents/document_1/mcp", origin),
      { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } },
    );

    try {
      await client.connect(transport);
      nextMutationFailure = new RepositoryError(
        "SERVER_BUSY",
        "The repository write queue is full",
      );
      const busyApply = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.applyCommand,
        arguments: { command: createFrameCommand({ origin: "agent" }) },
      });
      expect(busyApply).toMatchObject({
        isError: true,
        structuredContent: { ok: false, code: "SERVER_BUSY", retryable: true },
      });

      nextMutationFailure = new RepositoryError(
        "CAPACITY_EXCEEDED",
        "The document exceeds the configured storage bound",
      );
      const capacityApply = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.applyCommand,
        arguments: { command: createFrameCommand({ origin: "agent" }) },
      });
      expect(capacityApply).toMatchObject({
        isError: true,
        structuredContent: { ok: false, code: "RESOURCE_LIMIT" },
      });

      const current = await repository.getProjection("document_1");
      nextMutationFailure = new RepositoryError(
        "SERVER_BUSY",
        "The repository write queue is full",
      );
      const busyImport = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.importDocument,
        arguments: {
          commandId: "import_busy_1",
          expectedDocumentId: "document_1",
          expectedRevision: 0,
          documentJson: JSON.stringify(current.document),
        },
      });
      expect(busyImport).toMatchObject({
        isError: true,
        structuredContent: { ok: false, code: "SERVER_BUSY", retryable: true },
      });

      nextMutationFailure = new RepositoryError(
        "CAPACITY_EXCEEDED",
        "The document exceeds the configured storage bound",
      );
      const capacityImport = await client.callTool({
        name: KOI_MCP_TOOL_NAMES.importDocument,
        arguments: {
          commandId: "import_capacity_1",
          expectedDocumentId: "document_1",
          expectedRevision: 0,
          documentJson: JSON.stringify(current.document),
        },
      });
      expect(capacityImport).toMatchObject({
        isError: true,
        structuredContent: { ok: false, code: "DOCUMENT_TOO_LARGE" },
      });
    } finally {
      await client.close();
      await closeServer(server);
    }
  });

  it("rejects excess concurrent MCP exchanges without growing an unbounded queue", async () => {
    const { repository } = await provisionDocument();
    let releaseFirstRead: () => void = () => undefined;
    let reportFirstRead: () => void = () => undefined;
    const firstReadEntered = new Promise<void>((resolve) => {
      reportFirstRead = resolve;
    });
    const firstReadBlocker = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let blocked = false;
    const delayedRepository = new Proxy(repository, {
      get(target, property) {
        if (property === "getProjection") {
          return async (documentId: string) => {
            if (!blocked) {
              blocked = true;
              reportFirstRead();
              await firstReadBlocker;
            }
            return target.getProjection(documentId);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const app = createKoiApp({
      repository: delayedRepository,
      authToken: TOKEN,
      maxMcpRequests: 1,
      mcpViewHtml: "<!doctype html><title>Koi</title>",
    });
    const first = app.request("/api/v1/documents/document_1/mcp", {
      method: "POST",
      ...authenticatedMcpJson(initializeMcpRequest(1)),
    });
    await firstReadEntered;

    const rejected = await app.request("/api/v1/documents/document_1/mcp", {
      method: "POST",
      ...authenticatedMcpJson(initializeMcpRequest(2)),
    });
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("retry-after")).toBe("1");
    expect(await rejected.json()).toMatchObject({ error: { code: "MCP_CAPACITY" } });

    releaseFirstRead();
    expect((await first).status).toBe(200);
  });
});

describe("revision notifications", () => {
  it("delivers bounded document-specific wake-ups and releases capacity on close", async () => {
    const hub = new RevisionHub(1);
    const subscription = hub.subscribe("document_1");
    expect(() => hub.subscribe("document_2")).toThrow("capacity");

    hub.publish({
      documentId: "document_1",
      revision: 2,
      cursor: 2,
      commandId: "command_2",
      changedIds: ["frame_1"],
    });
    await expect(subscription.next()).resolves.toMatchObject({
      type: "revision",
      event: { cursor: 2, commandId: "command_2" },
    });

    subscription.close();
    expect(hub.subscriberCount).toBe(0);
    const replacement = hub.subscribe("document_2");
    replacement.close();
  });
});

describe("same-origin static serving", () => {
  it("serves the SPA without allowing a symlink to escape its configured root", async () => {
    const directory = await temporaryDirectory();
    const staticRoot = join(directory, "web");
    await mkdir(staticRoot);
    await writeFile(join(staticRoot, "index.html"), "<main>Koi</main>", "utf8");
    await writeFile(join(directory, "secret.txt"), "not public", "utf8");
    await symlink(join(directory, "secret.txt"), join(staticRoot, "escape.txt"));
    const handler = await createStaticHandler(staticRoot);

    const page = await handler(
      new Request("http://localhost/projects/one", { headers: { Accept: "text/html" } }),
    );
    expect(page?.status).toBe(200);
    expect(await page?.text()).toBe("<main>Koi</main>");

    const escaped = await handler(new Request("http://localhost/escape.txt"));
    expect(escaped).toBeUndefined();
  });
});
