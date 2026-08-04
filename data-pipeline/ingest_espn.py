"""ESPN private-league player ingestion for the draft cheat sheet.

Fetches the draftable player pool from ESPN's (undocumented) fantasy football API,
caches every stage of the data locally, and upserts the result into the Supabase
`players` table. The local cache is written BEFORE the Supabase upload, so a
working snapshot of the data always exists on disk even if the upload fails or
ESPN's API/auth breaks on draft day.

ESPN's endpoints here are not officially documented and can change shape without
notice. If a run produces fewer/emptier fields than expected, inspect the raw
JSON under cache/raw_players_latest.json rather than assuming this script is
correct — the field paths were reverse-engineered from observed responses.

Usage:
    python ingest_espn.py                # fetch, cache locally, and upsert to Supabase
    python ingest_espn.py --skip-upload   # fetch and cache locally only (dry run)
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

CACHE_DIR = Path(__file__).parent / "cache"

# defaultPositionId -> position abbreviation used in the players table.
POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST"}

# proTeamId -> team abbreviation. Stable NFL team IDs used by ESPN's fantasy API;
# update if a team relocates/rebrands.
PRO_TEAM_MAP = {
    0: None, 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL",
    7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV",
    14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
    20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
    26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL",
    34: "HOU",
}


def timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_cache(name: str, payload) -> None:
    """Write both a timestamped snapshot and a `latest` copy for `name`."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ts = timestamp()
    for filename in (f"{name}_{ts}.json", f"{name}_latest.json"):
        path = CACHE_DIR / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, default=str)
    print(f"  cached: {name}_latest.json (+ {name}_{ts}.json)")


def fetch_raw_players(league_id: str, year: str, espn_s2: str, swid: str, size: int = 1000) -> list:
    url = f"https://fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{league_id}"
    headers = {
        "x-fantasy-filter": json.dumps({
            "players": {
                "limit": size,
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "PPR"},
            }
        })
    }
    cookies = {"espn_s2": espn_s2, "SWID": swid}
    resp = requests.get(url, headers=headers, cookies=cookies, params={"view": "kona_player_info"}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get("players", [])


def fetch_bye_weeks(year: str) -> dict:
    """Best-effort team -> bye week lookup. Returns {} on any unexpected shape
    rather than raising, since bye_week is a nice-to-have, not critical."""
    url = f"https://site.api.espn.com/apis/fantasy/v2/games/ffl/seasons/{year}"
    try:
        resp = requests.get(url, params={"view": "proTeamSchedules"}, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        print(f"  warning: bye week fetch failed ({exc}); bye_week will be left null", file=sys.stderr)
        return {}

    teams = data.get("settings", {}).get("proTeams") or data.get("proTeams") or []
    bye_weeks = {}
    for team in teams:
        abbrev = team.get("abbrev")
        bye = team.get("byeWeek")
        if abbrev and bye:
            bye_weeks[abbrev.upper()] = bye

    if not bye_weeks:
        print("  warning: bye week response had an unexpected shape; bye_week will be left null", file=sys.stderr)
    return bye_weeks


def transform_player(raw: dict, bye_weeks: dict) -> dict | None:
    player = raw.get("player") or {}
    position = POSITION_MAP.get(player.get("defaultPositionId"))
    if position is None:
        return None  # not a rosterable fantasy position (e.g. IDP) — skip

    team = PRO_TEAM_MAP.get(player.get("proTeamId"))
    ranks = player.get("draftRanksByRankType") or {}
    ppr_rank = (ranks.get("PPR") or {}).get("rank")
    standard_rank = (ranks.get("STANDARD") or {}).get("rank")
    overall_rank = ppr_rank if ppr_rank is not None else standard_rank
    adp = (player.get("ownership") or {}).get("averageDraftPosition")
    espn_id = player.get("id") or raw.get("id")

    if not espn_id or not player.get("fullName"):
        return None

    # Deliberately omits tier/tags/notes/is_drafted: PostgREST's upsert only touches
    # columns present in the payload, so leaving these out means re-running the
    # pipeline mid-prep refreshes rank/adp/bye_week without clobbering anything the
    # user has already set in the UI. New rows still get sane defaults from the
    # table schema (tier null, tags '{}', notes '', is_drafted false).
    return {
        "espn_player_id": espn_id,
        "player_name": player["fullName"],
        "position": position,
        "team": team,
        "bye_week": bye_weeks.get(team) if team else None,
        "overall_rank": overall_rank,
        "adp": adp,
        # last_season_rank omitted for the same reason: not exposed by kona_player_info
        # (would need a separate historical pull), and omitting rather than sending None
        # avoids clobbering it if it's ever populated another way.
    }


def upsert_to_supabase(records: list) -> None:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_SERVICE_KEY not set — skipping upload.", file=sys.stderr)
        return

    client = create_client(url, key)
    client.table("players").upsert(records, on_conflict="espn_player_id").execute()
    print(f"  upserted {len(records)} players to Supabase")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-upload", action="store_true", help="fetch and cache locally only")
    parser.add_argument("--size", type=int, default=1000, help="max players to fetch from ESPN")
    args = parser.parse_args()

    load_dotenv(Path(__file__).parent / ".env")

    league_id = os.environ.get("ESPN_LEAGUE_ID")
    year = os.environ.get("ESPN_YEAR")
    espn_s2 = os.environ.get("ESPN_S2")
    swid = os.environ.get("SWID")

    missing = [k for k, v in {
        "ESPN_LEAGUE_ID": league_id, "ESPN_YEAR": year, "ESPN_S2": espn_s2, "SWID": swid,
    }.items() if not v]
    if missing:
        print(f"Missing required env vars: {', '.join(missing)}. Copy .env.example to .env and fill it in.", file=sys.stderr)
        sys.exit(1)

    print(f"Fetching player pool for league {league_id}, season {year}...")
    raw_players = fetch_raw_players(league_id, year, espn_s2, swid, size=args.size)
    print(f"  fetched {len(raw_players)} raw player records")
    write_cache("raw_players", raw_players)

    print("Fetching bye weeks...")
    bye_weeks = fetch_bye_weeks(year)
    write_cache("bye_weeks", bye_weeks)

    print("Transforming...")
    transformed = [transform_player(p, bye_weeks) for p in raw_players]
    transformed = [p for p in transformed if p is not None]
    skipped = len(raw_players) - len(transformed)
    print(f"  transformed {len(transformed)} players ({skipped} skipped: non-fantasy position or missing id/name)")
    write_cache("players", transformed)

    if args.skip_upload:
        print("Skipping Supabase upload (--skip-upload).")
        return

    print("Uploading to Supabase...")
    upsert_to_supabase(transformed)


if __name__ == "__main__":
    main()
