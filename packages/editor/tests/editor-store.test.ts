import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeAllOutboxEntries,
  createEmptyDocument,
  createInitialProjection,
  type ElementInput,
} from "@koi/core";

import { EditorStore } from "../src/store/editor-store.js";

const frame: ElementInput = {
  schemaVersion: 1,
  id: "frame-1",
  kind: "frame",
  parentId: null,
  geometry: { x: 20, y: 30, width: 400, height: 300, rotation: 0 },
  properties: { clipContent: false, background: "#fff" },
};

function createStore(onError?: (message: string) => void) {
  const document = createEmptyDocument({
    id: "document-1",
    workspaceId: "workspace-1",
    name: "Test document",
    pageId: "page-1",
    historyId: "history-1",
    designProfileVersion: "0.5.0",
  });
  let sequence = 0;
  return new EditorStore({
    projection: createInitialProjection(document),
    clientId: "test-client",
    createId: (prefix) => `${prefix}-${++sequence}`,
    onError,
  });
}

describe("EditorStore", () => {
  it("notifies only the changed record subscriber and commits one semantic drag", () => {
    const store = createStore();
    expect(store.createElement("page-1", frame).ok).toBe(true);
    const changed = vi.fn();
    const untouched = vi.fn();
    store.subscribeElement("frame-1", changed);
    store.subscribeElement("other", untouched);

    const result = store.patchElement("page-1", "frame-1", {
      geometry: { x: 100, y: 120 },
    });

    expect(result.ok).toBe(true);
    expect(store.getElement("frame-1")?.geometry).toMatchObject({ x: 100, y: 120 });
    expect(changed).toHaveBeenCalledOnce();
    expect(untouched).not.toHaveBeenCalled();
    expect(store.getProjection().history).toHaveLength(2);
  });

  it("undo appends compensation and restores the prior observable geometry", () => {
    const store = createStore();
    store.createElement("page-1", frame);
    store.patchElement("page-1", "frame-1", { geometry: { x: 240 } });

    const result = store.undo();

    expect(result?.ok).toBe(true);
    expect(store.getElement("frame-1")?.geometry.x).toBe(20);
    expect(store.getProjection().history.at(-1)?.command.undoOf).toBe("command-2");
  });

  it("walks backward through commands instead of compensating the same command twice", () => {
    const store = createStore();
    store.createElement("page-1", frame);
    store.patchElement("page-1", "frame-1", { geometry: { x: 240 } });

    expect(store.undo()?.ok).toBe(true);
    expect(store.getElement("frame-1")?.geometry.x).toBe(20);
    expect(store.undo()?.ok).toBe(true);

    expect(store.getElement("frame-1")).toBeUndefined();
    expect(
      store
        .getProjection()
        .history.filter((entry) => entry.command.undoOf !== undefined)
        .map((entry) => entry.command.undoOf),
    ).toEqual(["command-2", "command-1"]);
    expect(store.undo()).toBeUndefined();
  });

  it("deletes a Frame with its descendants and attached connectors as one undoable intent", () => {
    const store = createStore();
    const child: ElementInput = {
      schemaVersion: 1,
      id: "text-child",
      kind: "text",
      parentId: "frame-1",
      geometry: { x: 20, y: 20, width: 120, height: 40, rotation: 0 },
      properties: { content: "Inside", style: {} },
    };
    const external: ElementInput = {
      ...child,
      id: "text-external",
      parentId: null,
      geometry: { ...child.geometry, x: 600 },
    };
    const connector: ElementInput = {
      schemaVersion: 1,
      id: "connector-1",
      kind: "connector",
      parentId: null,
      geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      properties: {
        from: { elementId: child.id, anchor: "right" },
        to: { elementId: external.id, anchor: "left" },
        route: "straight",
        points: [],
        strokeWidth: 1,
      },
    };
    store.createElement("page-1", frame);
    store.createElement("page-1", child);
    store.createElement("page-1", external);
    store.createElement("page-1", connector);
    store.select([frame.id]);

    const deleted = store.deleteSelection();

    expect(deleted?.ok).toBe(true);
    expect(store.getElement(frame.id)).toBeUndefined();
    expect(store.getElement(child.id)).toBeUndefined();
    expect(store.getElement(connector.id)).toBeUndefined();
    expect(store.getElement(external.id)).toBeDefined();
    expect(store.getProjection().history.at(-1)?.changedIds).toEqual([
      connector.id,
      child.id,
      frame.id,
    ]);

    expect(store.undo()?.ok).toBe(true);
    expect(store.getElement(frame.id)).toBeDefined();
    expect(store.getElement(child.id)).toBeDefined();
    expect(store.getElement(connector.id)).toBeDefined();
  });

  it("refuses an oversized cascade instead of partially deleting a Frame", () => {
    const onError = vi.fn();
    const store = createStore(onError);
    store.createElement("page-1", frame);
    store.replaceProjection(acknowledgeAllOutboxEntries(store.getProjection()));
    for (let index = 0; index < 64; index += 1) {
      store.createElement("page-1", {
        schemaVersion: 1,
        id: `child-${index}`,
        kind: "note",
        parentId: frame.id,
        geometry: { x: index, y: index, width: 40, height: 40, rotation: 0 },
        properties: { content: String(index) },
      });
      store.replaceProjection(acknowledgeAllOutboxEntries(store.getProjection()));
    }
    const revision = store.getDocument().revision;
    store.select([frame.id]);

    expect(store.deleteSelection()).toBeUndefined();
    expect(store.getDocument().revision).toBe(revision);
    expect(store.getElement(frame.id)).toBeDefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("more than 64 Elements"));
  });

  it("honors cancellation before the projection and outbox commit", () => {
    const store = createStore();
    const abort = new AbortController();
    abort.abort(new DOMException("Canceled", "AbortError"));

    expect(() => store.createElement("page-1", frame, { signal: abort.signal })).toThrow(
      "Canceled",
    );
    expect(store.getActivePage()?.elements).toHaveLength(0);
    expect(store.getProjection().outbox).toHaveLength(0);
  });

  it("stays interaction-locked until every owner releases its lock", () => {
    const store = createStore();
    const releaseSave = store.acquireInteractionLock();
    const releaseTransition = store.acquireInteractionLock();

    releaseSave();
    expect(store.getInteractionLocked()).toBe(true);
    expect(store.createElement("page-1", frame)).toMatchObject({
      ok: false,
      error: { code: "INTERACTION_LOCKED" },
    });

    releaseTransition();
    releaseTransition();
    expect(store.getInteractionLocked()).toBe(false);
    expect(store.createElement("page-1", frame).ok).toBe(true);
  });

  it("replays the original receipt when an agent retries the same command id", () => {
    const store = createStore();
    const first = store.createElement("page-1", frame, {
      commandId: "agent-command-1",
      origin: "agent",
    });
    const second = store.createElement("page-1", frame, {
      commandId: "agent-command-1",
      origin: "agent",
    });

    expect(first.ok && first.replayed).toBe(false);
    expect(second.ok && second.replayed).toBe(true);
    expect(store.getActivePage()?.elements).toHaveLength(1);
    expect(store.getProjection().outbox).toHaveLength(1);
  });

  it("does not resolve a durable commit before the persistence callback finishes", async () => {
    let finishPersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const document = createEmptyDocument({
      id: "document-1",
      workspaceId: "workspace-1",
      name: "Test document",
      pageId: "page-1",
      historyId: "history-1",
      designProfileVersion: "0.5.0",
    });
    const store = new EditorStore({
      projection: createInitialProjection(document),
      clientId: "durability-client",
      onCommit: () => persistence,
    });

    let resolved = false;
    const commit = store
      .commitDurably([{ type: "create", pageId: "page-1", element: frame }])
      .then((result) => {
        resolved = true;
        return result;
      });
    await Promise.resolve();

    expect(store.getElement("frame-1")).toBeDefined();
    expect(resolved).toBe(false);

    finishPersistence();
    expect((await commit).ok).toBe(true);
    expect(resolved).toBe(true);
  });

  it("does not let a concurrent idempotent retry outrun the original durable commit", async () => {
    let finishPersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const document = createEmptyDocument({
      id: "document-1",
      workspaceId: "workspace-1",
      name: "Test document",
      pageId: "page-1",
      historyId: "history-1",
      designProfileVersion: "0.5.0",
    });
    let store!: EditorStore;
    store = new EditorStore({
      projection: createInitialProjection(document),
      clientId: "durability-client",
      onCommit: () => {
        const releaseInteractionLock = store.acquireInteractionLock();
        return persistence.finally(releaseInteractionLock);
      },
    });
    const operation = { type: "create", pageId: "page-1", element: frame } as const;
    let firstResolved = false;
    let retryResolved = false;

    const first = store.commitDurably([operation], { commandId: "same-command" }).then((result) => {
      firstResolved = true;
      return result;
    });
    const retry = store.commitDurably([operation], { commandId: "same-command" }).then((result) => {
      retryResolved = true;
      return result;
    });
    await Promise.resolve();

    expect(firstResolved).toBe(false);
    expect(retryResolved).toBe(false);
    expect(store.getInteractionLocked()).toBe(true);
    finishPersistence();
    expect(await first).toMatchObject({ ok: true, replayed: false });
    expect(await retry).toMatchObject({ ok: true, replayed: true });
    expect(store.getInteractionLocked()).toBe(false);
  });

  it("retries persistence after an earlier durable callback failed", async () => {
    const document = createEmptyDocument({
      id: "document-1",
      workspaceId: "workspace-1",
      name: "Test document",
      pageId: "page-1",
      historyId: "history-1",
      designProfileVersion: "0.5.0",
    });
    let attempts = 0;
    const store = new EditorStore({
      projection: createInitialProjection(document),
      clientId: "durability-client",
      onCommit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk unavailable");
      },
    });
    const operation = { type: "create", pageId: "page-1", element: frame } as const;

    await expect(
      store.commitDurably([operation], { commandId: "retry-persistence" }),
    ).rejects.toThrow("disk unavailable");
    await Promise.resolve();
    const releaseTransitionLock = store.acquireInteractionLock();
    await expect(
      store.commitDurably([operation], { commandId: "retry-persistence" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INTERACTION_LOCKED" } });
    expect(attempts).toBe(1);
    releaseTransitionLock();
    const retry = await store.commitDurably([operation], { commandId: "retry-persistence" });

    expect(retry).toMatchObject({ ok: true, replayed: true });
    expect(attempts).toBe(2);
  });

  it("rejects a second optimistic edit while an MCP-style save lock is active", () => {
    const onError = vi.fn();
    const store = createStore(onError);
    const releaseInteractionLock = store.acquireInteractionLock();

    const result = store.createElement("page-1", frame);

    expect(result).toMatchObject({ ok: false, error: { code: "INTERACTION_LOCKED" } });
    expect(store.getActivePage()?.elements).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith("Wait for the current edit to finish saving.");
    releaseInteractionLock();
  });
});
