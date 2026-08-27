# Data pipeline

Fetches your private ESPN league's draftable player pool and upserts it into the
Supabase `players` table. See `fantasy_football_architecture_context.md` (repo root)
for the full architecture and decisions behind this.

## Setup

```
cd data-pipeline
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
copy .env.example .env       # then fill in ESPN cookies, league id, and Supabase keys
```

Apply `supabase/schema.sql` to your Supabase project (SQL editor or `supabase db push`)
before the first run.

## Run

```
python ingest_espn.py               # fetch, cache locally, and upload to Supabase
python ingest_espn.py --skip-upload # fetch and cache locally only, no upload
```

Every run writes both a timestamped and a `_latest` copy of the raw ESPN response,
the bye-week lookup, and the transformed player records to `cache/` — so a local
backup always exists even if the Supabase upload fails or ESPN changes/breaks auth.
`cache/` is gitignored.

## Re-running during the season

Re-running is safe: players are upserted on `espn_player_id`, so existing rows are
updated in place rather than duplicated. Each run only sends
`espn_player_id`/`player_name`/`position`/`team`/`bye_week`/`overall_rank`/`adp`,
plus `tags` but *only* for players whose ESPN-reported injury status changed (adds/
removes just the `"Injured"` entry, leaving your other manual tags alone) —
`my_rank`, `tier`, and `is_drafted` are never included in the payload, so
PostgREST's upsert leaves whatever you've already set for them in the UI untouched.
New players get the table's defaults (`my_rank`/`tier` null, `tags` `'{}'`,
`is_drafted` `false`) on first insert. Notes live in a separate `player_notes`
table (see the app's detail modal) — this script never touches it.

There's also an **in-app version** of this refresh: a "Sync ESPN Data" button on
the deployed site (`web/src/app/api/sync/route.ts`) does the same rank/ADP/bye/
injury refresh without needing a terminal. It needs its own copy of the ESPN
cookies + Supabase service key as server-side env vars on Vercel (see the
architecture doc's implementation log for the full list). This CLI script is
still the tool to reach for if something looks wrong, though — it's the only one
that writes a local cache you can inspect.

## Backfilling last season's positional rank

```
python backfill_last_season_rank.py                # backfill for (ESPN_YEAR - 1)
python backfill_last_season_rank.py --season 2024   # backfill a specific season
python backfill_last_season_rank.py --skip-upload   # dry run, cache only
```

One-time/occasional, not part of the regular refresh — last season's results
don't change once the season's over. Fetches each player's ESPN-computed actual
PPR point total for the target season (via our own league's scoring context, not
guessed from raw stat categories) and ranks QB/RB/WR/TE separately by points to
populate `last_season_rank` (e.g. rank 1 at RB = "was the RB1"). K/DST are
skipped — different-enough scoring rules that it wasn't worth the complexity for
a reference stat. Only ever writes `last_season_rank` (plus `player_name`/
`position`, required by Supabase's upsert but not actually changing) — `my_rank`,
`tags`, `tier`, `is_drafted`, and notes are all untouched.
