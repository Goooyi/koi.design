import type { Projection } from "@koi/core";

/**
 * The first snapshot pins this View to one Document. Cursors are only comparable inside that
 * identity, so a different Document is ignored until the host creates a fresh View lifecycle.
 */
export function shouldInstallProjection(
  current: Projection | undefined,
  candidate: Projection,
): boolean {
  if (current === undefined) return true;
  return current.document.id === candidate.document.id && candidate.cursor >= current.cursor;
}
