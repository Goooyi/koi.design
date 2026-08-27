import { describe, expect, it, vi } from "vite-plus/test";

import { createEmptyDocument, createInitialProjection, type ElementInput } from "@koi/core";
import { EditorStore } from "@koi/editor";

import { HostedPublishIntentCoordinator } from "../src/hosting/publish-intent.js";
import {
  localReturnDocumentIdForTransition,
  publishAfterCheckpoint,
  runWithSuspendedHostedSession,
  TransitionCoordinator,
} from "../src/app/transition-coordinator.js";

const frame: ElementInput = {
  schemaVersion: 1,
  id: "frame-1",
  kind: "frame",
  parentId: null,
  geometry: { x: 0, y: 0, width: 320, height: 240, rotation: 0 },
  properties: { clipContent: false },
};

function createStore() {
  return new EditorStore({
    projection: createInitialProjection(
      createEmptyDocument({
        id: "document-1",
        workspaceId: "workspace-1",
        name: "Transitions",
        pageId: "page-1",
        historyId: "history-1",
        designProfileVersion: "0.5.0",
      }),
    ),
  });
}

describe("TransitionCoordinator", () => {
  it("preserves the genuine local return target across hosted workspace switches", () => {
    let localReturnId: string | null = null;
    const rememberCandidate = (candidate: string | null) => {
      if (candidate) localReturnId = candidate;
    };

    rememberCandidate(
      localReturnDocumentIdForTransition({ kind: "local" }, "document-X", "document-Y"),
    );
    rememberCandidate(
      localReturnDocumentIdForTransition({ kind: "hosted" }, "document-Y", "document-X"),
    );

    expect(localReturnId).toBe("document-X");
  });

  it("does not create a return target when a local transition keeps the same document", () => {
    expect(
      localReturnDocumentIdForTransition({ kind: "local" }, "document-1", "document-1"),
    ).toBeNull();
  });

  it("does not publish new authority state when its durable checkpoint fails", async () => {
    const publish = vi.fn();

    await expect(
      publishAfterCheckpoint(async () => {
        throw new Error("IndexedDB quota exceeded");
      }, publish),
    ).rejects.toThrow("IndexedDB quota exceeded");
    expect(publish).not.toHaveBeenCalled();
  });

  it("retains a publish intent when its final durable checkpoint fails", async () => {
    const store = createStore();
    const commandIds = ["publish_retry", "publish_after_activation"];
    const intents = new HostedPublishIntentCoordinator(() => commandIds.shift()!);
    const request = intents.prepare(
      "https://koi.example",
      store.getProjection(),
      '{"name":"Local"}',
    );
    intents.retainInteractionLock(store);

    await expect(
      publishAfterCheckpoint(
        async () => {
          throw new Error("IndexedDB checkpoint failed");
        },
        () => intents.complete(request),
      ),
    ).rejects.toThrow("IndexedDB checkpoint failed");

    expect(intents.prepare("https://koi.example", store.getProjection(), '{"name":"Local"}')).toBe(
      request,
    );
    expect(store.getInteractionLocked()).toBe(true);

    await publishAfterCheckpoint(
      async () => undefined,
      () => intents.complete(request),
    );
    expect(store.getInteractionLocked()).toBe(false);
    expect(
      intents.prepare("https://koi.example", store.getProjection(), '{"name":"Later"}').commandId,
    ).toBe("publish_after_activation");
  });

  it("resumes the prior hosted session when its replacement fails", async () => {
    const watcher = new AbortController();
    const resume = vi.fn();

    await expect(
      runWithSuspendedHostedSession(
        () => watcher.abort(),
        async () =>
          publishAfterCheckpoint(
            async () => {
              throw new Error("Replacement checkpoint failed");
            },
            () => "replacement",
          ),
        resume,
      ),
    ).rejects.toThrow("Replacement checkpoint failed");

    expect(watcher.signal.aborted).toBe(true);
    expect(resume).toHaveBeenCalledOnce();
  });

  it("locks immediately and serializes transitions through failures", async () => {
    const store = createStore();
    const busy = vi.fn();
    const coordinator = new TransitionCoordinator(busy);
    let finishDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    const order: string[] = [];

    const first = coordinator.run(
      store,
      () => drain,
      async () => {
        order.push("first");
        throw new Error("transition failed");
      },
    );
    const second = coordinator.run(
      store,
      async () => undefined,
      async () => {
        order.push("second");
      },
    );

    expect(store.getInteractionLocked()).toBe(true);
    expect(store.createElement("page-1", frame)).toMatchObject({
      ok: false,
      error: { code: "INTERACTION_LOCKED" },
    });
    finishDrain();

    await expect(first).rejects.toThrow("transition failed");
    await second;
    expect(order).toEqual(["first", "second"]);
    expect(store.getInteractionLocked()).toBe(false);
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
});
