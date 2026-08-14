"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DropResult,
} from "@hello-pangea/dnd";
import { supabase } from "@/lib/supabase";
import { Player, PlayerNote, Position, POSITIONS } from "@/types/player";
import PlayerDetailModal from "@/components/PlayerDetailModal";

const PAGE_SIZE = 100;

function effectiveRank(p: Player): number {
  return p.my_rank ?? p.overall_rank ?? Infinity;
}

function byRank(a: Player, b: Player) {
  const diff = effectiveRank(a) - effectiveRank(b);
  if (diff !== 0) return diff;
  return (a.overall_rank ?? Infinity) - (b.overall_rank ?? Infinity);
}

// "Injured" is manually toggleable like the others, but the ingestion
// pipeline also sets/clears it automatically from ESPN's injury data on each
// run (see ingest_espn.py) — a manual add/remove here can be overwritten by
// the next pipeline run if ESPN's status disagrees.
const ALL_TAGS = ["Star", "Target", "Sleeper", "Avoid", "Injured"];

const TAG_STYLES: Record<string, string> = {
  Star: "bg-amber-100 text-amber-800",
  Target: "bg-emerald-100 text-emerald-800",
  Sleeper: "bg-sky-100 text-sky-800",
  Avoid: "bg-rose-100 text-rose-800",
  Injured: "bg-red-100 text-red-800",
};

function TagPill({
  tag,
  onRemove,
}: {
  tag: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        TAG_STYLES[tag] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {tag}
      <button
        onClick={onRemove}
        aria-label={`Remove ${tag}`}
        className="leading-none opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </span>
  );
}

function TagPicker({
  player,
  onToggleTag,
}: {
  player: Player;
  onToggleTag: (player: Player, tag: string) => void;
}) {
  const available = ALL_TAGS.filter((t) => !player.tags.includes(t));
  if (available.length === 0) return null;

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-600 [&::-webkit-details-marker]:hidden">
        + Tag
      </summary>
      <div className="absolute z-20 mt-1 flex flex-col gap-0.5 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
        {available.map((tag) => (
          <button
            key={tag}
            onClick={() => onToggleTag(player, tag)}
            className="whitespace-nowrap rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100"
          >
            {tag}
          </button>
        ))}
      </div>
    </details>
  );
}

function TierDivider({ tier }: { tier: number | null }) {
  return (
    <div className="sticky top-0 z-10 mt-3 bg-gray-900 px-3 py-1 text-xs font-semibold tracking-wide text-white first:mt-0">
      TIER {tier ?? "—"}
    </div>
  );
}

const PlayerRow = memo(function PlayerRow({
  player,
  index,
  isDragDisabled,
  onToggleDrafted,
  onToggleTag,
  onSelect,
}: {
  player: Player;
  index: number;
  isDragDisabled: boolean;
  onToggleDrafted: (player: Player) => void;
  onToggleTag: (player: Player, tag: string) => void;
  onSelect: (player: Player) => void;
}) {
  return (
    <Draggable
      draggableId={player.id}
      index={index}
      isDragDisabled={isDragDisabled}
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
              isDragDisabled ? "cursor-default" : "cursor-grab"
            }`}
            aria-hidden
          >
            ⠿
          </span>

          <span
            className="w-8 shrink-0 text-sm font-semibold text-gray-400"
            title="Your rank"
          >
            {player.my_rank ?? player.overall_rank ?? "—"}
          </span>

          <div className="min-w-0 flex-1">
            <button
              onClick={() => onSelect(player)}
              className="flex flex-wrap items-baseline gap-x-2 text-left hover:underline"
            >
              <span className="truncate font-medium text-gray-900">
                {player.player_name}
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {player.position}
                {player.team ? ` · ${player.team}` : ""}
                {player.bye_week ? ` · BYE ${player.bye_week}` : ""}
              </span>
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {player.tags.map((tag) => (
                <TagPill
                  key={tag}
                  tag={tag}
                  onRemove={() => onToggleTag(player, tag)}
                />
              ))}
              <TagPicker player={player} onToggleTag={onToggleTag} />
              {player.note_count > 0 && (
                <button
                  onClick={() => onSelect(player)}
                  title={`${player.note_count} note${
                    player.note_count === 1 ? "" : "s"
                  }`}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  📝 {player.note_count}
                </button>
              )}
            </div>
          </div>

          <span
            className="hidden w-28 shrink-0 text-right text-xs text-gray-500 sm:block"
            title="ESPN's imported rank and ADP — reference only, unaffected by your drag order"
          >
            ESPN #{player.overall_rank ?? "—"} · {player.adp?.toFixed(1) ?? "—"}
          </span>

          <button
            onClick={() => onToggleDrafted(player)}
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
  );
});

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
  const [page, setPage] = useState(1);

  // Mirrors the players table so other devices (or a re-run of the ingestion
  // pipeline) show up here live. Single-user app, no conflict handling — an
  // incoming row replaces local state for that id, aside from the derived
  // note_count field which is merged in separately (see architecture doc).
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
            // note_count isn't a real players column (it's a PostgREST
            // embedded count computed at initial fetch time), so a raw
            // realtime payload won't include it — carry the existing value
            // forward instead of letting it get wiped out on every edit.
            const incoming = payload.new as Player;
            const existing = prev.find((p) => p.id === incoming.id);
            const merged = {
              ...incoming,
              note_count: existing?.note_count ?? 0,
            };
            const next = existing
              ? prev.map((p) => (p.id === merged.id ? merged : p))
              : [...prev, merged];
            return next.sort(byRank);
          });
        }
      )
      // player_notes changes don't touch the players row itself, so they need
      // their own listener to keep each row's note_count badge live across
      // devices (e.g. add a note on your phone, see the count update here).
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "player_notes" },
        (payload) => {
          const playerId = (payload.new as PlayerNote).player_id;
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === playerId ? { ...p, note_count: p.note_count + 1 } : p
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "player_notes" },
        (payload) => {
          const playerId = (payload.old as Partial<PlayerNote>).player_id;
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === playerId
                ? { ...p, note_count: Math.max(0, p.note_count - 1) }
                : p
            )
          );
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

  // Large lists (1000+ rows) make both re-render and drag-and-drop noticeably
  // laggy, and a smaller tab like DST (~30 players) was visibly snappier —
  // paginating keeps the rendered/draggable set small regardless of filter.
  const totalPages = Math.max(1, Math.ceil(visiblePlayers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOffset = (currentPage - 1) * PAGE_SIZE;
  const pagePlayers = useMemo(
    () => visiblePlayers.slice(pageOffset, pageOffset + PAGE_SIZE),
    [visiblePlayers, pageOffset]
  );

  // Reset to page 1 whenever the filter changes, so switching tabs never
  // strands you on a now-out-of-range page. Adjusting state during render
  // (rather than in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const filterKey = `${positionFilter}|${hideDrafted}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const toggleDrafted = useCallback((player: Player) => {
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
  }, []);

  const toggleTag = useCallback((player: Player, tag: string) => {
    const tags = player.tags.includes(tag)
      ? player.tags.filter((t) => t !== tag)
      : [...player.tags, tag];
    setPlayers((prev) =>
      prev.map((p) => (p.id === player.id ? { ...p, tags } : p))
    );
    supabase
      .from("players")
      .update({ tags })
      .eq("id", player.id)
      .then(({ error }) => {
        if (error) console.error("Failed to update tags:", error);
      });
  }, []);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    null
  );
  // Look up by id each render rather than storing the player object, so the
  // modal reflects live updates (e.g. a tag change from another device)
  // instead of a frozen snapshot from when it was opened.
  const selectedPlayer =
    players.find((p) => p.id === selectedPlayerId) ?? null;

  const selectPlayer = useCallback((player: Player) => {
    setSelectedPlayerId(player.id);
  }, []);

  function handleDragEnd(result: DropResult) {
    if (!isReorderable || !result.destination) return;
    // Local (in-page) indices -> global indices into the full players array,
    // since only the current page's slice is rendered as Draggables.
    const from = pageOffset + result.source.index;
    const to = pageOffset + result.destination.index;
    if (from === to) return;

    const next = [...players];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Drag only ever sets my_rank — overall_rank stays ESPN's untouched
    // reference value, safe to refresh on the next ingestion run.
    const reranked = next.map((p, i) => ({ ...p, my_rank: i + 1 }));
    setPlayers(reranked);

    // Only ranks strictly between the old and new position actually changed.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const changed = reranked.slice(lo, hi + 1);
    Promise.all(
      changed.map((p) =>
        supabase.from("players").update({ my_rank: p.my_rank }).eq("id", p.id)
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

      <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
        <span>
          {visiblePlayers.length === 0
            ? "No players"
            : `Showing ${pageOffset + 1}–${Math.min(
                pageOffset + PAGE_SIZE,
                visiblePlayers.length
              )} of ${visiblePlayers.length}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30"
            >
              Prev
            </button>
            <span>
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="rounded px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
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
              {pagePlayers.map((player, index) => {
                const prevPlayer = pagePlayers[index - 1];
                const showDivider =
                  !prevPlayer || prevPlayer.tier !== player.tier;

                return (
                  <Fragment key={player.id}>
                    {showDivider && <TierDivider tier={player.tier} />}
                    <PlayerRow
                      player={player}
                      index={index}
                      isDragDisabled={!isReorderable}
                      onToggleDrafted={toggleDrafted}
                      onToggleTag={toggleTag}
                      onSelect={selectPlayer}
                    />
                  </Fragment>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {selectedPlayer && (
        <PlayerDetailModal
          player={selectedPlayer}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}
