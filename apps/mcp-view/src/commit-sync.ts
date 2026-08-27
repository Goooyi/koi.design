import { acknowledgeOutboxEntry, type Projection } from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { readProjection, readSnapshotTransfer, readToolFailure } from "./bridge.js";
import { loadProjectionResult } from "./initial-load.js";
import type { SnapshotChunkCaller } from "./snapshot-loader.js";

const MAX_REMEMBERED_REFRESHES = 128;

/** Releases a settled mutation lock, but keeps an unreconciled mutation locked. */
export class InteractionLockLease {
  #release: (() => void) | undefined;
  #retainUntilReconcile = false;

  constructor(release: (() => void) | undefined) {
    this.#release = release;
  }

  retainUntilReconcile(): void {
    this.#retainUntilReconcile = true;
  }

  finish(): void {
    if (this.#retainUntilReconcile) return;
    this.#releaseNow();
  }

  releaseAfterReconcile(): void {
    this.#releaseNow();
  }

  #releaseNow(): void {
    const release = this.#release;
    this.#release = undefined;
    release?.();
  }
}

export type ExactRetryResult<Result> =
  | { ok: true; value: Result; retried: boolean }
  | { ok: false; error: unknown };

/** Retries one rejected transport Promise; resolved structured tool failures are never retried. */
export async function callWithOneExactRetry<Result>(
  call: () => Promise<Result>,
): Promise<ExactRetryResult<Result>> {
  try {
    return { ok: true, value: await call(), retried: false };
  } catch {
    try {
      return { ok: true, value: await call(), retried: true };
    } catch (error) {
      return { ok: false, error };
    }
  }
}

/** A failed retry cannot prove whether the rejected first attempt committed before disconnecting. */
export function readAmbiguousRetryFailure(
  result: ExactRetryResult<CallToolResult>,
): string | undefined {
  return result.ok && result.retried ? readToolFailure(result.value) : undefined;
}

/**
 * Deduplicates exact apply receipts and serializes distinct refreshes. A later Command always gets
 * a trailing read, because an earlier in-flight read may have started before that Command committed.
 */
export class ApplyRefreshCoordinator {
  readonly #active = new Map<string, Promise<boolean>>();
  readonly #completed = new Set<string>();
  #tail: Promise<void> = Promise.resolve();

  request(
    commandId: string,
    acknowledge: () => void,
    refresh: () => Promise<boolean>,
  ): Promise<boolean> {
    // Acknowledgement is intentionally outside refresh deduplication: the host result may race the
    // View-owned call result, and either one must be able to drain the matching optimistic outbox.
    acknowledge();

    if (this.#completed.has(commandId)) return Promise.resolve(true);
    const active = this.#active.get(commandId);
    if (active) return active;

    const run = this.#tail.then(refresh);
    const tracked = run
      .then((refreshed) => {
        if (refreshed) this.#remember(commandId);
        return refreshed;
      })
      .finally(() => {
        this.#active.delete(commandId);
      });
    this.#active.set(commandId, tracked);
    this.#tail = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  #remember(commandId: string): void {
    this.#completed.add(commandId);
    if (this.#completed.size <= MAX_REMEMBERED_REFRESHES) return;
    const oldest = this.#completed.values().next().value;
    if (oldest !== undefined) this.#completed.delete(oldest);
  }
}

export function acknowledgePendingCommand(projection: Projection, commandId: string): Projection {
  return projection.outbox.some((entry) => entry.commandId === commandId)
    ? acknowledgeOutboxEntry(projection, commandId)
    : projection;
}

export type CommittedProjectionOutcome =
  | { kind: "installed" }
  | { kind: "refreshed" }
  | { kind: "tool-failure"; message: string }
  | { kind: "invalid-result"; message: string }
  | { kind: "refresh-unavailable"; message: string };

/**
 * A validated snapshot or transfer descriptor means the mutation committed. Failure after that
 * boundary must refresh current authority instead of reporting the durable mutation as failed.
 */
export async function reconcileCommittedProjectionResult(
  result: CallToolResult,
  callSnapshotChunk: SnapshotChunkCaller,
  acceptProjection: (projection: Projection) => boolean,
  refreshLatest: () => Promise<boolean>,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
): Promise<CommittedProjectionOutcome> {
  const failure = readToolFailure(result);
  if (failure) return { kind: "tool-failure", message: failure };

  const committedResult = readProjection(result) !== undefined || readSnapshotTransfer(result);
  if (!committedResult) {
    return { kind: "invalid-result", message: "The MCP server returned an invalid import result" };
  }

  const loaded = await loadProjectionResult(result, callSnapshotChunk, onProgress);
  if (loaded.ok && acceptProjection(loaded.projection)) return { kind: "installed" };

  const message = loaded.ok
    ? "The committed import returned a canvas for a different View lifecycle"
    : loaded.message;
  return (await refreshLatest()) ? { kind: "refreshed" } : { kind: "refresh-unavailable", message };
}
