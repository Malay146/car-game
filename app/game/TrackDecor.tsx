"use client";

import { useFrame } from "@react-three/fiber";
import { uTime } from "./visualTime";
import { StartArea } from "./StartArea";
import { CheckpointGates } from "./CheckpointGates";
import { RoadDecals } from "./RoadDecals";
import { AmbientLife } from "./AmbientLife";
import { TrackProps } from "./TrackProps";

/** Advances the shared shader clock used by every GPU-animated decoration. */
function VisualClock() {
  useFrame((state) => {
    uTime.value = state.clock.elapsedTime;
  });
  return null;
}

/** Decorative, non-physical world dressing for a map: start area, checkpoint gates, road paint, ambient life. */
export function TrackDecor({ mapId }: { mapId: string }) {
  return (
    <group>
      <VisualClock />
      <StartArea mapId={mapId} />
      <CheckpointGates mapId={mapId} />
      <RoadDecals mapId={mapId} />
      <TrackProps mapId={mapId} />
      <AmbientLife mapId={mapId} />
    </group>
  );
}
