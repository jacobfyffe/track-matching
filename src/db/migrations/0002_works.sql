-- 0002_works.sql
-- Phase 2 Tier 2: the Works grouping layer.
--
-- A "work" is a song for charting purposes. Multiple canonical recordings can
-- roll up into one work (an original + its remaster + its radio edit), while
-- other versions (live, remix, sped up, feat.) stay as separate works. This is
-- the editorial layer on top of the mechanical recording identity.
--
-- Like every Phase 2 table, this is additive and never mutates earlier tables.
-- The grouping is fully recomputable: you can wipe recording_works and rebuild
-- it from canonical_recordings + work_overrides without losing anything.

-- One row per distinct song-for-charting.
CREATE TABLE IF NOT EXISTS works (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The normalized grouping key. Recordings sharing a work_key belong to the
    -- same work. Derived from title+artist with version-tag rules applied (or
    -- supplied by a manual override). Unique so grouping is idempotent.
    work_key      TEXT NOT NULL UNIQUE,
    -- Representative display metadata, from the first recording placed here.
    title         TEXT NOT NULL,
    artist_name   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Links each canonical recording to its work. Separate table (rather than a
-- column on canonical_recordings) so the grouping layer stays fully rebuildable
-- without touching the recordings table.
CREATE TABLE IF NOT EXISTS recording_works (
    canonical_recording_id  BIGINT PRIMARY KEY REFERENCES canonical_recordings(id) ON DELETE CASCADE,
    work_id                 BIGINT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    -- How this recording was assigned: 'auto' (classifier) or 'override' (you).
    method                  TEXT NOT NULL,
    assigned_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recording_works_work ON recording_works(work_id);

-- Manual rulings that override the automatic classifier. Keyed by recording.
-- An override assigns a recording an explicit work_key:
--   * Split: give a recording a unique key so it groups with nothing.
--   * Merge: give two+ recordings the SAME key so they group together.
-- The grouping pass consults this first; your ruling always wins and persists
-- across re-runs.
CREATE TABLE IF NOT EXISTS work_overrides (
    canonical_recording_id  BIGINT PRIMARY KEY REFERENCES canonical_recordings(id) ON DELETE CASCADE,
    work_key                TEXT NOT NULL,
    -- Optional human note explaining the ruling (e.g. "Roles Reversed is part
    -- of the real title, not a version tag").
    note                    TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
