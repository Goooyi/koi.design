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

export function doctorStatus(requiredChecks, challengeAppReleasePrerequisiteChecks) {
  return {
    ok: requiredChecks.every(({ pass }) => pass),
    challengeAppReleasePrerequisitesPass: challengeAppReleasePrerequisiteChecks.every(
      ({ pass }) => pass,
    ),
  };
}
