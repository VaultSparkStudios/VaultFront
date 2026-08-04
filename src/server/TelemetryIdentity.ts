export function getTelemetryIdentity(environment = process.env) {
  const revisionValue = environment.GIT_COMMIT?.trim();
  let revision = "unversioned";
  if (revisionValue) revision = revisionValue;
  const versionValue = environment.VAULTFRONT_RELEASE_VERSION?.trim();
  const environmentValue = environment.GAME_ENV?.trim();
  let version = revision;
  if (versionValue) version = versionValue;
  let environmentName = "unknown";
  if (environmentValue) environmentName = environmentValue;
  return {
    service: "vaultfront",
    version,
    revision,
    environment: environmentName,
  } as const;
}
