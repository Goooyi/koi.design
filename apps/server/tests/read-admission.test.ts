import { describe, expect, it } from "vite-plus/test";

import { ReadAdmission } from "../src/read-admission.js";
import { DEFAULT_REPOSITORY_LIMITS } from "../src/repository.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("repository read admission", () => {
  it("allows two active projection reads and rejects excess work without queueing it", async () => {
    const admission = new ReadAdmission(2);
    const firstBlocker = deferred();
    const secondBlocker = deferred();
    const started: string[] = [];

    const first = admission.run(async () => {
      started.push("first");
      await firstBlocker.promise;
      return 1;
    });
    const second = admission.run(async () => {
      started.push("second");
      await secondBlocker.promise;
      return 2;
    });

    expect(started).toEqual(["first", "second"]);
    await expect(
      admission.run(async () => {
        started.push("rejected");
        return 3;
      }),
    ).rejects.toMatchObject({ code: "SERVER_BUSY" });
    expect(started).toEqual(["first", "second"]);

    firstBlocker.resolve();
    await expect(first).resolves.toBe(1);
    await expect(admission.run(async () => 3)).resolves.toBe(3);
    secondBlocker.resolve();
    await expect(second).resolves.toBe(2);
  });

  it("uses Mac-mini-safe repository defaults", () => {
    expect(DEFAULT_REPOSITORY_LIMITS).toMatchObject({
      maxConcurrentReads: 2,
      maxDocumentBytes: 8 * 1024 * 1024,
    });
  });
});
