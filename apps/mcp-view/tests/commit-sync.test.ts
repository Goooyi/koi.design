import { applyCommand, createInitialProjection, type Command } from "@koi/core";
import { createDemoDocument } from "@koi/mcp";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgePendingCommand,
  ApplyRefreshCoordinator,
  callWithOneExactRetry,
  InteractionLockLease,
  readAmbiguousRetryFailure,
} from "../src/commit-sync.js";

function pendingProjection() {
  const projection = createInitialProjection(createDemoDocument());
  const command: Command = {
    documentId: projection.document.id,
    commandId: "command-pending-refresh",
    clientId: "mcp-view-test",
    clientSeq: 1,
    baseCursor: projection.cursor,
    origin: "human",
    operations: [
      {
        type: "patch",
        pageId: projection.document.pages[0]!.id,
        elementId: "note-agent",
        expectedVersion: 1,
        changes: { geometry: { x: 810 } },
      },
    ],
  };
  const applied = applyCommand(projection, command);
  if (!applied.ok) throw new Error(applied.error.message);
  return applied.projection;
}

describe("MCP View committed apply refresh", () => {
  it("keeps the interaction lock after an ambiguous outcome but releases a conclusive one", () => {
    const ambiguousRelease = vi.fn();
    const ambiguous = new InteractionLockLease(ambiguousRelease);
    ambiguous.retainUntilReconcile();
    ambiguous.finish();
    expect(ambiguousRelease).not.toHaveBeenCalled();
    ambiguous.releaseAfterReconcile();
    ambiguous.releaseAfterReconcile();
    expect(ambiguousRelease).toHaveBeenCalledOnce();

    const conclusiveRelease = vi.fn();
    const conclusive = new InteractionLockLease(conclusiveRelease);
    conclusive.finish();
    conclusive.finish();
    expect(conclusiveRelease).toHaveBeenCalledOnce();
  });

  it("confirms a commit replay by retrying the exact request once after transport failure", async () => {
    const request = { commandId: "command-exact-retry", payload: "same-bytes" };
    const received: Array<typeof request> = [];
    let committed = false;

    const result = await callWithOneExactRetry(async () => {
      received.push(request);
      if (!committed) {
        committed = true;
        throw new Error("connection closed after commit");
      }
      return { replayed: true };
    });

    expect(result).toEqual({ ok: true, value: { replayed: true }, retried: true });
    expect(received).toEqual([request, request]);
    expect(received[0]).toBe(received[1]);
  });

  it("returns ambiguity after two transport failures without changing optimistic state", async () => {
    const visible = pendingProjection();
    const call = vi.fn(async () => {
      throw new Error("transport unavailable");
    });

    const result = await callWithOneExactRetry(call);

    expect(result).toMatchObject({ ok: false, error: new Error("transport unavailable") });
    expect(call).toHaveBeenCalledTimes(2);
    expect(visible.outbox.map((entry) => entry.commandId)).toEqual(["command-pending-refresh"]);
    expect(
      visible.document.pages[0]!.elements.find((element) => element.id === "note-agent"),
    ).toMatchObject({ geometry: { x: 810 } });
  });

  it("keeps a commit ambiguous when the exact retry resolves with a tool failure", async () => {
    const visible = pendingProjection();
    let attempt = 0;
    const call = await callWithOneExactRetry(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("connection closed after dispatch");
      return {
        isError: true,
        content: [{ type: "text" as const, text: "SERVER_BUSY: retry later" }],
        structuredContent: {
          ok: false,
          code: "SERVER_BUSY",
          message: "The mutation queue is full",
          retryable: true,
        },
      };
    });

    expect(readAmbiguousRetryFailure(call)).toBe("The mutation queue is full");
    expect(visible.outbox.map((entry) => entry.commandId)).toEqual(["command-pending-refresh"]);
    expect(
      visible.document.pages[0]!.elements.find((element) => element.id === "note-agent"),
    ).toMatchObject({ geometry: { x: 810 } });
  });

  it("does not retry a structured tool failure returned by the first attempt", async () => {
    const failure = {
      isError: true,
      content: [{ type: "text" as const, text: "CONFLICT: rejected" }],
      structuredContent: { ok: false, code: "CONFLICT", message: "The Command was rejected" },
    };
    const invoke = vi.fn(async () => failure);

    const result = await callWithOneExactRetry(invoke);

    expect(result).toEqual({ ok: true, value: failure, retried: false });
    expect(readAmbiguousRetryFailure(result)).toBeUndefined();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("preserves acknowledged local state when the authoritative refresh fails", async () => {
    const coordinator = new ApplyRefreshCoordinator();
    let visible = pendingProjection();
    const refresh = vi.fn(async () => false);

    const refreshed = await coordinator.request(
      "command-pending-refresh",
      () => {
        visible = acknowledgePendingCommand(visible, "command-pending-refresh");
      },
      refresh,
    );

    expect(refreshed).toBe(false);
    expect(visible.outbox).toEqual([]);
    expect(
      visible.document.pages[0]!.elements.find((element) => element.id === "note-agent"),
    ).toMatchObject({ geometry: { x: 810 } });
  });

  it("deduplicates one receipt but gives a later Command a serialized trailing refresh", async () => {
    const coordinator = new ApplyRefreshCoordinator();
    const order: string[] = [];
    let releaseFirst: ((value: boolean) => void) | undefined;
    const firstRefresh = () =>
      new Promise<boolean>((resolve) => {
        order.push("first-start");
        releaseFirst = resolve;
      });
    const duplicate = vi.fn();

    const first = coordinator.request("command-1", duplicate, firstRefresh);
    const same = coordinator.request("command-1", duplicate, async () => {
      throw new Error("duplicate refresh should not run");
    });
    const second = coordinator.request(
      "command-2",
      () => undefined,
      async () => {
        order.push("second-start");
        return true;
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst?.(true);
    await expect(Promise.all([first, same, second])).resolves.toEqual([true, true, true]);
    expect(order).toEqual(["first-start", "second-start"]);
    expect(duplicate).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed refresh, so a duplicate result can retry", async () => {
    const coordinator = new ApplyRefreshCoordinator();

    await expect(
      coordinator.request(
        "command-retry",
        () => undefined,
        async () => false,
      ),
    ).resolves.toBe(false);
    await expect(
      coordinator.request(
        "command-retry",
        () => undefined,
        async () => true,
      ),
    ).resolves.toBe(true);
  });
});
