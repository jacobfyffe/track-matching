import {
  getUnresolvedPlaysWithIsrc,
  resolvePlayByIsrc,
  type UnresolvedPlay,
} from './repository.js';
import { config } from '../config/index.js';
import { log } from '../lib/logger.js';

/**
 * Tier 1 resolution: match plays to canonical recordings by exact ISRC.
 *
 * This is the unambiguous tier — two plays sharing an ISRC are definitively the
 * same recording, no heuristics needed. It processes unresolved plays in
 * batches until none remain, so it scales to any backlog without holding the
 * whole table in memory.
 *
 * Idempotent: already-resolved plays are filtered out by the query, and the
 * writes use ON CONFLICT, so running it repeatedly only ever resolves new plays.
 */
export async function runTier1Resolution(): Promise<number> {
  let totalResolved = 0;

  for (;;) {
    const batch = await getUnresolvedPlaysWithIsrc(config.matching.batchSize);
    if (batch.length === 0) {
      break;
    }

    let batchResolved = 0;
    for (const play of batch) {
      const wasNew = await resolveOne(play);
      if (wasNew) {
        batchResolved++;
      }
    }

    totalResolved += batchResolved;
    log.info('Resolved batch', { batchSize: batch.length, newlyResolved: batchResolved });

    // Safety valve: if a full batch produced zero new resolutions, something is
    // off (e.g. the same plays keep coming back). Stop rather than loop forever.
    if (batchResolved === 0) {
      log.warn('Batch resolved nothing new; stopping to avoid an infinite loop');
      break;
    }
  }

  return totalResolved;
}

/**
 * Resolve a single play, isolating per-play failures: one bad row shouldn't
 * abort the whole run. A failure is logged and the play is left unresolved to
 * be retried on a later run.
 */
async function resolveOne(play: UnresolvedPlay): Promise<boolean> {
  try {
    return await resolvePlayByIsrc(play);
  } catch (error) {
    log.error('Failed to resolve play', {
      playId: play.play_id,
      isrc: play.isrc,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
