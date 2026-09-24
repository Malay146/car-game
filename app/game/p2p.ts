import type { DataConnection, Peer as PeerType } from "peerjs";
import { createHub, type HubConnection, type HubInbound, type HubOutbound } from "../../realtime/hub";
import { registerRealtime } from "../../realtime/rooms";

/**
 * Peer-to-peer transport (no game server needed). The host's browser runs the same room/race logic
 * as the dedicated server (realtime/rooms.ts) on an in-memory hub; guests reach it over WebRTC data
 * channels, signalled through the free public PeerJS broker. The host plays through an in-memory
 * loopback, so host and guests share one code path in net.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- socket.io-style untyped event arguments */
type Fn = (...args: any[]) => void;

/** The part of socket.io-client's Socket that net.ts uses; `MsgSocket` implements it for P2P. */
export interface NetSocket {
  readonly connected: boolean;
  on(event: string, fn: Fn): unknown;
  off(event: string, fn: Fn): unknown;
  emit(event: string, ...args: any[]): unknown;
  timeout(ms: number): { emit(event: string, ...args: any[]): unknown };
  volatile: { emit(event: string, ...args: any[]): unknown };
  disconnect(): unknown;
}

const PEER_PREFIX = "chaoscircuit-";
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const P2P_CONNECT_TIMEOUT_MS = 10_000;
/** Pre-negotiated id of the extra unordered, no-retransmit channel used for `car:state`. */
const STATE_CHANNEL_ID = 100;

export const P2P_UNREACHABLE =
  "Couldn't reach that room — check the code, or your network may block peer-to-peer; ask the host to try again.";
export const P2P_NOT_FOUND = "Room not found — check the code (the host must keep the game open).";
export const P2P_HOST_LEFT = "The host left the room.";
const BROKER_DOWN = "Couldn't reach the matchmaking service. Check your connection and try again.";

class P2PError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "not-found" | "broker" | "taken"
  ) {
    super(message);
  }
}

/** Client side of a hub connection, mimicking the socket.io-client API net.ts relies on. */
class MsgSocket implements NetSocket {
  connected = false;
  private listeners = new Map<string, Set<Fn>>();
  private acks = new Map<number, Fn>();
  private nextAck = 1;
  /** Returns false when the message could not be sent. */
  send: (msg: HubInbound, volatile: boolean) => boolean = () => false;
  onUserDisconnect: () => void = () => {};

  on(event: string, fn: Fn) {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }
  off(event: string, fn: Fn) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  fire(event: string, ...args: unknown[]) {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error("[p2p]", event, err);
      }
    }
  }

  private out(event: string, args: unknown[], volatile: boolean, ack?: Fn) {
    if (!this.connected) return;
    const msg: HubInbound = { e: event, a: args };
    if (ack) {
      msg.k = this.nextAck++;
      this.acks.set(msg.k, ack);
    }
    if (!this.send(msg, volatile) && msg.k) this.acks.delete(msg.k);
  }

  emit(event: string, ...args: unknown[]) {
    const ack = typeof args[args.length - 1] === "function" ? (args.pop() as Fn) : undefined;
    this.out(event, args, false, ack);
    return this;
  }

  timeout(ms: number) {
    return {
      emit: (event: string, ...args: unknown[]) => {
        const cb = args.pop() as Fn;
        let done = false;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          cb(new Error("operation has timed out"));
        }, ms);
        const finish = (...res: unknown[]) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cb(null, ...res);
        };
        if (!this.connected) return; // socket.io would buffer; here the timeout reports the failure
        this.out(event, args, false, finish);
      },
    };
  }

  volatile = { emit: (event: string, ...args: unknown[]) => this.out(event, args, true) };

  /** A message from the hub. */
  handle(raw: unknown) {
    if (!raw || typeof raw !== "object") return;
    const msg = raw as HubOutbound;
    if ("bye" in msg) return this.fire("net:bye", msg.bye);
    if ("k" in msg) {
      const fn = this.acks.get(msg.k);
      this.acks.delete(msg.k);
      if (fn && Array.isArray(msg.a)) fn(...msg.a);
      return;
    }
    if (typeof msg.e === "string" && Array.isArray(msg.a)) this.fire(msg.e, ...msg.a);
  }

  setConnected() {
    this.connected = true;
    this.fire("connect");
  }
  setDisconnected(reason: string) {
    if (!this.connected) return;
    this.connected = false;
    this.fire("disconnect", reason);
  }
  disconnect() {
    const was = this.connected;
    this.connected = false;
    this.onUserDisconnect();
    if (was) this.fire("disconnect", "io client disconnect");
    return this;
  }
}

// --- PeerJS helpers ------------------------------------------------------------------------

let peerLib: Promise<typeof import("peerjs")> | null = null;
const loadPeerJs = () => (peerLib ??= import("peerjs"));

const randomCode = () => {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return code;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new P2PError(P2P_UNREACHABLE, "unreachable"));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Creates a Peer registered with the broker (under `id` when given). */
async function openPeer(id?: string): Promise<PeerType> {
  const { Peer } = await loadPeerJs();
  const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
  const ready = new Promise<PeerType>((resolve, reject) => {
    peer.once("open", () => resolve(peer));
    peer.once("error", (err) => {
      reject(
        err.type === "unavailable-id"
          ? new P2PError("id taken", "taken")
          : err.type === "browser-incompatible"
            ? new P2PError("This browser does not support peer-to-peer play.", "broker")
            : new P2PError(BROKER_DOWN, "broker")
      );
    });
  });
  return withTimeout(ready, P2P_CONNECT_TIMEOUT_MS, () => peer.destroy()).catch((e) => {
    peer.destroy();
    throw e;
  });
}

/**
 * Adds a pre-negotiated unreliable, unordered channel on the connection's RTCPeerConnection
 * (both sides create it with the same id, so no renegotiation is needed). Null if unsupported.
 */
function stateChannel(conn: DataConnection, onMessage: (data: unknown) => void): RTCDataChannel | null {
  try {
    const ch = conn.peerConnection.createDataChannel("cc-state", {
      negotiated: true,
      id: STATE_CHANNEL_ID,
      ordered: false,
      maxRetransmits: 0,
    });
    ch.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string));
      } catch {
        /* ignore malformed */
      }
    };
    return ch;
  } catch {
    return null;
  }
}

/** Sends over the unreliable channel when it is open (for volatile messages), else the reliable one. */
function sendVia(conn: DataConnection, ch: RTCDataChannel | null, msg: unknown, volatile: boolean): boolean {
  try {
    if (volatile && ch && ch.readyState === "open") {
      if (ch.bufferedAmount > 64 * 1024) return false; // congested: drop, like socket.io's volatile
      ch.send(JSON.stringify(msg));
      return true;
    }
    if (!conn.open) return false;
    void conn.send(msg);
    return true;
  } catch {
    return false;
  }
}

// --- host ----------------------------------------------------------------------------------

let hosting: { peer: PeerType; shutdown: () => void } | null = null;

/**
 * Registers a Peer for a fresh room code, starts the room logic on an in-browser hub and returns
 * the host's own (loopback) socket plus the room code that `room:create` will hand out.
 */
export async function startHost(): Promise<NetSocket> {
  stopHost();
  let peer: PeerType | null = null;
  let code = "";
  for (let attempt = 0; attempt < 6 && !peer; attempt++) {
    code = randomCode();
    try {
      peer = await openPeer(PEER_PREFIX + code);
    } catch (e) {
      if (!(e instanceof P2PError && e.kind === "taken")) throw e;
    }
  }
  if (!peer) throw new P2PError(BROKER_DOWN, "broker");
  const hostPeer = peer;

  const hub = createHub();
  registerRealtime(hub.server, { makeCode: () => code, maxRooms: 1 });

  hostPeer.on("connection", (conn) => {
    let link: HubConnection | null = null;
    let ch: RTCDataChannel | null = null;
    conn.on("open", () => {
      ch = stateChannel(conn, (m) => link?.receive(m));
      link = hub.connect({
        send: (msg, volatile) => void sendVia(conn, ch, msg, volatile),
        close: () => setTimeout(() => conn.close(), 300), // let a final `bye` flush
      });
    });
    conn.on("data", (d) => link?.receive(d));
    const gone = () => {
      link?.close();
      link = null;
      ch?.close();
    };
    conn.on("close", gone);
    conn.on("error", gone);
  });
  // Losing the broker only stops new guests from finding us; live data channels keep working.
  hostPeer.on("disconnected", () => {
    setTimeout(() => {
      if (!hostPeer.destroyed && hostPeer.disconnected) hostPeer.reconnect();
    }, 1000);
  });
  hostPeer.on("error", () => {});

  // The host's own player: an in-memory loopback (async, and cloned like a real network hop).
  const client = new MsgSocket();
  const local = hub.connect({
    send: (msg) => queueMicrotask(() => client.handle(clone(msg))),
    close: () => {},
  });
  client.send = (msg) => {
    queueMicrotask(() => local.receive(clone(msg)));
    return true;
  };

  const onPageHide = () => hub.shutdown("host-left");
  window.addEventListener("pagehide", onPageHide);
  const shutdown = () => {
    window.removeEventListener("pagehide", onPageHide);
    hub.shutdown("host-left");
    setTimeout(() => hostPeer.destroy(), 500);
  };
  hosting = { peer: hostPeer, shutdown };
  client.onUserDisconnect = () => {
    if (hosting?.peer === hostPeer) hosting = null;
    shutdown();
  };
  client.setConnected();
  return client;
}

function stopHost() {
  const h = hosting;
  hosting = null;
  h?.shutdown();
}

// --- guest ---------------------------------------------------------------------------------

/** Opens a reliable data connection to the room's host. */
function dial(peer: PeerType, code: string, timeoutMs: number): Promise<DataConnection> {
  const hostId = PEER_PREFIX + code.toUpperCase();
  const conn = peer.connect(hostId, { reliable: true, serialization: "json" });
  const opened = new Promise<DataConnection>((resolve, reject) => {
    const onPeerError = (err: { type: string; message: string }) => {
      if (err.type === "peer-unavailable" && err.message.includes(hostId)) {
        peer.off("error", onPeerError);
        reject(new P2PError(P2P_NOT_FOUND, "not-found"));
      }
    };
    peer.on("error", onPeerError);
    conn.once("open", () => {
      peer.off("error", onPeerError);
      resolve(conn);
    });
    conn.once("error", () => reject(new P2PError(P2P_UNREACHABLE, "unreachable")));
    conn.once("close", () => reject(new P2PError(P2P_UNREACHABLE, "unreachable")));
  });
  return withTimeout(opened, timeoutMs, () => conn.close());
}

/**
 * Connects to room `code` hosted by another browser. On a dropped connection it retries a few
 * times (firing `connect` again on success, like socket.io), then fires `net:reconnect_failed`
 * with `true` when the host is gone.
 */
export async function joinHost(code: string): Promise<NetSocket> {
  stopHost();
  const client = new MsgSocket();
  let peer: PeerType | null = null;
  let conn: DataConnection | null = null;
  let ch: RTCDataChannel | null = null;
  let closedByUser = false;

  const bind = (c: DataConnection) => {
    conn = c;
    ch = stateChannel(c, (m) => client.handle(m));
    c.on("data", (d) => client.handle(d));
    c.on("close", () => {
      if (conn !== c) return;
      ch?.close();
      if (closedByUser) return;
      client.setDisconnected("transport close");
      void reconnect();
    });
    client.send = (msg, volatile) => (conn === c ? sendVia(c, ch, msg, volatile) : false);
  };

  const connectOnce = async (timeoutMs: number) => {
    if (!peer || peer.destroyed || peer.disconnected) {
      peer?.destroy();
      peer = await openPeer();
      peer.on("error", () => {});
    }
    return dial(peer, code, timeoutMs);
  };

  let reconnecting = false;
  const reconnect = async () => {
    if (reconnecting) return;
    reconnecting = true;
    let hostGone = false;
    for (const delay of [300, 1500, 3000]) {
      await new Promise((r) => setTimeout(r, delay));
      if (closedByUser) return;
      try {
        const c = await connectOnce(5000);
        if (closedByUser) return c.close();
        reconnecting = false;
        bind(c);
        client.setConnected();
        return;
      } catch (e) {
        hostGone = e instanceof P2PError && e.kind === "not-found";
      }
    }
    reconnecting = false;
    if (!closedByUser) client.fire("net:reconnect_failed", hostGone);
  };

  client.onUserDisconnect = () => {
    closedByUser = true;
    const c = conn as DataConnection | null;
    const p = peer as PeerType | null;
    // Give a just-sent `room:leave` time to reach the host before hanging up.
    setTimeout(() => {
      c?.close({ flush: true });
      p?.destroy();
    }, 300);
  };

  try {
    await loadPeerJs(); // downloading the library does not count against the connect timeout
    const deadline = Date.now() + P2P_CONNECT_TIMEOUT_MS;
    if (!peer) {
      peer = await openPeer();
      peer.on("error", () => {});
    }
    const c = await dial(peer, code, Math.max(3000, deadline - Date.now()));
    bind(c);
  } catch (e) {
    (peer as PeerType | null)?.destroy();
    throw e;
  }
  client.setConnected();
  return client;
}

/** Friendly text for a failed host/join attempt. */
export function p2pErrorMessage(e: unknown): string {
  return e instanceof P2PError ? e.message : P2P_UNREACHABLE;
}
