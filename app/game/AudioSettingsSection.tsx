"use client";

import { useSettings } from "./settings";
import { useGameStore } from "./store";
import { playCheckpoint } from "./AudioManager";

interface SliderProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** Called when the user lets go, e.g. to play a sample at the new level. */
  onCommit?: () => void;
}

function VolumeSlider({ label, value, onChange, onCommit }: SliderProps) {
  const id = `vol-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-20 shrink-0 text-sm text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="h-2 flex-1 cursor-pointer accent-amber-400"
        aria-valuetext={`${Math.round(value * 100)} percent`}
      />
      <span className="w-10 text-right text-sm tabular-nums text-zinc-400">{Math.round(value * 100)}%</span>
    </div>
  );
}

/** Master / music / effects volume sliders plus a mute toggle. Drop into the Settings panel. */
export function AudioSettingsSection() {
  const masterVolume = useSettings((s) => s.masterVolume);
  const musicVolume = useSettings((s) => s.musicVolume);
  const sfxVolume = useSettings((s) => s.sfxVolume);
  const set = useSettings((s) => s.set);
  const muted = useGameStore((s) => s.muted);
  const toggleMuted = useGameStore((s) => s.toggleMuted);

  return (
    <section className="flex flex-col gap-3" aria-label="Audio settings">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Audio</h3>
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          className="rounded-md bg-white/10 px-3 py-1 text-sm font-medium hover:bg-white/20"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
      <VolumeSlider label="Master" value={masterVolume} onChange={(v) => set({ masterVolume: v })} onCommit={playCheckpoint} />
      <VolumeSlider label="Music" value={musicVolume} onChange={(v) => set({ musicVolume: v })} />
      <VolumeSlider label="Effects" value={sfxVolume} onChange={(v) => set({ sfxVolume: v })} onCommit={playCheckpoint} />
    </section>
  );
}
