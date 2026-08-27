import { acknowledgeOutboxEntry, type Command, type Projection } from "@koi/core";

export interface HostedOutboxTarget {
  sendCommand(documentId: string, command: Command): Promise<{ cursor: number }>;
  getProjection(documentId: string): Promise<Projection>;
}

export async function recoverHostedOutbox(
  client: HostedOutboxTarget,
  local: Projection,
  checkpoint: (projection: Projection) => Promise<void>,
  onDelivered?: (cursor: number) => void,
): Promise<Projection> {
  const pendingCommandIds = new Set(
    local.outbox.filter((entry) => entry.status !== "acknowledged").map((entry) => entry.commandId),
  );
  const pendingHistory = local.history
    .filter((entry) => pendingCommandIds.has(entry.command.commandId))
    .sort((left, right) => left.cursor - right.cursor);
  if (pendingHistory.length !== pendingCommandIds.size) {
    throw new Error("The hosted outbox does not match durable Command history.");
  }

  let working = local;
  for (const entry of pendingHistory) {
    const delivered = await client.sendCommand(local.document.id, entry.command);
    onDelivered?.(delivered.cursor);
    working = acknowledgeOutboxEntry(working, entry.command.commandId);
    await checkpoint(working);
  }
  return client.getProjection(local.document.id);
}
