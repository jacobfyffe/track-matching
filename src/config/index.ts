import 'dotenv/config';

/**
 * Centralized, validated configuration.
 *
 * Phase 2 is a database-to-database processor: it reads raw plays and writes
 * canonical resolutions. It needs nothing from Spotify, so the only required
 * config is the connection to the database it shares with Phase 1.
 *
 * As with the scrobbler, env is read exactly once here and validated at startup,
 * so a misconfigured run fails immediately with a clear message.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function asInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

export const config = {
  env: optional('NODE_ENV', 'development'),

  database: {
    // The SAME database the scrobbler writes to. Phase 2 reads `plays` and
    // writes its own canonical tables alongside.
    url: required('DATABASE_URL'),
  },

  matching: {
    // How many unresolved plays to process per batch when resolving.
    batchSize: asInt(optional('MATCH_BATCH_SIZE', '500'), 'MATCH_BATCH_SIZE'),
    // Fuzzy matcher thresholds (tunable). Combined title+artist similarity:
    //   >= autoMatch        -> auto-link to the candidate recording
    //   reviewFloor..auto   -> queue for manual review (Tier 3)
    //   < reviewFloor       -> no match (create a new ISRC-less recording)
    fuzzyAutoMatch: Number(optional('FUZZY_AUTO_MATCH', '0.92')),
    fuzzyReviewFloor: Number(optional('FUZZY_REVIEW_FLOOR', '0.80')),
    // Duration guard: a candidate beyond this many ms apart can't auto-match.
    durationToleranceMs: asInt(optional('FUZZY_DURATION_TOLERANCE_MS', '10000'), 'FUZZY_DURATION_TOLERANCE_MS'),
  },

  fuzzy: {
    // Strict text threshold: at/above this combined title+artist score, auto-link.
    autoMatchThreshold: Number(optional('FUZZY_AUTO_THRESHOLD', '0.92')),
    // Plausible band: at/above this (but below auto) goes to review; below, new.
    reviewFloorThreshold: Number(optional('FUZZY_REVIEW_FLOOR', '0.80')),
    // Loose duration guard: max ms difference allowed for an auto-match.
    durationToleranceMs: asInt(optional('FUZZY_DURATION_TOLERANCE_MS', '10000'), 'FUZZY_DURATION_TOLERANCE_MS'),
  },
} as const;

export type Config = typeof config;
