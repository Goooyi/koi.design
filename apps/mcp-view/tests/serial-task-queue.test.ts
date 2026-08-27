import { describe, expect, it } from "vite-plus/test";

import { SerialTaskQueue } from "../src/serial-task-queue.js";

describe("SerialTaskQueue", () => {
  it("does not start a later server mutation before the prior response settles", async () => {
    const queue = new SerialTaskQueue();
    let releaseFirst!: () => void;
    const events: string[] = [];
    const first = queue.run(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second:start");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("continues after a rejected task", async () => {
    const queue = new SerialTaskQueue();
    await expect(queue.run(() => Promise.reject(new Error("failed")))).rejects.toThrow("failed");
    await expect(queue.run(() => Promise.resolve("recovered"))).resolves.toBe("recovered");
  });
});
