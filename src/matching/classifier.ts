/**
 * Version-tag classifier — the heart of works grouping.
 *
 * Given a recording's title and artist, it produces a normalized "work key".
 * Recordings that share a work key are treated as the same song for charting.
 *
 * The rules (per the project's editorial design):
 *
 *   GROUP tags (stripped, so the version collapses into the base song):
 *     Remaster / Remastered / "YYYY Remaster", Radio Edit, Single Version
 *
 *   SEPARATE tags (kept, so the version stays its own work):
 *     Live, Remix (incl. "X Remix"), Sped Up, Slowed, Nightcore,
 *     feat. / featuring / ft.
 *
 *   UNKNOWN tags (anything else, e.g. "(Roles Reversed)"): kept, i.e. treated
 *     as part of the title — they stay separate. This is the safe default:
 *     failing to merge is mild and fixable; wrongly merging corrupts the chart.
 *     Manual overrides exist precisely to correct these cases.
 *
 *   PRECEDENCE: if any SEPARATE (or unknown) tag is present, the recording is a
 *     separate work, even if a GROUP tag is also present. A live remaster is
 *     still live. Split beats group.
 *
 * Spotify renders version tags with " - " (dash) and other stores use
 * parentheses/brackets, so we handle both.
 */

// Tags that mean "same song, different mastering/edit" -> safe to strip.
const GROUP_TAG_PATTERNS: RegExp[] = [
  /^\d{4}\s+remaster(ed)?$/i, // "2011 Remaster", "2011 Remastered"
  /^remaster(ed)?$/i,
  /^remaster(ed)?\s+\d{4}$/i, // "Remastered 2011"
  /^radio\s+edit$/i,
  /^single\s+version$/i,
];

// Tags that mean "materially different version" -> must stay separate.
const SEPARATE_TAG_PATTERNS: RegExp[] = [
  /^live\b.*$/i, // "Live", "Live at Wembley", "Live / Remastered"
  /\bremix$/i, // "Remix", "Acme Remix"
  /^sped\s*up.*$/i, // "Sped Up", "Sped Up Version"
  /^slowed.*$/i, // "Slowed", "Slowed + Reverb"
  /^nightcore$/i,
  /^(feat\.?|ft\.?|featuring)\b.*$/i, // featured-artist tags
];

export type TagKind = 'group' | 'separate' | 'unknown';

/** Classify a single extracted tag string. */
export function classifyTag(tag: string): TagKind {
  const t = tag.trim();
  if (GROUP_TAG_PATTERNS.some((re) => re.test(t))) return 'group';
  if (SEPARATE_TAG_PATTERNS.some((re) => re.test(t))) return 'separate';
  return 'unknown';
}

/**
 * Pull version tags off the end of a title, returning the base title and the
 * list of extracted tag strings.
 *
 * Handles the two common encodings:
 *   - Parenthetical/bracketed:  "Song (Live) [2011 Remaster]"
 *   - Spotify dash style:       "Song - Live - 2011 Remaster"
 *
 * Only trailing tags are extracted; a parenthetical in the middle of a title is
 * left alone (rare, and safer not to touch).
 */
export function extractTags(title: string): { base: string; tags: string[] } {
  let working = title.trim();
  const tags: string[] = [];

  // Repeatedly peel a trailing (...) or [...] group.
  const bracketRe = /\s*[([]([^()[\]]+)[)\]]\s*$/;
  for (;;) {
    const m = working.match(bracketRe);
    if (!m || m[1] === undefined) break;
    tags.unshift(m[1].trim());
    working = working.slice(0, m.index).trim();
  }

  // Then peel trailing " - tag" segments (Spotify's dash style). We only treat
  // a dash segment as a tag if it looks like a known/decorator phrase; this
  // avoids mangling titles that legitimately contain " - " (e.g. a song titled
  // "9 to 5 - Theme"). Heuristic: split on " - " and pull trailing segments
  // that classify as a known tag; stop at the first segment that doesn't.
  if (working.includes(' - ')) {
    const parts = working.split(' - ');
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (last === undefined) break;
      if (classifyTag(last) !== 'unknown') {
        tags.unshift(last.trim());
        parts.pop();
      } else {
        break;
      }
    }
    working = parts.join(' - ').trim();
  }

  return { base: working, tags };
}

/** Lowercase, strip punctuation, collapse whitespace — for stable keys. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD') // split accented chars so diacritics can be removed
    .replace(/[\u0300-\u036f]/g, '') // remove combining diacritical marks
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // punctuation -> space (keep letters/numbers)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Derive the work key for a recording.
 *
 * If every extracted tag is a GROUP tag, they're stripped and the key is just
 * the normalized base title + artist — so the recording collapses with the
 * original. If ANY tag is SEPARATE or UNKNOWN, those tags are retained in the
 * key, keeping the recording distinct.
 */
export function deriveWorkKey(title: string, artist: string): string {
  const { base, tags } = extractTags(title);
  const kept = tags.filter((t) => classifyTag(t) !== 'group');

  const titlePart = kept.length > 0 ? `${base} ${kept.join(' ')}` : base;
  return `${normalize(titlePart)}|${normalize(artist)}`;
}
