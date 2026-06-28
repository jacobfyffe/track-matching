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
  },
} as const;

export type Config = typeof config;
