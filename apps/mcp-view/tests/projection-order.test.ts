import { createInitialProjection } from "@koi/core";
import { createDemoDocument } from "@koi/mcp";
import { describe, expect, it } from "vite-plus/test";

import { shouldInstallProjection } from "../src/projection-order.js";

describe("MCP View Projection ordering", () => {
  it("rejects lower cursors for the current Document and accepts equal or newer snapshots", () => {
    const projection = createInitialProjection(createDemoDocument());
    const current = { ...projection, cursor: 4 };

    expect(shouldInstallProjection(undefined, projection)).toBe(true);
    expect(shouldInstallProjection(current, { ...projection, cursor: 3 })).toBe(false);
    expect(shouldInstallProjection(current, { ...projection, cursor: 4 })).toBe(true);
    expect(shouldInstallProjection(current, { ...projection, cursor: 5 })).toBe(true);
  });

  it("keeps one View lifecycle pinned to its initial Document identity", () => {
    const projection = createInitialProjection(createDemoDocument());
    const current = { ...projection, cursor: 8 };
    const differentDocument = {
      ...projection,
      document: { ...projection.document, id: "document-host-context-two" },
      cursor: 0,
    };

    expect(shouldInstallProjection(current, differentDocument)).toBe(false);
    expect(shouldInstallProjection(undefined, differentDocument)).toBe(true);
  });
});
