import { applyCommand, createUndoCommand, getElement, type Command } from "@koi/core";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryKoiDocumentRepository } from "../src/repository.js";

function moveWelcome(commandId = "command-move"): Command {
  return {
    documentId: "document-demo",
    commandId,
    clientId: "human-test",
    clientSeq: 1,
    baseCursor: 0,
    origin: "human",
    operations: [
      {
        type: "patch",
        pageId: "page-explorations",
        elementId: "frame-welcome",
        expectedVersion: 1,
        changes: { geometry: { x: 360 } },
      },
    ],
  };
}

describe("in-memory MCP repository", () => {
  it("commits an idempotent Command once and returns defensive snapshots", async () => {
    const repository = new InMemoryKoiDocumentRepository();
    const command = moveWelcome();

    const committed = await repository.apply(command);
    expect(committed).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { syncStatus: "acknowledged" },
      projection: { outbox: [] },
    });
    const replayed = await repository.apply(command);
    expect(replayed).toMatchObject({ ok: true, replayed: true });

    const projection = await repository.readProjection();
    expect(projection.history).toHaveLength(1);
    expect(projection.outbox).toEqual([]);
    expect(projection.receipts[command.commandId]?.syncStatus).toBe("acknowledged");
    expect(getElement(projection.document, "frame-welcome")?.geometry.x).toBe(360);

    projection.document.name = "mutated outside repository";
    expect((await repository.readProjection()).document.name).toBe("Koi component studies");
  });

  it("honors cancellation before a mutation can commit", async () => {
    const repository = new InMemoryKoiDocumentRepository();
    const controller = new AbortController();
    controller.abort("test cancellation");

    await expect(repository.apply(moveWelcome(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    const projection = await repository.readProjection();
    expect(projection.document.revision).toBe(0);
    expect(getElement(projection.document, "frame-welcome")?.geometry.x).toBe(80);
  });

  it("requires optimistic preconditions and makes exact imports idempotent", async () => {
    const repository = new InMemoryKoiDocumentRepository();
    const committed = await repository.apply(moveWelcome());
    expect(committed.ok).toBe(true);
    const projection = await repository.readProjection();
    const documentJson = JSON.stringify({
      ...projection.document,
      name: "Imported study",
    });
    const request = {
      commandId: "import-1",
      expectedDocumentId: projection.document.id,
      expectedRevision: projection.document.revision,
      documentJson,
    };

    const imported = await repository.replaceDocument(request);
    expect(imported).toMatchObject({ ok: true, replayed: false });
    const replayed = await repository.replaceDocument(request);
    expect(replayed).toMatchObject({ ok: true, replayed: true });
    expect((await repository.readProjection()).document.name).toBe("Imported study");

    const oldCommandReplay = await repository.apply(moveWelcome());
    expect(oldCommandReplay).toMatchObject({ ok: true, replayed: true });
    const staleClientSequence = await repository.apply({
      ...moveWelcome("command-after-import"),
      clientSeq: 1,
      operations: [
        {
          type: "patch",
          pageId: "page-explorations",
          elementId: "frame-welcome",
          expectedVersion: 2,
          changes: { geometry: { y: 600 } },
        },
      ],
    });
    expect(staleClientSequence).toMatchObject({
      ok: false,
      error: { code: "CURSOR_EPOCH_CONFLICT" },
    });

    const conflictingReuse = await repository.replaceDocument({
      ...request,
      documentJson: documentJson.replace("Imported study", "Different content"),
    });
    expect(conflictingReuse).toMatchObject({ ok: false, code: "DUPLICATE_IMPORT_ID" });
  });

  it("keeps pre-import Commands replayable but blocks their undo across the import epoch", async () => {
    const repository = new InMemoryKoiDocumentRepository();
    const original = moveWelcome();
    expect(await repository.apply(original)).toMatchObject({ ok: true });
    const beforeImport = await repository.readProjection();
    const imported = await repository.replaceDocument({
      commandId: "import-epoch",
      expectedDocumentId: beforeImport.document.id,
      expectedRevision: beforeImport.document.revision,
      documentJson: JSON.stringify({ ...beforeImport.document, name: "Replacement" }),
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(
      createUndoCommand(imported.projection, original.commandId, {
        commandId: "undo-before-import",
        clientId: "undo-client",
        clientSeq: 1,
        origin: "human",
      }),
    ).toMatchObject({ ok: false, code: "HISTORY_ENTRY_NOT_FOUND" });

    const oldEntry = imported.projection.history[0]!;
    const forged = applyCommand(imported.projection, {
      documentId: imported.projection.document.id,
      commandId: "forged-undo-before-import",
      clientId: "forger",
      clientSeq: 1,
      baseCursor: imported.projection.cursor,
      origin: "agent",
      undoOf: original.commandId,
      operations: oldEntry.inverseOperations,
    });
    expect(forged).toMatchObject({ ok: false, error: { code: "UNDO_CONFLICT" } });

    const afterImport = await repository.apply({
      documentId: imported.projection.document.id,
      commandId: "after-import",
      clientId: "after-import-client",
      clientSeq: 1,
      baseCursor: imported.projection.cursor,
      origin: "human",
      operations: [
        {
          type: "patch",
          pageId: "page-explorations",
          elementId: "frame-welcome",
          expectedVersion: 2,
          changes: { geometry: { y: 720 } },
        },
      ],
    });
    expect(afterImport.ok).toBe(true);
    if (!afterImport.ok) return;
    const undo = createUndoCommand(afterImport.projection, "after-import", {
      commandId: "undo-after-import",
      clientId: "undo-client",
      clientSeq: 1,
      origin: "human",
    });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(await repository.apply(undo.command)).toMatchObject({ ok: true });
    expect(
      getElement((await repository.readProjection()).document, "frame-welcome")?.geometry.y,
    ).toBe(100);
  });
});
