export class SerialTaskQueue {
  #tail: Promise<void> = Promise.resolve();

  run<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(task);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
