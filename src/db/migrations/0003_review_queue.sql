-- 0003_review_queue.sql
-- Match review queue: borderline fuzzy matches awaiting a human decision.
--
-- The fuzzy matcher auto-links only confident matches (>= auto threshold).
-- Matches in the uncertain band (>= review floor, < auto) are written here
-- instead of being applied, for the Tier 3 review workflow to resolve later.
-- Additive and independent, like all Phase 2 tables.

CREATE TABLE IF NOT EXISTS match_review_queue (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- The play awaiting a decision (loose coupling to Phase 1's plays, no FK).
    play_id                 BIGINT NOT NULL UNIQUE,
    -- The best candidate recording the matcher found.
    candidate_recording_id  BIGINT NOT NULL REFERENCES canonical_recordings(id) ON DELETE CASCADE,
    -- Confidence that landed it in the review band, for triage/sorting.
    score                   DOUBLE PRECISION NOT NULL,
    -- Snapshot of the play's metadata, so review needs no extra joins.
    play_title              TEXT NOT NULL,
    play_artist             TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending', -- pending | resolved | rejected
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON match_review_queue(status);
