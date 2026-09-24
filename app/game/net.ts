import { io, Socket } from "socket.io-client";
import { useGameStore } from "./store";

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
  /** Local receive time (ms), set on arrival. */
  t?: number;
}

export interface Profile {
  name: string;
  carId: string;
  paint: string;
}

export interface RoomPlayer extends Profile {
  id: string;
}

interface JoinAck {
  ok: boolean;
  error?: string;
  code?: string;
  id?: string;
  players?: RoomPlayer[];
  hostId?: string;
  mapId?: string;
}

/** Latest snapshot per remote player; mutated by socket events, read every frame by RemoteCar. */
export const remoteStates = new Map<string, NetState>();

let socket: Socket | null = null;

function getSocket(): Socket {
  if (socket) return socket;
  const s = io();
  socket = s;

  s.on("room:players", ({ players, hostId, mapId }: { players: RoomPlayer[]; hostId: string; mapId: string }) => {
    useGameStore.getState().setRoomPlayers(players, hostId, mapId);
  });
  s.on("player:left", (id: string) => {
    remoteStates.delete(id);
  });
  s.on("car:state", (msg: NetState & { id: string }) => {
    remoteStates.set(msg.id, { ...msg, t: performance.now() });
  });
  s.on("race:start", () => {
    remoteStates.clear();
    useGameStore.getState().beginOnlineRace();
  });
  s.on("race:results", (order: string[]) => {
    useGameStore.getState().setOnlineResults(order);
  });
  s.on("disconnect", () => {
    useGameStore.getState().leaveRoom();
  });
  return s;
}

function applyJoin(ack: JoinAck) {
  if (ack.ok && ack.code && ack.id && ack.players && ack.hostId) {
    useGameStore.getState().enterRoom(ack.code, ack.id, ack.players, ack.hostId, ack.mapId ?? "circuit");
  }
}

export function createRoom(profile: Profile, mapId: string): Promise<JoinAck> {
  return new Promise((resolve) => {
    getSocket().emit("room:create", profile, mapId, (ack: JoinAck) => {
      applyJoin(ack);
      resolve(ack);
    });
  });
}

export function joinRoom(code: string, profile: Profile): Promise<JoinAck> {
  return new Promise((resolve) => {
    getSocket().emit("room:join", code, profile, (ack: JoinAck) => {
      applyJoin(ack);
      resolve(ack);
    });
  });
}

export function changeRoomMap(mapId: string) {
  socket?.emit("room:map", mapId);
}

export function requestStart() {
  socket?.emit("room:start");
}

export function sendState(state: NetState) {
  socket?.volatile.emit("car:state", state);
}

export function sendFinish() {
  socket?.emit("race:finish");
}

export function leaveRoomNet() {
  socket?.emit("room:leave");
  remoteStates.clear();
}
