import {
  getUnresolvedPlaysWithoutIsrc,
  getCandidateRecordings,
  linkPlayToRecording,
  createRecordingForPlay,
  queueForReview,
  type CandidateRecording,
} from './fuzzy-repository.js';
import { scoreMatch } from './similarity.js';
import { config } from '../config/index.js';
import { log } from '../lib/logger.js';

/**
 * Fuzzy matching (Tier 2 fallback) for plays without a usable ISRC.
 *
 * For each such play, find the best-scoring existing canonical recording:
 *   score >= autoMatch (and duration ok)  -> auto-link (method 'fuzzy')
 *   reviewFloor <= score < autoMatch      -> queue for manual review (Tier 3)
 *   score < reviewFloor                   -> create a new recording (no match)
 *
 * Thresholds come from config so they're tunable without code changes.
 *
 * Note: with fully ISRC-covered data this pass simply finds nothing to do, by
 * design — it exists for ISRC-less sources (e.g. future Apple Music data).
 */
export interface FuzzyStats {
  processed: number;
  autoLinked: number;
  queued: number;
  newRecordings: number;
}

export async function runFuzzyMatching(): Promise<FuzzyStats> {
  const { fuzzyAutoMatch, fuzzyReviewFloor, durationToleranceMs, batchSize } = config.matching;

  const stats: FuzzyStats = { processed: 0, autoLinked: 0, queued: 0, newRecordings: 0 };

  for (;;) {
    const plays = await getUnresolvedPlaysWithoutIsrc(batchSize);
    if (plays.length === 0) break;

    // Load candidates once per batch (cheap at current scale).
    const candidates = await getCandidateRecordings();

    for (const play of plays) {
      stats.processed++;
      const best = bestCandidate(play, candidates, durationToleranceMs);

      try {
        if (best && best.score >= fuzzyAutoMatch && best.durationOk) {
          await linkPlayToRecording(play.play_id, best.recording.id);
          stats.autoLinked++;
        } else if (best && best.score >= fuzzyReviewFloor) {
          await queueForReview(
            play.play_id,
            best.recording.id,
            best.score,
            play.track_name,
            play.artist_name,
          );
          stats.queued++;
        } else {
          await createRecordingForPlay(play.play_id, play.track_name, play.artist_name);
          stats.newRecordings++;
        }
      } catch (error) {
        log.error('Fuzzy resolution failed for play', {
          playId: play.play_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Safety valve: every play in the batch produces an outcome, so the next
    // query returns fewer rows. If somehow nothing changed, stop.
    if (plays.length < batchSize) break;
  }

  log.info('Fuzzy matching complete', { ...stats });
  return stats;
}

interface BestMatch {
  recording: CandidateRecording;
  score: number;
  durationOk: boolean;
}

function bestCandidate(
  play: { track_name: string; artist_name: string; duration_ms: number | null },
  candidates: CandidateRecording[],
  durationToleranceMs: number,
): BestMatch | null {
  let best: BestMatch | null = null;
  for (const cand of candidates) {
    const { score, durationOk } = scoreMatch(
      { title: play.track_name, artist: play.artist_name, durationMs: play.duration_ms },
      { title: cand.title, artist: cand.artist_name, durationMs: cand.duration_ms },
      durationToleranceMs,
    );
    if (best === null || score > best.score) {
      best = { recording: cand, score, durationOk };
    }
  }
  return best;
}
