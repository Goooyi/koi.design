import { commandReceiptSchema, projectionSchema, type Command, type Projection } from "@koi/core";
import { z } from "zod";

const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  requestId: z.string().optional(),
});

const workspaceSummarySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  documentCount: z.number().int().nonnegative(),
});

const documentSummarySchema = z.strictObject({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
});

const snapshotSchema = z.strictObject({
  snapshot: z.strictObject({
    projection: projectionSchema,
  }),
});

const importResponseSchema = z.strictObject({
  snapshot: snapshotSchema.shape.snapshot,
  commandId: z.string(),
  replayed: z.boolean(),
});

const commandResponseSchema = z.strictObject({
  receipt: commandReceiptSchema,
  replayed: z.boolean(),
  revision: z.number().int().nonnegative(),
  cursor: z.number().int().nonnegative(),
});

export type HostedCommandResponse = z.infer<typeof commandResponseSchema>;

export interface HostedPublishRequest {
  readonly commandId: string;
  readonly expectedDocumentId: string;
  readonly expectedRevision: number;
  readonly documentJson: string;
}

export class HostedKoiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HostedKoiError";
    this.status = status;
    this.code = code;
  }
}

export class HostedPublishOutcomeUnknownError extends Error {
  readonly request: HostedPublishRequest;

  constructor(request: HostedPublishRequest, cause: unknown) {
    super(
      `Publish outcome is unknown for ${request.commandId}. Retry Publish to reconcile the same request, or Open the hosted canvas to accept its authoritative state.`,
      { cause },
    );
    this.name = "HostedPublishOutcomeUnknownError";
    this.request = request;
  }
}

export interface HostedDocument {
  workspaceId: string;
  projection: Projection;
}

export interface HostedKoiClientOptions {
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function projectionFromSnapshot(snapshot: z.infer<typeof snapshotSchema>["snapshot"]): Projection {
  return snapshot.projection;
}

export class HostedKoiClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestTimeoutMs: number;

  constructor(baseUrl: string, token: string, options: HostedKoiClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new RangeError("Hosted request timeout must be positive and finite");
    }
  }

  async authenticate(): Promise<void> {
    await this.#request("/api/v1/session");
  }

  async openOrCreateDocument(): Promise<HostedDocument> {
    const workspaceList = z
      .strictObject({ workspaces: z.array(workspaceSummarySchema) })
      .parse(await this.#request("/api/v1/workspaces"));
    let workspace = workspaceList.workspaces[0];
    if (!workspace) {
      const created = z.strictObject({ workspace: workspaceSummarySchema }).parse(
        await this.#request("/api/v1/workspaces", {
          method: "POST",
          body: JSON.stringify({ name: "Koi workspace" }),
        }),
      );
      workspace = created.workspace;
    }

    const documentList = z
      .strictObject({ documents: z.array(documentSummarySchema) })
      .parse(await this.#request(`/api/v1/workspaces/${workspace.id}/documents`));
    const summary = documentList.documents[0];
    const response = summary
      ? snapshotSchema.parse(await this.#request(`/api/v1/documents/${summary.id}`))
      : snapshotSchema.parse(
          await this.#request(`/api/v1/workspaces/${workspace.id}/documents`, {
            method: "POST",
            body: JSON.stringify({ name: "Koi canvas" }),
          }),
        );
    return {
      workspaceId: workspace.id,
      projection: projectionFromSnapshot(response.snapshot),
    };
  }

  async getProjection(documentId: string): Promise<Projection> {
    const response = snapshotSchema.parse(await this.#request(`/api/v1/documents/${documentId}`));
    return projectionFromSnapshot(response.snapshot);
  }

  async publishDocument(request: HostedPublishRequest): Promise<Projection> {
    const path = `/api/v1/documents/${encodeURIComponent(request.expectedDocumentId)}/import`;
    const body = JSON.stringify(request);
    const attempt = async () => {
      const response = importResponseSchema.parse(
        await this.#request(path, {
          method: "POST",
          body,
        }),
      );
      if (response.commandId !== request.commandId) {
        throw new Error("Koi host returned a different publish command ID");
      }
      return projectionFromSnapshot(response.snapshot);
    };

    try {
      return await attempt();
    } catch (error) {
      if (!isAmbiguousPublishFailure(error)) throw error;
    }

    try {
      return await attempt();
    } catch (error) {
      throw new HostedPublishOutcomeUnknownError(request, error);
    }
  }

  async sendCommand(documentId: string, command: Command): Promise<HostedCommandResponse> {
    return commandResponseSchema.parse(
      await this.#request(`/api/v1/documents/${documentId}/commands`, {
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
  }

  async watchRevisions(
    documentId: string,
    after: number,
    onRevision: (cursor: number) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/events?after=${after}`,
      {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.token}`,
        },
        signal,
      },
    );
    if (!response.ok || !response.body) await this.#throwResponse(response);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) {
        if (signal.aborted) return;
        throw new Error("The hosted revision stream ended unexpectedly");
      }
      buffer += value;
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .find((line) => line.startsWith("data:"))
          ?.slice(5)
          .trim();
        if (!data) continue;
        const parsed = z
          .object({ cursor: z.number().int().nonnegative() })
          .safeParse(JSON.parse(data));
        if (parsed.success) await onRevision(parsed.data.cursor);
      }
    }
  }

  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${this.token}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.requestTimeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal,
      });
      if (!response.ok) await this.#throwResponse(response);
      return await response.json();
    } catch (error) {
      if (timeout.signal.aborted && !init.signal?.aborted) {
        throw new HostedKoiError(
          408,
          "request_timeout",
          `Koi host did not respond within ${this.requestTimeoutMs} ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async #throwResponse(response: Response): Promise<never> {
    const payload = errorSchema.safeParse(await response.json().catch(() => null));
    throw new HostedKoiError(
      response.status,
      payload.success ? payload.data.error.code : "http_error",
      payload.success ? payload.data.error.message : `Koi server returned ${response.status}`,
    );
  }
}

function isAmbiguousPublishFailure(error: unknown): boolean {
  if (!(error instanceof HostedKoiError)) return true;
  if (error.code === "request_timeout") return true;
  if (
    error.code === "SERVER_BUSY" ||
    error.code === "CAPACITY_EXCEEDED" ||
    error.code === "RESOURCE_LIMIT"
  ) {
    return false;
  }
  if (error.status >= 400 && error.status < 500) return false;
  return error.status >= 500 && error.status < 600;
}
