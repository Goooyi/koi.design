import { describe, expect, it } from "vite-plus/test";

import {
  applyCommand,
  acknowledgeOutboxEntry,
  createInitialProjection,
  createUndoCommand,
  getElement,
  MAX_HISTORY_ENTRIES,
  projectionSchema,
  updateOutboxEntry,
  type Command,
} from "../src/index.js";
import { documentWith, frame, text } from "./fixtures.js";

function command(
  commandId: string,
  operations: Command["operations"],
  overrides: Partial<Command> = {},
): Command {
  return {
    documentId: "document-1",
    commandId,
    clientId: "human-1",
    clientSeq: Number(commandId.replace(/\D/g, "")) || 1,
    baseCursor: 0,
    origin: "human",
    operations,
    ...overrides,
  };
}

describe("semantic Commands", () => {
  it("rejects an oversized aggregate Command before mutating the Projection", () => {
    const initial = createInitialProjection(documentWith());
    const operations: Command["operations"] = Array.from({ length: 6 }, (_, index) => ({
      type: "create" as const,
      pageId: "page-1",
      element: {
        schemaVersion: 1 as const,
        id: `text-${index}`,
        kind: "text" as const,
        parentId: null,
        geometry: { x: index * 20, y: 0, width: 120, height: 40, rotation: 0 },
        properties: { content: "x".repeat(100_000), style: {} },
      },
    }));

    const result = applyCommand(initial, command("oversized-command", operations));

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect(result.projection).toBe(initial);
    expect(initial.history).toHaveLength(0);
  });

  it("bounds retained outbox Commands while preserving the last valid Projection", () => {
    let projection = createInitialProjection(documentWith([frame("frame-1")]));
    for (let sequence = 1; sequence <= 64; sequence += 1) {
      const result = applyCommand(
        projection,
        command(
          `queued-${sequence}`,
          [
            {
              type: "patch",
              pageId: "page-1",
              elementId: "frame-1",
              expectedVersion: sequence,
              changes: { geometry: { x: sequence } },
            },
          ],
          { clientSeq: sequence, baseCursor: projection.cursor },
        ),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      projection = result.projection;
    }

    const rejected = applyCommand(
      projection,
      command(
        "queued-65",
        [
          {
            type: "patch",
            pageId: "page-1",
            elementId: "frame-1",
            expectedVersion: 65,
            changes: { geometry: { x: 65 } },
          },
        ],
        { clientSeq: 65, baseCursor: projection.cursor },
      ),
    );

    expect(rejected).toMatchObject({ ok: false, error: { code: "RESOURCE_LIMIT" } });
    expect(rejected.projection).toBe(projection);
    expect(projection.outbox).toHaveLength(64);
  });

  it("refuses a Command before history would exceed the persisted Projection limit", () => {
    const first = applyCommand(
      createInitialProjection(documentWith([frame("frame-1")])),
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 1,
          changes: { geometry: { x: 1 } },
        },
      ]),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Reusing the immutable entry exercises the length boundary without allocating 50,000 full
    // Command graphs; applyCommand checks this guard before reading any new Operation.
    const atCapacity = {
      ...acknowledgeOutboxEntry(first.projection, "command-1"),
      history: Array.from({ length: MAX_HISTORY_ENTRIES }, () => first.projection.history[0]!),
    };

    const rejected = applyCommand(
      atCapacity,
      command(
        "command-2",
        [
          {
            type: "patch",
            pageId: "page-1",
            elementId: "frame-1",
            expectedVersion: 2,
            changes: { geometry: { x: 2 } },
          },
        ],
        { clientSeq: 2, baseCursor: atCapacity.cursor },
      ),
    );

    expect(rejected).toMatchObject({ ok: false, error: { code: "RESOURCE_LIMIT" } });
    expect(rejected.projection).toBe(atCapacity);
  });

  it("commits one immutable Projection, history entry, receipt, and outbox item per intent", () => {
    const initial = createInitialProjection(documentWith([frame("frame-1")]));
    const move = command("command-1", [
      {
        type: "patch",
        pageId: "page-1",
        elementId: "frame-1",
        expectedVersion: 1,
        changes: { geometry: { x: 320, y: 180 } },
      },
    ]);

    const result = applyCommand(initial, move);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getElement(initial.document, "frame-1")?.geometry.x).toBe(0);
    expect(getElement(result.projection.document, "frame-1")).toMatchObject({
      version: 2,
      geometry: { x: 320, y: 180 },
    });
    expect(result.projection.document.revision).toBe(1);
    expect(result.projection.history).toHaveLength(1);
    expect(result.projection.outbox).toEqual([
      { commandId: "command-1", status: "pending", attempts: 0 },
    ]);
    expect(result.receipt).toMatchObject({
      commandId: "command-1",
      changedIds: ["frame-1"],
      viewRevision: 1,
      syncStatus: "pending",
    });

    const replay = applyCommand(result.projection, move);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.replayed).toBe(true);
    expect(replay.projection).toBe(result.projection);
    expect(replay.projection.history).toHaveLength(1);
    expect(replay.projection.outbox).toHaveLength(1);

    const reusedId = applyCommand(
      result.projection,
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 2,
          changes: { geometry: { x: 999 } },
        },
      ]),
    );
    expect(reusedId).toMatchObject({ ok: false, error: { code: "DUPLICATE_COMMAND_ID" } });
  });

  it("treats JSON object key ordering as the same idempotent Command", () => {
    const initial = createInitialProjection(documentWith());
    const create = command("command-1", [
      {
        type: "create",
        pageId: "page-1",
        element: {
          schemaVersion: 1,
          id: "component-1",
          kind: "component",
          parentId: null,
          geometry: { x: 0, y: 0, width: 120, height: 40, rotation: 0 },
          properties: {
            profile: "koi.astryx",
            profileVersion: "0.5.0",
            componentId: "button",
            props: { label: "Continue", intent: "primary" },
          },
        },
      },
    ]);
    const created = applyCommand(initial, create);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const reordered = structuredClone(create);
    const operation = reordered.operations[0];
    if (operation?.type !== "create" || operation.element.kind !== "component") return;
    operation.element.properties.props = { intent: "primary", label: "Continue" };

    const replay = applyCommand(created.projection, reordered);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(replay.projection.history).toHaveLength(1);
  });

  it("merges an unrelated stale-base edit but rejects stale geometry on the same Element", () => {
    const initial = createInitialProjection(
      documentWith([frame("frame-1"), text("text-1", "frame-1")]),
    );
    const moved = applyCommand(
      initial,
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 1,
          changes: { geometry: { x: 400 } },
        },
      ]),
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const unrelated = applyCommand(
      moved.projection,
      command(
        "agent-command-1",
        [
          {
            type: "patch",
            pageId: "page-1",
            elementId: "text-1",
            expectedVersion: 1,
            changes: { properties: { content: "Agent copy", style: {} } },
          },
        ],
        { clientId: "agent-1", clientSeq: 1, origin: "agent", baseCursor: 0 },
      ),
    );
    expect(unrelated.ok).toBe(true);
    if (!unrelated.ok) return;
    expect(getElement(unrelated.projection.document, "text-1")).toMatchObject({
      version: 2,
      properties: { content: "Agent copy" },
    });

    const staleMove = applyCommand(
      unrelated.projection,
      command(
        "agent-command-2",
        [
          {
            type: "patch",
            pageId: "page-1",
            elementId: "frame-1",
            expectedVersion: 1,
            changes: { geometry: { x: 800 } },
          },
        ],
        { clientId: "agent-1", clientSeq: 2, origin: "agent", baseCursor: 0 },
      ),
    );
    expect(staleMove).toMatchObject({
      ok: false,
      error: { code: "VERSION_CONFLICT", expectedVersion: 1, actualVersion: 2 },
    });
    expect(staleMove.projection).toBe(unrelated.projection);
  });

  it("rejects a delayed Command from before a document replacement even when ids and versions match", () => {
    const initial = createInitialProjection(documentWith([frame("frame-1")]));
    const replaced = {
      ...initial,
      document: { ...initial.document, name: "Replacement", revision: 1 },
      cursor: 1,
    };
    const delayed = command(
      "delayed-command",
      [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 1,
          changes: { geometry: { x: 640 } },
        },
      ],
      { clientId: "offline-client", clientSeq: 1, baseCursor: 0 },
    );

    const result = applyCommand(replaced, delayed);

    expect(result).toMatchObject({ ok: false, error: { code: "CURSOR_EPOCH_CONFLICT" } });
    expect(result.projection).toBe(replaced);
    expect(getElement(replaced.document, "frame-1")?.geometry.x).toBe(0);
  });

  it("makes deletion win over stale writes while allowing an explicit compensating restore", () => {
    const initial = createInitialProjection(documentWith([text("text-1")]));
    const deleted = applyCommand(
      initial,
      command("command-1", [
        { type: "delete", pageId: "page-1", elementId: "text-1", expectedVersion: 1 },
      ]),
    );
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    const stalePatch = applyCommand(
      deleted.projection,
      command(
        "agent-command-1",
        [
          {
            type: "patch",
            pageId: "page-1",
            elementId: "text-1",
            expectedVersion: 1,
            changes: { properties: { content: "Bring it back", style: {} } },
          },
        ],
        { clientId: "agent-1", clientSeq: 1, origin: "agent" },
      ),
    );
    expect(stalePatch).toMatchObject({ ok: false, error: { code: "ELEMENT_DELETED" } });

    const undo = createUndoCommand(deleted.projection, "command-1", {
      commandId: "undo-1",
      clientId: "human-1",
      clientSeq: 2,
      origin: "human",
    });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    const restored = applyCommand(deleted.projection, undo.command);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(getElement(restored.projection.document, "text-1")?.version).toBe(3);
    expect(restored.projection.tombstones["text-1"]).toBeUndefined();
    expect(restored.projection.history).toHaveLength(2);
  });

  it("refuses an undo after another edit changed the protected Element", () => {
    const initial = createInitialProjection(documentWith([text("text-1")]));
    const first = applyCommand(
      initial,
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "text-1",
          expectedVersion: 1,
          changes: { properties: { content: "First edit", style: {} } },
        },
      ]),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyCommand(
      first.projection,
      command("command-2", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "text-1",
          expectedVersion: 2,
          changes: { properties: { content: "Second edit", style: {} } },
        },
      ]),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const undo = createUndoCommand(second.projection, "command-1", {
      commandId: "undo-1",
      clientId: "human-1",
      clientSeq: 3,
      origin: "human",
    });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    const rejected = applyCommand(second.projection, undo.command);
    expect(rejected).toMatchObject({ ok: false, error: { code: "UNDO_CONFLICT" } });
    expect(getElement(rejected.projection.document, "text-1")?.properties).toMatchObject({
      content: "Second edit",
    });
  });

  it("rebases concurrency tokens while undoing a compensated edit chain", () => {
    const initial = createInitialProjection(documentWith());
    const { version: _version, ...textInput } = text("text-1");
    const created = applyCommand(
      initial,
      command("command-1", [
        {
          type: "create",
          pageId: "page-1",
          element: textInput,
        },
      ]),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const edited = applyCommand(
      created.projection,
      command("command-2", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "text-1",
          expectedVersion: 1,
          changes: { properties: { content: "Edited", style: {} } },
        },
      ]),
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const undoEdit = createUndoCommand(edited.projection, "command-2", {
      commandId: "undo-2",
      clientId: "human-1",
      clientSeq: 3,
      origin: "human",
    });
    expect(undoEdit.ok).toBe(true);
    if (!undoEdit.ok) return;
    const editCompensated = applyCommand(edited.projection, undoEdit.command);
    expect(editCompensated.ok).toBe(true);
    if (!editCompensated.ok) return;

    const undoCreate = createUndoCommand(editCompensated.projection, "command-1", {
      commandId: "undo-1",
      clientId: "human-1",
      clientSeq: 4,
      origin: "human",
    });
    expect(undoCreate.ok).toBe(true);
    if (!undoCreate.ok) return;
    expect(undoCreate.command.operations[0]).toMatchObject({
      type: "delete",
      expectedVersion: 3,
    });
    const createCompensated = applyCommand(editCompensated.projection, undoCreate.command);

    expect(createCompensated.ok).toBe(true);
    if (!createCompensated.ok) return;
    expect(getElement(createCompensated.projection.document, "text-1")).toBeUndefined();
  });

  it("rolls back the entire Command when its final document would contain a dangling child", () => {
    const initial = createInitialProjection(
      documentWith([frame("frame-1"), text("text-1", "frame-1")]),
    );
    const rejected = applyCommand(
      initial,
      command("command-1", [
        { type: "delete", pageId: "page-1", elementId: "frame-1", expectedVersion: 1 },
      ]),
    );

    expect(rejected).toMatchObject({ ok: false, error: { code: "INTEGRITY_CONFLICT" } });
    expect(rejected.projection).toBe(initial);
    expect(getElement(initial.document, "frame-1")).toBeDefined();
    expect(initial.history).toHaveLength(0);
    expect(initial.outbox).toHaveLength(0);
  });

  it("tracks delivery attempts and keeps acknowledgement terminal", () => {
    const initial = createInitialProjection(documentWith([frame("frame-1")]));
    const result = applyCommand(
      initial,
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 1,
          changes: { name: "Homepage" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sending = updateOutboxEntry(result.projection, "command-1", { status: "sending" });
    const failed = updateOutboxEntry(sending, "command-1", {
      status: "failed",
      error: "network unavailable",
    });
    const retrying = updateOutboxEntry(failed, "command-1", { status: "sending" });
    const acknowledged = updateOutboxEntry(retrying, "command-1", {
      status: "acknowledged",
    });

    expect(acknowledged.outbox[0]).toEqual({
      commandId: "command-1",
      status: "acknowledged",
      attempts: 2,
    });
    expect(acknowledged.receipts["command-1"]?.syncStatus).toBe("acknowledged");
    expect(() => updateOutboxEntry(acknowledged, "command-1", { status: "pending" })).toThrow(
      /Acknowledged/,
    );

    const drained = acknowledgeOutboxEntry(retrying, "command-1");
    expect(drained.outbox).toEqual([]);
    expect(drained.receipts["command-1"]?.syncStatus).toBe("acknowledged");
  });

  it("rejects persisted Projections whose replay and client-head indexes are inconsistent", () => {
    const result = applyCommand(
      createInitialProjection(documentWith([frame("frame-1")])),
      command("command-1", [
        {
          type: "patch",
          pageId: "page-1",
          elementId: "frame-1",
          expectedVersion: 1,
          changes: { name: "Homepage" },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const missingReceipt = structuredClone(result.projection);
    delete missingReceipt.receipts["command-1"];
    expect(projectionSchema.safeParse(missingReceipt).success).toBe(false);

    const staleHead = structuredClone(result.projection);
    staleHead.clientHeads["human-1"] = { clientSeq: 99, commandId: "command-1" };
    expect(projectionSchema.safeParse(staleHead).success).toBe(false);

    const missingHead = structuredClone(result.projection);
    delete missingHead.clientHeads["human-1"];
    expect(projectionSchema.safeParse(missingHead).success).toBe(false);
  });

  it("treats Object prototype property names as ordinary stable IDs", () => {
    const create = command(
      "hasOwnProperty",
      [
        {
          type: "create",
          pageId: "page-1",
          element: {
            schemaVersion: 1,
            id: "toString",
            kind: "frame",
            parentId: null,
            geometry: { x: 10, y: 20, width: 320, height: 240, rotation: 0 },
            properties: { clipContent: false },
          },
        },
      ],
      { clientId: "constructor", clientSeq: 1 },
    );

    const created = applyCommand(createInitialProjection(documentWith()), create);
    expect(created).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { commandId: "hasOwnProperty", changedIds: ["toString"] },
    });
    if (!created.ok) return;
    expect(getElement(created.projection.document, "toString")).toBeDefined();
    expect(projectionSchema.safeParse(created.projection).success).toBe(true);
    expect(applyCommand(created.projection, create)).toMatchObject({ ok: true, replayed: true });

    const missingPrototypeNamedHead = structuredClone(created.projection);
    const prototypeClientId: string = "constructor";
    delete missingPrototypeNamedHead.clientHeads[prototypeClientId];
    expect(projectionSchema.safeParse(missingPrototypeNamedHead).success).toBe(false);
  });
});
