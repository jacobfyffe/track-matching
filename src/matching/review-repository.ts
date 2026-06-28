import { query, withTransaction } from '../db/pool.js';

/**
 * Data-access for the Tier 3 review workflow: working through the borderline
 * fuzzy matches sitting in match_review_queue.
 */

export interface ReviewItem {
  id: string;
  play_id: string;
  candidate_recording_id: string;
  score: number;
  play_title: string;
  play_artist: string;
  candidate_title: string;
  candidate_artist: string;
}

/** Pending review items, joined to their suggested recording for context. */
export async function getPendingReviews(limit: number): Promise<ReviewItem[]> {
  const { rows } = await query<ReviewItem>(
    `SELECT q.id, q.play_id, q.candidate_recording_id, q.score,
            q.play_title, q.play_artist,
            cr.title AS candidate_title, cr.artist_name AS candidate_artist
       FROM match_review_queue q
       JOIN canonical_recordings cr ON cr.id = q.candidate_recording_id
      WHERE q.status = 'pending'
      ORDER BY q.score DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Fetch a single pending item by queue id. */
export async function getReviewItem(queueId: string): Promise<ReviewItem | null> {
  const { rows } = await query<ReviewItem>(
    `SELECT q.id, q.play_id, q.candidate_recording_id, q.score,
            q.play_title, q.play_artist,
            cr.title AS candidate_title, cr.artist_name AS candidate_artist
       FROM match_review_queue q
       JOIN canonical_recordings cr ON cr.id = q.candidate_recording_id
      WHERE q.id = $1 AND q.status = 'pending'`,
    [queueId],
  );
  return rows[0] ?? null;
}

/**
 * Confirm a match: link the play to the suggested recording (method 'manual')
 * and mark the queue row resolved. Atomic so the two always agree.
 */
export async function confirmReview(item: ReviewItem): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO play_resolutions (play_id, canonical_recording_id, method)
       VALUES ($1, $2, 'manual')
       ON CONFLICT (play_id) DO NOTHING`,
      [item.play_id, item.candidate_recording_id],
    );
    await client.query(
      `UPDATE match_review_queue SET status = 'resolved' WHERE id = $1`,
      [item.id],
    );
  });
}

/**
 * Reject a match: the play is NOT the suggested recording, so create a new
 * standalone ISRC-less recording for it and link to that. Mark the row rejected.
 */
export async function rejectReview(item: ReviewItem): Promise<void> {
  await withTransaction(async (client) => {
    const rec = await client.query<{ id: string }>(
      `INSERT INTO canonical_recordings (isrc, title, artist_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [`noisrc:play:${item.play_id}`, item.play_title, item.play_artist],
    );
    const recordingId = rec.rows[0]?.id;
    if (recordingId === undefined) {
      throw new Error(`Failed to create recording for play ${item.play_id}`);
    }
    await client.query(
      `INSERT INTO play_resolutions (play_id, canonical_recording_id, method)
       VALUES ($1, $2, 'manual-new')
       ON CONFLICT (play_id) DO NOTHING`,
      [item.play_id, recordingId],
    );
    await client.query(
      `UPDATE match_review_queue SET status = 'rejected' WHERE id = $1`,
      [item.id],
    );
  });
}
