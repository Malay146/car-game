/** Live map/ranking data for every car, written by cars each tick and read by the minimap/HUD. */
export interface Marker {
  x: number;
  z: number;
  heading: number;
  color: string;
  /** Race progress: completed laps + fraction of the current lap (negative behind the line at the start). */
  total: number;
}

export const markers = new Map<string, Marker>();

export function setMarker(id: string, x: number, z: number, heading: number, color: string, total: number) {
  const m = markers.get(id);
  if (m) {
    m.x = x;
    m.z = z;
    m.heading = heading;
    m.color = color;
    m.total = total;
  } else {
    markers.set(id, { x, z, heading, color, total });
  }
}
