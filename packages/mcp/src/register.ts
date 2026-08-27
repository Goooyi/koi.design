import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { KOI_MCP_APP_RESOURCE_URI, KOI_MCP_TOOL_NAMES } from "./protocol.js";
import type { KoiDocumentRepository } from "./repository.js";
import {
  applyCommandInputShape,
  applyCommandOutputSchema,
  exportDocumentInputShape,
  exportDocumentOutputSchema,
  importDocumentInputShape,
  importDocumentOutputSchema,
  inspectElementsInputShape,
  inspectElementsOutputSchema,
  openCanvasInputShape,
  openCanvasOutputSchema,
  snapshotChunkInputShape,
  snapshotChunkOutputSchema,
} from "./schemas.js";
import { createKoiToolHandlers } from "./tools.js";

export interface RegisterKoiMcpOptions {
  repository: KoiDocumentRepository;
  loadViewHtml: () => Promise<string>;
}

const uiMeta = {
  resourceUri: KOI_MCP_APP_RESOURCE_URI,
  visibility: ["model", "app"] as Array<"model" | "app">,
};

const appOnlyUiMeta = {
  resourceUri: KOI_MCP_APP_RESOURCE_URI,
  visibility: ["app"] as Array<"app">,
};

export function registerKoiMcp(server: McpServer, options: RegisterKoiMcpOptions): void {
  const handlers = createKoiToolHandlers(options.repository);

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.openCanvas,
    {
      title: "Open Koi canvas",
      description:
        "Open the current Koi Document as an interactive canvas. Returns a bounded, editable snapshot for the MCP App View.",
      inputSchema: openCanvasInputShape,
      outputSchema: openCanvasOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: uiMeta },
    },
    async (_args, extra) => handlers.openCanvas(extra.signal),
  );

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.readSnapshotChunk,
    {
      title: "Read Koi canvas snapshot chunk",
      description:
        "Read one fingerprint-pinned chunk of a paginated Koi Projection for the interactive View. Reopen the canvas if the snapshot changed.",
      inputSchema: snapshotChunkInputShape,
      outputSchema: snapshotChunkOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: appOnlyUiMeta },
    },
    async (args, extra) => handlers.readSnapshotChunk(args, extra.signal),
  );

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.inspectElements,
    {
      title: "Inspect Koi Elements",
      description:
        "Read up to 32 Koi Elements by stable id. Returns bounded semantic previews, current versions, geometry, and missing ids.",
      inputSchema: inspectElementsInputShape,
      outputSchema: inspectElementsOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: uiMeta },
    },
    async (args, extra) => handlers.inspectElements(args, extra.signal),
  );

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.applyCommand,
    {
      title: "Apply Koi Command",
      description:
        "Atomically apply one bounded semantic Koi Command. Supply a stable commandId, monotonic clientSeq, baseCursor, and expected Element versions; exact retries are idempotent.",
      inputSchema: applyCommandInputShape,
      outputSchema: applyCommandOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: uiMeta },
    },
    async (args, extra) => handlers.applyCommand(args, extra.signal),
  );

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.exportDocument,
    {
      title: "Export Koi Document",
      description:
        "Export the current portable Koi Document as bounded JSON. Optionally require the current revision to prevent exporting stale state.",
      inputSchema: exportDocumentInputShape,
      outputSchema: exportDocumentOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: { ui: uiMeta },
    },
    async (args, extra) => handlers.exportDocument(args, extra.signal),
  );

  registerAppTool(
    server,
    KOI_MCP_TOOL_NAMES.importDocument,
    {
      title: "Import Koi Document",
      description:
        "Replace the current local Document with validated portable Koi JSON. Requires an idempotency key and the current Document id and revision.",
      inputSchema: importDocumentInputShape,
      outputSchema: importDocumentOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: uiMeta },
    },
    async (args, extra) => handlers.importDocument(args, extra.signal),
  );

  registerAppResource(
    server,
    "Koi canvas",
    KOI_MCP_APP_RESOURCE_URI,
    {
      description: "The self-contained interactive Koi canvas View.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: KOI_MCP_APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await options.loadViewHtml(),
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: [],
                baseUriDomains: [],
              },
              prefersBorder: false,
            },
          },
        },
      ],
    }),
  );
}
