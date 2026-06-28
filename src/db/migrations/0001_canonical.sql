-- 0001_canonical.sql
-- Phase 2 canonical-matching schema (Tier 1: ISRC exact match).
--
-- Design:
--   * Phase 2 NEVER mutates Phase 1's `plays` table. Raw plays stay immutable
--     and reprocessable; canonical resolution is a layer on top that can be
--     wiped and rebuilt as matching logic improves (e.g. when Tier 2 lands).
--   * `canonical_recordings` is one row per distinct ISRC — the canonical
--     identity of a specific recording (a specific audio file).
--   * `play_resolutions` links each play to the recording it resolved to, and
--     records HOW it was resolved so later tiers can recompute selectively.
--
-- The `works` grouping layer (which collapses recordings into songs per the
-- editorial version-tag rules) is deliberately NOT here — it arrives with
-- Tier 2 as an additive migration, requiring no changes to these tables.

-- One row per distinct recording, keyed by ISRC.
CREATE TABLE IF NOT EXISTS canonical_recordings (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- ISRC is the canonical key: two plays with the same ISRC are the same
    -- recording. Unique so resolution is idempotent.
    isrc          TEXT NOT NULL UNIQUE,
    -- Representative metadata, captured from the first play that created this
    -- recording. Not authoritative — purely for human-readable display.
    title         TEXT NOT NULL,
    artist_name   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- How a play was resolved to a canonical recording. Phase 2 owns this entirely.
CREATE TABLE IF NOT EXISTS play_resolutions (
    -- One resolution per play. play_id references Phase 1's plays table; we do
    -- NOT add a foreign key across the phase boundary on purpose, to keep the
    -- two schemas independently migratable. (Both live in one database, but the
    -- coupling is intentionally loose.)
    play_id                 BIGINT PRIMARY KEY,
    canonical_recording_id  BIGINT NOT NULL REFERENCES canonical_recordings(id) ON DELETE CASCADE,
    -- Which tier/method resolved this play. Tier 1 writes 'isrc'; Tier 2 will
    -- write 'fuzzy', Tier 3 'manual'. Lets later passes recompute selectively.
    method                  TEXT NOT NULL,
    resolved_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_play_resolutions_recording
    ON play_resolutions(canonical_recording_id);
