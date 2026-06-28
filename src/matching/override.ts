import { query } from '../db/pool.js';
import { closePool } from '../db/pool.js';
import { setOverride } from './works-repository.js';
import { deriveWorkKey, normalize } from './classifier.js';
import { log } from '../lib/logger.js';

/**
 * Manual override CLI.
 *
 * Two subcommands:
 *
 *   list [search]
 *     Show recordings (id, title, artist, current work) so you can find the id
 *     to override. Optional case-insensitive title search.
 *
 *   merge <recordingId> <targetRecordingId> [note]
 *     Force <recordingId> into the SAME work as <targetRecordingId>, by copying
 *     the target's auto-derived work key. Use for "these belong together".
 *
 *   split <recordingId> [note]
 *     Force <recordingId> into its OWN standalone work, by giving it a unique
 *     key. Use for "the classifier wrongly merged this".
 *
 * After any override, re-run `npm run resolve:dev` to apply it.
 *
 * Usage:
 *   tsx src/matching/override.ts list traitor
 *   tsx src/matching/override.ts merge 42 17 "Roles Reversed is part of the title"
 *   tsx src/matching/override.ts split 88 "wrongly grouped"
 */

interface RecRow {
  id: string;
  title: string;
  artist_name: string;
  work_title: string | null;
  override_key: string | null;
}

async function list(search: string | undefined): Promise<void> {
  const like = search ? `%${search}%` : '%';
  const { rows } = await query<RecRow>(
    `SELECT cr.id, cr.title, cr.artist_name,
            w.title AS work_title,
            o.work_key AS override_key
       FROM canonical_recordings cr
       LEFT JOIN recording_works rw ON rw.canonical_recording_id = cr.id
       LEFT JOIN works w ON w.id = rw.work_id
       LEFT JOIN work_overrides o ON o.canonical_recording_id = cr.id
      WHERE cr.title ILIKE $1
      ORDER BY cr.artist_name, cr.title`,
    [like],
  );

  if (rows.length === 0) {
    process.stdout.write('No recordings found.\n');
    return;
  }
  for (const r of rows) {
    const flag = r.override_key ? ' [OVERRIDDEN]' : '';
    process.stdout.write(
      `  #${r.id}  ${r.title} — ${r.artist_name}  (work: ${r.work_title ?? 'unassigned'})${flag}\n`,
    );
  }
}

async function getRecording(id: string): Promise<RecRow | null> {
  const { rows } = await query<RecRow>(
    `SELECT id, title, artist_name, NULL AS work_title, NULL AS override_key
       FROM canonical_recordings WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

async function merge(recordingId: string, targetId: string, note: string | null): Promise<void> {
  const target = await getRecording(targetId);
  if (!target) {
    throw new Error(`Target recording #${targetId} not found`);
  }
  // Use the target's auto-derived key so the override-d recording lands in the
  // same work the target naturally belongs to.
  const key = deriveWorkKey(target.title, target.artist_name);
  await setOverride(recordingId, key, note);
  log.info('Override set: merge', { recordingId, intoWorkOf: targetId, workKey: key });
  process.stdout.write(`Set: #${recordingId} will group with #${targetId}. Re-run resolve to apply.\n`);
}

async function split(recordingId: string, note: string | null): Promise<void> {
  const rec = await getRecording(recordingId);
  if (!rec) {
    throw new Error(`Recording #${recordingId} not found`);
  }
  // A unique key guarantees this recording stands alone. Suffix with the id so
  // it can never collide with another work.
  const key = `${normalize(rec.title)}|${normalize(rec.artist_name)}|standalone-${recordingId}`;
  await setOverride(recordingId, key, note);
  log.info('Override set: split', { recordingId, workKey: key });
  process.stdout.write(`Set: #${recordingId} will be its own work. Re-run resolve to apply.\n`);
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'list':
      await list(args[0]);
      break;
    case 'merge': {
      const [recordingId, targetId, ...noteParts] = args;
      if (!recordingId || !targetId) {
        throw new Error('Usage: merge <recordingId> <targetRecordingId> [note]');
      }
      await merge(recordingId, targetId, noteParts.join(' ') || null);
      break;
    }
    case 'split': {
      const [recordingId, ...noteParts] = args;
      if (!recordingId) {
        throw new Error('Usage: split <recordingId> [note]');
      }
      await split(recordingId, noteParts.join(' ') || null);
      break;
    }
    default:
      process.stdout.write(
        'Commands:\n' +
          '  list [search]                              show recordings + their works\n' +
          '  merge <recordingId> <targetId> [note]      group recording into target\'s work\n' +
          '  split <recordingId> [note]                 make recording its own work\n',
      );
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    log.error('Override command failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    await closePool();
    process.exit(1);
  });
