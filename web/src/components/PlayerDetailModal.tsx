"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Player, PlayerNote } from "@/types/player";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PlayerDetailModal({
  player,
  onClose,
}: {
  player: Player;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState<PlayerNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when switching to a different player, adjusted during render
  // (rather than in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const [loadedPlayerId, setLoadedPlayerId] = useState(player.id);
  if (player.id !== loadedPlayerId) {
    setLoadedPlayerId(player.id);
    setLoading(true);
    setNotes([]);
  }

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("player_notes")
      .select("*")
      .eq("player_id", player.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to load notes:", error);
        setNotes(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function addNote() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("player_notes")
      .insert({ player_id: player.id, content })
      .select()
      .single();
    setSaving(false);
    if (error) {
      console.error("Failed to add note:", error);
      return;
    }
    setNotes((prev) => [data as PlayerNote, ...prev]);
    setDraft("");
  }

  async function deleteNote(noteId: string) {
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    const { error } = await supabase
      .from("player_notes")
      .delete()
      .eq("id", noteId);
    if (error) console.error("Failed to delete note:", error);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {player.player_name}
            </h2>
            <p className="text-sm text-gray-500">
              {player.position}
              {player.team ? ` · ${player.team}` : ""}
              {player.bye_week ? ` · BYE ${player.bye_week}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-gray-100 px-4 py-3 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-gray-400">My Rank</div>
            <div className="font-medium text-gray-900">
              {player.my_rank ?? player.overall_rank ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">ESPN Rank</div>
            <div className="font-medium text-gray-900">
              {player.overall_rank ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">ADP</div>
            <div className="font-medium text-gray-900">
              {player.adp?.toFixed(1) ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Tier</div>
            <div className="font-medium text-gray-900">
              {player.tier ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Status</div>
            <div className="font-medium text-gray-900">
              {player.is_drafted ? "Drafted" : "Available"}
            </div>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <div className="text-xs text-gray-400">Tags</div>
            <div className="font-medium text-gray-900">
              {player.tags.length > 0 ? player.tags.join(", ") : "—"}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Notes
          </h3>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-gray-400">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="group flex items-start justify-between gap-2 rounded-md bg-gray-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-gray-800">{note.content}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatTimestamp(note.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteNote(note.id)}
                    aria-label="Delete note"
                    className="shrink-0 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-end gap-2 border-t border-gray-100 px-4 py-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                addNote();
              }
            }}
            placeholder="Add a note… (Enter to save, Shift+Enter for a new line)"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-gray-400"
          />
          <button
            onClick={addNote}
            disabled={saving || !draft.trim()}
            className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
