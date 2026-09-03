import { listComponents } from "@koi/astryx";
import {
  exportDocument,
  elementInputSchema,
  geometrySchema,
  getPage,
  jsonObjectSchema,
  KOI_DOCUMENT_MEDIA_TYPE,
  KOI_JSON_LIMITS,
  ownRecordValue,
  patchChangesSchema,
  stableIdSchema,
  type CommandReceipt,
  type Operation,
} from "@koi/core";
import type { CameraController, EditorStore } from "@koi/editor";
import { z } from "zod";

import {
  createWebMcpElementPreviews,
  MAX_WEBMCP_OUTPUT_BYTES,
  outputExceedsWebMcpLimit,
} from "./preview.js";

const commandId = stableIdSchema.describe("Stable caller-generated id used for safe retries.");
const pageId = stableIdSchema.describe("Target Page id. Defaults to the active Page when omitted.");
const expectedVersion = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const coordinate = geometrySchema.shape.x;
const dimension = geometrySchema.shape.width;
const MAX_CONTEXT_SELECTION_IDS = 64;
const MAX_ERROR_TEXT_LENGTH = 512;
const SAFE_ERROR_KINDS = new Set([
  "AbortError",
  "DOMException",
  "Error",
  "EvalError",
  "InvalidStateError",
  "NotAllowedError",
  "NotFoundError",
  "QuotaExceededError",
  "RangeError",
  "ReferenceError",
  "SecurityError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
]);
// WebMCP hosts place advertised schemas in model context. Four JSON levels cover the current
// Astryx props and shader parameters without repeating Koi's deeper portable-document allowance
// in every tool declaration. Runtime validation remains bounded by the core document schema.
const MAX_WEBMCP_SCHEMA_JSON_DEPTH = 4;

const contextInput = z.strictObject({});
const inspectInput = z.strictObject({ elementIds: z.array(stableIdSchema).min(1).max(32) });
const createInput = z.strictObject({
  commandId,
  pageId: pageId.optional(),
  elements: z.array(elementInputSchema).min(1).max(32),
});
const updateInput = z.strictObject({
  commandId,
  updates: z
    .array(
      z.strictObject({
        pageId,
        elementId: stableIdSchema,
        expectedVersion,
        changes: patchChangesSchema,
      }),
    )
    .min(1)
    .max(32),
});
const deleteInput = z.strictObject({
  commandId,
  elements: z
    .array(
      z.strictObject({
        pageId,
        elementId: stableIdSchema,
        expectedVersion,
      }),
    )
    .min(1)
    .max(32),
});
const arrangeInput = z.strictObject({
  commandId,
  placements: z
    .array(
      z.strictObject({
        pageId,
        elementId: stableIdSchema,
        expectedVersion,
        x: coordinate,
        y: coordinate,
        width: dimension.optional(),
        height: dimension.optional(),
      }),
    )
    .min(1)
    .max(32),
});

type ToolSchema = z.ZodObject;

interface ToolDefinition<Schema extends ToolSchema> {
  name: string;
  title: string;
  description: string;
  schema: Schema;
  readOnly: boolean;
  untrustedContent: boolean;
  execute: (
    input: z.output<Schema>,
    options: WebMCP.ToolExecuteCallbackOptions,
  ) => WebMCP.MaybePromise<Record<string, unknown>>;
}

type JsonSchema = Record<string, unknown>;

function boundedJsonDefinitions(): Record<string, JsonSchema> {
  const primitiveSchemas = (): JsonSchema[] => [
    { type: "null" },
    { type: "boolean" },
    { type: "number", minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE },
    { type: "string", maxLength: KOI_JSON_LIMITS.maxStringLength },
  ];
  const definitions: Record<string, JsonSchema> = {
    koiJsonValue0: { anyOf: primitiveSchemas() },
  };

  for (let depth = 1; depth < MAX_WEBMCP_SCHEMA_JSON_DEPTH; depth += 1) {
    const child = { $ref: `#/$defs/koiJsonValue${depth - 1}` };
    definitions[`koiJsonValue${depth}`] = {
      anyOf: [
        ...primitiveSchemas(),
        {
          type: "array",
          maxItems: KOI_JSON_LIMITS.maxCollectionSize,
          items: child,
        },
        {
          type: "object",
          maxProperties: KOI_JSON_LIMITS.maxCollectionSize,
          propertyNames: {
            type: "string",
            minLength: 1,
            maxLength: KOI_JSON_LIMITS.maxKeyLength,
          },
          additionalProperties: child,
        },
      ],
    };
  }
  return definitions;
}

function inputJsonSchema(schema: ToolSchema) {
  let usesBoundedJson = false;
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
    reused: "ref",
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema: generated }) => {
      if (zodSchema !== jsonObjectSchema) return;
      usesBoundedJson = true;
      Object.assign(generated, {
        type: "object",
        maxProperties: KOI_JSON_LIMITS.maxCollectionSize,
        propertyNames: {
          type: "string",
          minLength: 1,
          maxLength: KOI_JSON_LIMITS.maxKeyLength,
        },
        additionalProperties: {
          $ref: `#/$defs/koiJsonValue${MAX_WEBMCP_SCHEMA_JSON_DEPTH - 1}`,
        },
      });
    },
  });
  if (usesBoundedJson) {
    jsonSchema.$defs = { ...jsonSchema.$defs, ...boundedJsonDefinitions() };
  }
  return jsonSchema;
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : "Unknown error";
  return text.length <= MAX_ERROR_TEXT_LENGTH
    ? text
    : `${text.slice(0, MAX_ERROR_TEXT_LENGTH - 1)}…`;
}

function invalidInput(error: z.ZodError, readOnly: boolean) {
  return {
    ok: false,
    ...(readOnly ? {} : { outcome: "rejected" }),
    error: {
      code: "invalid_input",
      message: "The tool input is invalid.",
      retryable: false,
      details: error.issues.slice(0, 20).map((issue) => ({
        path: boundedText(issue.path.map(String).join(".")),
        message: boundedText(issue.message),
      })),
    },
  };
}

function executionFailure(readOnly: boolean, signal: AbortSignal) {
  return {
    ok: false,
    ...(readOnly ? {} : { outcome: "rejected" }),
    error: {
      code: signal.aborted ? "execution_cancelled" : "execution_failed",
      message: signal.aborted
        ? "The tool call was cancelled before Koi accepted a change."
        : "Koi could not complete the tool call.",
      retryable: false,
    },
  };
}

function reportUnexpectedFailure(scope: string, error: unknown, signal: AbortSignal): void {
  if (signal.aborted) return;
  const candidate = error instanceof Error ? error.name : typeof error;
  const kind = SAFE_ERROR_KINDS.has(candidate) ? candidate : "Unknown";
  console.error(`[Koi WebMCP] ${scope} failed (${kind}).`);
}

function defineTool<Schema extends ToolSchema>(
  definition: ToolDefinition<Schema>,
): WebMCP.ModelContextTool {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: inputJsonSchema(definition.schema),
    annotations: {
      readOnlyHint: definition.readOnly,
      untrustedContentHint: definition.untrustedContent,
    },
    execute: async (raw, options?: WebMCP.ToolExecuteCallbackOptions) => {
      const parsed = definition.schema.safeParse(raw);
      if (!parsed.success) return invalidInput(parsed.error, definition.readOnly);
      // Experimental hosts can omit either the callback-options object or its draft-required
      // signal. Preserve cancellation when supplied and isolate older hosts with a per-call
      // fallback instead of borrowing the registration lifetime.
      const signal = options?.signal ?? new AbortController().signal;
      const executionOptions = { signal };
      try {
        executionOptions.signal.throwIfAborted();
        return await definition.execute(parsed.data, executionOptions);
      } catch (error) {
        reportUnexpectedFailure(`Tool ${definition.name}`, error, executionOptions.signal);
        return executionFailure(definition.readOnly, executionOptions.signal);
      }
    },
  };
}

function receiptOutput(result: ReturnType<EditorStore["commit"]>) {
  if (result.ok) {
    return {
      ok: true,
      outcome: result.replayed ? "duplicate" : "applied",
      commandId: result.receipt.commandId,
      changedIds: result.receipt.changedIds,
      viewRevision: result.receipt.viewRevision,
      syncStatus: result.receipt.syncStatus,
      replayed: result.replayed,
    };
  }
  const details =
    "operationIndex" in result.error
      ? {
          operationIndex: result.error.operationIndex,
          expectedVersion: result.error.expectedVersion,
          actualVersion: result.error.actualVersion,
        }
      : undefined;
  return {
    ok: false,
    outcome: "rejected",
    error: {
      code: result.error.code.toLowerCase(),
      message: result.error.message,
      retryable: [
        "VERSION_CONFLICT",
        "CURSOR_AHEAD",
        "CLIENT_SEQUENCE_CONFLICT",
        "INTERACTION_LOCKED",
      ].includes(result.error.code),
      details,
    },
  };
}

async function commitTool(
  store: EditorStore,
  operations: readonly Operation[],
  options: { commandId: string; signal: AbortSignal },
) {
  try {
    return receiptOutput(
      await store.commitDurably(operations, {
        commandId: options.commandId,
        origin: "agent",
        signal: options.signal,
      }),
    );
  } catch (error) {
    const receipt = ownRecordValue(store.getProjection().receipts, options.commandId);
    reportUnexpectedFailure("Durable commit", error, options.signal);
    if (!receipt) return executionFailure(false, options.signal);
    return {
      ok: false,
      outcome: "ambiguous",
      commandId: receipt.commandId,
      changedIds: receipt.changedIds,
      viewRevision: receipt.viewRevision,
      syncStatus: receipt.syncStatus,
      error: {
        code: "durability_outcome_unknown",
        message:
          "The change is visible in this page, but Koi could not confirm durable persistence. Retry once with the same commandId, then inspect before creating new intent.",
        retryable: true,
      },
    };
  }
}

export interface KoiWebMcpDependencies {
  store: EditorStore;
  camera: CameraController;
}

export function createKoiWebMcpTools({
  store,
  camera,
}: KoiWebMcpDependencies): WebMCP.ModelContextTool[] {
  return [
    defineTool({
      name: "get_canvas_context",
      title: "Get canvas context",
      description:
        "Read the active Koi Document, Page, camera, selection, revision, and sync summary before planning edits.",
      schema: contextInput,
      readOnly: true,
      untrustedContent: true,
      execute: () => {
        const projection = store.getProjection();
        const page = store.getActivePage();
        const selection = store.getSelection();
        return {
          ok: true,
          document: {
            id: projection.document.id,
            name: projection.document.name,
            revision: projection.document.revision,
          },
          page: page ? { id: page.id, name: page.name, elementCount: page.elements.length } : null,
          camera: camera.get(),
          selection: selection.slice(0, MAX_CONTEXT_SELECTION_IDS),
          selectionCount: selection.length,
          selectionTruncated: selection.length > MAX_CONTEXT_SELECTION_IDS,
          selectionContinuation:
            selection.length > MAX_CONTEXT_SELECTION_IDS
              ? {
                  available: false,
                  reason:
                    "Selection pagination is unavailable in Stage 1. The first 64 stable IDs are returned.",
                }
              : null,
          sync: {
            pending: projection.outbox.filter((entry) => entry.status !== "acknowledged").length,
          },
        };
      },
    }),
    defineTool({
      name: "list_components",
      title: "List components",
      description:
        "List the trusted Astryx components that Koi can place as native HTML/CSS instances.",
      schema: contextInput,
      readOnly: true,
      untrustedContent: false,
      execute: () => ({ ok: true, profile: "koi.astryx/0.5.0", components: listComponents() }),
    }),
    defineTool({
      name: "inspect_elements",
      title: "Inspect elements",
      description:
        "Read bounded previews of up to 32 Koi Elements by stable id, including geometry, version, and semantic properties.",
      schema: inspectInput,
      readOnly: true,
      untrustedContent: true,
      execute: ({ elementIds }) => {
        const preview = createWebMcpElementPreviews(store.getDocument(), elementIds);
        const output = {
          ok: true,
          documentId: store.getDocument().id,
          revision: store.getDocument().revision,
          ...preview,
        };
        return outputExceedsWebMcpLimit(output)
          ? {
              ok: false,
              error: {
                code: "output_too_large",
                message: `The requested previews exceed ${MAX_WEBMCP_OUTPUT_BYTES} UTF-8 bytes. Inspect fewer Elements.`,
                retryable: true,
                truncated: false,
                continuation: {
                  available: false,
                  reason:
                    "Koi refuses oversized tool output instead of returning a partial response.",
                },
              },
            }
          : output;
      },
    }),
    defineTool({
      name: "create_elements",
      title: "Create elements",
      description:
        "Create a bounded batch of semantic Koi Elements and commit it as one visible, undoable agent action.",
      schema: createInput,
      readOnly: false,
      untrustedContent: true,
      execute: async ({ commandId: id, pageId: targetPageId, elements }, { signal }) => {
        const target = targetPageId ?? store.getPageId();
        if (!getPage(store.getDocument(), target)) {
          return {
            ok: false,
            outcome: "rejected",
            error: {
              code: "page_not_found",
              message: `Page ${target} does not exist.`,
              retryable: true,
            },
          };
        }
        return commitTool(
          store,
          elements.map((element) => ({ type: "create", pageId: target, element })),
          { commandId: id, signal },
        );
      },
    }),
    defineTool({
      name: "update_elements",
      title: "Update elements",
      description:
        "Patch a bounded batch by stable id and expected version; stale edits fail instead of overwriting human work.",
      schema: updateInput,
      readOnly: false,
      untrustedContent: true,
      execute: async ({ commandId: id, updates }, { signal }) =>
        commitTool(
          store,
          updates.map((update): Operation => ({ type: "patch", ...update })),
          { commandId: id, signal },
        ),
    }),
    defineTool({
      name: "delete_elements",
      title: "Delete elements",
      description:
        "Delete a bounded batch by stable id and expected version as one undoable agent action.",
      schema: deleteInput,
      readOnly: false,
      untrustedContent: true,
      execute: async ({ commandId: id, elements }, { signal }) =>
        commitTool(
          store,
          elements.map((element): Operation => ({ type: "delete", ...element })),
          { commandId: id, signal },
        ),
    }),
    defineTool({
      name: "arrange_elements",
      title: "Arrange elements",
      description:
        "Move or resize a bounded batch using expected versions, so layout never silently replaces newer geometry.",
      schema: arrangeInput,
      readOnly: false,
      untrustedContent: true,
      execute: async ({ commandId: id, placements }, { signal }) =>
        commitTool(
          store,
          placements.map(
            ({ pageId: targetPageId, elementId, expectedVersion, ...geometry }): Operation => ({
              type: "patch",
              pageId: targetPageId,
              elementId,
              expectedVersion,
              changes: { geometry },
            }),
          ),
          { commandId: id, signal },
        ),
    }),
    defineTool({
      name: "export_document",
      title: "Export document",
      description:
        "Return the validated portable .koi.json representation of the current Document.",
      schema: contextInput,
      readOnly: true,
      untrustedContent: true,
      execute: () => {
        const source = exportDocument(store.getDocument());
        const bytes = new TextEncoder().encode(source).byteLength;
        if (bytes > MAX_WEBMCP_OUTPUT_BYTES) {
          return {
            ok: false,
            error: {
              code: "output_too_large",
              message: `The portable Document exceeds the ${MAX_WEBMCP_OUTPUT_BYTES} byte WebMCP output limit. Use the editor's download action instead.`,
              retryable: false,
              truncated: false,
              continuation: {
                available: false,
                reason: "The full Document is available only through the human download action.",
              },
            },
          };
        }
        return {
          ok: true,
          mediaType: KOI_DOCUMENT_MEDIA_TYPE,
          bytes,
          source,
          truncated: false,
          continuation: null,
        };
      },
    }),
  ];
}

export async function registerKoiWebMcp(
  dependencies: KoiWebMcpDependencies,
  context = document.modelContext,
  lifetime = new AbortController(),
): Promise<() => void> {
  if (!context || typeof context.registerTool !== "function") return () => undefined;
  try {
    for (const tool of createKoiWebMcpTools(dependencies)) {
      lifetime.signal.throwIfAborted();
      await context.registerTool(tool, { signal: lifetime.signal });
    }
  } catch (error) {
    lifetime.abort(error);
    throw error;
  }
  return () => lifetime.abort();
}

export type KoiWebMcpReceipt = CommandReceipt;
