import type { CommandError, Projection } from "@koi/core";
import { MAX_TOOL_DOCUMENT_BYTES } from "@koi/mcp";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import {
  InvalidJsonError,
  PayloadTooLargeError,
  RepositoryError,
  UnsupportedMediaTypeError,
} from "./errors.js";
import { handleHostedMcpRequest } from "./hosted-mcp.js";
import { readLimitedJson } from "./request-body.js";
import { RevisionHub, type RevisionEvent, type RevisionSubscription } from "./revision-hub.js";
import type { KoiRepository } from "./repository.js";

const DEFAULT_MAX_BODY_BYTES = 512 * 1024;
const DEFAULT_MAX_MCP_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_MCP_REQUESTS = 8;
const DEFAULT_HEARTBEAT_MS = 15_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type AppEnvironment = {
  Variables: {
    requestId: string;
  };
};

const workspaceInputSchema = z.strictObject({
  id: z.string().regex(SAFE_ID_PATTERN).optional(),
  name: z.string().trim().min(1).max(512),
});

const documentInputSchema = z.strictObject({
  id: z.string().regex(SAFE_ID_PATTERN).optional(),
  pageId: z.string().regex(SAFE_ID_PATTERN).optional(),
  name: z.string().trim().min(1).max(512),
});

const importInputSchema = z.strictObject({
  commandId: z.string().regex(SAFE_ID_PATTERN),
  expectedDocumentId: z.string().regex(SAFE_ID_PATTERN),
  expectedRevision: z.number().int().nonnegative(),
  documentJson: z.string().min(1).max(MAX_TOOL_DOCUMENT_BYTES),
});

export type StaticHandler = (
  request: Request,
) => Response | undefined | Promise<Response | undefined>;

export interface ServerLogger {
  error(message: string, details: Record<string, unknown>): void;
}

export interface CreateKoiAppOptions {
  repository: KoiRepository;
  authToken: string;
  revisionHub?: RevisionHub;
  maxBodyBytes?: number;
  maxMcpBodyBytes?: number;
  maxMcpRequests?: number;
  heartbeatMs?: number;
  publicOrigin?: string;
  staticHandler?: StaticHandler;
  mcpViewHtml?: string;
  logger?: ServerLogger;
}

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

function jsonError(
  context: Context<AppEnvironment>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503 | 507,
  code: string,
  message: string,
  details?: unknown,
) {
  const payload: ErrorPayload = {
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId: context.get("requestId"),
  };
  return context.json(payload, status);
}

function tokensMatch(expected: string, authorization: string | undefined): boolean {
  const match = authorization?.match(/^Bearer ([^\s,]+)$/);
  if (!match) {
    return false;
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(match[1]!, "utf8");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function snapshot(projection: Projection) {
  return { projection };
}

function commandErrorStatus(error: CommandError): 409 | 422 {
  return error.code === "INVALID_COMMAND" ? 422 : 409;
}

function parseEventCursor(value: string | undefined): number | undefined {
  if (value === undefined) {
    return 0;
  }
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : undefined;
}

function setSecurityHeaders(context: Context<AppEnvironment>): void {
  context.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:",
  );
  context.header("Cross-Origin-Opener-Policy", "same-origin");
  context.header("Cross-Origin-Resource-Policy", "same-origin");
  context.header("Origin-Agent-Cluster", "?1");
  context.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=()");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "SAMEORIGIN");
}

function mapRepositoryError(context: Context<AppEnvironment>, error: RepositoryError) {
  switch (error.code) {
    case "NOT_FOUND":
      return jsonError(context, 404, error.code, error.message);
    case "CONFLICT":
      return jsonError(context, 409, error.code, error.message);
    case "CAPACITY_EXCEEDED":
      return jsonError(context, 507, error.code, error.message);
    case "SERVER_BUSY":
      context.header("Retry-After", "1");
      return jsonError(context, 503, error.code, error.message);
    case "CORRUPT_DATA":
      return jsonError(context, 500, "INTERNAL_ERROR", "Stored data could not be read");
    default:
      return jsonError(context, 500, "INTERNAL_ERROR", "Repository operation failed");
  }
}

function normalizedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

export function createKoiApp(options: CreateKoiAppOptions): Hono<AppEnvironment> {
  if (Buffer.byteLength(options.authToken, "utf8") < 32) {
    throw new TypeError("authToken must contain at least 32 UTF-8 bytes");
  }
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxMcpBodyBytes = options.maxMcpBodyBytes ?? DEFAULT_MAX_MCP_BODY_BYTES;
  const maxMcpRequests = options.maxMcpRequests ?? DEFAULT_MAX_MCP_REQUESTS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError("maxBodyBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new TypeError("heartbeatMs must be a positive integer");
  }
  if (!Number.isSafeInteger(maxMcpBodyBytes) || maxMcpBodyBytes <= 0) {
    throw new TypeError("maxMcpBodyBytes must be a positive integer");
  }
  if (!Number.isSafeInteger(maxMcpRequests) || maxMcpRequests <= 0) {
    throw new TypeError("maxMcpRequests must be a positive integer");
  }

  const publicOrigin = options.publicOrigin ? normalizedOrigin(options.publicOrigin) : undefined;
  if (options.publicOrigin && !publicOrigin) {
    throw new TypeError("publicOrigin must be an absolute HTTP(S) origin");
  }
  const hub = options.revisionHub ?? new RevisionHub();
  const logger = options.logger ?? console;
  const app = new Hono<AppEnvironment>();
  let activeMcpRequests = 0;

  app.use("*", async (context, next) => {
    const requestId = randomUUID();
    context.set("requestId", requestId);
    context.header("X-Request-Id", requestId);
    setSecurityHeaders(context);
    if (isApiPath(context.req.path)) {
      context.header("Cache-Control", "no-store");
    }
    await next();
  });

  app.get("/healthz", (context) => context.json({ ok: true, service: "koi", status: "alive" }));
  app.get("/readyz", (context) =>
    options.repository.isReady()
      ? context.json({ ok: true, service: "koi", status: "ready" })
      : jsonError(context, 503, "NOT_READY", "Repository initialization is incomplete"),
  );

  app.use("/api/*", async (context, next) => {
    const origin = context.req.header("origin");
    const expectedOrigin = publicOrigin ?? new URL(context.req.url).origin;
    if (origin && normalizedOrigin(origin) !== expectedOrigin) {
      return jsonError(context, 403, "CROSS_ORIGIN_REQUEST", "Cross-origin API access is disabled");
    }
    if (!tokensMatch(options.authToken, context.req.header("authorization"))) {
      context.header("WWW-Authenticate", 'Bearer realm="koi"');
      return jsonError(context, 401, "UNAUTHORIZED", "A valid deployment token is required");
    }
    await next();
  });

  app.get("/api/v1/session", (context) =>
    context.json({ session: { mode: "single-user", subject: "deployment-owner" } }),
  );

  app.get("/api/v1/workspaces", async (context) => {
    const workspaces = await options.repository.listWorkspaces();
    return context.json({ workspaces });
  });

  app.get("/api/v1/workspaces/:workspaceId", async (context) => {
    const workspace = await options.repository.getWorkspace(context.req.param("workspaceId"));
    return context.json({ workspace });
  });

  app.post("/api/v1/workspaces", async (context) => {
    const input = workspaceInputSchema.safeParse(
      await readLimitedJson(context.req.raw, maxBodyBytes),
    );
    if (!input.success) {
      return jsonError(
        context,
        422,
        "INVALID_WORKSPACE",
        "Workspace validation failed",
        input.error.issues,
      );
    }
    const workspace = await options.repository.createWorkspace(input.data);
    context.header("Location", `/api/v1/workspaces/${encodeURIComponent(workspace.id)}`);
    return context.json({ workspace }, 201);
  });

  app.get("/api/v1/workspaces/:workspaceId/documents", async (context) => {
    const workspaceId = context.req.param("workspaceId");
    const documents = await options.repository.listDocuments(workspaceId);
    return context.json({ documents });
  });

  app.post("/api/v1/workspaces/:workspaceId/documents", async (context) => {
    const input = documentInputSchema.safeParse(
      await readLimitedJson(context.req.raw, maxBodyBytes),
    );
    if (!input.success) {
      return jsonError(
        context,
        422,
        "INVALID_DOCUMENT",
        "Document validation failed",
        input.error.issues,
      );
    }
    const projection = await options.repository.createDocument(
      context.req.param("workspaceId"),
      input.data,
    );
    context.header("Location", `/api/v1/documents/${encodeURIComponent(projection.document.id)}`);
    context.header("ETag", `"koi-${projection.cursor}"`);
    return context.json({ snapshot: snapshot(projection) }, 201);
  });

  app.get("/api/v1/documents/:documentId", async (context) => {
    const projection = await options.repository.getProjection(context.req.param("documentId"));
    context.header("ETag", `"koi-${projection.cursor}"`);
    return context.json({ snapshot: snapshot(projection) });
  });

  app.all("/api/v1/documents/:documentId/mcp", async (context) => {
    if (context.req.method !== "POST") {
      // Stateless JSON deployments do not expose a server-initiated SSE channel.
      context.header("Allow", "POST");
      return context.body(null, 405);
    }
    if (activeMcpRequests >= maxMcpRequests) {
      context.header("Retry-After", "1");
      return jsonError(
        context,
        503,
        "MCP_CAPACITY",
        "The active MCP request limit has been reached",
      );
    }

    activeMcpRequests += 1;
    try {
      const documentId = context.req.param("documentId");
      const parsedBody =
        context.req.method === "POST"
          ? await readLimitedJson(context.req.raw, maxMcpBodyBytes)
          : undefined;
      if (Array.isArray(parsedBody)) {
        return jsonError(
          context,
          400,
          "MCP_BATCH_UNSUPPORTED",
          "Send exactly one JSON-RPC message per stateless MCP request",
        );
      }
      await options.repository.getProjection(documentId);
      return await handleHostedMcpRequest({
        request: context.req.raw,
        repository: options.repository,
        revisionHub: hub,
        documentId,
        ...(parsedBody === undefined ? {} : { parsedBody }),
        ...(options.mcpViewHtml === undefined ? {} : { viewHtml: options.mcpViewHtml }),
      });
    } finally {
      activeMcpRequests -= 1;
    }
  });

  app.post("/api/v1/documents/:documentId/import", async (context) => {
    const input = importInputSchema.safeParse(
      await readLimitedJson(context.req.raw, maxMcpBodyBytes),
    );
    if (!input.success) {
      return jsonError(
        context,
        422,
        "INVALID_IMPORT",
        "Document import validation failed",
        input.error.issues,
      );
    }

    const documentId = context.req.param("documentId");
    const result = await options.repository.replaceDocument(documentId, input.data);
    if (!result.ok) {
      const status =
        result.code === "DOCUMENT_TOO_LARGE" ? 413 : result.code === "INVALID_DOCUMENT" ? 422 : 409;
      return jsonError(context, status, result.code, result.message, {
        expectedVersion: result.expectedVersion,
        actualVersion: result.actualVersion,
      });
    }

    context.header("ETag", `"koi-${result.projection.cursor}"`);
    // Revision events are idempotent wake-ups. Publishing exact replays also repairs the case
    // where the atomic rename committed but the original response failed during directory fsync.
    hub.publish({
      documentId,
      revision: result.projection.document.revision,
      cursor: result.projection.cursor,
      commandId: input.data.commandId,
      changedIds: [],
    });
    return context.json({
      snapshot: snapshot(result.projection),
      commandId: input.data.commandId,
      replayed: result.replayed,
    });
  });

  app.post("/api/v1/documents/:documentId/commands", async (context) => {
    const command = await readLimitedJson(context.req.raw, maxBodyBytes);
    const documentId = context.req.param("documentId");
    const result = await options.repository.submitCommand(documentId, command);
    if (!result.ok) {
      return jsonError(
        context,
        commandErrorStatus(result.error),
        result.error.code,
        result.error.message,
        {
          operationIndex: result.error.operationIndex,
          expectedVersion: result.error.expectedVersion,
          actualVersion: result.error.actualVersion,
          issues: result.error.issues,
        },
      );
    }

    context.header("ETag", `"koi-${result.projection.cursor}"`);
    // Exact replays publish the same wake-up so a post-rename failure cannot suppress the only
    // notification for a durable Command.
    const event: RevisionEvent = {
      documentId,
      revision: result.projection.document.revision,
      cursor: result.projection.cursor,
      commandId: result.receipt.commandId,
      changedIds: result.receipt.changedIds,
    };
    hub.publish(event);
    return context.json({
      receipt: result.receipt,
      replayed: result.replayed,
      revision: result.projection.document.revision,
      cursor: result.projection.cursor,
    });
  });

  app.get("/api/v1/documents/:documentId/events", async (context) => {
    const rawCursor = context.req.query("after") ?? context.req.header("last-event-id");
    const after = parseEventCursor(rawCursor);
    if (after === undefined) {
      return jsonError(context, 400, "INVALID_CURSOR", "after must be a non-negative integer");
    }

    const documentId = context.req.param("documentId");
    await options.repository.getProjection(documentId);
    let subscription: RevisionSubscription;
    try {
      subscription = hub.subscribe(documentId);
    } catch {
      context.header("Retry-After", "5");
      return jsonError(
        context,
        503,
        "SUBSCRIBER_CAPACITY",
        "Revision stream capacity has been reached",
      );
    }
    let current: Projection;
    try {
      current = await options.repository.getProjection(documentId);
    } catch (error) {
      subscription.close();
      throw error;
    }
    if (after > current.cursor) {
      subscription.close();
      return jsonError(
        context,
        409,
        "CURSOR_AHEAD",
        `Requested cursor ${after} is ahead of current cursor ${current.cursor}`,
      );
    }
    context.header("Cache-Control", "no-cache, no-transform");
    context.header("X-Accel-Buffering", "no");

    return streamSSE(
      context,
      async (stream) => {
        const heartbeat = setInterval(() => subscription.heartbeat(), heartbeatMs);
        stream.onAbort(() => subscription.close());
        try {
          if (current.cursor > after) {
            await stream.writeSSE({
              event: "revision",
              id: String(current.cursor),
              data: JSON.stringify({
                documentId,
                revision: current.document.revision,
                cursor: current.cursor,
              }),
            });
          }

          while (!stream.aborted) {
            const message = await subscription.next();
            if (!message) {
              break;
            }
            if (message.type === "heartbeat") {
              await stream.write(": keepalive\n\n");
              continue;
            }
            await stream.writeSSE({
              event: "revision",
              id: String(message.event.cursor),
              data: JSON.stringify(message.event),
            });
          }
        } finally {
          clearInterval(heartbeat);
          subscription.close();
        }
      },
      (error, stream) => {
        subscription.close();
        if (!stream.aborted) {
          logger.error("Revision stream failed", {
            requestId: context.get("requestId"),
            documentId,
            error: error.message,
          });
        }
        return Promise.resolve();
      },
    );
  });

  app.notFound(async (context) => {
    if (
      options.staticHandler &&
      !isApiPath(context.req.path) &&
      (context.req.method === "GET" || context.req.method === "HEAD")
    ) {
      const response = await options.staticHandler(context.req.raw);
      if (response) {
        return response;
      }
    }
    return jsonError(context, 404, "NOT_FOUND", "Route not found");
  });

  app.onError((error, context) => {
    if (error instanceof PayloadTooLargeError) {
      return jsonError(context, 413, "PAYLOAD_TOO_LARGE", error.message);
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return jsonError(context, 415, "UNSUPPORTED_MEDIA_TYPE", error.message);
    }
    if (error instanceof InvalidJsonError) {
      return jsonError(context, 400, "INVALID_JSON", error.message);
    }
    if (error instanceof RepositoryError) {
      return mapRepositoryError(context, error);
    }

    logger.error("Unhandled request error", {
      requestId: context.get("requestId"),
      method: context.req.method,
      path: context.req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(context, 500, "INTERNAL_ERROR", "The request could not be completed");
  });

  return app;
}
