# SYSTEM CONTEXT: Custom NFL Fantasy Football Cheat Sheet App

## 1. PROJECT OVERVIEW
- **Goal**: Build a personalized, responsive web application for managing a Fantasy Football draft cheat sheet.
- **Target Platforms**: Cross-platform web app (Desktop & Mobile) with real-time state synchronization.
- **Core Features**: Drag-and-drop tiering, custom player tags (sleeper/target/avoid), expert/personal notes, ADP tracking, and real-time draft status synchronization.
- **Format & Scoring**: Standard snake draft (non-auction), PPR (Points Per Reception).
- **Core Differentiator**: Total control over player rankings and data presentation, free from the constraints of standard platform UIs (e.g., ESPN, Draft Wizard).

## 2. TECHNOLOGY STACK
- **Frontend**: Next.js (React), Tailwind CSS, `@hello-pangea/dnd` for drag-and-drop interactions.
- **Backend/Database**: Supabase (PostgreSQL) leveraging its native Real-time WebSocket API.
- **Data Pipeline**: Python (`requests`, `pandas`, `supabase-py`).
- **Hosting/Deployment**: Vercel (Frontend), Supabase Cloud (Backend).
- **Cost Constraint**: Architecture strictly utilizes free-tier services.

## 3. ARCHITECTURE & COMPONENT BREAKDOWN

### A. Data Ingestion Pipeline (Pre-Draft)
- **Role**: Disconnected from the live app to prevent API rate-limiting or authentication breakage during the draft.
- **Process**: A local Python script authenticates with ESPN (using wrappers like `espn-api` or cookies) or parses generic CSV player lists.
- **Transformation**: Maps external data to the internal schema, calculates "Last Season Positional Rank" (LPR), and formats Average Draft Position (ADP).
- **Output**: Bulk uploads/upserts the curated list to the Supabase database.

### B. Database Schema (Supabase / PostgreSQL)
**Table**: `players`
- `id` (UUID, Primary Key)
- `player_name` (String)
- `position` (String: QB, RB, WR, TE, K, DST)
- `team` (String)
- `bye_week` (Integer)
- `overall_rank` (Integer) - *Used for default baseline sorting*
- `tier` (Integer) - *For visual grouping in the UI*
- `adp` (Decimal)
- `last_season_rank` (Integer)
- `tags` (Array of Strings) - *e.g., ['Target', 'Avoid', 'Star']*
- `notes` (Text)
- `is_drafted` (Boolean, Default: false)

### C. Real-Time Synchronization Mechanism (Draft Day)
- **Problem Solved**: Seamlessly updating the PC browser view when a user marks a player as "Drafted" on their mobile phone.
- **Flow**: 
  1. Next.js client establishes a WebSocket connection to the Supabase `players` table on page load.
  2. Mobile user taps "Draft" on a player row.
  3. Client fires a `PATCH` request updating `is_drafted` to `true`.
  4. Supabase detects the row change and instantly broadcasts a payload to all connected clients.
  5. The PC Desktop client receives the payload and updates the React state to hide or gray out the player instantly.

## 4. UI/UX REQUIREMENTS
- **Visual Design**: Data-dense, clean tabular layout inspired by Draft Wizard.
- **Desktop UI**: Row-based table grouped by user-defined Tiers. 
- **Mobile UI**: Condensed list prioritizing readability and quick tap actions.
- **Navigation**: Top-level positional filtering tabs (`[All]`, `[QB]`, `[RB]`, `[WR]`, `[TE]`, `[K]`, `[DST]`).
- **Core Interactions**: 
  - Manual "Hide Drafted" toggle.
  - "Draft" quick-action button per row.
  - Drag-and-drop to reorder ranks manually.

## 5. LOCKED-IN DECISIONS (do not re-litigate without explicit user request)
These were decided during planning on 2026-08-04 and constrain implementation choices below.

- **Access model**: Single user, no auth system. Multiple devices (phone/laptop) are used concurrently only during the pre-draft prep phase to edit tiers/notes; during the live draft, only one device is active at a time (switch to backup only on failure). No login flow, no per-user RLS — RLS on `players` should just allow the anon/service key used by the app.
- **League settings**: Hardcoded, not stored in a settings table. 12-team league, standard roster composition (QB/RB/RB/WR/WR/TE/FLEX/K/DST + bench), standard PPR scoring (1 pt/reception, 4pt passing TD, 6pt rush/rec TD, no TE premium or other wrinkles). If multi-league support is ever wanted, that's a deliberate future scope change.
- **Conflict handling**: None. Last-write-wins via Supabase realtime is acceptable — do not add optimistic locking, versioning, or merge logic.
- **ESPN data source**: The league is a **private** ESPN league, so the ingestion script authenticates via `espn_s2` / `SWID` cookies (read from local env vars, never hardcoded/committed). On every run, the script must write a local cached copy of the fetched player data (JSON or CSV under a gitignored local dir) *before/alongside* upserting to Supabase, so a working data snapshot always exists independent of the DB or ESPN's API availability.

## 6. IMPLEMENTATION LOG
Keep this section current as work lands — it's the fastest way for an AI agent resuming this project to know what already exists vs. what's still planned. Update the status and add a dated bullet under a step when it's completed, including file paths touched.

- [x] **Database Setup** — `supabase/schema.sql`: `players` table, updated_at trigger, open anon RLS policy, realtime publication. (2026-08-04) Applied to the live Supabase project (ref `gptghbdkwssqcsdddqrl`) on 2026-08-13 via the SQL editor; verified read+write through the publishable/anon key with a throwaway insert/delete.
- [x] **Data Pipeline** — `data-pipeline/ingest_espn.py`: fetches ESPN's undocumented `kona_player_info` endpoint via espn_s2/SWID cookies, caches raw + transformed data to `data-pipeline/cache/` (gitignored) before uploading, upserts to Supabase on `espn_player_id` with a partial payload so manual tier/tags/notes/is_drafted edits survive re-runs. `last_season_rank` is not populated (ESPN endpoint doesn't expose it — left null, needs a separate historical-stats source if wanted later). (2026-08-13) Ran successfully against the user's real private league (id `1810877938`, season 2026 — the league doesn't exist for prior seasons, it's new this year) and upserted 1000 real players into Supabase; verified via the running app. Two fixes were needed vs. the original guess, both now baked into the script: (1) ESPN's edge blocks requests without browser-like headers (`BROWSER_HEADERS` constant: User-Agent/Accept/Referer/x-fantasy-source) — without them every request 302s to the generic fantasy homepage regardless of cookie validity; (2) private-league API reads live on `lm-api-reads.fantasy.espn.com`, not `fantasy.espn.com` (`API_HOST` constant) — the old host 302s even with valid cookies and correct headers. If ESPN changes this again, capture a real request from Chrome's Network tab and diff against `BROWSER_HEADERS`/`API_HOST`.
- [x] **Frontend Scaffold** — `web/`: Next.js 16 (App Router, TypeScript, Turbopack) + Tailwind v4, scaffolded via `create-next-app`. `web/src/components/PlayerBoard.tsx` renders live player data with position filter tabs, hide-drafted toggle, per-player Draft/Undo button, and tier divider headers computed from consecutive rows. Verified with `tsc --noEmit`, `next lint`, `next build`, and a `next dev` smoke check.
- [x] **Drag-and-drop tiering (partial)** — `@hello-pangea/dnd` wired in `PlayerBoard.tsx` for manual rank reordering, but only in the unfiltered "ALL / show drafted" view — reordering is disabled while a position filter or hide-drafted is active, since a filtered index can't be unambiguously mapped back to the full list. Dragging a player does **not** currently change its `tier` value (only its rank/position in the list) — cross-tier drag-to-retier is still open.
- [x] **Real-time sync** — (2026-08-13) `page.tsx` (Server Component, `dynamic = "force-dynamic"`) fetches the initial player list from Supabase via `web/src/lib/supabase.ts`; `PlayerBoard` subscribes to `postgres_changes` on the `players` table and merges INSERT/UPDATE/DELETE events into local state. `toggleDrafted` and drag-reorder both write through to Supabase (optimistic local update + `.update()` call, errors logged to console, no rollback — consistent with the "no conflict handling" decision). Verified end-to-end against the live project: seeded rows via the REST API, confirmed SSR render picked them up, then cleaned up. Not yet verified with two real browser tabs open simultaneously — worth a manual check before relying on it during actual prep.
- [x] **`my_rank` vs `overall_rank` split** — (2026-08-14) `overall_rank` (ESPN's imported rank, refreshed every ingestion run) and the user's personal manual rank were conflated in one field, meaning drag-reorder was silently overwritable by a future pipeline re-run. Added a separate `my_rank` column (`supabase/schema.sql`, migration block). Sort order is `my_rank` with `overall_rank` as fallback (SSR query in `page.tsx` and client-side `byRank` in `PlayerBoard.tsx`); drag-and-drop only ever writes `my_rank`. UI shows the user's rank as the big draggable number and ESPN's rank + ADP as a small reference label. User ran the migration and confirmed it's working live.
- [x] **Performance: pagination + row memoization** — (2026-08-14) The 1000-player ALL view was "super laggy" on hide-drafted toggle, draft button, and drag-and-drop, while smaller tabs (DST, ~30 players) felt fine — rendered/draggable row count was the bottleneck. `PlayerBoard.tsx` paginates at 100/page (Prev/Next, resets to page 1 on filter change) and extracts row rendering into a `React.memo`'d `PlayerRow` so an unrelated state change (e.g. toggling one player's `is_drafted`) doesn't re-render every other row. Drag reorder accounts for the page offset when mapping local Draggable index back to the global array. User confirmed it feels fine now.
- [x] **DST "rank changes" report — resolved, keep in mind if it recurs** — (2026-08-14) User saw a DST row's big rank number showing another, unrelated player's rank (e.g. Colts D/ST displaying Tyler Loop's/a kicker's rank value) while browsing the DST tab. Verified via direct Supabase queries that stored `my_rank`/`overall_rank` data was correct and consistent — not a data or sort bug. Traced the component logic: `player.my_rank` and `player.player_name` are always read from the same object in the same render, so a same-row mismatch isn't reachable from the code as written. Concluded it was a stale React Fast Refresh artifact from hot-reloading a structurally-rewritten component (`PlayerRow` extraction) combined with `@hello-pangea/dnd`'s DOM manipulation — a known weak spot for HMR. Fixed by killing the dev server, clearing `.next`, restarting clean, and a hard browser refresh; user confirmed it's gone. Should not occur in production (no HMR there); if something like this shows up again outside of active development, it's a real bug worth re-investigating from scratch.
- [x] **Mobile-responsive layout (partial)** — single responsive row (`PlayerBoard.tsx`) reflows via Tailwind utilities rather than two separate desktop-table/mobile-card layouts; ADP column hides below `sm`. Not yet tested on an actual mobile viewport/device — only build/type-check verified.
- [x] **Tag editing** — (2026-08-14) `PlayerBoard.tsx` adds `TagPicker` (a `<details>`-based dropdown listing the 4 preset tags — `Star`/`Target`/`Sleeper`/`Avoid` — not yet on the player) and `TagPill` now has a remove ("×") button; both write through `toggleTag` (optimistic update + Supabase `.update()`). Tag vocabulary is currently fixed to the 4 presets — no free-text custom tags yet. Verified end-to-end against the live table.
- [x] **Player detail modal + multi-note system** — (2026-08-14) Superseded the single inline notes field (which lived on the row) with a click-the-player-row modal (`web/src/components/PlayerDetailModal.tsx`), per user request: "move the note system inside the player" + support multiple notes + room for more data fields later. The `players.notes` text column is **dropped** (schema.sql migration block — user needs to run it; no real note data existed yet, confirmed with the user before dropping rather than migrating) and replaced with a `player_notes` table (`player_id` FK with `on delete cascade`, `content`, `created_at`; open anon RLS + realtime enabled like `players`, though the modal doesn't currently subscribe to realtime for notes — it fetches fresh on open, which is enough for the single-viewer-at-a-time modal use case). The modal shows all current player fields (my rank, ESPN rank, ADP, tier, drafted status, tags — read-only here, tags still edited from the row) plus a chronological (newest-first) note list with add/delete, Enter-to-save. `PlayerRow`'s name/position block is now a button that opens the modal (`onSelect`, `useCallback`-wrapped to preserve `React.memo` on `PlayerRow`). Migration run and verified live (insert/select/delete round-tripped through the REST API). **The user has since added a real note through the UI** ("This a new super note!" on one player) — `player_notes` now holds real data, same caution as `players` applies: don't reset/drop this table casually without checking first.
- [x] **Note color coding** — (2026-08-14) User request: gray (default) / red (bad) / green (good) per note, for quick visual scanning. Added `color` column to `player_notes` (schema.sql migration block, `check` constrained to the 3 values). `PlayerDetailModal.tsx`: new notes get a 3-swatch color picker above the compose box (defaults to gray); existing notes show a colored left border + a clickable dot that cycles gray → green → red → gray, writing through immediately. No realtime subscription for color changes, same as the rest of the note system.
- [ ] **Search bar** — requested but not yet designed/built. Needs a decision on scope: filter-as-you-type on `player_name` only, or also match `team`/`tags`; and whether it composes with the position-tab filter or replaces it while active.
- [x] **Note count badge on row** — (2026-08-14) User wanted to see if a player has notes without opening the modal. Uses PostgREST's embedded-count feature — `page.tsx`'s query is `select("*, player_notes(count)")`, no schema change or extra query needed — reshaped into a flat `note_count` on `Player` (`page.tsx`). Shown as a "📝 N" badge on the row (only when >0) that also opens the modal, same as clicking the name. Caveat found and fixed while building this: `note_count` isn't a real `players` column, so a raw realtime `players` UPDATE payload (e.g. a tag change) doesn't include it — the realtime handler in `PlayerBoard.tsx` now explicitly carries the existing `note_count` forward when merging incoming payloads, and has its own `player_notes` INSERT/DELETE listeners to keep the badge live across devices.
- [x] **Injury tag (auto-populated, manually overridable)** — (2026-08-14) User's decision, overriding my initial recommendation to keep it a separate pipeline-only field: they wanted it mixed into the existing manual tag system, addable/removable like Star/Target/Sleeper/Avoid. `ingest_espn.py` now captures `player.injured` (boolean, already present in the `kona_player_info` response — no new API calls) and, in `upsert_to_supabase()`, fetches each existing player's current `tags` first and adds/removes only the `"Injured"` entry, leaving every other manual tag untouched (`compute_tag_updates()`, unit-tested for add/preserve/remove/no-op before running live). **Real bug hit and fixed during this build**: PostgREST's bulk upsert builds one SQL statement from the union of keys across the whole batch, so mixing records that include `tags` with records that omit it sent literal `NULL` for the omitters and violated the not-null constraint — the first live run failed (cleanly rolled back, verified no partial writes) until the upsert was split into two homogeneous batches (changed vs. unchanged). Re-run succeeded: 19 players correctly auto-tagged `Injured`; a player with pre-existing manual tags was confirmed untouched. `"Injured"` also added to `ALL_TAGS`/`TAG_STYLES` in `PlayerBoard.tsx` so it's manually toggleable from the row's tag picker — note that a manual add/remove can be reverted by the next pipeline run if ESPN's status disagrees, and there's a narrow race window (documented in code) between the pipeline's tag-read and tag-write where a concurrent manual edit could be overwritten, accepted per the project's no-conflict-handling stance.
- [ ] **Deployment** — Vercel project connected to this repo, env vars configured.
