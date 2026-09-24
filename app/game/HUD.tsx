"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "./store";
import { startAudio } from "./AudioManager";
import { changeRoomMap, createRoom, joinRoom, leaveRoomNet, requestStart } from "./net";
import { MapCarousel } from "./MapCarousel";
import { Minimap } from "./Minimap";
import { WeatherBadge, WeatherPicker, resetWeatherToMapDefault } from "./WeatherPicker";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

const ordinal = (n: number) => ["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`;

const primaryButton =
  "rounded-full bg-red-600 px-8 py-3 text-xl font-bold uppercase tracking-wide shadow-lg transition-transform hover:scale-105 hover:bg-red-500 disabled:opacity-50 disabled:hover:scale-100";
const secondaryButton =
  "rounded-full border border-white/40 px-6 py-2 text-base font-semibold hover:bg-white/10 disabled:opacity-50";

function Toast() {
  const notice = useGameStore((s) => s.notice);
  const [shownId, setShownId] = useState(0);
  useEffect(() => {
    if (!notice) return;
    const show = setTimeout(() => setShownId(notice.id), 0);
    const hide = setTimeout(() => setShownId(0), 1500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [notice]);
  if (!notice || shownId !== notice.id) return null;
  return (
    <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/65 px-5 py-2 text-lg font-black tracking-wide backdrop-blur-sm">
      {notice.text}
    </div>
  );
}

function Menu() {
  const startOffline = useGameStore((s) => s.startOffline);
  const mapId = useGameStore((s) => s.mapId);
  const selectMap = useGameStore((s) => s.selectMap);
  const profile = useGameStore((s) => s.profile);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totalLaps = useGameStore((s) => s.totalLaps);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startAudio();
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Could not connect");
    } catch {
      setError("Could not connect to the server");
    }
    setBusy(false);
  };

  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/70">
      <h1 className="text-5xl font-black tracking-tight drop-shadow-lg">CHAOS CIRCUIT</h1>
      <p className="max-w-md text-center text-zinc-300">
        WASD / arrows to drive, Space to brake, Shift to handbrake-drift, E to boost, F to flip the car upright, R to return to your last checkpoint. {totalLaps} laps.
      </p>
      <MapCarousel
        value={mapId}
        onChange={(id) => {
          selectMap(id);
          resetWeatherToMapDefault();
        }}
      />
      <WeatherPicker />
      <button
        className={primaryButton}
        onClick={() => {
          startAudio();
          startOffline();
        }}
      >
        Play vs Bot
      </button>
      <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 p-4">
        <button className={secondaryButton} disabled={busy} onClick={() => run(() => createRoom(profile, mapId))}>
          Create online room
        </button>
        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="CODE"
            className="w-24 rounded-md bg-black/50 px-3 py-2 text-center font-mono text-lg tracking-widest outline-none ring-1 ring-white/30 focus:ring-white/70"
          />
          <button
            className={secondaryButton}
            disabled={busy || joinCode.length !== 4}
            onClick={() => run(() => joinRoom(joinCode, profile))}
          >
            Join
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function Lobby() {
  const roomCode = useGameStore((s) => s.roomCode);
  const roomPlayers = useGameStore((s) => s.roomPlayers);
  const myId = useGameStore((s) => s.myId);
  const hostId = useGameStore((s) => s.hostId);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const mapId = useGameStore((s) => s.mapId);
  const selectMap = useGameStore((s) => s.selectMap);
  const isHost = myId !== null && myId === hostId;

  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
      <p className="text-sm uppercase tracking-widest text-zinc-400">Room code</p>
      <p className="font-mono text-6xl font-black tracking-[0.3em]">{roomCode}</p>
      <MapCarousel
        value={mapId}
        readOnly={!isHost}
        onChange={(id) => {
          selectMap(id);
          changeRoomMap(id);
          resetWeatherToMapDefault();
        }}
      />
      <WeatherPicker readOnly={!isHost} />
      <p className="text-zinc-300">Share this code with friends (up to 4 players).</p>
      <p className="max-w-sm text-center text-xs text-zinc-400">
        Testing on one computer? Use two separate browser windows side by side. A background tab pauses its game, so that player looks frozen.
      </p>
      <ul className="w-64 space-y-1">
        {roomPlayers.map((p, i) => (
          <li key={p.id} className="flex justify-between rounded-md bg-white/10 px-3 py-2">
            <span>
              {p.name} {i + 1}
              {p.id === myId ? " (you)" : ""}
            </span>
            {p.id === hostId && <span className="text-xs text-yellow-400">HOST</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button className={primaryButton} disabled={roomPlayers.length < 2} onClick={requestStart}>
          {roomPlayers.length < 2 ? "Waiting for players" : "Start Race"}
        </button>
      ) : (
        <p className="text-zinc-300">Waiting for the host to start...</p>
      )}
      <button
        className={secondaryButton}
        onClick={() => {
          leaveRoomNet();
          leaveRoom();
        }}
      >
        Leave room
      </button>
    </div>
  );
}

export function HUD() {
  const phase = useGameStore((s) => s.phase);
  const mode = useGameStore((s) => s.mode);
  const raceState = useGameStore((s) => s.raceState);
  const countdownValue = useGameStore((s) => s.countdownValue);
  const muted = useGameStore((s) => s.muted);
  const player = useGameStore((s) => s.player);
  const bot = useGameStore((s) => s.bot);
  const totalLaps = useGameStore((s) => s.totalLaps);
  const toggleMuted = useGameStore((s) => s.toggleMuted);
  const reset = useGameStore((s) => s.reset);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const item = useGameStore((s) => s.item);

  const playing = phase === "playing";
  const online = mode === "online";

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-white">
      {phase === "menu" && <Menu />}
      {phase === "lobby" && <Lobby />}

      {playing && raceState === "countdown" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-8xl font-black drop-shadow-lg">{countdownValue}</span>
        </div>
      )}

      {playing && raceState === "racing" && (
        <>
          <div className="absolute left-4 top-4 rounded-lg bg-black/60 px-4 py-3 backdrop-blur-sm">
            <div className="text-sm text-zinc-300">
              Lap {Math.min(player.lap + 1, totalLaps)} / {totalLaps}
            </div>
            <div className="font-mono text-2xl tabular-nums">{formatTime(player.lapTime)}</div>
            {player.bestLapTime !== null && (
              <div className="text-xs text-zinc-400">Best {formatTime(player.bestLapTime)}</div>
            )}
            {!online && (
              <div className="mt-1 text-xs text-zinc-400">Bot lap {Math.min(bot.lap + 1, totalLaps)}</div>
            )}
            <WeatherBadge />
          </div>

          <Minimap />
          <Toast />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[11px] text-white/70">F: flip car upright · R: back to checkpoint · E: boost</div>

          <div className="absolute bottom-6 left-1/2 flex h-20 w-32 -translate-x-1/2 flex-col items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm">
            <div className="text-xs uppercase tracking-widest text-zinc-400">Item</div>
            <div className="text-xl font-black uppercase">
              {item ? "Boost" : "-"}
            </div>
            {item && <div className="text-xs text-zinc-300">press E</div>}
          </div>

          <div className="absolute bottom-6 right-6 text-right">
            <div className="font-mono text-4xl font-bold tabular-nums drop-shadow-lg">
              {Math.round(player.speedKmh)}
            </div>
            <div className="text-xs tracking-widest text-zinc-300">KM/H</div>
            <div className="mt-1 h-4 text-xs font-bold tracking-widest text-orange-300">
              {player.boosting ? "BOOST" : ""}
            </div>
          </div>
        </>
      )}

      {playing && raceState === "finished" && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/75">
          <h2 className="text-4xl font-black">
            {player.place === null
              ? "FINISHED"
              : online
                ? `YOU FINISHED ${ordinal(player.place).toUpperCase()}`
                : player.place === 1
                  ? "YOU WIN"
                  : "BOT WINS"}
          </h2>
          {player.bestLapTime !== null && (
            <p className="text-zinc-300">Best lap: {formatTime(player.bestLapTime)}</p>
          )}
          <button className={primaryButton} onClick={reset}>
            {online ? "Back to lobby" : "Race again"}
          </button>
          {online && (
            <button
              className={secondaryButton}
              onClick={() => {
                leaveRoomNet();
                leaveRoom();
              }}
            >
              Leave room
            </button>
          )}
        </div>
      )}

      <button
        onClick={toggleMuted}
        className="pointer-events-auto absolute right-4 top-4 rounded-full bg-black/40 px-3 py-2 text-sm backdrop-blur-sm hover:bg-black/60"
      >
        {muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
