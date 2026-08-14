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
- [x] **Drag-and-drop tiering (partial)** — `@hello-pangea/dnd` wired in `PlayerBoard.tsx` for manual rank reordering (updates `overall_rank` to match new position, persisted to Supabase), but only in the unfiltered "ALL / show drafted" view — reordering is disabled while a position filter or hide-drafted is active, since a filtered index can't be unambiguously mapped back to the full list. Dragging a player does **not** currently change its `tier` value (only its rank/position in the list) — cross-tier drag-to-retier is still open.
- [x] **Real-time sync** — (2026-08-13) `page.tsx` (Server Component, `dynamic = "force-dynamic"`) fetches the initial player list from Supabase via `web/src/lib/supabase.ts`; `PlayerBoard` subscribes to `postgres_changes` on the `players` table and merges INSERT/UPDATE/DELETE events into local state, sorted by `overall_rank`. `toggleDrafted` and drag-reorder both write through to Supabase (optimistic local update + `.update()` call, errors logged to console, no rollback — consistent with the "no conflict handling" decision). Verified end-to-end against the live project: seeded rows via the REST API, confirmed SSR render picked them up, then cleaned up. Not yet verified with two real browser tabs open simultaneously — worth a manual check before relying on it during actual prep.
- [x] **Mobile-responsive layout (partial)** — single responsive row (`PlayerBoard.tsx`) reflows via Tailwind utilities rather than two separate desktop-table/mobile-card layouts; ADP column hides below `sm`. Not yet tested on an actual mobile viewport/device — only build/type-check verified.
- [ ] **Deployment** — Vercel project connected to this repo, env vars configured.
