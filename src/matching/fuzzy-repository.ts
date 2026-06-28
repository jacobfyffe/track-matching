import { query, withTransaction } from '../db/pool.js';

/**
 * Data-access for the fuzzy matcher (Tier 2 fallback) and review queue.
 */

export interface UnresolvedNoIsrcPlay {
  play_id: string;
  track_name: string;
  artist_name: string;
  duration_ms: number | null;
}

/**
 * Plays with NO resolution yet that Tier 1 couldn't handle — i.e. ISRC is null.
 * These are the fuzzy matcher's input. (Plays with an ISRC are Tier 1's job.)
 * Also excludes plays already sitting in the review queue, so re-runs don't
 * re-queue the same play.
 */
export async function getUnresolvedPlaysWithoutIsrc(limit: number): Promise<UnresolvedNoIsrcPlay[]> {
  const { rows } = await query<UnresolvedNoIsrcPlay>(
    `SELECT p.id AS play_id, p.track_name, p.artist_name, p.duration_ms
       FROM plays p
       LEFT JOIN play_resolutions r ON r.play_id = p.id
       LEFT JOIN match_review_queue q ON q.play_id = p.id
      WHERE p.isrc IS NULL
        AND r.play_id IS NULL
        AND q.play_id IS NULL
      ORDER BY p.id ASC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export interface CandidateRecording {
  id: string;
  title: string;
  artist_name: string;
  duration_ms: number | null;
}

/**
 * Candidate recordings to compare against. We pull recordings that share at
 * least the first character of the normalized artist as a cheap blocking key —
 * but for the current data volume we simply return all recordings, which is
 * correct and plenty fast. (A blocking strategy is a future optimization, not a
 * correctness requirement.)
 */
export async function getCandidateRecordings(): Promise<CandidateRecording[]> {
  const { rows } = await query<CandidateRecording>(
    `SELECT cr.id, cr.title, cr.artist_name,
            (SELECT p.duration_ms FROM plays p
              WHERE p.track_id IS NOT NULL AND p.isrc = cr.isrc
              LIMIT 1) AS duration_ms
       FROM canonical_recordings cr`,
  );
  return rows;
}

/** Link a play to an existing recording via the fuzzy method. Idempotent. */
export async function linkPlayToRecording(playId: string, recordingId: string): Promise<boolean> {
  const result = await query(
    `INSERT INTO play_resolutions (play_id, canonical_recording_id, method)
     VALUES ($1, $2, 'fuzzy')
     ON CONFLICT (play_id) DO NOTHING`,
    [playId, recordingId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Create a brand-new ISRC-less canonical recording for a play that matched
 * nothing, and link the play to it. ISRC-less recordings use a synthetic key so
 * the NOT NULL/UNIQUE isrc constraint still holds: 'noisrc:play:<id>'.
 */
export async function createRecordingForPlay(
  playId: string,
  title: string,
  artist: string,
): Promise<void> {
  await withTransaction(async (client) => {
    const rec = await client.query<{ id: string }>(
      `INSERT INTO canonical_recordings (isrc, title, artist_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`noisrc:play:${playId}`, title, artist],
    );
    const recordingId = rec.rows[0]?.id;
    if (recordingId === undefined) {
      throw new Error(`Failed to create recording for play ${playId}`);
    }
    await client.query(
      `INSERT INTO play_resolutions (play_id, canonical_recording_id, method)
       VALUES ($1, $2, 'fuzzy-new')
       ON CONFLICT (play_id) DO NOTHING`,
      [playId, recordingId],
    );
  });
}

/** Queue a borderline match for manual review (Tier 3). */
export async function queueForReview(
  playId: string,
  candidateRecordingId: string,
  score: number,
  playTitle: string,
  playArtist: string,
): Promise<void> {
  await query(
    `INSERT INTO match_review_queue
       (play_id, candidate_recording_id, score, play_title, play_artist)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (play_id) DO NOTHING`,
    [playId, candidateRecordingId, score, playTitle, playArtist],
  );
}
