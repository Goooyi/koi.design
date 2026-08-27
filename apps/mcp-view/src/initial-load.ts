import type { Projection } from "@koi/core";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { readProjection, readSnapshotTransfer, readToolFailure } from "./bridge.js";
import { loadSnapshotTransfer, type SnapshotChunkCaller } from "./snapshot-loader.js";

export type InitialProjectionLoadResult =
  | { ok: true; projection: Projection }
  | { ok: false; message: string };

function loadError(error: unknown): InitialProjectionLoadResult {
  return {
    ok: false,
    message:
      error instanceof Error && error.message.trim()
        ? error.message
        : "The MCP canvas request failed",
  };
}

/** Converts a snapshot-or-transfer tool result into validated renderable state. */
export async function loadProjectionResult(
  result: CallToolResult,
  callSnapshotChunk?: SnapshotChunkCaller,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
): Promise<InitialProjectionLoadResult> {
  try {
    const failure = readToolFailure(result);
    if (failure) return { ok: false, message: failure };

    const projection = readProjection(result);
    if (projection) {
      return { ok: true, projection };
    }

    const transfer = readSnapshotTransfer(result);
    if (!transfer || !callSnapshotChunk) {
      return { ok: false, message: "The MCP server returned an invalid canvas snapshot" };
    }
    return {
      ok: true,
      projection: await loadSnapshotTransfer(transfer, callSnapshotChunk, onProgress),
    };
  } catch (error) {
    return loadError(error);
  }
}

/** Converts every initial tool-call outcome into renderable state; this Promise never rejects. */
export async function loadInitialProjection(
  callOpenCanvas: () => Promise<CallToolResult>,
  callSnapshotChunk?: SnapshotChunkCaller,
  onProgress?: (completedChunks: number, totalChunks: number) => void,
): Promise<InitialProjectionLoadResult> {
  try {
    return await loadProjectionResult(await callOpenCanvas(), callSnapshotChunk, onProgress);
  } catch (error) {
    return loadError(error);
  }
}
