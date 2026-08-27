import {
  createKoiMcpServer,
  RepositoryBusyError,
  type ImportDocumentRequest,
  type ImportRepositoryResult,
  type KoiDocumentRepository,
  type RepositoryApplyResult,
} from "@koi/mcp";
import bundledMcpViewHtml from "@koi/mcp-view/mcp-app.html?raw";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { KoiRepository } from "./repository.js";
import { RepositoryError } from "./errors.js";
import type { RevisionHub } from "./revision-hub.js";

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error("MCP request was cancelled", { cause: signal.reason });
  error.name = "AbortError";
  throw error;
}

class HostedDocumentRepository implements KoiDocumentRepository {
  readonly #repository: KoiRepository;
  readonly #documentId: string;
  readonly #revisionHub: RevisionHub;

  constructor(repository: KoiRepository, documentId: string, revisionHub: RevisionHub) {
    this.#repository = repository;
    this.#documentId = documentId;
    this.#revisionHub = revisionHub;
  }

  async readProjection(signal?: AbortSignal) {
    throwIfAborted(signal);
    try {
      const projection = await this.#repository.getProjection(this.#documentId);
      throwIfAborted(signal);
      return projection;
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "SERVER_BUSY") {
        throw new RepositoryBusyError(error.message, { cause: error });
      }
      throw error;
    }
  }

  async apply(input: unknown, signal?: AbortSignal): Promise<RepositoryApplyResult> {
    throwIfAborted(signal);
    let result: RepositoryApplyResult;
    try {
      result = await this.#repository.submitCommand(this.#documentId, input);
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "SERVER_BUSY") {
        return {
          ok: false,
          error: {
            ok: false,
            code: "SERVER_BUSY",
            message: error.message,
            retryable: true,
          },
        };
      }
      if (error instanceof RepositoryError && error.code === "CAPACITY_EXCEEDED") {
        return {
          ok: false,
          error: {
            ok: false,
            code: "RESOURCE_LIMIT",
            message: error.message,
          },
        };
      }
      throw error;
    }
    if (result.ok) {
      this.#revisionHub.publish({
        documentId: this.#documentId,
        revision: result.projection.document.revision,
        cursor: result.projection.cursor,
        commandId: result.receipt.commandId,
        changedIds: result.receipt.changedIds,
      });
    }
    return result;
  }

  async replaceDocument(
    request: ImportDocumentRequest,
    signal?: AbortSignal,
  ): Promise<ImportRepositoryResult> {
    throwIfAborted(signal);
    let result: ImportRepositoryResult;
    try {
      result = await this.#repository.replaceDocument(this.#documentId, request);
    } catch (error) {
      if (error instanceof RepositoryError && error.code === "SERVER_BUSY") {
        return {
          ok: false,
          code: "SERVER_BUSY",
          message: error.message,
          retryable: true,
        };
      }
      if (error instanceof RepositoryError && error.code === "CAPACITY_EXCEEDED") {
        return {
          ok: false,
          code: "DOCUMENT_TOO_LARGE",
          message: error.message,
        };
      }
      throw error;
    }
    if (result.ok) {
      this.#revisionHub.publish({
        documentId: this.#documentId,
        revision: result.projection.document.revision,
        cursor: result.projection.cursor,
        commandId: request.commandId,
        changedIds: [],
      });
    }
    return result;
  }
}

export interface HandleHostedMcpRequestOptions {
  request: Request;
  parsedBody?: unknown;
  repository: KoiRepository;
  revisionHub: RevisionHub;
  documentId: string;
  viewHtml?: string;
}

/** Handles one stateless MCP exchange. Every request gets isolated protocol state. */
export async function handleHostedMcpRequest(
  options: HandleHostedMcpRequestOptions,
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createKoiMcpServer({
    repository: new HostedDocumentRepository(
      options.repository,
      options.documentId,
      options.revisionHub,
    ),
    loadViewHtml: async () => options.viewHtml ?? bundledMcpViewHtml,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(
      options.request,
      options.parsedBody === undefined ? undefined : { parsedBody: options.parsedBody },
    );
  } finally {
    await server.close();
  }
}
