export function selectLatestSessionHandoff(markdown) {
  const matches = [
    ...markdown.matchAll(/^## Session Intent — Session (\d+).*$/gmu),
  ];
  if (!matches.length) return markdown;
  const latest = matches.reduce((best, candidate) =>
    Number(candidate[1]) > Number(best[1]) ? candidate : best,
  );
  const start = latest.index ?? 0;
  const next = matches
    .filter((candidate) => (candidate.index ?? 0) > start)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  return markdown.slice(start, next?.index ?? markdown.length).trim();
}
