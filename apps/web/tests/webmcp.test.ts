import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeAllOutboxEntries,
  createEmptyDocument,
  createInitialProjection,
} from "@koi/core";
import { CameraController, EditorStore } from "@koi/editor";

import { createKoiWebMcpTools, registerKoiWebMcp } from "../src/webmcp/tools.js";

type JsonSchema = Record<string, unknown>;

function resolveLocalReference(root: JsonSchema, reference: string): JsonSchema {
  expect(reference.startsWith("#/")).toBe(true);
  let current: unknown = root;
  for (const segment of reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    expect(current).toBeTypeOf("object");
    current = (current as JsonSchema)[segment];
  }
  expect(current).toBeTypeOf("object");
  return current as JsonSchema;
}

function expectBoundedInputSchema(root: JsonSchema): void {
  const visited = new Set<object>();
  const visit = (candidate: unknown, path: string): void => {
    expect(candidate, path).not.toBe(true);
    if (candidate === false) return;
    expect(candidate, path).toBeTypeOf("object");
    expect(Array.isArray(candidate), path).toBe(false);
    const schema = candidate as JsonSchema;
    if (visited.has(schema)) return;
    visited.add(schema);

    if (typeof schema.$ref === "string") {
      visit(resolveLocalReference(root, schema.$ref), `${path}.$ref`);
    }
    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = schema[keyword];
      if (branches !== undefined) {
        expect(Array.isArray(branches), `${path}.${keyword}`).toBe(true);
        for (const [index, branch] of (branches as unknown[]).entries()) {
          visit(branch, `${path}.${keyword}[${index}]`);
        }
      }
    }

    if (schema.type === "string" && schema.const === undefined && schema.enum === undefined) {
      expect(schema.maxLength, `${path}.maxLength`).toBeTypeOf("number");
    }
    if (
      (schema.type === "number" || schema.type === "integer") &&
      schema.const === undefined &&
      schema.enum === undefined
    ) {
      expect(
        typeof schema.minimum === "number" || typeof schema.exclusiveMinimum === "number",
        `${path}.minimum`,
      ).toBe(true);
      expect(
        typeof schema.maximum === "number" || typeof schema.exclusiveMaximum === "number",
        `${path}.maximum`,
      ).toBe(true);
    }
    if (schema.type === "array") {
      expect(schema.maxItems, `${path}.maxItems`).toBeTypeOf("number");
      visit(schema.items, `${path}.items`);
    }
    if (schema.type === "object") {
      if (schema.additionalProperties !== false) {
        expect(schema.maxProperties, `${path}.maxProperties`).toBeTypeOf("number");
        visit(schema.additionalProperties, `${path}.additionalProperties`);
      }
      if (schema.propertyNames !== undefined) {
        visit(schema.propertyNames, `${path}.propertyNames`);
      }
      for (const [name, property] of Object.entries(
        (schema.properties as Record<string, unknown> | undefined) ?? {},
      )) {
        visit(property, `${path}.properties.${name}`);
      }
    }
  };

  visit(root, "inputSchema");
}

function dependencies(onCommit?: ConstructorParameters<typeof EditorStore>[0]["onCommit"]) {
  const document = createEmptyDocument({
    id: "document-1",
    workspaceId: "workspace-1",
    name: "WebMCP test",
    pageId: "page-1",
    historyId: "history-1",
    designProfileVersion: "0.5.0",
  });
  let sequence = 0;
  return {
    camera: new CameraController({ x: 10, y: 20, zoom: 1 }),
    store: new EditorStore({
      projection: createInitialProjection(document),
      clientId: "webmcp-client",
      createId: (prefix) => `${prefix}-${++sequence}`,
      onCommit,
    }),
  };
}

function executionOptions() {
  return { signal: new AbortController().signal };
}

describe("Koi WebMCP", () => {
  it("publishes the stable first-class tool catalog with schemas and annotations", () => {
    const tools = createKoiWebMcpTools(dependencies());

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_canvas_context",
      "list_components",
      "inspect_elements",
      "create_elements",
      "update_elements",
      "delete_elements",
      "arrange_elements",
      "export_document",
    ]);
    expect(tools.every((tool) => tool.inputSchema && tool.description.length > 0)).toBe(true);
    expect(
      tools.every(
        (tool) =>
          tool.name.length <= 128 &&
          /^[A-Za-z0-9_.-]+$/.test(tool.name) &&
          tool.description.length <= 500,
      ),
    ).toBe(true);
    for (const tool of tools) {
      expectBoundedInputSchema(tool.inputSchema as JsonSchema);
      expect(
        new TextEncoder().encode(JSON.stringify(tool.inputSchema)).byteLength,
      ).toBeLessThanOrEqual(10 * 1_024);
    }
    const advertisedCatalog = tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }));
    expect(
      new TextEncoder().encode(JSON.stringify(advertisedCatalog)).byteLength,
    ).toBeLessThanOrEqual(20 * 1_024);
    expect(tools.find((tool) => tool.name === "create_elements")?.annotations).toEqual({
      readOnlyHint: false,
      untrustedContentHint: true,
    });
  });

  it("validates input and makes a retried mutation idempotent", async () => {
    const runtime = dependencies();
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;
    const invalid = await tool.execute({ unexpected: true }, executionOptions());
    expect(invalid).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "invalid_input", retryable: false },
    });

    const input = {
      commandId: "agent-command-1",
      pageId: "page-1",
      elements: [
        {
          schemaVersion: 1,
          id: "note-1",
          kind: "note",
          parentId: null,
          geometry: { x: 10, y: 20, width: 220, height: 140, rotation: 0 },
          properties: { content: "Agent note", color: "#ffe694" },
        },
      ],
    };
    const first = await tool.execute(input, executionOptions());
    const replay = await tool.execute(input, executionOptions());

    expect(first).toMatchObject({
      ok: true,
      outcome: "applied",
      replayed: false,
      changedIds: ["note-1"],
    });
    expect(replay).toMatchObject({
      ok: true,
      outcome: "duplicate",
      replayed: true,
      changedIds: ["note-1"],
    });
    expect(runtime.store.getActivePage()?.elements).toHaveLength(1);
  });

  it("accepts hosts that omit the draft callback-options object", async () => {
    const tool = createKoiWebMcpTools(dependencies()).find(
      (candidate) => candidate.name === "get_canvas_context",
    )!;

    const result = await (tool.execute as (input: Record<string, unknown>) => Promise<unknown>)({});

    expect(result).toMatchObject({ ok: true, document: { id: "document-1" } });
  });

  it("bounds canvas-context selection output and marks transient locks retryable", async () => {
    const runtime = dependencies();
    for (let index = 0; index < 70; index += 1) {
      runtime.store.createElement("page-1", {
        schemaVersion: 1,
        id: `note-${index}`,
        kind: "note",
        parentId: null,
        geometry: { x: index, y: index, width: 100, height: 80, rotation: 0 },
        properties: { content: String(index) },
      });
      runtime.store.replaceProjection(acknowledgeAllOutboxEntries(runtime.store.getProjection()));
    }
    runtime.store.select(Array.from({ length: 70 }, (_, index) => `note-${index}`));
    const tools = createKoiWebMcpTools(runtime);
    const context = tools.find((candidate) => candidate.name === "get_canvas_context")!;

    await expect(context.execute({}, executionOptions())).resolves.toMatchObject({
      ok: true,
      selectionCount: 70,
      selectionTruncated: true,
      selection: expect.any(Array),
    });
    const contextResult = (await context.execute({}, executionOptions())) as {
      selection: unknown[];
    };
    expect(contextResult.selection).toHaveLength(64);

    const releaseInteractionLock = runtime.store.acquireInteractionLock();
    const create = tools.find((candidate) => candidate.name === "create_elements")!;
    const locked = await create.execute(
      {
        commandId: "locked-command",
        elements: [
          {
            schemaVersion: 1,
            id: "locked-note",
            kind: "note",
            parentId: null,
            geometry: { x: 0, y: 0, width: 100, height: 80, rotation: 0 },
            properties: { content: "later" },
          },
        ],
      },
      executionOptions(),
    );
    releaseInteractionLock();
    expect(locked).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "interaction_locked", retryable: true },
    });
  });

  it("does not tell agents to blindly retry a resource limit", async () => {
    const runtime = dependencies();
    const create = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;
    for (let index = 0; index < 64; index += 1) {
      await expect(
        create.execute(
          {
            commandId: `queued-command-${index}`,
            pageId: "page-1",
            elements: [
              {
                schemaVersion: 1,
                id: `queued-note-${index}`,
                kind: "note",
                parentId: null,
                geometry: { x: index, y: index, width: 100, height: 80, rotation: 0 },
                properties: { content: String(index) },
              },
            ],
          },
          executionOptions(),
        ),
      ).resolves.toMatchObject({ ok: true });
    }

    await expect(
      create.execute(
        {
          commandId: "one-command-too-many",
          pageId: "page-1",
          elements: [
            {
              schemaVersion: 1,
              id: "one-note-too-many",
              kind: "note",
              parentId: null,
              geometry: { x: 0, y: 0, width: 100, height: 80, rotation: 0 },
              properties: { content: "Reconnect or clear the queue first" },
            },
          ],
        },
        executionOptions(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "resource_limit", retryable: false },
    });
  });

  it("returns bounded Element previews and refuses oversized model-context exports", async () => {
    const runtime = dependencies();
    for (let index = 0; index < 11; index += 1) {
      expect(
        runtime.store.createElement("page-1", {
          schemaVersion: 1,
          id: `large-note-${index}`,
          kind: "note",
          parentId: null,
          geometry: { x: index * 20, y: 20, width: 220, height: 140, rotation: 0 },
          properties: { content: "x".repeat(100_000), color: "#ffe694" },
        }).ok,
      ).toBe(true);
    }
    const tools = createKoiWebMcpTools(runtime);
    const inspect = tools.find((candidate) => candidate.name === "inspect_elements")!;
    const inspected = await inspect.execute({ elementIds: ["large-note-0"] }, executionOptions());
    expect(inspected).toMatchObject({
      ok: true,
      truncated: true,
      continuation: { available: false },
      elements: [{ id: "large-note-0", truncated: true }],
    });
    const exportTool = tools.find((candidate) => candidate.name === "export_document")!;
    const exported = await exportTool.execute({}, executionOptions());

    expect(exported).toMatchObject({
      ok: false,
      error: {
        code: "output_too_large",
        retryable: false,
        truncated: false,
        continuation: { available: false },
      },
    });
  });

  it("reports an accepted write as ambiguous when durability cannot be confirmed", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let attempts = 0;
    const runtime = dependencies(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("private storage detail");
    });
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;
    const input = {
      commandId: "ambiguous-command",
      pageId: "page-1",
      elements: [
        {
          schemaVersion: 1,
          id: "ambiguous-note",
          kind: "note",
          parentId: null,
          geometry: { x: 10, y: 10, width: 200, height: 100, rotation: 0 },
          properties: { content: "Visible, persistence unknown", color: "#ffe694" },
        },
      ],
    };

    const ambiguous = await tool.execute(input, executionOptions());
    expect(ambiguous).toMatchObject({
      ok: false,
      outcome: "ambiguous",
      commandId: "ambiguous-command",
      changedIds: ["ambiguous-note"],
      error: { code: "durability_outcome_unknown", retryable: true },
    });
    expect(JSON.stringify(ambiguous)).not.toContain("private storage detail");
    expect(consoleError).toHaveBeenCalledWith("[Koi WebMCP] Durable commit failed (Error).");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private storage detail");

    await Promise.resolve();
    await expect(tool.execute(input, executionOptions())).resolves.toMatchObject({
      ok: true,
      outcome: "duplicate",
      replayed: true,
    });
    expect(runtime.store.getActivePage()?.elements).toHaveLength(1);
    consoleError.mockRestore();
  });

  it("bounds unexpected read errors without exposing internal details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = dependencies();
    vi.spyOn(runtime.camera, "get").mockImplementation(() => {
      const error = new Error("private camera detail");
      error.name = "PrivateCameraDetail";
      throw error;
    });
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "get_canvas_context",
    )!;

    const result = await tool.execute({}, executionOptions());
    expect(result).toEqual({
      ok: false,
      error: {
        code: "execution_failed",
        message: "Koi could not complete the tool call.",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private camera detail");
    expect(consoleError).toHaveBeenCalledWith(
      "[Koi WebMCP] Tool get_canvas_context failed (Unknown).",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("PrivateCameraDetail");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private camera detail");
    consoleError.mockRestore();
  });

  it("rejects an unexpected pre-accept write failure without changing state or inviting retries", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = dependencies();
    const privateError = new Error("private commit detail");
    privateError.name = "PrivateCommitDetail";
    vi.spyOn(runtime.store, "commitDurably").mockRejectedValueOnce(privateError);
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;

    const result = await tool.execute(
      {
        commandId: "failed-before-acceptance",
        pageId: "page-1",
        elements: [
          {
            schemaVersion: 1,
            id: "uncommitted-note",
            kind: "note",
            parentId: null,
            geometry: { x: 10, y: 10, width: 200, height: 100, rotation: 0 },
            properties: { content: "Must not appear", color: "#ffe694" },
          },
        ],
      },
      executionOptions(),
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "execution_failed", retryable: false },
    });
    expect(runtime.store.getActivePage()?.elements).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("[Koi WebMCP] Durable commit failed (Unknown).");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("PrivateCommitDetail");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private commit detail");
    consoleError.mockRestore();
  });

  it("treats a cancelled write as non-retryable without logging an unexpected error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runtime = dependencies();
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      {
        commandId: "cancelled-before-acceptance",
        pageId: "page-1",
        elements: [
          {
            schemaVersion: 1,
            id: "cancelled-note",
            kind: "note",
            parentId: null,
            geometry: { x: 10, y: 10, width: 200, height: 100, rotation: 0 },
            properties: { content: "Must not appear", color: "#ffe694" },
          },
        ],
      },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      outcome: "rejected",
      error: { code: "execution_cancelled", retryable: false },
    });
    expect(runtime.store.getActivePage()?.elements).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("reports mutation success only after the durable callback completes", async () => {
    let finishPersistence!: () => void;
    const runtime = dependencies(
      () =>
        new Promise<void>((resolve) => {
          finishPersistence = resolve;
        }),
    );
    const tool = createKoiWebMcpTools(runtime).find(
      (candidate) => candidate.name === "create_elements",
    )!;
    let resolved = false;
    const execution = tool.execute(
      {
        commandId: "durable-agent-command",
        pageId: "page-1",
        elements: [
          {
            schemaVersion: 1,
            id: "durable-note",
            kind: "note",
            parentId: null,
            geometry: { x: 10, y: 10, width: 200, height: 100, rotation: 0 },
            properties: { content: "Saved before success", color: "#ffe694" },
          },
        ],
      },
      executionOptions(),
    ) as Promise<unknown>;
    const call = execution.then((result: unknown) => {
      resolved = true;
      return result;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    finishPersistence();
    expect(await call).toMatchObject({ ok: true, commandId: "durable-agent-command" });
  });

  it("registers centrally and aborts one shared lifetime on cleanup", async () => {
    const registered: Array<{ tool: WebMCP.ModelContextTool; signal?: AbortSignal }> = [];
    const context = {
      registerTool: vi.fn(async (tool, options) => {
        registered.push({ tool, signal: options?.signal });
      }),
    } as unknown as WebMCP.ModelContext;

    const cleanup = await registerKoiWebMcp(dependencies(), context);
    expect(registered).toHaveLength(8);
    expect(new Set(registered.map((entry) => entry.signal)).size).toBe(1);
    expect(registered[0]!.signal?.aborted).toBe(false);

    cleanup();
    expect(registered[0]!.signal?.aborted).toBe(true);
  });
});
