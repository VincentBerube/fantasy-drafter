"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { supabase } from "@/lib/supabase";
import { Player, Position, POSITIONS } from "@/types/player";

function byRank(a: Player, b: Player) {
  return (a.overall_rank ?? Infinity) - (b.overall_rank ?? Infinity);
}

const TAG_STYLES: Record<string, string> = {
  Star: "bg-amber-100 text-amber-800",
  Target: "bg-emerald-100 text-emerald-800",
  Sleeper: "bg-sky-100 text-sky-800",
  Avoid: "bg-rose-100 text-rose-800",
};

function TagPill({ tag }: { tag: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        TAG_STYLES[tag] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {tag}
    </span>
  );
}

function TierDivider({ tier }: { tier: number | null }) {
  return (
    <div className="sticky top-0 z-10 mt-3 bg-gray-900 px-3 py-1 text-xs font-semibold tracking-wide text-white first:mt-0">
      TIER {tier ?? "—"}
    </div>
  );
}

export default function PlayerBoard({
  initialPlayers,
}: {
  initialPlayers: Player[];
}) {
  const [players, setPlayers] = useState(initialPlayers);
  const [positionFilter, setPositionFilter] = useState<Position | "ALL">(
    "ALL"
  );
  const [hideDrafted, setHideDrafted] = useState(false);

  // Mirrors the players table so other devices (or a re-run of the ingestion
  // pipeline) show up here live. Single-user app, no conflict handling — an
  // incoming row simply replaces local state for that id (see architecture doc).
  useEffect(() => {
    const channel = supabase
      .channel("players-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players" },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "DELETE") {
              const deletedId = (payload.old as Partial<Player>).id;
              return prev.filter((p) => p.id !== deletedId);
            }
            const incoming = payload.new as Player;
            const exists = prev.some((p) => p.id === incoming.id);
            const next = exists
              ? prev.map((p) => (p.id === incoming.id ? incoming : p))
              : [...prev, incoming];
            return next.sort(byRank);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Reordering only makes sense against the full, unfiltered list — otherwise a
  // drag's `index` refers to a position in the filtered subset, not the
  // underlying array, and there's no unambiguous way to map it back.
  const isReorderable = positionFilter === "ALL" && !hideDrafted;

  const visiblePlayers = useMemo(
    () =>
      players.filter(
        (p) =>
          (positionFilter === "ALL" || p.position === positionFilter) &&
          (!hideDrafted || !p.is_drafted)
      ),
    [players, positionFilter, hideDrafted]
  );

  function toggleDrafted(player: Player) {
    const is_drafted = !player.is_drafted;
    setPlayers((prev) =>
      prev.map((p) => (p.id === player.id ? { ...p, is_drafted } : p))
    );
    supabase
      .from("players")
      .update({ is_drafted })
      .eq("id", player.id)
      .then(({ error }) => {
        if (error) console.error("Failed to update is_drafted:", error);
      });
  }

  function handleDragEnd(result: DropResult) {
    if (!isReorderable || !result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;

    const next = [...players];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const reranked = next.map((p, i) => ({ ...p, overall_rank: i + 1 }));
    setPlayers(reranked);

    // Only ranks strictly between the old and new position actually changed.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const changed = reranked.slice(lo, hi + 1);
    Promise.all(
      changed.map((p) =>
        supabase
          .from("players")
          .update({ overall_rank: p.overall_rank })
          .eq("id", p.id)
      )
    ).then((results) => {
      const failed = results.filter((r) => r.error);
      if (failed.length > 0) console.error("Failed to persist ranks:", failed);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-3 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["ALL", ...POSITIONS] as const).map((pos) => (
          <button
            key={pos}
            onClick={() => setPositionFilter(pos)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              positionFilter === pos
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {pos}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={hideDrafted}
            onChange={(e) => setHideDrafted(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Hide drafted
        </label>
      </div>

      {!isReorderable && (
        <p className="mb-3 text-xs text-gray-500">
          Drag-to-reorder is disabled while filtering — switch to the ALL tab
          with &ldquo;Hide drafted&rdquo; off to re-rank.
        </p>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="players">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {visiblePlayers.map((player, index) => {
                const prevPlayer = visiblePlayers[index - 1];
                const showDivider =
                  !prevPlayer || prevPlayer.tier !== player.tier;

                return (
                  <Fragment key={player.id}>
                    {showDivider && <TierDivider tier={player.tier} />}
                    <Draggable
                      draggableId={player.id}
                      index={index}
                      isDragDisabled={!isReorderable}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center gap-3 border-b border-gray-100 bg-white px-3 py-2 ${
                            snapshot.isDragging ? "shadow-lg" : ""
                          } ${player.is_drafted ? "opacity-40" : ""}`}
                        >
                          <span
                            {...provided.dragHandleProps}
                            className={`text-gray-300 ${
                              isReorderable ? "cursor-grab" : "cursor-default"
                            }`}
                            aria-hidden
                          >
                            ⠿
                          </span>

                          <span className="w-8 shrink-0 text-sm font-semibold text-gray-400">
                            {player.overall_rank ?? "—"}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="truncate font-medium text-gray-900">
                                {player.player_name}
                              </span>
                              <span className="shrink-0 text-xs text-gray-500">
                                {player.position}
                                {player.team ? ` · ${player.team}` : ""}
                                {player.bye_week
                                  ? ` · BYE ${player.bye_week}`
                                  : ""}
                              </span>
                            </div>
                            {(player.tags.length > 0 || player.notes) && (
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {player.tags.map((tag) => (
                                  <TagPill key={tag} tag={tag} />
                                ))}
                                {player.notes && (
                                  <span
                                    className="truncate text-xs text-gray-500"
                                    title={player.notes}
                                  >
                                    {player.notes}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <span className="hidden w-14 shrink-0 text-right text-xs text-gray-500 sm:block">
                            ADP {player.adp?.toFixed(1) ?? "—"}
                          </span>

                          <button
                            onClick={() => toggleDrafted(player)}
                            className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${
                              player.is_drafted
                                ? "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                : "bg-gray-900 text-white hover:bg-gray-700"
                            }`}
                          >
                            {player.is_drafted ? "Undo" : "Draft"}
                          </button>
                        </div>
                      )}
                    </Draggable>
                  </Fragment>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
