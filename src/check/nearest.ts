const MAX_NEAREST = 3;

/**
 * The valid names nearest to `name`, closest first, at most three. A name further
 * away than half its own length (and than two edits) is not a likely typo and is
 * left out, so an unrelated word gets no suggestion at all.
 */
export function nearestNames(name: string, valid: readonly string[]): string[] {
  const limit = Math.max(2, Math.floor(name.length / 2));
  return valid
    .map((candidate, index) => ({
      candidate,
      index,
      distance: editDistance(name.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter((entry) => entry.distance <= limit)
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, MAX_NEAREST)
    .map((entry) => entry.candidate);
}

/** Levenshtein distance over UTF-16 code units. */
function editDistance(from: string, to: string): number {
  let previous = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let i = 1; i <= from.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= to.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (from[i - 1] === to[j - 1] ? 0 : 1);
      current.push(
        Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1),
      );
    }
    previous = current;
  }
  return previous[to.length] ?? 0;
}
