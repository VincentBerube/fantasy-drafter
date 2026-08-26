import { getSupabaseAdmin } from "@/lib/supabase-admin";

// TypeScript port of data-pipeline/ingest_espn.py's fetch + transform +
// injured-tag logic, so the same refresh can run as a button on the deployed
// site instead of only from a local terminal. Deliberately narrower than the
// Python script in one way: no local cache file (Vercel's filesystem isn't
// persistent), so there's no on-disk snapshot to fall back on if ESPN's
// response shape ever breaks — the CLI script remains the tool to reach for
// when debugging a bad response, this route is for routine refreshes.
//
// Keep this in sync with data-pipeline/ingest_espn.py if ESPN's API changes
// (host, headers, or response shape) — see that file's comments for the
// history of what's been needed to keep requests from being blocked.

export const maxDuration = 60;

const POSITION_MAP: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

const PRO_TEAM_MAP: Record<number, string | null> = {
  0: null, 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL",
  7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV",
  14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG",
  20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF",
  26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL",
  34: "HOU",
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://fantasy.espn.com/",
  "x-fantasy-source": "kona",
};

const API_HOST = "lm-api-reads.fantasy.espn.com";

interface TransformedPlayer {
  espn_player_id: number;
  player_name: string;
  position: string;
  team: string | null;
  bye_week: number | null;
  overall_rank: number | null;
  adp: number | null;
  injured: boolean;
}

async function fetchRawPlayers(
  leagueId: string,
  year: string,
  espnS2: string,
  swid: string,
  size = 1000
): Promise<unknown[]> {
  const url = `https://${API_HOST}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${leagueId}?view=kona_player_info`;
  const resp = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`,
      "x-fantasy-filter": JSON.stringify({
        players: {
          limit: size,
          sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "PPR" },
        },
      }),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    throw new Error(`ESPN player fetch failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return data.players ?? [];
}

// Best-effort team -> bye week lookup, same as the Python version — this
// endpoint has been flakier than the player-pool one, so failures here don't
// abort the whole sync, they just leave bye_week null for everyone.
async function fetchByeWeeks(
  year: string,
  espnS2: string,
  swid: string
): Promise<Record<string, number>> {
  try {
    const url = `https://${API_HOST}/apis/v3/games/ffl/seasons/${year}?view=proTeamSchedules`;
    const resp = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    const teams: unknown[] = data?.settings?.proTeams ?? data?.proTeams ?? [];
    const byeWeeks: Record<string, number> = {};
    for (const team of teams) {
      const t = team as { abbrev?: string; byeWeek?: number };
      if (t.abbrev && t.byeWeek) byeWeeks[t.abbrev.toUpperCase()] = t.byeWeek;
    }
    return byeWeeks;
  } catch {
    return {};
  }
}

function transformPlayer(
  raw: unknown,
  byeWeeks: Record<string, number>
): TransformedPlayer | null {
  const r = raw as { player?: Record<string, unknown>; id?: number };
  const player = r.player ?? {};
  const position = POSITION_MAP[player.defaultPositionId as number];
  if (!position) return null; // not a rosterable fantasy position (e.g. IDP)

  const team = PRO_TEAM_MAP[player.proTeamId as number] ?? null;
  const ranks =
    (player.draftRanksByRankType as Record<
      string,
      { rank?: number } | undefined
    >) ?? {};
  const overallRank = ranks.PPR?.rank ?? ranks.STANDARD?.rank ?? null;
  const adp =
    (player.ownership as { averageDraftPosition?: number } | undefined)
      ?.averageDraftPosition ?? null;
  const espnId = (player.id as number | undefined) ?? r.id;
  const fullName = player.fullName as string | undefined;

  if (!espnId || !fullName) return null;

  return {
    espn_player_id: espnId,
    player_name: fullName,
    position,
    team,
    bye_week: team ? (byeWeeks[team] ?? null) : null,
    overall_rank: overallRank,
    adp,
    injured: Boolean(player.injured),
  };
}

type UpsertRecord = Omit<TransformedPlayer, "injured"> & { tags?: string[] };

// Merges each player's ESPN-derived injury flag into their existing tags,
// adding/removing only "Injured" so manually-set tags (Star/Target/Sleeper/
// Avoid/Rookie/Longshot) are left alone. `tags` is only included in a record
// when it actually needs to change, so unrelated rows aren't touched.
function computeTagUpdates(
  records: TransformedPlayer[],
  currentTags: Map<number, string[]>
): UpsertRecord[] {
  return records.map(({ injured, ...rest }) => {
    const existing = currentTags.get(rest.espn_player_id) ?? [];
    const tags = [...existing];
    const hasInjured = tags.includes("Injured");
    if (injured && !hasInjured) tags.push("Injured");
    else if (!injured && hasInjured) tags.splice(tags.indexOf("Injured"), 1);

    if (tags.length !== existing.length || tags.some((t, i) => t !== existing[i])) {
      return { ...rest, tags };
    }
    return rest;
  });
}

export async function POST() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const year = process.env.ESPN_YEAR;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.SWID;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  const missing = Object.entries({
    ESPN_LEAGUE_ID: leagueId,
    ESPN_YEAR: year,
    ESPN_S2: espnS2,
    SWID: swid,
    SUPABASE_SERVICE_KEY: serviceKey,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing env vars: ${missing.join(", ")}` },
      { status: 500 }
    );
  }

  let rawPlayers: unknown[];
  try {
    rawPlayers = await fetchRawPlayers(leagueId!, year!, espnS2!, swid!);
  } catch (err) {
    return Response.json(
      { error: `ESPN fetch failed: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  const byeWeeks = await fetchByeWeeks(year!, espnS2!, swid!);

  const transformed = rawPlayers
    .map((p) => transformPlayer(p, byeWeeks))
    .filter((p): p is TransformedPlayer => p !== null);

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existingRows, error: fetchError } = await supabaseAdmin
    .from("players")
    .select("espn_player_id, tags")
    .not("espn_player_id", "is", null);

  if (fetchError) {
    return Response.json(
      { error: `Failed to read current tags: ${fetchError.message}` },
      { status: 500 }
    );
  }

  const currentTags = new Map<number, string[]>(
    (existingRows ?? []).map((r) => [
      r.espn_player_id as number,
      (r.tags as string[]) ?? [],
    ])
  );

  const records = computeTagUpdates(transformed, currentTags);
  // Same reason as ingest_espn.py: PostgREST's bulk upsert derives its
  // column set from the union of keys across the batch, so mixing records
  // with/without `tags` sends literal NULLs for the ones missing it.
  const withTags = records.filter((r): r is UpsertRecord & { tags: string[] } => "tags" in r);
  const withoutTags = records.filter((r) => !("tags" in r));

  if (withTags.length > 0) {
    const { error } = await supabaseAdmin
      .from("players")
      .upsert(withTags, { onConflict: "espn_player_id" });
    if (error) {
      return Response.json(
        { error: `Upsert (tag changes) failed: ${error.message}` },
        { status: 500 }
      );
    }
  }
  if (withoutTags.length > 0) {
    const { error } = await supabaseAdmin
      .from("players")
      .upsert(withoutTags, { onConflict: "espn_player_id" });
    if (error) {
      return Response.json(
        { error: `Upsert failed: ${error.message}` },
        { status: 500 }
      );
    }
  }

  return Response.json({
    synced: transformed.length,
    injuredChanges: withTags.length,
  });
}
