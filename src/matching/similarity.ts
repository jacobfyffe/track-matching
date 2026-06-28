import { normalize, extractTags, classifyTag } from './classifier.js';

/**
 * Fuzzy similarity scoring — used to match a play to an existing canonical
 * recording when ISRC resolution (Tier 1) didn't apply.
 *
 * Everything here is pure (no I/O), so it unit-tests cleanly. We use Levenshtein
 * edit distance turned into a 0..1 ratio: matches in music metadata typically
 * differ by small edits (punctuation, spacing, a dropped word), which edit
 * distance captures well.
 */

/**
 * Levenshtein distance: minimum single-character insertions, deletions, or
 * substitutions to turn `a` into `b`. Single rolling row, O(min(a,b)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Make `a` the shorter string to minimize row width.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  let prev: number[] = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(a.length + 1).fill(0);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    const bChar = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bChar ? 0 : 1;
      const deletion = (prev[i] ?? 0) + 1;
      const insertion = (curr[i - 1] ?? 0) + 1;
      const substitution = (prev[i - 1] ?? 0) + cost;
      curr[i] = Math.min(deletion, insertion, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length] ?? 0;
}

/** Similarity ratio in [0, 1] on normalized strings. 1 = identical. */
export function similarityRatio(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === '' && nb === '') return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export interface Candidate {
  title: string;
  artist: string;
  durationMs: number | null;
}

export interface ScoreResult {
  /** Combined title+artist similarity in [0, 1]. */
  score: number;
  /** Whether durations are within tolerance (true if either is unknown). */
  durationOk: boolean;
}

/**
 * Score how likely a play and a candidate recording are the same recording.
 *
 * Title similarity is weighted higher (0.7) than artist (0.3): artist strings
 * are noisier (features, collaborators, ordering, formatting), so a title match
 * is the stronger signal. Group version tags (remaster, radio edit) are stripped
 * before comparison; separate tags (live, remix, …) are kept, because their
 * presence on only one side genuinely indicates different recordings.
 */
export function scoreMatch(
  play: Candidate,
  candidate: Candidate,
  durationToleranceMs: number,
): ScoreResult {
  const titleSim = similarityRatio(baseForCompare(play.title), baseForCompare(candidate.title));
  const artistSim = similarityRatio(play.artist, candidate.artist);
  const score = titleSim * 0.7 + artistSim * 0.3;

  let durationOk = true;
  if (play.durationMs !== null && candidate.durationMs !== null) {
    durationOk = Math.abs(play.durationMs - candidate.durationMs) <= durationToleranceMs;
  }

  return { score, durationOk };
}

/** Strip GROUP tags for comparison; keep separate/unknown tags. */
function baseForCompare(title: string): string {
  const { base, tags } = extractTags(title);
  const kept = tags.filter((t) => classifyTag(t) !== 'group');
  return kept.length > 0 ? `${base} ${kept.join(' ')}` : base;
}
