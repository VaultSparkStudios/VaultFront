import { timingSafeEqual } from "crypto";

/**
 * Constant-time admin-token comparison (S99 audit #173). Mirrors the
 * established timingSafeEqual pattern already used for secret/digest
 * comparison elsewhere (CertifiedDailyMasteryStore, CertifiedLoopTimeline,
 * MatchProgression, ReplayStore) so the admin surface stops being the one
 * place that discipline was never applied.
 */
export function isAdminTokenMatch(
  headerValue: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof headerValue !== "string") return false;
  const actual = Buffer.from(headerValue);
  const expectedBuf = Buffer.from(expected);
  return (
    actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf)
  );
}
