import { listComponents } from "@koi/astryx";
import {
  exportDocument,
  KOI_DOCUMENT_MEDIA_TYPE,
  getPage,
  elementInputSchema,
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
const MAX_CONTEXT_SELECTION_IDS = 64;

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
        expectedVersion: z.number().int().positive(),
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
        expectedVersion: z.number().int().positive(),
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
        expectedVersion: z.number().int().positive(),
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative().optional(),
        height: z.number().finite().nonnegative().optional(),
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

function invalidInput(error: z.ZodError) {
  return {
    ok: false,
    error: {
      code: "invalid_input",
      message: "The tool input is invalid.",
      retryable: false,
      details: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    },
  };
}

function defineTool<Schema extends ToolSchema>(
  definition: ToolDefinition<Schema>,
): WebMCP.ModelContextTool {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: z.toJSONSchema(definition.schema, {
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
    annotations: {
      readOnlyHint: definition.readOnly,
      untrustedContentHint: definition.untrustedContent,
    },
    execute: async (raw, options?: WebMCP.ToolExecuteCallbackOptions) => {
      const parsed = definition.schema.safeParse(raw);
      if (!parsed.success) return invalidInput(parsed.error);
      // Chrome's experimental WebMCP executor currently omits callback options even though the
      // draft API marks them as required. Keep cancellation when the host supplies it, while
      // allowing otherwise-valid calls from today's browser implementation.
      const executionOptions = options ?? { signal: new AbortController().signal };
      executionOptions.signal.throwIfAborted();
      return definition.execute(parsed.data, executionOptions);
    },
  };
}

function receiptOutput(result: ReturnType<EditorStore["commit"]>) {
  if (result.ok) {
    return {
      ok: true,
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
            error: {
              code: "page_not_found",
              message: `Page ${target} does not exist.`,
              retryable: true,
            },
          };
        }
        return receiptOutput(
          await store.commitDurably(
            elements.map((element) => ({ type: "create", pageId: target, element })),
            { commandId: id, origin: "agent", signal },
          ),
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
        receiptOutput(
          await store.commitDurably(
            updates.map((update): Operation => ({ type: "patch", ...update })),
            { commandId: id, origin: "agent", signal },
          ),
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
        receiptOutput(
          await store.commitDurably(
            elements.map((element): Operation => ({ type: "delete", ...element })),
            { commandId: id, origin: "agent", signal },
          ),
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
        receiptOutput(
          await store.commitDurably(
            placements.map(
              ({ pageId: targetPageId, elementId, expectedVersion, ...geometry }): Operation => ({
                type: "patch",
                pageId: targetPageId,
                elementId,
                expectedVersion,
                changes: { geometry },
              }),
            ),
            { commandId: id, origin: "agent", signal },
          ),
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
            },
          };
        }
        return {
          ok: true,
          mediaType: KOI_DOCUMENT_MEDIA_TYPE,
          bytes,
          source,
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
