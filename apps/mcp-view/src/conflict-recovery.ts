import type { Projection } from "@koi/core";

export interface ProjectionReplacementTarget {
  replaceProjection(projection: Projection): void;
}

/**
 * Discard the rejected optimistic state before asking for an authoritative refresh. This also
 * leaves the View on its last known durable state when the host cannot return a bounded snapshot.
 */
export async function recoverRejectedCommand(
  target: ProjectionReplacementTarget | undefined,
  lastSynced: Projection | undefined,
  refresh: () => Promise<boolean>,
): Promise<"refreshed" | "reverted"> {
  if (lastSynced) target?.replaceProjection(lastSynced);
  return (await refresh()) ? "refreshed" : "reverted";
}
