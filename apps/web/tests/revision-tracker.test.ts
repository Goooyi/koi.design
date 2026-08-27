import { describe, expect, it } from "vite-plus/test";

import { HostedRevisionTracker } from "../src/hosting/revision-tracker.js";

describe("HostedRevisionTracker", () => {
  it("retains a remote high-water cursor until the local outbox drains", () => {
    const tracker = new HostedRevisionTracker();
    tracker.observe(1);
    expect(tracker.target(0, true)).toBeUndefined();

    tracker.observe(2);
    expect(tracker.target(1, true)).toBeUndefined();
    expect(tracker.target(1, false)).toBe(2);

    tracker.markApplied(2);
    expect(tracker.target(2, false)).toBeUndefined();
  });

  it("does not forget a newer event when an older snapshot is observed", () => {
    const tracker = new HostedRevisionTracker();
    tracker.observe(8);
    tracker.markApplied(7);
    expect(tracker.target(7, false)).toBe(8);
  });
});
