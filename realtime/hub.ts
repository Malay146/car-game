import type { RealtimeEmitter, RealtimeServer, RealtimeSocket } from "./rooms";

/**
 * A minimal in-memory stand-in for a socket.io Server, so `registerRealtime` (rooms.ts) can run
 * inside the host's browser in peer-to-peer mode. Each client connection is a `HubLink` that
 * carries plain JSON messages (a PeerJS data channel, or an in-memory loopback for the host).
 * Dependency free: works in the browser and in Node.
 */

/** Client -> hub: an event, optionally expecting an ack reply with id `k`. */
export interface HubInbound {
  e: string;
  a: unknown[];
  k?: number;
}

/** Hub -> client: an event, an ack reply, or a notice that the hub is shutting down. */
export type HubOutbound = { e: string; a: unknown[] } | { k: number; a: unknown[] } | { bye: string };

export interface HubLink {
  /** `volatile` messages may be dropped (sent over an unreliable channel when one exists). */
  send(msg: HubOutbound, volatile: boolean): void;
  close(): void;
}

export interface HubConnection {
  receive(msg: unknown): void;
  /** The transport went away (fires `disconnect` on the hub socket). */
  close(): void;
}

type Listener = (...args: unknown[]) => void;
const RESERVED = new Set(["connection", "connect", "disconnect", "disconnecting"]);

export function createHub() {
  const sockets = new Map<string, HubSocket>();
  const rooms = new Map<string, Set<string>>();
  const onConnection: ((s: RealtimeSocket) => void)[] = [];
  let seq = 0;
  let closed = false;

  const roomEmitter = (room: string, except: string | null, volatile: boolean): RealtimeEmitter => ({
    emit(event: string, ...args: unknown[]) {
      const ids = rooms.get(room);
      if (!ids) return true;
      for (const id of ids) if (id !== except) sockets.get(id)?.link.send({ e: event, a: args }, volatile);
      return true;
    },
  });

  class HubSocket implements RealtimeSocket {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same shape as socket.io's `socket.data`
    data: any = {};
    alive = true;
    readonly joined = new Set<string>();
    private readonly listeners = new Map<string, Listener[]>();
    constructor(
      readonly id: string,
      readonly link: HubLink
    ) {}
    on(event: string, listener: Listener) {
      const list = this.listeners.get(event) ?? [];
      list.push(listener);
      this.listeners.set(event, list);
      return this;
    }
    join(room: string) {
      if (!this.alive) return;
      let set = rooms.get(room);
      if (!set) rooms.set(room, (set = new Set()));
      set.add(this.id);
      this.joined.add(room);
    }
    leave(room: string) {
      const set = rooms.get(room);
      set?.delete(this.id);
      if (set && set.size === 0) rooms.delete(room);
      this.joined.delete(room);
    }
    to(room: string) {
      return Object.assign(roomEmitter(room, this.id, false), { volatile: roomEmitter(room, this.id, true) });
    }
    fire(event: string, args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) {
        try {
          fn(...args);
        } catch (err) {
          console.error("[hub]", event, err);
        }
      }
    }
  }

  const server: RealtimeServer = {
    on(event, listener) {
      if (event === "connection") onConnection.push(listener);
      return server;
    },
    to: (room) => roomEmitter(room, null, false),
    sockets: { sockets },
  };

  const drop = (s: HubSocket) => {
    if (!s.alive) return;
    s.alive = false;
    for (const room of [...s.joined]) s.leave(room);
    sockets.delete(s.id);
    s.fire("disconnect", ["transport close"]);
  };

  function connect(link: HubLink): HubConnection {
    const s = new HubSocket(`h${++seq}${Math.random().toString(36).slice(2, 8)}`, link);
    if (closed) {
      link.send({ bye: "closed" }, false);
      link.close();
      return { receive() {}, close() {} };
    }
    sockets.set(s.id, s);
    onConnection.forEach((fn) => fn(s));
    return {
      receive(raw) {
        if (!s.alive || !raw || typeof raw !== "object") return;
        const msg = raw as Partial<HubInbound>;
        if (typeof msg.e !== "string" || RESERVED.has(msg.e) || !Array.isArray(msg.a) || msg.a.length > 8) return;
        const args = [...msg.a];
        if (typeof msg.k === "number") {
          const k = msg.k;
          let done = false;
          args.push((...res: unknown[]) => {
            if (done || !s.alive) return;
            done = true;
            link.send({ k, a: res }, false);
          });
        }
        s.fire(msg.e, args);
      },
      close: () => drop(s),
    };
  }

  /** Tells every client why the hub is going away, then closes their links. */
  function shutdown(reason: string) {
    if (closed) return;
    closed = true;
    for (const s of [...sockets.values()]) {
      s.link.send({ bye: reason }, false);
      s.link.close();
      drop(s);
    }
  }

  return { server, connect, shutdown };
}
