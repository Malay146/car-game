import { create } from "zustand";
import { useGameStore } from "./store";
import type { WireResultEntry } from "../../realtime/protocol";

/** Server-authoritative finish list for the current online race (filled from `race:results`). */
interface OnlineResults {
  entries: WireResultEntry[];
  /** True once the server closed the race (everyone finished, or the straggler timeout hit). */
  over: boolean;
  set: (entries: WireResultEntry[], over: boolean) => void;
  clear: () => void;
}

export const useOnlineResults = create<OnlineResults>((set) => ({
  entries: [],
  over: false,
  set: (entries, over) => set({ entries, over }),
  clear: () => set({ entries: [], over: false }),
}));

/** Offline race clock: when the race went green and when each car finished. */
interface OfflineTimes {
  startAt: number | null;
  playerMs: number | null;
  botMs: number | null;
}

export const useOfflineTimes = create<OfflineTimes>(() => ({ startAt: null, playerMs: null, botMs: null }));

// Derive offline finish times from the game store so the store itself needs no timing code.
useGameStore.subscribe((s, prev) => {
  if (s.mode !== "offline") return;
  if (s.raceState === "racing" && prev.raceState !== "racing") {
    useOfflineTimes.setState({ startAt: performance.now(), playerMs: null, botMs: null });
    return;
  }
  const { startAt } = useOfflineTimes.getState();
  if (startAt === null) return;
  const elapsed = Math.round(performance.now() - startAt);
  if (s.player.finished && !prev.player.finished) useOfflineTimes.setState({ playerMs: elapsed });
  if (s.bot.finished && !prev.bot.finished) useOfflineTimes.setState({ botMs: elapsed });
});
