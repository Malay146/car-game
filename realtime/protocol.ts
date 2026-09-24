/** Wire types shared by the realtime server and the browser client. Keep this file dependency free. */

export interface WireProfile {
  name?: string;
  carId?: string;
  paint?: string;
}

export interface WirePlayer {
  id: string;
  name: string;
  carId: string;
  paint: string;
  /** True while the player's connection is down but their seat is being held for a reconnect. */
  offline?: boolean;
}

export interface WireResultEntry {
  id: string;
  name: string;
  paint: string;
  /** Server clock: finish time minus race start, in milliseconds. */
  timeMs: number;
  bestLapMs: number | null;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  players: WirePlayer[];
  mapId: string;
  options: Record<string, string>;
  status: "lobby" | "racing";
}

export interface JoinAck extends Partial<RoomSnapshot> {
  ok: boolean;
  error?: string;
  /** The caller's stable player id (survives reconnects; not the socket id). */
  id?: string;
  /** Secret used to reclaim the seat after a dropped connection. */
  token?: string;
  results?: WireResultEntry[];
}

/** Wall-clock length of the pre-race countdown on the client (3 steps of 800 ms, GO on the third tick). */
export const COUNTDOWN_MS = 2400;

/** Default number of laps when the room has no `laps` option. */
export const DEFAULT_LAPS = 3;
