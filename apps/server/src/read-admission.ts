import { RepositoryError } from "./errors.js";

/** Fail-fast admission gate for memory-heavy projection reads. */
export class ReadAdmission {
  readonly #maxConcurrentReads: number;
  #activeReads = 0;

  constructor(maxConcurrentReads: number) {
    if (!Number.isSafeInteger(maxConcurrentReads) || maxConcurrentReads <= 0) {
      throw new TypeError("maxConcurrentReads must be a positive integer");
    }
    this.#maxConcurrentReads = maxConcurrentReads;
  }

  async run<Value>(read: () => Promise<Value>): Promise<Value> {
    if (this.#activeReads >= this.#maxConcurrentReads) {
      throw new RepositoryError(
        "SERVER_BUSY",
        "The concurrent repository read limit has been reached",
      );
    }

    this.#activeReads += 1;
    try {
      return await read();
    } finally {
      this.#activeReads -= 1;
    }
  }
}
