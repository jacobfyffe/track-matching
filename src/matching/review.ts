import { closePool } from '../db/pool.js';
import {
  getPendingReviews,
  getReviewItem,
  confirmReview,
  rejectReview,
} from './review-repository.js';
import { log } from '../lib/logger.js';

/**
 * Tier 3 — manual review of borderline fuzzy matches.
 *
 * The fuzzy matcher queues uncertain matches (score in the review band) rather
 * than guessing. This CLI works through that queue:
 *
 *   list
 *     Show pending items: queue id, the play, the suggested recording, score.
 *
 *   confirm <queueId>
 *     Accept the suggestion — link the play to the suggested recording
 *     (method 'manual') and mark the item resolved.
 *
 *   reject <queueId>
 *     Reject the suggestion — give the play its own new recording instead
 *     (method 'manual-new') and mark the item rejected.
 *
 * After resolving items, re-run `npm run resolve:dev` so works-grouping picks up
 * any newly created recordings.
 *
 * Usage:
 *   npm run review list
 *   npm run review confirm 7
 *   npm run review reject 7
 */

async function list(): Promise<void> {
  const items = await getPendingReviews(100);
  if (items.length === 0) {
    process.stdout.write('No pending reviews. (The queue is empty.)\n');
    return;
  }
  process.stdout.write(`${items.length} pending review(s):\n\n`);
  for (const it of items) {
    process.stdout.write(
      `  #${it.id}  (score ${it.score.toFixed(3)})\n` +
        `      play:      "${it.play_title}" — ${it.play_artist}\n` +
        `      suggested: "${it.candidate_title}" — ${it.candidate_artist}\n` +
        `      -> npm run review confirm ${it.id}   |   npm run review reject ${it.id}\n\n`,
    );
  }
}

async function confirm(queueId: string): Promise<void> {
  const item = await getReviewItem(queueId);
  if (!item) {
    throw new Error(`No pending review item #${queueId}`);
  }
  await confirmReview(item);
  log.info('Review confirmed', { queueId, playId: item.play_id, recordingId: item.candidate_recording_id });
  process.stdout.write(`Confirmed: play linked to "${item.candidate_title}". Re-run resolve to regroup.\n`);
}

async function reject(queueId: string): Promise<void> {
  const item = await getReviewItem(queueId);
  if (!item) {
    throw new Error(`No pending review item #${queueId}`);
  }
  await rejectReview(item);
  log.info('Review rejected', { queueId, playId: item.play_id });
  process.stdout.write(`Rejected: "${item.play_title}" is now its own recording. Re-run resolve to regroup.\n`);
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case 'list':
      await list();
      break;
    case 'confirm':
      if (!arg) throw new Error('Usage: confirm <queueId>');
      await confirm(arg);
      break;
    case 'reject':
      if (!arg) throw new Error('Usage: reject <queueId>');
      await reject(arg);
      break;
    default:
      process.stdout.write(
        'Commands:\n' +
          '  list                 show pending review items\n' +
          '  confirm <queueId>    accept the suggested match\n' +
          '  reject <queueId>     give the play its own new recording\n',
      );
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    log.error('Review command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await closePool();
    process.exit(1);
  });
