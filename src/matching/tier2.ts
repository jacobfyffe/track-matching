import {
  getAllRecordings,
  getOverrides,
  assignRecordingToWork,
  pruneEmptyWorks,
  type RecordingRow,
} from './works-repository.js';
import { deriveWorkKey } from './classifier.js';
import { log } from '../lib/logger.js';

/**
 * Works grouping (Tier 2).
 *
 * Assigns every canonical recording to a work. For each recording:
 *   1. If a manual override exists, use its work_key (your ruling always wins).
 *   2. Otherwise derive the key automatically via the version-tag classifier.
 * Recordings sharing a key collapse into one work.
 *
 * Fully recomputable and idempotent: re-running re-derives every assignment and
 * updates links in place, then prunes any works left empty by the reshuffle.
 * Overrides are read fresh each run, so adding an override and re-running is all
 * it takes to apply a manual correction.
 */
export async function runWorksGrouping(): Promise<{ assigned: number; pruned: number }> {
  const [recordings, overrides] = await Promise.all([getAllRecordings(), getOverrides()]);

  let assigned = 0;
  for (const rec of recordings) {
    try {
      const override = overrides.get(rec.id);
      const workKey = override ?? deriveWorkKey(rec.title, rec.artist_name);
      const method = override ? 'override' : 'auto';
      await assignRecordingToWork(rec.id, workKey, rec.title, rec.artist_name, method);
      assigned++;
    } catch (error) {
      log.error('Failed to assign recording to work', {
        recordingId: rec.id,
        title: rec.title,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const pruned = await pruneEmptyWorks();
  log.info('Works grouping complete', { assigned, pruned });
  return { assigned, pruned };
}

// Exported for potential reuse/testing: derive a key for a recording row.
export function workKeyFor(rec: RecordingRow): string {
  return deriveWorkKey(rec.title, rec.artist_name);
}
