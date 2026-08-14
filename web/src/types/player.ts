export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";

export interface Player {
  id: string;
  player_name: string;
  position: Position;
  team: string | null;
  bye_week: number | null;
  overall_rank: number | null;
  my_rank: number | null;
  tier: number | null;
  adp: number | null;
  last_season_rank: number | null;
  tags: string[];
  is_drafted: boolean;
}

export type NoteColor = "gray" | "red" | "green";

export interface PlayerNote {
  id: string;
  player_id: string;
  content: string;
  color: NoteColor;
  created_at: string;
}

export const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
