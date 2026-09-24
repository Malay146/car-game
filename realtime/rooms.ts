import { generateCenterline, getTrackLength, nearestIndex } from "../app/game/trackPath";
import {
  COUNTDOWN_MS,
  DEFAULT_LAPS,
  type JoinAck,
  type RoomSnapshot,
  type WirePlayer,
  type WireProfile,
  type WireResultEntry,
} from "./protocol";

/**
 * Room / race logic shared by the dev custom server (server.ts), the standalone realtime
 * server (realtime/server.ts) and the in-browser peer-to-peer host (realtime/hub.ts + app/game/p2p.ts).
 * It only depends on the tiny transport interface below, never on Node modules, so it bundles for the browser. Everything about a race that matters for fairness is decided here:
 * positions are validated, progress and lap counts are recomputed from positions, and finish times
 * come from the server clock.
 */

// --- transport interface (the subset of socket.io's Server / Socket used here) ----------------

/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors socket.io's untyped event arguments */
export interface RealtimeEmitter {
  emit(event: string, ...args: any[]): unknown;
}

export interface RealtimeSocket {
  readonly id: string;
  data: any;
  on(event: string, listener: (...args: any[]) => void): unknown;
  join(room: string): unknown;
  leave(room: string): unknown;
  /** Everyone in `room` except this socket. */
  to(room: string): RealtimeEmitter & { volatile: RealtimeEmitter };
}

export interface RealtimeServer {
  on(event: "connection", listener: (socket: RealtimeSocket) => void): unknown;
  to(room: string): RealtimeEmitter;
  sockets: { sockets: { get(id: string): RealtimeSocket | undefined; readonly size: number } };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RealtimeOptions {
  /** Room code generator (the P2P host pins the code its peer id was registered under). */
  makeCode?: () => string;
  maxRooms?: number;
}

type Socket = RealtimeSocket;

/** Random hex id; Web Crypto exists in browsers and Node 20+. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

const MAX_PLAYERS = 4;
const MAX_ROOMS = 300;
/** How long a dropped player's seat is held so they can reconnect. */
const RECONNECT_GRACE_MS = 25_000;
/** After the first finisher, stragglers get this long before the race is closed. */
const STRAGGLER_MS = 120_000;

// --- anti-cheat tuning -------------------------------------------------------------------
/** The game's real top speed is ~46 u/s (60 boosted); allow a generous margin for ramps and impacts. */
const MAX_SPEED = 75;
/** Unused movement allowance that can be banked to absorb network bursts (world units). */
const ALLOWANCE_CAP = 25;
/** Sustained `car:state` rate limit (messages per second) and burst size. */
const STATE_RATE = 40;
const STATE_BURST = 12;
/** A respawn may move the car anywhere as long as it does not gain progress (fraction of a lap). */
const RESET_MAX_FORWARD = 0.004;
const RESET_COOLDOWN_MS = 700;
/** Finish check: how far short of the full distance a finish may be (fraction of a lap). */
const FINISH_SLACK = 0.05;
/** The first state of a race must be near the start grid (units behind / past the line). */
const ANCHOR_BEHIND = 60;
const ANCHOR_PAST = 30;

interface Tracker {
  anchored: boolean;
  lastAt: number;
  x: number;
  y: number;
  z: number;
  allowance: number;
  frac: number;
  /** Server-computed progress: completed laps + fraction of the current lap. */
  total: number;
  lastResetAt: number;
  dropped: number;
}

interface Player {
  id: string;
  token: string;
  socketId: string | null;
  name: string;
  carId: string;
  paint: string;
  graceTimer: ReturnType<typeof setTimeout> | null;
  track: Tracker;
  /** `car:state` token bucket. */
  bucket: number;
  bucketAt: number;
}

interface Room {
  code: string;
  hostId: string;
  players: Player[];
  mapId: string;
  /** Free-form host-chosen settings synced to everyone (weather, time of day, mode, laps, ...). */
  options: Record<string, string>;
  status: "lobby" | "racing";
  /** Server timestamp at which the race goes green (race:start + countdown). */
  goAt: number;
  finished: WireResultEntry[];
  endTimer: ReturnType<typeof setTimeout> | null;
}

const clean = (v: unknown, fallback: string, max = 20) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

const cleanPaint = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : fallback;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const newTracker = (): Tracker => ({
  anchored: false,
  lastAt: 0,
  x: 0,
  y: 0,
  z: 0,
  allowance: ALLOWANCE_CAP,
  frac: 0,
  total: 0,
  lastResetAt: 0,
  dropped: 0,
});

function lapsOf(room: Room): number {
  const n = parseInt(room.options.laps ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : DEFAULT_LAPS;
}

const publicPlayer = (p: Player): WirePlayer => ({
  id: p.id,
  name: p.name,
  carId: p.carId,
  paint: p.paint,
  ...(p.socketId === null ? { offline: true } : {}),
});

const snapshot = (room: Room): RoomSnapshot => ({
  code: room.code,
  hostId: room.hostId,
  players: room.players.map(publicPlayer),
  mapId: room.mapId,
  options: room.options,
  status: room.status,
});

interface CarStateIn {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vz: number;
  speedKmh: number;
  steer: number;
  t: number;
}

/** Rejects non-finite or absurd values; returns a clean copy with only known fields. */
function sanitizeState(raw: unknown): CarStateIn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const { x, y, z, qx, qy, qz, qw, vx, vz, speedKmh, steer, t } = r;
  if (
    !finite(x) || !finite(y) || !finite(z) || !finite(qx) || !finite(qy) || !finite(qz) || !finite(qw) ||
    !finite(vx) || !finite(vz) || !finite(speedKmh) || !finite(steer) || !finite(t)
  ) {
    return null;
  }
  if (Math.abs(x) > 5000 || Math.abs(z) > 5000 || y < -40 || y > 300) return null;
  const qn = Math.hypot(qx, qy, qz, qw);
  if (qn < 0.9 || qn > 1.1) return null;
  if (Math.hypot(vx, vz) > MAX_SPEED * 1.6 || Math.abs(speedKmh) > 320 || Math.abs(steer) > 1.6) return null;
  return { x, y, z, qx, qy, qz, qw, vx, vz, speedKmh, steer, t };
}

const wrapHalf = (d: number) => d - Math.round(d);

export interface RealtimeStats {
  rooms: number;
  players: number;
  sockets: number;
}

export function registerRealtime(io: RealtimeServer, opts: RealtimeOptions = {}): { stats: () => RealtimeStats } {
  const rooms = new Map<string, Room>();
  const maxRooms = opts.maxRooms ?? MAX_ROOMS;

  const randomCode = (): string => {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
      if (!rooms.has(code)) return code;
    }
  };
  const makeCode = opts.makeCode ?? randomCode;

  const broadcastPlayers = (room: Room) => io.to(room.code).emit("room:players", snapshot(room));

  const findOf = (socket: Socket): { room: Room; player: Player } | null => {
    const d = socket.data as { code?: string; pid?: string };
    const room = d.code ? rooms.get(d.code) : undefined;
    const player = room?.players.find((p) => p.id === d.pid);
    if (!room || !player || player.socketId !== socket.id) return null;
    return { room, player };
  };

  const pickHost = (room: Room) => {
    const host = room.players.find((p) => p.id === room.hostId);
    if (host && host.socketId !== null) return;
    const next = room.players.find((p) => p.socketId !== null) ?? room.players[0];
    if (next) room.hostId = next.id;
  };

  const dropRoom = (room: Room) => {
    if (room.endTimer) clearTimeout(room.endTimer);
    room.players.forEach((p) => p.graceTimer && clearTimeout(p.graceTimer));
    rooms.delete(room.code);
  };

  const endRace = (room: Room) => {
    if (room.status !== "racing") return;
    room.status = "lobby";
    if (room.endTimer) clearTimeout(room.endTimer);
    room.endTimer = null;
    io.to(room.code).emit("race:results", { entries: room.finished, over: true });
    broadcastPlayers(room);
  };

  /** The race is over once every connected player has finished (or nobody is left racing). */
  const maybeEndRace = (room: Room) => {
    if (room.status !== "racing") return;
    const racing = room.players.filter((p) => p.socketId !== null);
    if (racing.every((p) => room.finished.some((f) => f.id === p.id))) endRace(room);
  };

  const removePlayer = (room: Room, player: Player) => {
    if (player.graceTimer) clearTimeout(player.graceTimer);
    player.graceTimer = null;
    room.players = room.players.filter((p) => p.id !== player.id);
    if (room.players.length === 0) return dropRoom(room);
    pickHost(room);
    io.to(room.code).emit("player:left", player.id);
    broadcastPlayers(room);
    maybeEndRace(room);
  };

  /** Detaches a socket from its room right now (explicit leave, or joining another room). */
  const leaveNow = (socket: Socket) => {
    const found = findOf(socket);
    const code = (socket.data as { code?: string }).code;
    socket.data = {};
    if (code) socket.leave(code);
    if (found) removePlayer(found.room, found.player);
  };

  const attach = (socket: Socket, room: Room, player: Player) => {
    player.socketId = socket.id;
    socket.data = { code: room.code, pid: player.id };
    socket.join(room.code);
  };

  const newPlayer = (profile: WireProfile | undefined, fallbackName: string, fallbackPaint: string): Player => ({
    id: randomHex(6),
    token: randomHex(16),
    socketId: null,
    name: clean(profile?.name, fallbackName, 16),
    carId: clean(profile?.carId, "race", 30),
    paint: cleanPaint(profile?.paint, fallbackPaint),
    graceTimer: null,
    track: newTracker(),
    bucket: STATE_BURST,
    bucketAt: Date.now(),
  });

  const joinAck = (room: Room, player: Player): JoinAck => ({
    ok: true,
    ...snapshot(room),
    id: player.id,
    token: player.token,
    results: room.finished,
  });

  // --- race progress and validation ----------------------------------------------------------

  const acceptState = (room: Room, player: Player, s: CarStateIn): number | null => {
    const tr = player.track;
    const path = generateCenterline(room.mapId);
    const len = getTrackLength(room.mapId);
    const frac = nearestIndex(path, s.x, s.z) / path.length;
    const now = Date.now();

    if (!tr.anchored) {
      // Only start tracking from a believable start-grid position (also ignores stale states from a previous race).
      const behind = (1 - frac) * len;
      const past = frac * len;
      if (behind > ANCHOR_BEHIND && past > ANCHOR_PAST) return null;
      tr.anchored = true;
      tr.total = frac > 0.5 ? frac - 1 : frac;
      tr.frac = frac;
      tr.x = s.x;
      tr.y = s.y;
      tr.z = s.z;
      tr.lastAt = now;
      tr.allowance = ALLOWANCE_CAP;
      return tr.total;
    }

    const dt = Math.max(0, (now - tr.lastAt) / 1000);
    tr.allowance = Math.min(ALLOWANCE_CAP, tr.allowance + MAX_SPEED * dt);
    tr.lastAt = now;
    const dist = Math.hypot(s.x - tr.x, s.y - tr.y, s.z - tr.z);
    const dFrac = wrapHalf(frac - tr.frac);

    if (dist <= tr.allowance) {
      // Ordinary movement within the speed budget.
      tr.allowance -= dist;
      // Track loops can make the nearest centerline sample jump; ignore progress that does not match movement.
      if (Math.abs(dFrac) * len <= dist * 2 + 30) tr.total += dFrac;
    } else if (dFrac <= RESET_MAX_FORWARD && now - tr.lastResetAt >= RESET_COOLDOWN_MS) {
      // A teleport that gains no progress is a respawn (R key, flipped, fell off the map).
      tr.lastResetAt = now;
      tr.allowance = 0;
      tr.total += dFrac;
    } else {
      tr.dropped++;
      return null;
    }
    tr.frac = frac;
    tr.x = s.x;
    tr.y = s.y;
    tr.z = s.z;
    return tr.total;
  };

  const onState = (socket: Socket, raw: unknown) => {
    const found = findOf(socket);
    if (!found || found.room.status !== "racing") return;
    const { room, player } = found;

    const now = Date.now();
    player.bucket = Math.min(STATE_BURST, player.bucket + ((now - player.bucketAt) / 1000) * STATE_RATE);
    player.bucketAt = now;
    if (player.bucket < 1) return;
    player.bucket -= 1;

    const s = sanitizeState(raw);
    if (!s) return;
    const total = acceptState(room, player, s);
    if (total === null) return;
    socket.to(room.code).volatile.emit("car:state", { id: player.id, ...s, total });
  };

  const onFinish = (socket: Socket, payload: unknown, ack?: (r: unknown) => void) => {
    const reply = (ok: boolean, error?: string) => typeof ack === "function" && ack({ ok, error });
    const found = findOf(socket);
    if (!found || found.room.status !== "racing") return reply(false, "No race in progress");
    const { room, player } = found;
    if (room.finished.some((f) => f.id === player.id)) return reply(true);

    const laps = lapsOf(room);
    const len = getTrackLength(room.mapId);
    const timeMs = Date.now() - room.goAt;
    // Fastest physically possible time for the distance, with a safety margin.
    const minMs = Math.max(4000, (((laps - FINISH_SLACK) * len) / MAX_SPEED) * 1000);
    if (!player.track.anchored || player.track.total < laps - FINISH_SLACK) return reply(false, "Progress does not match a finish");
    if (timeMs < minMs) return reply(false, "Finish time is not plausible");

    const minLapMs = ((len * 0.9) / MAX_SPEED) * 1000;
    const reported = (payload as { bestLapMs?: unknown } | null)?.bestLapMs;
    const bestLapMs = finite(reported) ? Math.round(Math.min(Math.max(reported, minLapMs), timeMs)) : null;

    room.finished.push({ id: player.id, name: player.name, paint: player.paint, timeMs: Math.round(timeMs), bestLapMs });
    io.to(room.code).emit("race:results", { entries: room.finished, over: false });
    if (room.finished.length === 1 && room.players.length > 1 && !room.endTimer) {
      room.endTimer = setTimeout(() => endRace(room), STRAGGLER_MS);
    }
    maybeEndRace(room);
    reply(true);
  };

  // --- connection handlers -------------------------------------------------------------------

  io.on("connection", (socket: Socket) => {
    socket.on("room:create", (profile: WireProfile, mapId: string, ack: (r: unknown) => void) => {
      if (typeof ack !== "function") return;
      if (rooms.size >= maxRooms) return ack({ ok: false, error: "The server is busy, try again later" });
      leaveNow(socket);
      const player = newPlayer(profile, "Player 1", "#e0322f");
      const room: Room = {
        code: makeCode(),
        hostId: player.id,
        players: [player],
        mapId: typeof mapId === "string" && mapId ? mapId.slice(0, 32) : "circuit",
        options: {},
        status: "lobby",
        goAt: 0,
        finished: [],
        endTimer: null,
      };
      rooms.set(room.code, room);
      attach(socket, room, player);
      ack(joinAck(room, player));
    });

    socket.on("room:join", (code: string, profile: WireProfile, ack: (r: unknown) => void) => {
      if (typeof ack !== "function") return;
      const room = rooms.get(String(code || "").toUpperCase());
      if (!room) return ack({ ok: false, error: "Room not found" });
      if (room.status === "racing") return ack({ ok: false, error: "A race is already in progress" });
      if (room.players.length >= MAX_PLAYERS) return ack({ ok: false, error: "Room is full" });
      leaveNow(socket);
      const player = newPlayer(profile, `Player ${room.players.length + 1}`, "#3b82f6");
      room.players.push(player);
      attach(socket, room, player);
      ack(joinAck(room, player));
      broadcastPlayers(room);
    });

    /** Reclaim a seat after a dropped connection (the client keeps its id + token in memory). */
    socket.on("room:rejoin", (code: string, id: string, token: string, ack: (r: unknown) => void) => {
      if (typeof ack !== "function") return;
      const room = rooms.get(String(code || "").toUpperCase());
      const player = room?.players.find((p) => p.id === id);
      if (!room || !player || player.token !== token) return ack({ ok: false, error: "Room no longer exists" });
      if (player.graceTimer) clearTimeout(player.graceTimer);
      player.graceTimer = null;
      if (player.socketId && player.socketId !== socket.id) {
        // A stale connection for the same seat (half-open socket): retire it quietly.
        const old = io.sockets.sockets.get(player.socketId);
        if (old) {
          old.data = {};
          old.leave(room.code);
        }
      }
      attach(socket, room, player);
      player.bucket = STATE_BURST;
      ack(joinAck(room, player));
      pickHost(room);
      broadcastPlayers(room);
    });

    socket.on("room:map", (mapId: string) => {
      const found = findOf(socket);
      if (!found || found.room.hostId !== found.player.id || found.room.status !== "lobby" || typeof mapId !== "string") return;
      found.room.mapId = mapId.slice(0, 32);
      broadcastPlayers(found.room);
    });

    socket.on("room:options", (patch: Record<string, unknown>) => {
      const found = findOf(socket);
      if (!found || found.room.hostId !== found.player.id || found.room.status !== "lobby") return;
      if (!patch || typeof patch !== "object") return;
      const { room } = found;
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === "string" && k.length <= 16 && v.length <= 32 && (k in room.options || Object.keys(room.options).length < 16)) {
          room.options[k] = v;
        }
      }
      broadcastPlayers(room);
    });

    socket.on("room:start", (ack?: (r: unknown) => void) => {
      const reply = (ok: boolean, error?: string) => typeof ack === "function" && ack({ ok, error });
      const found = findOf(socket);
      if (!found || found.room.hostId !== found.player.id) return reply(false, "Only the host can start");
      const { room } = found;
      if (room.status !== "lobby") return reply(false, "A race is already in progress");
      room.status = "racing";
      room.finished = [];
      room.goAt = Date.now() + COUNTDOWN_MS;
      room.players.forEach((p) => (p.track = newTracker()));
      if (room.endTimer) clearTimeout(room.endTimer);
      room.endTimer = null;
      io.to(room.code).emit("race:start");
      broadcastPlayers(room);
      reply(true);
    });

    socket.on("car:state", (state: unknown) => onState(socket, state));
    socket.on("race:finish", (payload: unknown, ack?: (r: unknown) => void) => onFinish(socket, payload, ack));

    socket.on("room:leave", () => leaveNow(socket));

    socket.on("disconnect", () => {
      const found = findOf(socket);
      if (!found) return;
      const { room, player } = found;
      // Hold the seat so a dropped connection (or a backgrounded phone) can come back.
      player.socketId = null;
      player.graceTimer = setTimeout(() => removePlayer(room, player), RECONNECT_GRACE_MS);
      pickHost(room);
      broadcastPlayers(room);
      maybeEndRace(room);
    });
  });

  return {
    stats: () => ({
      rooms: rooms.size,
      players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
      sockets: io.sockets.sockets.size,
    }),
  };
}
