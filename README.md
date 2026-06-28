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
| `src/matching` | Data-access layer, the Tier 1 resolver, and the run entrypoint. |

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
| `npm run resolve:dev` | Run a resolution pass (Tier 1). |
| `npm run migrate:dev` | Apply pending migrations. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run typecheck` | Type-check without emitting. |

## Roadmap

- **Tier 1 — ISRC exact match.** *(Done.)*
- **Tier 2 — Fuzzy match.** Normalize artist/title/duration; assign recordings to works using version-tag rules (remaster groups with original; live, remix, sped-up, and feat. variants split off).
- **Tier 3 — Manual review queue.** Persist human decisions for low-confidence cases.
- **Works layer.** Group recordings into songs for charting (Phase 3 consumes this).
