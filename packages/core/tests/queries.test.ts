import { describe, expect, it } from "vite-plus/test";

import { getAncestors, getChildren, inspectElements, queryElementsInRect } from "../src/index.js";
import { documentWith, frame, text } from "./fixtures.js";

describe("Document queries", () => {
  it("projects containment and spatial candidates without changing the document", () => {
    const root = frame("frame-root");
    const nested = frame("frame-nested", "frame-root");
    nested.geometry = { x: 100, y: 100, width: 300, height: 300, rotation: 0 };
    const label = text("text-1", "frame-nested");
    label.geometry = { x: 120, y: 140, width: 100, height: 30, rotation: 0 };
    const distant = text("text-2");
    distant.geometry = { x: 5_000, y: 5_000, width: 100, height: 30, rotation: 0 };
    const document = documentWith([root, nested, label, distant]);

    expect(getChildren(document, "frame-root", true).map((element) => element.id)).toEqual([
      "frame-nested",
      "text-1",
    ]);
    expect(getAncestors(document, "text-1").map((element) => element.id)).toEqual([
      "frame-nested",
      "frame-root",
    ]);
    expect(
      queryElementsInRect(document, "page-1", {
        x: 90,
        y: 90,
        width: 400,
        height: 400,
        rotation: 0,
      }).map((element) => element.id),
    ).toEqual(["frame-root", "frame-nested", "text-1"]);
    expect(
      inspectElements(document, ["text-2", "missing"]).map(({ element }) => element.id),
    ).toEqual(["text-2"]);
  });
});
