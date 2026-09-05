import { describe, expect, it } from "vite-plus/test";

import {
  applyCommand,
  createInitialProjection,
  createUndoCommand,
  operationSchema,
  type Command,
} from "../src/index.js";
import { documentWith } from "./fixtures.js";

function command(
  documentId: string,
  baseCursor: number,
  operations: Command["operations"],
  seq = 0,
) {
  return {
    documentId,
    commandId: `design-command-${seq}`,
    clientId: "client-design",
    clientSeq: seq,
    baseCursor,
    origin: "human" as const,
    operations,
  };
}

describe("the design operation", () => {
  it("replaces the Document's design profile tokens and records the inverse", () => {
    const projection = createInitialProjection(documentWith([]));
    const tokens = {
      name: "Apple",
      theme: { name: "apple", tokens: { "--color-accent": "#0066cc" } },
    };
    const applied = applyCommand(
      projection,
      command(projection.document.id, projection.cursor, [{ type: "design", tokens }]),
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.projection.document.designProfile.tokens).toEqual(tokens);
    expect(applied.projection.document.designProfile.id).toBe("koi.astryx");
    expect(applied.projection.history.at(-1)?.inverseOperations).toEqual([
      { type: "design", tokens: {} },
    ]);
    expect(applied.projection.document.pages).toEqual(projection.document.pages);
  });

  it("undoes back to the previous record", () => {
    const projection = createInitialProjection(documentWith([]));
    const first = applyCommand(
      projection,
      command(
        projection.document.id,
        projection.cursor,
        [{ type: "design", tokens: { name: "A" } }],
        1,
      ),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyCommand(
      first.projection,
      command(
        projection.document.id,
        first.projection.cursor,
        [{ type: "design", tokens: { name: "B" } }],
        2,
      ),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const undo = createUndoCommand(second.projection, "design-command-2", {
      commandId: "design-undo",
      clientId: "client-design",
      clientSeq: 3,
      origin: "human",
    });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    const undone = applyCommand(second.projection, undo.command);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.projection.document.designProfile.tokens).toEqual({ name: "A" });
  });

  it("is validated like every other operation", () => {
    expect(operationSchema.safeParse({ type: "design", tokens: { a: 1 } }).success).toBe(true);
    expect(operationSchema.safeParse({ type: "design" }).success).toBe(false);
    expect(operationSchema.safeParse({ type: "design", tokens: [] }).success).toBe(false);
    const projection = createInitialProjection(documentWith([]));
    const twice = applyCommand(
      projection,
      command(projection.document.id, projection.cursor, [
        { type: "design", tokens: { a: 1 } },
        { type: "design", tokens: { a: 2 } },
      ]),
    );
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error.code).toBe("INVALID_COMMAND");
  });
});
