"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "./store";
import { startAudio } from "./AudioManager";
import { changeRoomMap, createRoom, joinRoom, leaveRoomNet, requestStart } from "./net";
import { MapCarousel } from "./MapCarousel";
import { Minimap } from "./Minimap";
import { Garage } from "./Garage";
import { ProfileSync } from "./ProfileSync";
import { SpeedFx } from "./SpeedFx";
import { getCar } from "./cars";
import { WeatherBadge, WeatherPicker, resetWeatherToMapDefault } from "./WeatherPicker";
import { SettingsButton, SettingsPanel } from "./SettingsPanel";
import { TouchControls } from "./TouchControls";
import { FpsCounter } from "./FpsCounter";
import { LoadingScreen, useSceneLoading } from "./LoadingScreen";
import { ControlsHint, FullscreenButton, RotateHint } from "./HudWidgets";
import { useShowTouchControls } from "./deviceInfo";
import { keyLabel, useBindings } from "./bindings";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

const ordinal = (n: number) => ["1st", "2nd", "3rd", "4th"][n - 1] ?? `${n}th`;

const primaryButton =
  "min-h-12 rounded-full bg-red-600 px-8 py-3 text-xl font-bold uppercase tracking-wide shadow-lg transition-transform hover:scale-105 hover:bg-red-500 disabled:opacity-50 disabled:hover:scale-100 short:py-2 short:text-lg";
const secondaryButton =
  "min-h-11 rounded-full border border-white/40 px-6 py-2 text-base font-semibold hover:bg-white/10 disabled:opacity-50";

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
    <div className="absolute left-1/2 top-16 max-w-[90vw] -translate-x-1/2 rounded-full bg-black/65 px-5 py-2 text-center text-lg font-black tracking-wide backdrop-blur-sm short:top-12 short:py-1 short:text-base">
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
  const [garageOpen, setGarageOpen] = useState(false);
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

  const { loading: sceneLoading } = useSceneLoading();

  return (
    <div className="pointer-events-auto safe-pad absolute inset-0 overflow-y-auto overscroll-contain bg-black/70">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center gap-5 pt-12 row:flex-row row:gap-10 row:pt-0 short:gap-6">
        <div className="flex w-full min-w-0 max-w-[26rem] flex-col items-center gap-4 short:gap-2">
          <h1 className="text-center text-4xl font-black tracking-tight drop-shadow-lg sm:text-5xl short:text-3xl">CHAOS CIRCUIT</h1>
          <div className="short:hidden">
            <ControlsHint />
          </div>
          <p className="text-xs text-zinc-400 short:hidden">{totalLaps} laps</p>
          <MapCarousel
            value={mapId}
            onChange={(id) => {
              selectMap(id);
              resetWeatherToMapDefault();
            }}
          />
          <WeatherPicker />
        </div>
        <div className="flex flex-col items-center gap-4 short:gap-3">
          <button
            className={primaryButton}
            disabled={sceneLoading}
            onClick={() => {
              startAudio();
              startOffline();
            }}
          >
            {sceneLoading ? "Loading…" : "Play vs Bot"}
          </button>
          <button className={secondaryButton} onClick={() => setGarageOpen(true)}>
            <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle ring-1 ring-white/50" style={{ background: profile.paint }} />
            Garage: {getCar(profile.carId).name}
          </button>
          {garageOpen && <Garage onClose={() => setGarageOpen(false)} />}
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white/5 p-4 short:gap-2 short:p-3">
            <button className={secondaryButton} disabled={busy} onClick={() => run(() => createRoom(profile, mapId))}>
              Create online room
            </button>
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="CODE"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                className="min-h-11 w-24 rounded-md bg-black/50 px-3 py-2 text-center font-mono text-lg tracking-widest outline-none ring-1 ring-white/30 focus:ring-white/70"
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
    <div className="pointer-events-auto safe-pad absolute inset-0 overflow-y-auto overscroll-contain bg-black/70">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center gap-4 pt-12 row:flex-row row:gap-10 row:pt-0">
        <div className="flex w-full min-w-0 max-w-[26rem] flex-col items-center gap-3 short:gap-2">
          <p className="text-sm uppercase tracking-widest text-zinc-400 short:hidden">Room code</p>
          <p className="font-mono text-5xl font-black tracking-[0.3em] sm:text-6xl short:text-4xl">{roomCode}</p>
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
        </div>
        <div className="flex flex-col items-center gap-3 short:gap-2">
          <p className="text-center text-zinc-300">Share this code with friends (up to 4 players).</p>
          <p className="max-w-sm text-center text-xs text-zinc-400 short:hidden">
            Testing on one computer? Use two separate browser windows side by side. A background tab pauses its game, so that player looks frozen.
          </p>
          <ul className="w-64 max-w-full space-y-1">
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
      </div>
    </div>
  );
}

function LapPanel({ compact }: { compact: boolean }) {
  const lap = useGameStore((s) => s.player.lap);
  const lapTime = useGameStore((s) => s.player.lapTime);
  const best = useGameStore((s) => s.player.bestLapTime);
  const botLap = useGameStore((s) => s.bot.lap);
  const totalLaps = useGameStore((s) => s.totalLaps);
  const online = useGameStore((s) => s.mode === "online");
  return (
    <div
      className={`absolute rounded-lg bg-black/60 backdrop-blur-sm ${compact ? "left-2 top-2 px-2.5 py-1.5" : "left-4 top-4 px-4 py-3 short:left-2 short:top-2 short:px-3 short:py-2"}`}
    >
      <div className={`${compact ? "text-xs" : "text-sm short:text-xs"} text-zinc-300`}>
        Lap {Math.min(lap + 1, totalLaps)} / {totalLaps}
      </div>
      <div className={`font-mono tabular-nums ${compact ? "text-lg leading-tight" : "text-2xl short:text-xl"}`}>{formatTime(lapTime)}</div>
      {best !== null && <div className="text-xs text-zinc-400">Best {formatTime(best)}</div>}
      {!online && <div className="mt-1 text-xs text-zinc-400">Bot lap {Math.min(botLap + 1, totalLaps)}</div>}
      <WeatherBadge />
    </div>
  );
}

function Speedometer({ compact }: { compact: boolean }) {
  const speed = useGameStore((s) => Math.round(s.player.speedKmh));
  const boosting = useGameStore((s) => !!s.player.boosting);
  if (compact) {
    return (
      <div className="absolute left-[6.75rem] top-2 flex items-baseline gap-1.5 rounded-full bg-black/50 px-3 py-1 backdrop-blur-sm landscape:left-1/2 landscape:-translate-x-1/2">
        <span className="font-mono text-2xl font-bold tabular-nums leading-none">{speed}</span>
        <span className="text-[10px] tracking-widest text-zinc-300">KM/H</span>
        {boosting && <span className="text-[10px] font-bold tracking-widest text-orange-300">BOOST</span>}
      </div>
    );
  }
  return (
    <div className="absolute bottom-6 right-6 text-right short:bottom-3 short:right-3">
      <div className="font-mono text-4xl font-bold tabular-nums drop-shadow-lg short:text-3xl">{speed}</div>
      <div className="text-xs tracking-widest text-zinc-300">KM/H</div>
      <div className="mt-1 h-4 text-xs font-bold tracking-widest text-orange-300">{boosting ? "BOOST" : ""}</div>
    </div>
  );
}

function ItemSlot() {
  const item = useGameStore((s) => s.item);
  const boost = useBindings((s) => s.bindings.item[0]);
  return (
    <div className="absolute bottom-6 left-1/2 flex h-20 w-32 -translate-x-1/2 flex-col items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm short:bottom-3 short:h-14 short:w-24">
      <div className="text-xs uppercase tracking-widest text-zinc-400">Item</div>
      <div className="text-xl font-black uppercase short:text-base">{item ? "Boost" : "-"}</div>
      {item && <div className="text-xs text-zinc-300 short:hidden">press {keyLabel(boost ?? "")}</div>}
    </div>
  );
}

export function HUD() {
  const phase = useGameStore((s) => s.phase);
  const mode = useGameStore((s) => s.mode);
  const raceState = useGameStore((s) => s.raceState);
  const countdownValue = useGameStore((s) => s.countdownValue);
  const muted = useGameStore((s) => s.muted);
  const place = useGameStore((s) => s.player.place);
  const bestLapTime = useGameStore((s) => s.player.bestLapTime);
  const toggleMuted = useGameStore((s) => s.toggleMuted);
  const reset = useGameStore((s) => s.reset);
  const leaveRoom = useGameStore((s) => s.leaveRoom);
  const showTouch = useShowTouchControls();

  const playing = phase === "playing";
  const online = mode === "online";

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans text-white">
      <ProfileSync />
      {playing && <SpeedFx />}
      {phase === "menu" && <Menu />}
      {phase === "lobby" && <Lobby />}

      {playing && raceState === "countdown" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-8xl font-black drop-shadow-lg short:text-6xl">{countdownValue}</span>
        </div>
      )}

      {playing && raceState === "racing" && (
        <div
          className="absolute"
          style={{
            top: "env(safe-area-inset-top)",
            right: "env(safe-area-inset-right)",
            bottom: "env(safe-area-inset-bottom)",
            left: "env(safe-area-inset-left)",
          }}
        >
          <LapPanel compact={showTouch} />
          <Minimap compact={showTouch} />
          <Toast />
          {!showTouch && (
            <>
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <ControlsHint compact />
              </div>
              <ItemSlot />
            </>
          )}
          <Speedometer compact={showTouch} />
        </div>
      )}

      {playing && raceState !== "finished" && showTouch && <TouchControls />}
      {playing && raceState !== "finished" && showTouch && <RotateHint />}

      {playing && raceState === "finished" && (
        <div className="pointer-events-auto safe-pad absolute inset-0 overflow-y-auto overscroll-contain bg-black/75">
          <div className="mx-auto flex min-h-full flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-3xl font-black sm:text-4xl">
              {place === null
                ? "FINISHED"
                : online
                  ? `YOU FINISHED ${ordinal(place).toUpperCase()}`
                  : place === 1
                    ? "YOU WIN"
                    : "BOT WINS"}
            </h2>
            {bestLapTime !== null && <p className="text-zinc-300">Best lap: {formatTime(bestLapTime)}</p>}
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
        </div>
      )}

      <LoadingScreen />
      <FpsCounter />

      <div className="absolute z-30 flex gap-2" style={{ top: "max(0.5rem, env(safe-area-inset-top))", right: "max(0.5rem, env(safe-area-inset-right))" }}>
        <SettingsButton />
        <FullscreenButton />
        <button
          onClick={toggleMuted}
          aria-label={muted ? "Unmute" : "Mute"}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm hover:bg-black/65"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
            {muted ? <path d="m16 9 5 6M21 9l-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
        </button>
      </div>

      <SettingsPanel />
    </div>
  );
}
