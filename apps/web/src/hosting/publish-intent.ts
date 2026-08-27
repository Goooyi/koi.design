import type { Projection } from "@koi/core";

import { HostedPublishOutcomeUnknownError, type HostedPublishRequest } from "./client.js";

interface PendingHostedPublish {
  baseUrl: string;
  request: HostedPublishRequest;
}

interface InteractionLockOwner {
  acquireInteractionLock(): () => void;
}

export class HostedPublishIntentConflictError extends Error {
  readonly pendingRequest: HostedPublishRequest;

  constructor(pendingRequest: HostedPublishRequest) {
    super(
      `Publish ${pendingRequest.commandId} still has an unresolved outcome. Retry the same canvas and host, or Open that hosted canvas before starting a different publish.`,
    );
    this.name = "HostedPublishIntentConflictError";
    this.pendingRequest = pendingRequest;
  }
}

export class HostedPublishIntentCoordinator {
  #pending: PendingHostedPublish | null = null;
  #releaseInteractionLock: (() => void) | null = null;

  constructor(
    private readonly createCommandId: () => string = () => `publish_${crypto.randomUUID()}`,
  ) {}

  prepare(baseUrl: string, target: Projection, documentJson: string): HostedPublishRequest {
    if (this.#pending) {
      const pending = this.#pending;
      if (
        pending.baseUrl === baseUrl &&
        pending.request.expectedDocumentId === target.document.id &&
        pending.request.documentJson === documentJson
      ) {
        return pending.request;
      }
      throw new HostedPublishIntentConflictError(pending.request);
    }

    const request = Object.freeze({
      commandId: this.createCommandId(),
      expectedDocumentId: target.document.id,
      expectedRevision: target.document.revision,
      documentJson,
    });
    this.#pending = { baseUrl, request };
    return request;
  }

  abandon(request: HostedPublishRequest): void {
    if (this.#pending?.request.commandId !== request.commandId) return;
    this.#pending = null;
    this.#releaseInteractionLock?.();
    this.#releaseInteractionLock = null;
  }

  complete(request: HostedPublishRequest): void {
    this.abandon(request);
  }

  hasUnresolvedTarget(baseUrl: string, documentId: string): boolean {
    return (
      this.#pending?.baseUrl === baseUrl && this.#pending.request.expectedDocumentId === documentId
    );
  }

  hasUnresolved(): boolean {
    return this.#pending !== null;
  }

  requireUnresolvedBaseUrl(baseUrl: string): void {
    if (this.#pending && this.#pending.baseUrl !== baseUrl) {
      throw new HostedPublishIntentConflictError(this.#pending.request);
    }
  }

  requireUnresolvedTarget(baseUrl: string, documentId: string): void {
    if (this.#pending && !this.hasUnresolvedTarget(baseUrl, documentId)) {
      throw new HostedPublishIntentConflictError(this.#pending.request);
    }
  }

  requireNoUnresolved(): void {
    if (this.#pending) throw new HostedPublishIntentConflictError(this.#pending.request);
  }

  retainInteractionLock(owner: InteractionLockOwner): void {
    if (this.#pending && !this.#releaseInteractionLock) {
      this.#releaseInteractionLock = owner.acquireInteractionLock();
    }
  }

  clearAfterAuthoritativeOpen(baseUrl: string, documentId: string): void {
    const request = this.#pending?.request;
    if (request && this.hasUnresolvedTarget(baseUrl, documentId)) this.abandon(request);
  }
}

export async function attemptHostedPublish(
  intents: HostedPublishIntentCoordinator,
  baseUrl: string,
  target: Projection,
  documentJson: string,
  publish: (request: HostedPublishRequest) => Promise<Projection>,
): Promise<{ projection: Projection; request: HostedPublishRequest }> {
  const hadUnresolvedOutcome = intents.hasUnresolved();
  const request = intents.prepare(baseUrl, target, documentJson);
  try {
    return { projection: await publish(request), request };
  } catch (error) {
    if (!(error instanceof HostedPublishOutcomeUnknownError) && !hadUnresolvedOutcome) {
      intents.abandon(request);
    }
    throw error;
  }
}
