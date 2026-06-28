import { query, withTransaction } from '../db/pool.js';

/**
 * Data-access layer for Tier 1 ISRC resolution. All SQL lives here.
 *
 * Note this module reads from Phase 1's `plays` table and writes to Phase 2's
 * own tables — that cross-phase read is the whole point of sharing one database.
 */

export interface UnresolvedPlay {
  play_id: string; // bigint comes back as string from pg
  isrc: string;
  track_name: string;
  artist_name: string;
}

/**
 * Plays that have an ISRC but no resolution yet.
 *
 * The LEFT JOIN ... WHERE r.play_id IS NULL is the standard "rows in A not in B"
 * pattern: keep only plays that don't already appear in play_resolutions. We
 * also require a non-null ISRC, since Tier 1 matches purely on ISRC.
 */
export async function getUnresolvedPlaysWithIsrc(limit: number): Promise<UnresolvedPlay[]> {
  const { rows } = await query<UnresolvedPlay>(
    `SELECT p.id AS play_id, p.isrc, p.track_name, p.artist_name
       FROM plays p
       LEFT JOIN play_resolutions r ON r.play_id = p.id
      WHERE p.isrc IS NOT NULL
        AND r.play_id IS NULL
      ORDER BY p.id ASC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Resolve a single play: ensure a canonical recording exists for its ISRC,
 * then link the play to it. Done in one transaction so a play is never linked
 * to a half-created recording.
 *
 * The recording upsert uses ON CONFLICT (isrc) so concurrent or repeated runs
 * converge on the same canonical row rather than erroring or duplicating.
 *
 * Returns true if a NEW resolution row was written, false if the play was
 * already resolved (making the whole operation idempotent).
 */
export async function resolvePlayByIsrc(play: UnresolvedPlay): Promise<boolean> {
  return withTransaction(async (client) => {
    // Upsert the canonical recording for this ISRC and get its id back.
    // DO UPDATE (rather than DO NOTHING) so RETURNING always yields the row,
    // whether it was just inserted or already existed.
    const recording = await client.query<{ id: string }>(
      `INSERT INTO canonical_recordings (isrc, title, artist_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (isrc) DO UPDATE SET isrc = EXCLUDED.isrc
       RETURNING id`,
      [play.isrc, play.track_name, play.artist_name],
    );
    const recordingId = recording.rows[0]?.id;
    if (recordingId === undefined) {
      throw new Error(`Failed to upsert canonical recording for ISRC ${play.isrc}`);
    }

    // Link the play. ON CONFLICT DO NOTHING makes re-runs safe: if this play
    // was already resolved, we change nothing and report it as not-new.
    const linked = await client.query(
      `INSERT INTO play_resolutions (play_id, canonical_recording_id, method)
       VALUES ($1, $2, 'isrc')
       ON CONFLICT (play_id) DO NOTHING`,
      [play.play_id, recordingId],
    );
    return (linked.rowCount ?? 0) > 0;
  });
}

export interface ResolutionStats {
  totalPlays: number;
  resolvedPlays: number;
  canonicalRecordings: number;
}

/** A snapshot of resolution progress, for the run summary. */
export async function getResolutionStats(): Promise<ResolutionStats> {
  const { rows } = await query<{
    total_plays: string;
    resolved_plays: string;
    canonical_recordings: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM plays) AS total_plays,
       (SELECT COUNT(*) FROM play_resolutions) AS resolved_plays,
       (SELECT COUNT(*) FROM canonical_recordings) AS canonical_recordings`,
  );
  const row = rows[0];
  return {
    totalPlays: Number(row?.total_plays ?? 0),
    resolvedPlays: Number(row?.resolved_plays ?? 0),
    canonicalRecordings: Number(row?.canonical_recordings ?? 0),
  };
}
