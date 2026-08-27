interface InteractionLockOwner {
  acquireInteractionLock(): () => void;
}

interface AuthorityKind {
  kind: "local" | "hosted";
}

export function localReturnDocumentIdForTransition(
  sourceAuthority: AuthorityKind,
  sourceDocumentId: string,
  destinationDocumentId: string,
): string | null {
  return sourceAuthority.kind === "local" && sourceDocumentId !== destinationDocumentId
    ? sourceDocumentId
    : null;
}

export async function publishAfterCheckpoint<T>(
  checkpoint: () => Promise<void>,
  publish: () => T,
): Promise<T> {
  await checkpoint();
  return publish();
}

export async function runWithSuspendedHostedSession<T>(
  suspend: () => void,
  attemptReplacement: () => Promise<T>,
  resumePriorSession: () => void,
): Promise<T> {
  suspend();
  try {
    return await attemptReplacement();
  } catch (error) {
    resumePriorSession();
    throw error;
  }
}

export class TransitionCoordinator {
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;

  constructor(private readonly onBusyChange: (busy: boolean) => void) {}

  run<T>(
    lockOwner: InteractionLockOwner,
    drainWrites: () => Promise<void>,
    transition: () => Promise<T>,
  ): Promise<T> {
    const releaseLock = lockOwner.acquireInteractionLock();
    this.#pending += 1;
    if (this.#pending === 1) this.onBusyChange(true);

    const execution = this.#tail.then(async () => {
      await drainWrites();
      return transition();
    });
    this.#tail = execution.then(
      () => undefined,
      () => undefined,
    );

    return execution.finally(() => {
      releaseLock();
      this.#pending -= 1;
      if (this.#pending === 0) this.onBusyChange(false);
    });
  }
}
