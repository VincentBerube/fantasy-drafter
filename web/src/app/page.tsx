import PlayerBoard from "@/components/PlayerBoard";
import { supabase } from "@/lib/supabase";
import { Player } from "@/types/player";

// Draft state changes constantly (rank edits, drafted toggles) — never
// statically cache this route.
export const dynamic = "force-dynamic";

export default async function Home() {
  // player_notes(count) is a PostgREST embedded aggregate over the FK
  // relationship — no join/extra query needed to show a note count per row.
  const { data, error } = await supabase
    .from("players")
    .select("*, player_notes(count)")
    .order("my_rank", { ascending: true, nullsFirst: false })
    .order("overall_rank", { ascending: true, nullsFirst: false });

  const players: Player[] = (data ?? []).map((row) => {
    const { player_notes, ...player } = row as typeof row & {
      player_notes: { count: number }[];
    };
    return { ...player, note_count: player_notes[0]?.count ?? 0 };
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3">
        <h1 className="text-lg font-semibold text-gray-900">
          Draft Cheat Sheet
        </h1>
      </header>
      {error ? (
        <p className="px-3 py-4 text-sm text-red-600">
          Failed to load players: {error.message}
        </p>
      ) : (
        <PlayerBoard initialPlayers={players} />
      )}
    </div>
  );
}
