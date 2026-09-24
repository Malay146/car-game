"use client";

import { useGameStore } from "./store";

export const MAX_NAME_LENGTH = 16;

/** Name input for the menu; bound straight to the shared player profile. */
export function PlayerNameField() {
  const name = useGameStore((s) => s.profile.name);
  const setProfile = useGameStore((s) => s.setProfile);
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      Your name
      <input
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => setProfile({ name: e.target.value.slice(0, MAX_NAME_LENGTH) })}
        onBlur={(e) => {
          if (!e.target.value.trim()) setProfile({ name: "Player" });
        }}
        placeholder="Player"
        aria-label="Your name"
        className="w-40 rounded-md bg-black/50 px-3 py-1.5 text-center text-base text-white outline-none ring-1 ring-white/30 focus:ring-white/70"
      />
    </label>
  );
}
