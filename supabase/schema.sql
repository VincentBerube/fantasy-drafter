-- Fantasy draft cheat sheet: core schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh project.
--
-- Access model: single user, no auth (see fantasy_football_architecture_context.md, section 5).
-- RLS is enabled but policies grant full access to the `anon` role, since the app talks to
-- Supabase directly with the anon key and there is no login flow. Do not scope policies to
-- auth.uid() unless the access model changes.

create extension if not exists "pgcrypto";

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  position text not null check (position in ('QB', 'RB', 'WR', 'TE', 'K', 'DST')),
  team text,
  bye_week integer,
  overall_rank integer,
  tier integer,
  adp numeric(6, 2),
  last_season_rank integer,
  tags text[] not null default '{}',
  notes text not null default '',
  is_drafted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_position_idx on players (position);
create index if not exists players_tier_idx on players (tier);
create index if not exists players_overall_rank_idx on players (overall_rank);
create index if not exists players_is_drafted_idx on players (is_drafted);

-- Keep updated_at current on every edit (tier drag, tags, notes, is_drafted toggle, etc).
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists players_set_updated_at on players;
create trigger players_set_updated_at
  before update on players
  for each row
  execute function set_updated_at();

-- Row Level Security: open access for the anon key (single-user app, no auth).
alter table players enable row level security;

drop policy if exists "anon full access" on players;
create policy "anon full access" on players
  for all
  to anon
  using (true)
  with check (true);

-- Realtime: broadcast row changes (e.g. is_drafted toggles, tier edits) to all connected clients.
-- REPLICA IDENTITY FULL so UPDATE payloads include the full old row, not just the primary key.
alter table players replica identity full;
alter publication supabase_realtime add table players;
