import { io, Socket } from "socket.io-client";
import { joinHost, p2pErrorMessage, P2P_HOST_LEFT, startHost, type NetSocket } from "./p2p";
import { useGameStore } from "./store";
import { useNetStatus } from "./netStatus";
import { useOnlineResults } from "./resultsStore";
import { clearRemotes, pushSnapshot, removeRemote } from "./remoteBuffer";
import type { JoinAck, RoomSnapshot, WirePlayer, WireResultEntry } from "../../realtime/protocol";

export interface NetState {
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
  total: number;
}

export interface Profile {
  name: string;
  carId: string;
  paint: string;
}

export type RoomPlayer = WirePlayer;

/**

/**
 * Where the realtime (Socket.IO) server lives. Unset means same origin, which is what the custom
 * Next server (`npm run dev` / `npm start`) provides. On Vercel set NEXT_PUBLIC_REALTIME_URL to the
 * standalone realtime server (see README "Deploying"); without it, online play is peer-to-peer.
 */
export const REALTIME_URL: string | undefined = process.env.NEXT_PUBLIC_REALTIME_URL || undefined;

export type NetMode = "socket" | "p2p";

/**
 * Which transport online play uses:
 *  1. `?net=p2p` / `?net=socket` in the page URL (handy for testing);
 *  2. NEXT_PUBLIC_REALTIME_URL set -> the dedicated Socket.IO server;
 *  3. NEXT_PUBLIC_NET_MODE=p2p|socket;
 *  4. otherwise Socket.IO in development (the dev server hosts it) and peer-to-peer in production
 *     (e.g. Vercel, where no realtime server can run).
 */
export function netMode(): NetMode {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("net");
    if (q === "p2p" || q === "socket") return q;
  }
  if (REALTIME_URL) return "socket";
  const env = process.env.NEXT_PUBLIC_NET_MODE;
  if (env === "p2p" || env === "socket") return env;
  return process.env.NODE_ENV === "development" ? "socket" : "p2p";
}

const CONNECT_TIMEOUT_MS = 5000;
const ACK_TIMEOUT_MS = 8000;

export const UNAVAILABLE_MESSAGE = "Online play is unavailable right now. Please try again in a moment.";
const WAKING_HINT = " The server may be waking up: give it up to a minute, then retry.";

/** The live connection used by the helpers below (Socket.IO, or a peer-to-peer socket). */
let socket: NetSocket | null = null;
/** Socket.IO is created once and reused (it reconnects by itself); P2P sockets live per room. */
let ioSocket: Socket | null = null;
/** Identity of our seat in the current room; kept in memory so a dropped connection can reclaim it. */
let session: { code: string; id: string; token: string } | null = null;
let pendingFinish: { bestLapMs: number | null } | null = null;

function endSession(message?: string) {
  session = null;
  pendingFinish = null;
  clearRemotes();
  useNetStatus.getState().setReconnecting(false);
  if (message) useNetStatus.getState().setMenuMessage(message);
}

/** Leaves the room locally with a menu message (the room, the server or the host is gone). */
function abandonRoom(message: string) {
  if (!session) return;
  const store = useGameStore.getState();
  endSession(message);
  store.leaveRoom();
}

function applySnapshot(snap: Partial<RoomSnapshot>) {
  if (!snap.players || !snap.hostId) return;
  useGameStore.getState().setRoomPlayers(snap.players, snap.hostId, snap.mapId, snap.options);
}

function tryRejoin(s: NetSocket) {
  if (!session) return;
  const { code, id, token } = session;
  s.timeout(ACK_TIMEOUT_MS).emit("room:rejoin", code, id, token, (err: Error | null, ack?: JoinAck) => {
    if (!session) return;
    if (err || !ack?.ok) {
      // The seat is gone (server restarted, or we were away past the grace period).
      abandonRoom("You were disconnected and the room no longer exists.");
      return;
    }
    useNetStatus.getState().setReconnecting(false);
    applySnapshot(ack);
    const store = useGameStore.getState();
    if (ack.results) useOnlineResults.getState().set(ack.results, ack.status !== "racing");
    if (ack.status === "racing" && store.phase === "lobby") store.beginOnlineRace();
    else if (ack.status === "lobby" && store.phase === "playing" && store.raceState !== "finished") store.reset();
    if (pendingFinish) {
      const p = pendingFinish;
      pendingFinish = null;
      s.emit("race:finish", p, onFinishAck);
    }
  });
}

function onFinishAck(ack?: { ok: boolean; error?: string }) {
  if (ack && !ack.ok) useGameStore.getState().flash("Result could not be verified");
}

/** Game events, identical for both transports. */
function bindGameEvents(s: NetSocket) {
  s.on("connect", () => {
    if (s === socket) tryRejoin(s);
  });
  s.on("room:players", (snap: RoomSnapshot) => applySnapshot(snap));
  s.on("player:left", (id: string) => removeRemote(id));
  s.on("car:state", (msg: NetState & { id: string; t: number }) => {
    pushSnapshot(msg.id, msg, performance.now());
  });
  s.on("race:start", () => {
    clearRemotes();
    useOnlineResults.getState().clear();
    useGameStore.getState().beginOnlineRace();
  });
  s.on("race:results", ({ entries, over }: { entries: WireResultEntry[]; over: boolean }) => {
    useOnlineResults.getState().set(entries, over);
    useGameStore.getState().setOnlineResults(entries.map((e) => e.id));
  });
}

// --- Socket.IO (dedicated server) ------------------------------------------------------------

function getIoSocket(): Socket {
  if (ioSocket) return ioSocket;
  const s = io(REALTIME_URL, {
    transports: ["websocket", "polling"],
    autoConnect: false,
    timeout: CONNECT_TIMEOUT_MS,
    reconnectionAttempts: 12,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
  });
  ioSocket = s;
  bindGameEvents(s);
  s.on("disconnect", (reason) => {
    if (reason === "io client disconnect" || !session) return;
    useNetStatus.getState().setReconnecting(true);
    // The server closed the connection on purpose: socket.io will not retry by itself.
    if (reason === "io server disconnect") s.connect();
  });
  // All retries used up while we were in a room: give up and return to the menu.
  s.io.on("reconnect_failed", () => abandonRoom("Lost connection to the game server."));
  return s;
}

/** Resolves once connected; rejects after ~5 s so the UI can show an error instead of hanging. */
function ensureIoConnected(): Promise<Socket> {
  const s = getIoSocket();
  socket = s;
  if (s.connected) return Promise.resolve(s);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      s.off("connect", onConnect);
    };
    const onConnect = () => {
      cleanup();
      resolve(s);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(UNAVAILABLE_MESSAGE));
    }, CONNECT_TIMEOUT_MS);
    s.on("connect", onConnect);
    s.connect();
  });
}

// --- peer-to-peer ----------------------------------------------------------------------------

/** Wires a fresh peer-to-peer socket (host loopback or guest link) with the game + lifecycle handlers. */
function adoptP2P(s: NetSocket) {
  socket = s;
  bindGameEvents(s);
  s.on("disconnect", (reason: string) => {
    if (s !== socket || reason === "io client disconnect" || !session) return;
    useNetStatus.getState().setReconnecting(true);
  });
  s.on("net:reconnect_failed", (hostGone: boolean) => {
    if (s !== socket) return;
    abandonRoom(hostGone ? P2P_HOST_LEFT : "Lost connection to the host.");
    dropP2P();
  });
  s.on("net:bye", () => {
    if (s !== socket) return;
    abandonRoom(P2P_HOST_LEFT);
    dropP2P();
  });
}

/** Hangs up the current P2P socket (a host closes its room for everyone). */
function dropP2P() {
  if (!socket || socket === ioSocket) return;
  const s = socket;
  socket = null;
  s.disconnect();
}

// --- rooms -----------------------------------------------------------------------------------

function applyJoin(ack: JoinAck) {
  if (ack.ok && ack.code && ack.id && ack.token && ack.players && ack.hostId) {
    session = { code: ack.code, id: ack.id, token: ack.token };
    useNetStatus.getState().setReconnecting(false);
    useNetStatus.getState().setMenuMessage(null);
    useOnlineResults.getState().clear();
    useGameStore.getState().enterRoom(ack.code, ack.id, ack.players, ack.hostId, ack.mapId ?? "circuit", ack.options ?? {});
  }
}

type RoomRequest = "room:create" | "room:join";

function ask(s: NetSocket, event: RoomRequest, args: unknown[]): Promise<JoinAck> {
  return new Promise<JoinAck>((resolve) => {
    s.timeout(ACK_TIMEOUT_MS).emit(event, ...args, (err: Error | null, ack?: JoinAck) => {
      if (err || !ack) return resolve({ ok: false, error: "The server did not respond. Please try again." });
      applyJoin(ack);
      resolve(ack);
    });
  });
}

function requestIo(event: RoomRequest, ...args: unknown[]): Promise<JoinAck> {
  return ensureIoConnected().then(
    (s) => ask(s, event, args),
    () => ({ ok: false, error: UNAVAILABLE_MESSAGE + (REALTIME_URL ? WAKING_HINT : "") })
  );
}

async function requestP2P(open: () => Promise<NetSocket>, event: RoomRequest, ...args: unknown[]): Promise<JoinAck> {
  dropP2P();
  let s: NetSocket;
  try {
    s = await open();
  } catch (e) {
    return { ok: false, error: p2pErrorMessage(e) };
  }
  adoptP2P(s);
  const ack = await ask(s, event, args);
  if (!ack.ok && socket === s) dropP2P();
  return ack;
}

export const createRoom = (profile: Profile, mapId: string) =>
  netMode() === "p2p" ? requestP2P(startHost, "room:create", profile, mapId) : requestIo("room:create", profile, mapId);

export const joinRoom = (code: string, profile: Profile) =>
  netMode() === "p2p" ? requestP2P(() => joinHost(code), "room:join", code, profile) : requestIo("room:join", code, profile);

export function changeRoomMap(mapId: string) {
  socket?.emit("room:map", mapId);
}

/** Host only: merge settings (weather, time of day, mode, ...) that the server syncs to the whole room. */
export function changeRoomOptions(patch: Record<string, string>) {
  socket?.emit("room:options", patch);
}

export function requestStart() {
  socket?.emit("room:start", (ack?: { ok: boolean; error?: string }) => {
    if (ack && !ack.ok) useGameStore.getState().flash(ack.error ?? "Could not start");
  });
}

/** Called ~30x/s by the local car. Stamped with our clock so receivers can interpolate. */
export function sendState(state: NetState) {
  if (socket?.connected) socket.volatile.emit("car:state", { ...state, t: performance.now() });
}

/** The server decides the result; we only report our best lap (it is sanity-checked there). */
export function sendFinish() {
  const best = useGameStore.getState().player.bestLapTime;
  const payload = { bestLapMs: best === null ? null : Math.round(best * 1000) };
  if (socket?.connected) socket.emit("race:finish", payload, onFinishAck);
  else pendingFinish = payload; // connection dropped right at the line: send after we reclaim our seat
}

export function leaveRoomNet() {
  const s = socket;
  if (s?.connected) s.emit("room:leave");
  endSession();
  if (s && s === ioSocket) {
    // Idle in the menu we do not need a live connection (and must not keep retrying a dead server).
    s.disconnect();
  } else {
    dropP2P();
  }
}
