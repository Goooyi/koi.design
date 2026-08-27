import { createInitialProjection } from "@koi/core";
import { createDemoDocument } from "@koi/mcp";
import { describe, expect, it } from "vite-plus/test";

import { recoverRejectedCommand } from "../src/conflict-recovery.js";

describe("MCP View conflict recovery", () => {
  it("restores the last synced Projection before refresh and keeps it when refresh fails", async () => {
    const lastSynced = createInitialProjection(createDemoDocument());
    const optimistic = { ...lastSynced, cursor: 1 };
    let current = optimistic;
    const target = {
      replaceProjection(projection: typeof lastSynced) {
        current = projection;
      },
    };

    const result = await recoverRejectedCommand(target, lastSynced, async () => {
      expect(current).toBe(lastSynced);
      return false;
    });

    expect(result).toBe("reverted");
    expect(current).toBe(lastSynced);
  });
});
