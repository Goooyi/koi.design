export function packageManagerVersion(packageManager, expectedName = "pnpm") {
  if (typeof packageManager !== "string") return null;
  const prefix = `${expectedName}@`;
  return packageManager.startsWith(prefix) && packageManager.length > prefix.length
    ? packageManager.slice(prefix.length)
    : null;
}

export function minimumEngineVersion(engineRange) {
  if (typeof engineRange !== "string") return null;
  const match = engineRange.match(/^\s*>=\s*(\d+)\.(\d+)\.(\d+)\s*$/);
  return match ? match.slice(1).map(Number) : null;
}

export function pinnedPnpmCheck(actualVersion, expectedVersion, corepackAvailable) {
  const pass = typeof expectedVersion === "string" && actualVersion === expectedVersion;
  const installTarget = expectedVersion
    ? `pnpm@${expectedVersion}`
    : "the pnpm version in package.json";
  return {
    name: "pnpm",
    pass,
    detail: actualVersion,
    expected: expectedVersion,
    ...(pass
      ? {}
      : {
          remediation: corepackAvailable
            ? `Use Corepack to activate ${installTarget}.`
            : `Install ${installTarget}; Corepack is not bundled with every supported Node release.`,
        }),
  };
}

export function doctorStatus(requiredChecks, challengeAppReleasePrerequisiteChecks) {
  return {
    ok: requiredChecks.every(({ pass }) => pass),
    challengeAppReleasePrerequisitesPass: challengeAppReleasePrerequisiteChecks.every(
      ({ pass }) => pass,
    ),
  };
}
