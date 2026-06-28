# track-matching

Resolves raw play events into **canonical recordings** so listening data can be charted. This is Phase 2 of a larger music-tracking service; Phase 1 (the [scrobbler](https://github.com/jacobfyffe/scrobbler)) captures plays, and this service makes sense of them.

This first cut implements **Tier 1: exact ISRC matching** — the unambiguous case where two plays sharing an International Standard Recording Code are definitively the same recording. Later tiers add fuzzy matching and a manual review queue.

## The idea

A single song generates many raw plays, across time and (eventually) across streaming services, each with slightly different metadata. To chart "this recording has been played N times," you need a single canonical identity that all those plays roll up to. ISRC provides that identity for free when it's present, so Tier 1 uses it directly.

There are two levels of identity in the full design:

- **Recording** — a specific audio file, identified by ISRC. *(This repo, Tier 1.)*
- **Work** — the underlying song, grouping multiple recordings (e.g. a remaster groups with its original, but a live version stays separate). *(Later, with Tier 2.)*

## Architecture

This service shares one PostgreSQL database with the scrobbler. It **reads** the `plays` table (never mutating it — raw plays stay immutable and reprocessable) and **writes** its own canonical tables:

| Table | Purpose |
| --- | --- |
| `canonical_recordings` | One row per distinct ISRC — the canonical identity of a recording. |
| `play_resolutions` | Links each play to the recording it resolved to, plus the `method` (`isrc` now; `fuzzy`/`manual` later) so passes can recompute selectively. |

Resolution is **idempotent**: already-resolved plays are skipped, and all writes use `ON CONFLICT`, so the resolver can be re-run any time and only ever processes new plays.

### Module layout

| Path | Responsibility |
| --- | --- |
| `src/config` | Typed, validated environment loading. |
| `src/db` | Connection pool, transaction helper, SQL migration runner. |
| `src/lib` | Structured logger. |
| `src/matching` | Data-access, Tier 1 resolver, Tier 2 works grouping + classifier, override CLI, and the run entrypoint. |

## Setup

Prerequisites: Node 20+, and access to the same PostgreSQL database the scrobbler uses.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    Point DATABASE_URL at the same database the scrobbler writes to.

# 3. Run migrations (creates the canonical tables)
npm run migrate:dev

# 4. Resolve plays
npm run resolve:dev
```

The resolver logs a summary on completion: how many plays were newly resolved, total resolved vs. total plays, and how many canonical recordings exist.

## Scripts

| Command | Description |
| --- | --- |
| `npm run resolve:dev` | Run a full pass: Tier 1 resolution + Tier 2 works grouping. |
| `npm run override ...` | Make manual work-grouping corrections (list / merge / split). |
| `npm run migrate:dev` | Apply pending migrations. |
| `npm test` | Run the classifier unit tests. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run typecheck` | Type-check without emitting. |

## Roadmap

- **Tier 1 — ISRC exact match.** *(Done.)* Resolves plays to canonical recordings by ISRC.
- **Tier 2 — Works grouping.** *(Done.)* Groups recordings into works via a version-tag classifier, with manual overrides.
- **Tier 2 — Fuzzy match.** *(Done.)* For ISRC-less plays: similarity scoring (Levenshtein-based) auto-links confident matches, queues borderline ones for review, and creates new recordings for the rest. Thresholds are tunable in config.
- **Tier 3 — Manual review workflow.** *(Done.)* A CLI to resolve the borderline matches the fuzzy matcher queued: confirm (link to the suggestion) or reject (give the play its own recording).

## Review workflow (Tier 3)

Borderline fuzzy matches land in `match_review_queue` instead of being guessed. Work through them with:

```bash
npm run review list              # show pending items with scores + suggestions
npm run review confirm 7         # accept the suggested match (method 'manual')
npm run review reject 7          # give the play its own new recording
npm run resolve:dev              # re-run so works-grouping picks up changes
```

With fully ISRC-covered data the queue stays empty — this exists for ISRC-less sources.

## Fuzzy matching (Tier 2 fallback)

When a play has no resolvable ISRC, it's compared against existing recordings by normalized title + artist similarity (Levenshtein ratio, title weighted 0.7). Group version tags are stripped before comparison; separate tags are kept. Outcomes, by combined score:

- **>= 0.92** (and duration within ±10s): auto-link to the candidate.
- **0.80–0.92**: queue for manual review (`match_review_queue`) rather than guess.
- **< 0.80**: create a new ISRC-less recording.

All thresholds are configurable (`FUZZY_AUTO_MATCH`, `FUZZY_REVIEW_FLOOR`, `FUZZY_DURATION_TOLERANCE_MS`). With fully ISRC-covered data this pass simply finds nothing to do — it exists for ISRC-less sources like future Apple Music data.

## Works grouping (Tier 2)

A **work** is a song for charting; multiple recordings can roll up into one. The classifier derives a normalized "work key" from each recording's title and artist, applying version-tag rules:

- **Group with the original** (tag stripped): Remaster / "YYYY Remaster", Radio Edit, Single Version.
- **Stay separate** (tag kept): Live, Remix, Sped Up, Slowed, Nightcore, feat./ft.
- **Unknown tags** (e.g. "(Roles Reversed)", which is part of the real title): kept, so the recording stays separate by default. Safer than wrongly merging.
- **Precedence:** if any separate/unknown tag is present, the recording stays its own work even if a group tag is also present (a live remaster is still live).

Both the Spotify dash style (`Song - Live`) and the parenthetical style (`Song (Live)`) are handled.

### Manual overrides

Automation can't safely decide every case, so you can override any recording's work assignment. Overrides are consulted before the classifier and persist across re-runs.

```bash
npm run override list traitor                  # find recording ids
npm run override merge 42 17 "same song"       # group #42 into #17's work
npm run override split 88 "wrongly merged"     # make #88 its own work
npm run resolve:dev                            # re-run to apply
```
