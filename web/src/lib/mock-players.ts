import { Player } from "@/types/player";

// Placeholder data for building the UI before the ESPN pipeline is wired up to
// Supabase. Shape matches the `players` table in supabase/schema.sql exactly,
// so swapping this for a live Supabase query later is a drop-in replacement.
export const mockPlayers: Player[] = [
  { id: "1", player_name: "Ja'Marr Chase", position: "WR", team: "CIN", bye_week: 10, overall_rank: 1, tier: 1, adp: 1.2, last_season_rank: 2, tags: ["Star"], notes: "Locked in as WR1.", is_drafted: false },
  { id: "2", player_name: "Bijan Robinson", position: "RB", team: "ATL", bye_week: 5, overall_rank: 2, tier: 1, adp: 2.1, last_season_rank: 4, tags: ["Star"], notes: "", is_drafted: false },
  { id: "3", player_name: "CeeDee Lamb", position: "WR", team: "DAL", bye_week: 7, overall_rank: 3, tier: 1, adp: 3.4, last_season_rank: 1, tags: [], notes: "", is_drafted: false },
  { id: "4", player_name: "Christian McCaffrey", position: "RB", team: "SF", bye_week: 14, overall_rank: 4, tier: 1, adp: 4.8, last_season_rank: 12, tags: ["Target"], notes: "Injury risk but ceiling is unmatched.", is_drafted: false },
  { id: "5", player_name: "Amon-Ra St. Brown", position: "WR", team: "DET", bye_week: 8, overall_rank: 5, tier: 2, adp: 5.6, last_season_rank: 5, tags: [], notes: "", is_drafted: true },
  { id: "6", player_name: "Breece Hall", position: "RB", team: "NYJ", bye_week: 12, overall_rank: 6, tier: 2, adp: 6.3, last_season_rank: 9, tags: ["Sleeper"], notes: "", is_drafted: false },
  { id: "7", player_name: "Puka Nacua", position: "WR", team: "LAR", bye_week: 6, overall_rank: 7, tier: 2, adp: 8.1, last_season_rank: 3, tags: [], notes: "", is_drafted: false },
  { id: "8", player_name: "Jahmyr Gibbs", position: "RB", team: "DET", bye_week: 8, overall_rank: 8, tier: 2, adp: 7.9, last_season_rank: 15, tags: ["Target"], notes: "", is_drafted: false },
  { id: "9", player_name: "Patrick Mahomes", position: "QB", team: "KC", bye_week: 6, overall_rank: 9, tier: 3, adp: 22.5, last_season_rank: 6, tags: [], notes: "QB1 but not worth reaching for.", is_drafted: false },
  { id: "10", player_name: "Sam LaPorta", position: "TE", team: "DET", bye_week: 8, overall_rank: 10, tier: 3, adp: 18.2, last_season_rank: 2, tags: [], notes: "", is_drafted: false },
  { id: "11", player_name: "Travis Kelce", position: "TE", team: "KC", bye_week: 6, overall_rank: 11, tier: 3, adp: 19.7, last_season_rank: 8, tags: ["Avoid"], notes: "Age cliff concerns.", is_drafted: false },
  { id: "12", player_name: "Josh Allen", position: "QB", team: "BUF", bye_week: 12, overall_rank: 12, tier: 3, adp: 24.9, last_season_rank: 1, tags: ["Star"], notes: "", is_drafted: false },
  { id: "13", player_name: "Justin Tucker", position: "K", team: "BAL", bye_week: 13, overall_rank: 14, tier: 4, adp: 145.3, last_season_rank: 3, tags: [], notes: "", is_drafted: false },
  { id: "14", player_name: "San Francisco", position: "DST", team: "SF", bye_week: 14, overall_rank: 15, tier: 4, adp: 138.6, last_season_rank: 5, tags: [], notes: "", is_drafted: false },
  { id: "15", player_name: "Rashee Rice", position: "WR", team: "KC", bye_week: 6, overall_rank: 13, tier: 4, adp: 40.2, last_season_rank: null, tags: ["Sleeper"], notes: "Suspension watch.", is_drafted: false },
];
