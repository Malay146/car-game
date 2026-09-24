import { create } from "zustand";
import { DEFAULT_MAP_ID, getMap } from "./maps";
import { setActiveMap } from "./trackPath";

export type RaceState = "countdown" | "racing" | "finished";
export type Phase = "menu" | "lobby" | "playing";
export type Mode = "offline" | "online";
export type Item = "boost";

interface Telemetry {
  speedKmh: number;
  rpm: number; // normalized 0..1
  slip: number; // normalized 0..1, drives tire screech + HUD drift indicator
  throttle?: number;
  boosting?: boolean;
}

interface RoomPlayer {
  id: string;
  name: string;
  carId: string;
  paint: string;
  /** Connection dropped; the seat is held for a reconnect. */
  offline?: boolean;
}

export interface PlayerProfile {
  name: string;
  carId: string;
  paint: string;
}

interface GameStore {
  phase: Phase;
  mode: Mode;
  mapId: string;
  selectMap: (id: string) => void;
  /** The local player's chosen name, car model id and paint colour. */
  profile: PlayerProfile;
  setProfile: (p: Partial<PlayerProfile>) => void;
  raceId: number; // bumped on every (re)start so the 3D scene remounts fresh cars
  raceState: RaceState;
  countdownValue: number;
  muted: boolean;

  roomCode: string | null;
  myId: string | null;
  hostId: string | null;
  roomPlayers: RoomPlayer[];

  player: Telemetry & {
    lap: number;
    lapTime: number;
    bestLapTime: number | null;
    finished: boolean;
    place: number | null;
  };
  bot: {
    lap: number;
    finished: boolean;
  };

  totalLaps: number;
  notice: { text: string; id: number } | null;
  flash: (text: string) => void;
  item: Item | null;
  setItem: (item: Item | null) => void;

  toggleMuted: () => void;
  setPlayerTelemetry: (t: Telemetry) => void;
  setPlayerLapTime: (t: number) => void;
  incrementPlayerLap: (lapTime: number) => void;
  incrementBotLap: () => void;
  finishRace: (who: "player" | "bot") => void;

  startOffline: () => void;
  enterRoom: (code: string, id: string, players: RoomPlayer[], hostId: string, mapId: string, options?: Record<string, string>) => void;
  setRoomPlayers: (players: RoomPlayer[], hostId: string, mapId?: string, options?: Record<string, string>) => void;
  /** Race options (weather, time of day, mode, laps, ...). Online they are synced from the host. */
  options: Record<string, string>;
  setOption: (key: string, value: string) => void;
  beginOnlineRace: () => void;
  setOnlineResults: (order: string[]) => void;
  leaveRoom: () => void;
  reset: () => void;
}

const initialTelemetry: Telemetry = { speedKmh: 0, rpm: 0, slip: 0 };

const freshRace = () => ({
  raceState: "countdown" as RaceState,
  countdownValue: 3,
  player: {
    ...initialTelemetry,
    lap: 0,
    lapTime: 0,
    bestLapTime: null as number | null,
    finished: false,
    place: null as number | null,
  },
  bot: { lap: 0, finished: false },
  item: null as Item | null,
});

let countdownTimer: ReturnType<typeof setInterval> | null = null;

export const useGameStore = create<GameStore>((set, get) => {
  const runCountdown = () => {
    if (countdownTimer) clearInterval(countdownTimer);
    let n = 3;
    set({ countdownValue: n, raceState: "countdown" });
    countdownTimer = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        set({ raceState: "racing" });
      } else {
        set({ countdownValue: n });
      }
    }, 800);
  };

  return {
    phase: "menu",
    mode: "offline",
    mapId: DEFAULT_MAP_ID,
    options: {},
    setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
    profile: { name: "Player", carId: "race", paint: "#e0322f" },
    setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
    selectMap: (id) => {
      const mapId = getMap(id).id;
      setActiveMap(mapId);
      set({ mapId });
    },
    raceId: 0,
    ...freshRace(),
    muted: false,

    roomCode: null,
    myId: null,
    hostId: null,
    roomPlayers: [],

    totalLaps: 3,
    setItem: (item) => set({ item }),
    notice: null,
    flash: (text) => set((s) => ({ notice: { text, id: (s.notice?.id ?? 0) + 1 } })),

    toggleMuted: () => set((s) => ({ muted: !s.muted })),

    setPlayerTelemetry: (t) => set((s) => ({ player: { ...s.player, ...t } })),
    setPlayerLapTime: (lapTime) => set((s) => ({ player: { ...s.player, lapTime } })),

    incrementPlayerLap: (lapTime) =>
      set((s) => {
        const lap = s.player.lap + 1;
        const bestLapTime =
          s.player.bestLapTime === null ? lapTime : Math.min(s.player.bestLapTime, lapTime);
        return { player: { ...s.player, lap, lapTime: 0, bestLapTime } };
      }),

    incrementBotLap: () => set((s) => ({ bot: { ...s.bot, lap: s.bot.lap + 1 } })),

    finishRace: (who) =>
      set((s) => {
        if (who === "player" && s.player.finished) return s;
        if (who === "bot" && s.bot.finished) return s;
        const online = s.mode === "online";
        const someoneAlreadyFinished = s.player.finished || s.bot.finished;

        const player =
          who === "player"
            ? {
                ...s.player,
                finished: true,
                place: online ? s.player.place : someoneAlreadyFinished ? 2 : 1,
              }
            : !online && !s.player.finished
              ? { ...s.player, place: 2 }
              : s.player;
        const bot = who === "bot" ? { ...s.bot, finished: true } : s.bot;
        // Offline the race ends when anyone finishes; online each player finishes on their own.
        const raceState: RaceState =
          online ? (player.finished ? "finished" : s.raceState) : player.finished || bot.finished ? "finished" : s.raceState;

        return { player, bot, raceState };
      }),

    startOffline: () => {
      set({ mode: "offline", phase: "playing", raceId: get().raceId + 1, ...freshRace() });
      runCountdown();
    },

    enterRoom: (roomCode, myId, roomPlayers, hostId, mapId, options) => {
      setActiveMap(mapId);
      set({
        options: options ?? {},
        mapId: getMap(mapId).id,
        mode: "online",
        phase: "lobby",
        roomCode,
        myId,
        roomPlayers,
        hostId,
        raceId: get().raceId + 1,
        ...freshRace(),
      });
    },

    setRoomPlayers: (roomPlayers, hostId, mapId, options) => {
      const opt = options ? { options } : {};
      if (mapId && mapId !== get().mapId) {
        setActiveMap(mapId);
        set({ roomPlayers, hostId, mapId: getMap(mapId).id, raceId: get().raceId + 1, ...opt });
      } else {
        set({ roomPlayers, hostId, ...opt });
      }
    },

    beginOnlineRace: () => {
      set({ mode: "online", phase: "playing", raceId: get().raceId + 1, ...freshRace() });
      runCountdown();
    },

    setOnlineResults: (order) =>
      set((s) => {
        const idx = s.myId ? order.indexOf(s.myId) : -1;
        return idx >= 0 ? { player: { ...s.player, place: idx + 1 } } : s;
      }),

    leaveRoom: () => {
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
      set({
        mode: "offline",
        phase: "menu",
        roomCode: null,
        myId: null,
        hostId: null,
        roomPlayers: [],
        raceId: get().raceId + 1,
        ...freshRace(),
      });
    },

    // "Race again": back to the lobby when online, back to the menu when offline.
    reset: () => {
      if (countdownTimer) clearInterval(countdownTimer);
      countdownTimer = null;
      set({
        phase: get().mode === "online" ? "lobby" : "menu",
        raceId: get().raceId + 1,
        ...freshRace(),
      });
    },
  };
});
