import { runTier1Resolution } from './tier1.js';
import { runWorksGrouping } from './tier2.js';
import { getResolutionStats } from './repository.js';
import { getWorksStats } from './works-repository.js';
import { closePool } from '../db/pool.js';
import { log } from '../lib/logger.js';

/**
 * Entrypoint: run a full resolution pass.
 *
 *   Tier 1 — resolve plays to canonical recordings by ISRC.
 *   Tier 2 — group recordings into works (version-tag rules + manual overrides).
 *
 * Both are idempotent and safe to re-run on demand.
 */
async function main(): Promise<void> {
  log.info('Starting resolution');

  const newlyResolved = await runTier1Resolution();
  const resolution = await getResolutionStats();
  log.info('Tier 1 complete', {
    newlyResolved,
    resolvedPlays: resolution.resolvedPlays,
    totalPlays: resolution.totalPlays,
    canonicalRecordings: resolution.canonicalRecordings,
    unresolvedRemaining: resolution.totalPlays - resolution.resolvedPlays,
  });

  const { assigned, pruned } = await runWorksGrouping();
  const works = await getWorksStats();
  log.info('Tier 2 complete', {
    recordingsAssigned: assigned,
    emptyWorksPruned: pruned,
    totalWorks: works.works,
    recordings: works.recordings,
    overrides: works.overrides,
    recordingsCollapsed: works.recordings - works.works,
  });
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    log.error('Resolution run failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await closePool();
    process.exit(1);
  });
