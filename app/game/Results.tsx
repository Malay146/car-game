"use client";

import { useGameStore } from "./store";
import { useOfflineTimes, useOnlineResults } from "./resultsStore";
import { leaveRoomNet } from "./net";

/** One line of the standings table. Any game mode can build a list of these and pass it to <Results>. */
export interface ResultRow {
  id: string;
  name: string;
  /** Swatch colour (car paint). */
  color: string;
  /** Total race time, or null if the racer has not finished. */
  timeMs: number | null;
  bestLapMs: number | null;
  /** Shown instead of the time when there is none ("Racing...", "DNF", ...). */
  note?: string;
}

export interface ResultAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

const ordinal = (n: number) => ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"][n - 1] ?? `${n}th`;

const primaryButton =
  "rounded-full bg-red-600 px-8 py-3 text-xl font-bold uppercase tracking-wide shadow-lg transition-transform hover:scale-105 hover:bg-red-500 disabled:opacity-50 disabled:hover:scale-100";
const secondaryButton =
  "rounded-full border border-white/40 px-6 py-2 text-base font-semibold hover:bg-white/10 disabled:opacity-50";

/**
 * Reusable standings overlay. Finished racers are ranked by time; everyone else follows in the
 * order given. The row whose id equals `selfId` is highlighted.
 */
export function Results({
  rows,
  selfId,
  title,
  subtitle,
  actions,
}: {
  rows: ResultRow[];
  selfId: string | null;
  title: string;
  subtitle?: string;
  actions: ResultAction[];
}) {
  const finished = rows.filter((r) => r.timeMs !== null).sort((a, b) => (a.timeMs as number) - (b.timeMs as number));
  const rest = rows.filter((r) => r.timeMs === null);
  const bestLap = Math.min(...rows.map((r) => r.bestLapMs ?? Infinity));

  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75 px-3">
      <h2 className="text-center text-3xl font-black sm:text-4xl">{title}</h2>
      {subtitle && <p className="text-sm text-zinc-300">{subtitle}</p>}
      <table className="w-full max-w-md border-separate border-spacing-y-1 text-left text-sm sm:text-base">
        <thead>
          <tr className="text-xs uppercase tracking-widest text-zinc-400">
            <th className="px-3 font-semibold">Pos</th>
            <th className="px-3 font-semibold">Driver</th>
            <th className="px-3 text-right font-semibold">Time</th>
            <th className="px-3 text-right font-semibold">Best lap</th>
          </tr>
        </thead>
        <tbody>
          {[...finished, ...rest].map((r, i) => {
            const mine = r.id === selfId;
            const pos = r.timeMs !== null ? i + 1 : null;
            return (
              <tr key={r.id} className={mine ? "bg-yellow-400/20 ring-1 ring-yellow-300/60" : "bg-white/10"}>
                <td className="rounded-l-md px-3 py-2 font-black">{pos ?? "-"}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-white/50" style={{ background: r.color }} />
                    <span className="truncate">
                      {r.name}
                      {mine ? " (you)" : ""}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {r.timeMs !== null ? formatMs(r.timeMs) : <span className="text-zinc-400">{r.note ?? "-"}</span>}
                </td>
                <td
                  className={`rounded-r-md px-3 py-2 text-right font-mono tabular-nums ${
                    r.bestLapMs !== null && r.bestLapMs === bestLap ? "text-purple-300" : ""
                  }`}
                >
                  {formatMs(r.bestLapMs)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {actions.map((a) => (
          <button key={a.label} className={a.primary ? primaryButton : secondaryButton} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The finished-race overlay: server-authoritative standings online, player vs bot offline. */
export function RaceResults() {
  const mode = useGameStore((s) => s.mode);
  const myId = useGameStore((s) => s.myId);
  const roomPlayers = useGameStore((s) => s.roomPlayers);
  const player = useGameStore((s) => s.player);
  const profile = useGameStore((s) => s.profile);
  const reset = useGameStore((s) => s.reset);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const startOffline = useGameStore((s) => s.startOffline);
  const entries = useOnlineResults((s) => s.entries);
  const over = useOnlineResults((s) => s.over);
  const offline = useOfflineTimes();

  if (mode === "online") {
    const rows: ResultRow[] = entries.map((e) => ({ id: e.id, name: e.name, color: e.paint, timeMs: e.timeMs, bestLapMs: e.bestLapMs }));
    for (const p of roomPlayers) {
      if (entries.some((e) => e.id === p.id)) continue;
      rows.push({
        id: p.id,
        name: p.name,
        color: p.paint,
        timeMs: null,
        bestLapMs: null,
        note: over ? "DNF" : p.offline ? "Reconnecting..." : "Racing...",
      });
    }
    const myPlace = entries.findIndex((e) => e.id === myId) + 1;
    const title = myPlace > 0 ? `You finished ${ordinal(myPlace)}` : "Finished";
    const pending = rows.filter((r) => r.timeMs === null).length;
    return (
      <Results
        rows={rows}
        selfId={myId}
        title={title.toUpperCase()}
        subtitle={over ? "Final standings" : pending > 0 ? `Waiting for ${pending} more...` : undefined}
        actions={[
          { label: "Back to lobby", onClick: reset, primary: true },
          {
            label: "Leave room",
            onClick: () => {
              leaveRoomNet();
              leaveRoom();
            },
          },
        ]}
      />
    );
  }

  const playerWon = player.place === 1;
  const rows: ResultRow[] = [
    {
      id: "me",
      name: profile.name || "Player",
      color: profile.paint,
      timeMs: player.finished ? offline.playerMs : null,
      bestLapMs: player.bestLapTime !== null ? Math.round(player.bestLapTime * 1000) : null,
      note: "DNF",
    },
    { id: "bot", name: "Bot", color: "#f2c14e", timeMs: offline.botMs, bestLapMs: null, note: "DNF" },
  ];
  return (
    <Results
      rows={rows}
      selfId="me"
      title={playerWon ? "YOU WIN" : "BOT WINS"}
      actions={[
        { label: "Race again", onClick: startOffline, primary: true },
        { label: "Main menu", onClick: reset },
      ]}
    />
  );
}
