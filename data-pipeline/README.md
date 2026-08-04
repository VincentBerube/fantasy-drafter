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
`espn_player_id`/`player_name`/`position`/`team`/`bye_week`/`overall_rank`/`adp` —
`tier`, `tags`, `notes`, and `is_drafted` are never included in the payload, so
PostgREST's upsert leaves whatever you've already set for them in the UI untouched.
New players get the table's defaults (`tier` null, `tags` `'{}'`, `notes` `''`,
`is_drafted` `false`) on first insert.
