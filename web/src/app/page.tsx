import PlayerBoard from "@/components/PlayerBoard";
import { supabase } from "@/lib/supabase";

// Draft state changes constantly (rank edits, drafted toggles) — never
// statically cache this route.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("my_rank", { ascending: true, nullsFirst: false })
    .order("overall_rank", { ascending: true, nullsFirst: false });

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
        <PlayerBoard initialPlayers={data ?? []} />
      )}
    </div>
  );
}
