export function selectLatestSessionHandoff(markdown) {
  const matches = [
    ...markdown.matchAll(
      /^## (?:Where We Left Off|Session Intent) — Session (\d+).*$/gmu,
    ),
  ];
  if (!matches.length) return markdown;
  const latestSession = Math.max(...matches.map((match) => Number(match[1])));
  const start = Math.min(
    ...matches
      .filter((match) => Number(match[1]) === latestSession)
      .map((match) => match.index ?? 0),
  );
  const next = matches
    .filter(
      (candidate) =>
        (candidate.index ?? 0) > start &&
        Number(candidate[1]) !== latestSession,
    )
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  return markdown.slice(start, next?.index ?? markdown.length).trim();
}
