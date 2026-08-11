export const MAX_FORTUNE_TITLE_LENGTH = 32;

const FORTUNE_TITLE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '&-]*$/u;

export function normalizeFortuneTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim();
  if (
    title.length === 0 ||
    title.length > MAX_FORTUNE_TITLE_LENGTH ||
    !FORTUNE_TITLE_PATTERN.test(title)
  ) {
    return null;
  }
  return title;
}

export function formatPlayerDisplayName(
  playerName: string,
  equippedFortuneTitle?: string | null,
): string {
  const title = normalizeFortuneTitle(equippedFortuneTitle);
  return title ? `${playerName} · ${title}` : playerName;
}
