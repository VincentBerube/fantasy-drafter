"""One-time/occasional backfill of last_season_rank (positional finish, e.g.
"RB1") from ESPN's actual season stat totals.

Unlike ingest_espn.py, this isn't meant to run every prep session — last
season's results don't change once the season is over (barring rare ESPN
stat corrections), so there's no reason to hit ESPN for this on every sync.
Run it once, or again later only if you want to double check a correction.

How it works: ESPN doesn't expose a "positional rank" field directly, but
each player has a season-total actual-points entry (statSourceId=0,
scoringPeriodId=0) with an `appliedTotal` — the real PPR point total ESPN
itself computed, using the querying league's scoring settings. Fetching that
through our own PPR league (rather than a leagueless endpoint, which returns
appliedTotal=null with no scoring context attached) gives real, ESPN-computed
point totals — confirmed against known 2025 results before building this
(e.g. Christian McCaffrey: 416.6 pts, RB1) rather than reverse-engineering
ESPN's raw per-category stat IDs ourselves, which would risk silently wrong
numbers if a category were mapped incorrectly.

Scope: QB/RB/WR/TE only. K/DST scoring (distance-based field goals,
points-allowed brackets) is enough of a different animal that it wasn't
worth the extra complexity for a "who was RB1 last year" reference stat.

Usage:
    python backfill_last_season_rank.py                # backfill for (ESPN_YEAR - 1) and upload
    python backfill_last_season_rank.py --season 2024   # backfill a specific season instead
    python backfill_last_season_rank.py --skip-upload   # fetch and cache locally only (dry run)
"""

import argparse
import json
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv

from ingest_espn import API_HOST, BROWSER_HEADERS, POSITION_MAP, write_cache

RANKABLE_POSITIONS = {"QB", "RB", "WR", "TE"}


def fetch_players_with_stats(
    league_id: str, current_year: str, espn_s2: str, swid: str, size: int = 1000
) -> list:
    """Fetches the player pool through our own league (not the leagueless
    endpoint) so ESPN computes appliedTotal against real PPR scoring rules.
    Queried against the *current* league year — kona_playercard includes each
    player's stats across seasons, not just the current one."""
    url = f"https://{API_HOST}/apis/v3/games/ffl/seasons/{current_year}/segments/0/leagues/{league_id}"
    headers = {
        **BROWSER_HEADERS,
        "x-fantasy-filter": json.dumps({
            "players": {
                "limit": size,
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "PPR"},
            }
        }),
    }
    cookies = {"espn_s2": espn_s2, "SWID": swid}
    resp = requests.get(
        url,
        headers=headers,
        cookies=cookies,
        params={"view": ["kona_player_info", "kona_playercard"]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("players", [])


def extract_season_total(raw_player: dict, season: int) -> float | None:
    for s in raw_player.get("stats", []):
        if (
            s.get("seasonId") == season
            and s.get("scoringPeriodId") == 0
            and s.get("statSourceId") == 0
        ):
            return s.get("appliedTotal")
    return None


def compute_ranks(raw_players: list, season: int) -> list:
    """Returns [{espn_player_id, player_name, position, points, rank}, ...]
    for QB/RB/WR/TE players with a real season total, ranked within position."""
    by_position: dict[str, list[dict]] = {}
    for raw in raw_players:
        player = raw.get("player") or {}
        position = POSITION_MAP.get(player.get("defaultPositionId"))
        if position not in RANKABLE_POSITIONS:
            continue
        points = extract_season_total(player, season)
        if points is None:
            continue
        espn_id = player.get("id")
        full_name = player.get("fullName")
        if not espn_id or not full_name:
            continue
        by_position.setdefault(position, []).append({
            "espn_player_id": espn_id,
            "player_name": full_name,
            "position": position,
            "points": points,
        })

    ranked = []
    for position, players in by_position.items():
        players.sort(key=lambda p: p["points"], reverse=True)
        for i, p in enumerate(players, start=1):
            ranked.append({**p, "last_season_rank": i})
    return ranked


def upsert_to_supabase(records: list) -> None:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping upload.", file=sys.stderr)
        return

    client = create_client(url, key)
    # player_name/position ride along even though they're not changing:
    # supabase.upsert() is INSERT ... ON CONFLICT DO UPDATE, and Postgres
    # validates NOT NULL columns even for a row that will hit the update
    # branch (see PlayerBoard.tsx's toggleTierBreak for where this was first
    # hit) — a {espn_player_id, last_season_rank}-only payload would 400.
    payload = [
        {
            "espn_player_id": r["espn_player_id"],
            "player_name": r["player_name"],
            "position": r["position"],
            "last_season_rank": r["last_season_rank"],
        }
        for r in records
    ]
    client.table("players").upsert(payload, on_conflict="espn_player_id").execute()
    print(f"  upserted last_season_rank for {len(payload)} players")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None, help="season to backfill (default: ESPN_YEAR - 1)")
    parser.add_argument("--skip-upload", action="store_true", help="fetch and cache locally only")
    args = parser.parse_args()

    load_dotenv(Path(__file__).parent / ".env")

    league_id = os.environ.get("ESPN_LEAGUE_ID")
    current_year = os.environ.get("ESPN_YEAR")
    espn_s2 = os.environ.get("ESPN_S2")
    swid = os.environ.get("SWID")

    missing = [k for k, v in {
        "ESPN_LEAGUE_ID": league_id, "ESPN_YEAR": current_year, "ESPN_S2": espn_s2, "SWID": swid,
    }.items() if not v]
    if missing:
        print(f"Missing required env vars: {', '.join(missing)}. Copy .env.example to .env and fill it in.", file=sys.stderr)
        sys.exit(1)

    season = args.season or (int(current_year) - 1)

    print(f"Fetching player pool + stats via league {league_id} (queried as season {current_year})...")
    raw_players = fetch_players_with_stats(league_id, current_year, espn_s2, swid)
    print(f"  fetched {len(raw_players)} raw player records")
    write_cache("raw_players_with_stats", raw_players)

    print(f"Computing {season} positional ranks (QB/RB/WR/TE only)...")
    ranked = compute_ranks(raw_players, season)
    by_pos_count: dict[str, int] = {}
    for r in ranked:
        by_pos_count[r["position"]] = by_pos_count.get(r["position"], 0) + 1
    print(f"  ranked {len(ranked)} players: {by_pos_count}")
    write_cache("last_season_ranks", ranked)

    if args.skip_upload:
        print("Skipping Supabase upload (--skip-upload).")
        return

    print("Uploading to Supabase...")
    upsert_to_supabase(ranked)


if __name__ == "__main__":
    main()
