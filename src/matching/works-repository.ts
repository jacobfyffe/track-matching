import { query, withTransaction } from '../db/pool.js';

/**
 * Data-access for the Works grouping layer (Tier 2).
 */

export interface RecordingRow {
  id: string;
  title: string;
  artist_name: string;
}

/** All canonical recordings (the input to grouping). */
export async function getAllRecordings(): Promise<RecordingRow[]> {
  const { rows } = await query<RecordingRow>(
    `SELECT id, title, artist_name FROM canonical_recordings ORDER BY id ASC`,
  );
  return rows;
}

/** Manual overrides, as a map of recording id -> work_key. */
export async function getOverrides(): Promise<Map<string, string>> {
  const { rows } = await query<{ canonical_recording_id: string; work_key: string }>(
    `SELECT canonical_recording_id, work_key FROM work_overrides`,
  );
  return new Map(rows.map((r) => [r.canonical_recording_id, r.work_key]));
}

/**
 * Assign a recording to the work identified by work_key, creating the work if
 * it doesn't exist yet. Idempotent: re-running updates the link in place rather
 * than duplicating. Done in a transaction so a recording is never linked to a
 * half-created work.
 */
export async function assignRecordingToWork(
  recordingId: string,
  workKey: string,
  title: string,
  artist: string,
  method: 'auto' | 'override',
): Promise<void> {
  await withTransaction(async (client) => {
    const work = await client.query<{ id: string }>(
      `INSERT INTO works (work_key, title, artist_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (work_key) DO UPDATE SET work_key = EXCLUDED.work_key
       RETURNING id`,
      [workKey, title, artist],
    );
    const workId = work.rows[0]?.id;
    if (workId === undefined) {
      throw new Error(`Failed to upsert work for key ${workKey}`);
    }

    await client.query(
      `INSERT INTO recording_works (canonical_recording_id, work_id, method)
       VALUES ($1, $2, $3)
       ON CONFLICT (canonical_recording_id)
         DO UPDATE SET work_id = EXCLUDED.work_id, method = EXCLUDED.method, assigned_at = now()`,
      [recordingId, workId, method],
    );
  });
}

/** Insert or update a manual override for a recording. */
export async function setOverride(
  recordingId: string,
  workKey: string,
  note: string | null,
): Promise<void> {
  await query(
    `INSERT INTO work_overrides (canonical_recording_id, work_key, note)
     VALUES ($1, $2, $3)
     ON CONFLICT (canonical_recording_id)
       DO UPDATE SET work_key = EXCLUDED.work_key, note = EXCLUDED.note`,
    [recordingId, workKey, note],
  );
}

/**
 * Remove works that no longer have any recordings linked to them. Keeps the
 * works table tidy after re-grouping moves recordings around.
 */
export async function pruneEmptyWorks(): Promise<number> {
  const result = await query(
    `DELETE FROM works w
      WHERE NOT EXISTS (
        SELECT 1 FROM recording_works rw WHERE rw.work_id = w.id
      )`,
  );
  return result.rowCount ?? 0;
}

export interface WorksStats {
  recordings: number;
  works: number;
  overrides: number;
}

export async function getWorksStats(): Promise<WorksStats> {
  const { rows } = await query<{ recordings: string; works: string; overrides: string }>(
    `SELECT
       (SELECT COUNT(*) FROM canonical_recordings) AS recordings,
       (SELECT COUNT(*) FROM works) AS works,
       (SELECT COUNT(*) FROM work_overrides) AS overrides`,
  );
  const row = rows[0];
  return {
    recordings: Number(row?.recordings ?? 0),
    works: Number(row?.works ?? 0),
    overrides: Number(row?.overrides ?? 0),
  };
}
