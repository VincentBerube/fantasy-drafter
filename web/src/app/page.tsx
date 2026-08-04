import PlayerBoard from "@/components/PlayerBoard";
import { mockPlayers } from "@/lib/mock-players";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-3 py-3">
        <h1 className="text-lg font-semibold text-gray-900">
          Draft Cheat Sheet
        </h1>
      </header>
      <PlayerBoard initialPlayers={mockPlayers} />
    </div>
  );
}
