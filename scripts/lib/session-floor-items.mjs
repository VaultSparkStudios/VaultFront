const BLOCKED_OR_DONE_STATUSES = new Set([
  "blocked",
  "human-blocked",
  "cross-repo",
  "cross-repo-dirty",
  "blocked-active-lock",
  "external-blocked",
  "done",
  "shipped",
  "verified",
  "live",
  "rolled-up",
]);

const SIBLING_NAMES =
  "(?:voidfall|vorn|promogrind|hashmark|mindframe|ideaforge|sparkfunnel|analytica|seamline|obelisk|statvault|velaxis|call of doodie|gridiron gm|solara|vaultfront)";
const SIBLING_OWNED_TITLE_START = new RegExp(
  `^(?:\\[[^\\]]+\\]\\s*)*${SIBLING_NAMES}\\b`,
  "i",
);
const SIBLING_OWNED_BRACKET = new RegExp(
  `^\\[[^\\]]+\\]\\[[^\\]]*${SIBLING_NAMES}\\b`,
  "i",
);

export function extractRankedGeniusItems(cache) {
  if (Array.isArray(cache?.list?.ranked)) return cache.list.ranked;
  if (Array.isArray(cache?.ranked)) return cache.ranked;
  if (Array.isArray(cache?.list)) return cache.list;
  if (Array.isArray(cache?.items)) return cache.items;
  return null;
}

export function isLocallyActionableSessionFloorItem(item) {
  const status = String(item?.status ?? "").toLowerCase();
  if (
    item?.blocked ||
    item?.done ||
    item?.shipped ||
    BLOCKED_OR_DONE_STATUSES.has(status)
  )
    return false;

  const surface = String(item?.sourceSurface ?? "");
  if (surface.startsWith("xrepo:")) return false;

  const title = String(item?.title ?? item?.name ?? "");
  if (
    SIBLING_OWNED_TITLE_START.test(title) ||
    SIBLING_OWNED_BRACKET.test(title)
  )
    return false;

  return true;
}

export function locallyActionableSessionFloorItems(cache) {
  const list = extractRankedGeniusItems(cache);
  if (!Array.isArray(list)) return null;
  return list.filter(isLocallyActionableSessionFloorItem);
}
