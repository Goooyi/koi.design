export class HostedRevisionTracker {
  #highWaterCursor = 0;

  observe(cursor: number): void {
    this.#highWaterCursor = Math.max(this.#highWaterCursor, cursor);
  }

  target(currentCursor: number, hasPendingCommands: boolean): number | undefined {
    if (hasPendingCommands || this.#highWaterCursor <= currentCursor) return undefined;
    return this.#highWaterCursor;
  }

  markApplied(cursor: number): void {
    if (cursor >= this.#highWaterCursor) this.#highWaterCursor = 0;
  }

  reset(): void {
    this.#highWaterCursor = 0;
  }
}
