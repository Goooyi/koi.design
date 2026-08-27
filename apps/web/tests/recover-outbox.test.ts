import { describe, expect, it, vi } from "vite-plus/test";

import {
  acknowledgeAllOutboxEntries,
  applyCommand,
  createEmptyDocument,
  createInitialProjection,
  type Command,
} from "@koi/core";

import { recoverHostedOutbox } from "../src/hosting/recover-outbox.js";

function projectionWithTwoPendingCommands() {
  const initial = createInitialProjection(
    createEmptyDocument({
      id: "hosted-document",
      workspaceId: "hosted-workspace",
      name: "Hosted canvas",
      pageId: "page-1",
      historyId: "history-1",
      designProfileVersion: "0.5.0",
    }),
  );
  const create: Command = {
    documentId: initial.document.id,
    commandId: "offline-create",
    clientId: "offline-client",
    clientSeq: 1,
    baseCursor: 0,
    origin: "human",
    operations: [
      {
        type: "create",
        pageId: "page-1",
        element: {
          schemaVersion: 1,
          id: "note-1",
          kind: "note",
          parentId: null,
          geometry: { x: 10, y: 20, width: 200, height: 120, rotation: 0 },
          properties: { content: "Offline", color: "#ffe694" },
        },
      },
    ],
  };
  const created = applyCommand(initial, create);
  if (!created.ok) throw new Error(created.error.message);
  const update: Command = {
    documentId: initial.document.id,
    commandId: "offline-update",
    clientId: "offline-client",
    clientSeq: 2,
    baseCursor: created.projection.cursor,
    origin: "human",
    operations: [
      {
        type: "patch",
        pageId: "page-1",
        elementId: "note-1",
        expectedVersion: 1,
        changes: { geometry: { x: 80 } },
      },
    ],
  };
  const updated = applyCommand(created.projection, update);
  if (!updated.ok) throw new Error(updated.error.message);
  return updated.projection;
}

describe("hosted outbox recovery", () => {
  it("replays Commands in history order and checkpoints each acknowledgement", async () => {
    const local = projectionWithTwoPendingCommands();
    const remote = acknowledgeAllOutboxEntries(local);
    const sent: string[] = [];
    const checkpoints: number[] = [];
    const client = {
      sendCommand: vi.fn(async (_documentId: string, command: Command) => {
        sent.push(command.commandId);
        return { cursor: command.commandId === "offline-create" ? 1 : 2 };
      }),
      getProjection: vi.fn(async () => remote),
    };

    const recovered = await recoverHostedOutbox(client, local, async (projection) => {
      checkpoints.push(projection.outbox.length);
    });

    expect(sent).toEqual(["offline-create", "offline-update"]);
    expect(checkpoints).toEqual([1, 0]);
    expect(recovered).toBe(remote);
  });

  it("keeps later Commands pending when replay stops on a conflict", async () => {
    const local = projectionWithTwoPendingCommands();
    const checkpoints: (typeof local)[] = [];
    const client = {
      sendCommand: vi.fn(async (_documentId: string, command: Command) => {
        if (command.commandId === "offline-update") throw new Error("version conflict");
        return { cursor: 1 };
      }),
      getProjection: vi.fn(async () => acknowledgeAllOutboxEntries(local)),
    };

    await expect(
      recoverHostedOutbox(client, local, async (projection) => {
        checkpoints.push(projection);
      }),
    ).rejects.toThrow("version conflict");

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.outbox.map((entry) => entry.commandId)).toEqual(["offline-update"]);
    expect(client.getProjection).not.toHaveBeenCalled();
  });
});
