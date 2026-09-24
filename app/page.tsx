"use client";

import { Scene } from "./game/Scene";
import { HUD } from "./game/HUD";
import { AudioManager } from "./game/AudioManager";

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <Scene />
      <HUD />
      <AudioManager />
    </div>
  );
}
