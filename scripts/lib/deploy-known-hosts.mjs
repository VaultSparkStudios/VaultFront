export function normalizeKnownHostsEvidence(host, evidence) {
  const normalizedHost = host?.trim();
  const lines = evidence
    ?.trim()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!normalizedHost || !lines?.length) {
    throw new Error(
      "deployment host and protected known_hosts evidence are required",
    );
  }
  const valid = lines.some((line) => {
    const fields = line.split(/\s+/u);
    const hosts = fields[0]?.split(",") ?? [];
    return (
      fields.length >= 3 &&
      hosts.some(
        (candidate) =>
          candidate === normalizedHost ||
          candidate === `[${normalizedHost}]:22`,
      )
    );
  });
  if (!valid) {
    throw new Error(
      "protected known_hosts evidence does not contain the deployment host",
    );
  }
  return `${lines.join("\n")}\n`;
}
