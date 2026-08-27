import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createEmptyDocument, createInitialProjection } from "@koi/core";

import {
  HostedKoiClient,
  HostedPublishOutcomeUnknownError,
  type HostedPublishRequest,
} from "../src/hosting/client.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HostedKoiClient", () => {
  it("preserves the durable server cursor when reconstructing a Projection", async () => {
    const document = createEmptyDocument({
      id: "hosted-document",
      workspaceId: "hosted-workspace",
      name: "Hosted canvas",
      pageId: "hosted-page",
      historyId: "hosted-history",
      designProfileVersion: "0.5.0",
    });
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        snapshot: {
          projection: {
            ...createInitialProjection({ ...document, revision: 7 }),
            cursor: 11,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const projection = await new HostedKoiClient(
      "https://koi.example/",
      "owner-token",
    ).getProjection(document.id);

    expect(projection.cursor).toBe(11);
    expect(projection.document.revision).toBe(7);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://koi.example/api/v1/documents/hosted-document",
      expect.objectContaining({
        headers: expect.objectContaining({}),
      }),
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer owner-token");
  });

  it("publishes local content only through the explicit hosted import request", async () => {
    const document = createEmptyDocument({
      id: "hosted-document",
      workspaceId: "hosted-workspace",
      name: "Hosted canvas",
      pageId: "hosted-page",
      historyId: "hosted-history",
      designProfileVersion: "0.5.0",
    });
    const target = createInitialProjection(document);
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        snapshot: {
          projection: createInitialProjection({
            ...document,
            name: "Published",
            revision: 1,
          }),
        },
        commandId: "publish_test",
        replayed: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request: HostedPublishRequest = {
      commandId: "publish_test",
      expectedDocumentId: target.document.id,
      expectedRevision: target.document.revision,
      documentJson: '{"name":"Local"}',
    };
    const projection = await new HostedKoiClient(
      "https://koi.example",
      "owner-token",
    ).publishDocument(request);

    expect(projection.document.name).toBe("Published");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://koi.example/api/v1/documents/hosted-document/import");
    expect(init).toMatchObject({ method: "POST" });
    expect(typeof init?.body).toBe("string");
    if (typeof init?.body !== "string") return;
    expect(JSON.parse(init.body)).toEqual(request);
  });

  it("retries one timed-out publish with the exact request and observes the server replay", async () => {
    vi.useFakeTimers();
    const document = createEmptyDocument({
      id: "hosted-document",
      workspaceId: "hosted-workspace",
      name: "Hosted canvas",
      pageId: "hosted-page",
      historyId: "hosted-history",
      designProfileVersion: "0.5.0",
    });
    const request: HostedPublishRequest = {
      commandId: "publish_retry",
      expectedDocumentId: document.id,
      expectedRevision: 0,
      documentJson: '{"name":"Local"}',
    };
    const seenCommands = new Set<string>();
    const requestBodies: string[] = [];
    let remotePublishes = 0;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      const body = init.body;
      requestBodies.push(body);
      const parsed = JSON.parse(body) as HostedPublishRequest;
      if (!seenCommands.has(parsed.commandId)) {
        seenCommands.add(parsed.commandId);
        remotePublishes += 1;
      }
      if (requestBodies.length === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return Promise.resolve(
        Response.json({
          snapshot: {
            projection: createInitialProjection({ ...document, name: "Published", revision: 1 }),
          },
          commandId: request.commandId,
          replayed: true,
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HostedKoiClient("https://koi.example", "owner-token", {
      requestTimeoutMs: 250,
    });

    const publishing = client.publishDocument(request);
    await vi.advanceTimersByTimeAsync(250);
    const projection = await publishing;

    expect(projection.document.name).toBe("Published");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies).toEqual([JSON.stringify(request), JSON.stringify(request)]);
    expect(requestBodies.map((body) => JSON.parse(body))).toEqual([request, request]);
    expect(remotePublishes).toBe(1);
  });

  it.each([
    [409, "CONFLICT"],
    [503, "SERVER_BUSY"],
    [507, "CAPACITY_EXCEEDED"],
  ])("does not retry a definite %s %s publish failure", async (status, code) => {
    const request: HostedPublishRequest = {
      commandId: "publish_definite",
      expectedDocumentId: "hosted-document",
      expectedRevision: 0,
      documentJson: '{"name":"Local"}',
    };
    const fetchMock = vi.fn(async () =>
      Response.json({ error: { code, message: "Definite failure" } }, { status }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HostedKoiClient("https://koi.example", "owner-token").publishDocument(request),
    ).rejects.toMatchObject({ name: "HostedKoiError", code, status });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries an intermediary 503 without Koi's definite SERVER_BUSY code", async () => {
    const document = createEmptyDocument({
      id: "hosted-document",
      workspaceId: "hosted-workspace",
      name: "Hosted canvas",
      pageId: "hosted-page",
      historyId: "hosted-history",
      designProfileVersion: "0.5.0",
    });
    const request: HostedPublishRequest = {
      commandId: "publish_gateway_retry",
      expectedDocumentId: document.id,
      expectedRevision: 0,
      documentJson: '{"name":"Local"}',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("gateway unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          snapshot: { projection: createInitialProjection({ ...document, revision: 1 }) },
          commandId: request.commandId,
          replayed: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new HostedKoiClient("https://koi.example", "owner-token").publishDocument(request),
    ).resolves.toMatchObject({ document: { revision: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify(request),
      JSON.stringify(request),
    ]);
  });

  it.each([503, 507])(
    "treats two status-only intermediary %s responses as an unknown outcome",
    async (status) => {
      const request: HostedPublishRequest = {
        commandId: `publish_intermediary_${status}`,
        expectedDocumentId: "hosted-document",
        expectedRevision: 4,
        documentJson: '{"name":"Local"}',
      };
      const fetchMock = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response("intermediary failure", { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const client = new HostedKoiClient("https://koi.example", "owner-token");

      const outcome = await client.publishDocument(request).catch((error: unknown) => error);

      expect(outcome).toBeInstanceOf(HostedPublishOutcomeUnknownError);
      if (!(outcome instanceof HostedPublishOutcomeUnknownError)) return;
      expect(outcome.request).toBe(request);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
        JSON.stringify(request),
        JSON.stringify(request),
      ]);
    },
  );

  it("reports an unknown outcome with the exact request after two ambiguous failures", async () => {
    const request: HostedPublishRequest = {
      commandId: "publish_unknown",
      expectedDocumentId: "hosted-document",
      expectedRevision: 7,
      documentJson: '{"name":"Local"}',
    };
    const requestBodies: BodyInit[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.body) requestBodies.push(init.body);
      throw new TypeError("connection reset after dispatch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HostedKoiClient("https://koi.example", "owner-token");

    const outcome = await client.publishDocument(request).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(HostedPublishOutcomeUnknownError);
    if (!(outcome instanceof HostedPublishOutcomeUnknownError)) return;
    expect(outcome.request).toBe(request);
    expect(outcome.request).toEqual(request);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBodies).toEqual([JSON.stringify(request), JSON.stringify(request)]);
  });

  it("aborts a stalled JSON request at the configured finite timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new HostedKoiClient("https://koi.example", "owner-token", {
      requestTimeoutMs: 250,
    });

    const rejection = expect(client.authenticate()).rejects.toMatchObject({
      name: "HostedKoiError",
      code: "request_timeout",
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("treats an unexpected revision-stream EOF as a disconnect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
      ),
    );
    const client = new HostedKoiClient("https://koi.example", "owner-token");

    await expect(
      client.watchRevisions("document-1", 0, async () => undefined, new AbortController().signal),
    ).rejects.toThrow("revision stream ended unexpectedly");
  });
});
