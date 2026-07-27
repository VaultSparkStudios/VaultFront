export function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value >= max) return Number.MAX_SAFE_INTEGER;
  if (value <= 0n) return 0;
  return Number(value);
}
