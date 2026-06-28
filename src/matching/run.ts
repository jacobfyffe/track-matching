import { runTier1Resolution } from './tier1.js';
import { getResolutionStats } from './repository.js';
import { closePool } from '../db/pool.js';
import { log } from '../lib/logger.js';

/**
 * Entrypoint: run a full resolution pass, then report progress.
 *
 * For now this is a one-shot batch job you run on demand (npm run resolve:dev).
 * It could later be scheduled or triggered after each ingest, but on-demand is
 * the right starting point — resolution is cheap to re-run and idempotent.
 */
async function main(): Promise<void> {
  log.info('Starting Tier 1 (ISRC) resolution');

  const newlyResolved = await runTier1Resolution();
  const stats = await getResolutionStats();

  log.info('Resolution complete', {
    newlyResolved,
    resolvedPlays: stats.resolvedPlays,
    totalPlays: stats.totalPlays,
    canonicalRecordings: stats.canonicalRecordings,
    unresolvedRemaining: stats.totalPlays - stats.resolvedPlays,
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
