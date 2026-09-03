import assert from "node:assert/strict";
import test from "node:test";

import {
  doctorStatus,
  minimumEngineVersion,
  packageManagerVersion,
  pinnedPnpmCheck,
} from "./doctor-contract.mjs";

test("derives required versions and accepts pinned pnpm without Corepack", () => {
  assert.equal(packageManagerVersion("pnpm@11.21.0"), "11.21.0");
  assert.equal(packageManagerVersion("npm@11.21.0"), null);
  assert.deepEqual(minimumEngineVersion(">=22.18.0"), [22, 18, 0]);
  assert.equal(minimumEngineVersion("^22.18.0"), null);
  assert.deepEqual(pinnedPnpmCheck("11.21.0", "11.21.0", false), {
    name: "pnpm",
    pass: true,
    detail: "11.21.0",
    expected: "11.21.0",
  });
  assert.equal(pinnedPnpmCheck("11.20.0", "11.21.0", false).pass, false);
});

test("reports challenge release prerequisites without failing the development preflight", () => {
  assert.deepEqual(doctorStatus([{ pass: true }], [{ pass: false }]), {
    ok: true,
    challengeAppReleasePrerequisitesPass: false,
  });
});

test("fails the development preflight when a required tool check fails", () => {
  assert.deepEqual(doctorStatus([{ pass: false }], [{ pass: true }]), {
    ok: false,
    challengeAppReleasePrerequisitesPass: true,
  });
});
