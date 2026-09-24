import { createServer } from "http";
import net from "net";
import next from "next";
import { Server, Socket } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const preferredPort = parseInt(process.env.PORT || "3000", 10);

/** First free port at or above `start`, so another local dev server on 3000 doesn't block us. */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > start + 50) return reject(new Error(`No free port found from ${start}`));
      const probe = net.createServer();
      probe.once("error", () => tryPort(port + 1));
      probe.once("listening", () => probe.close(() => resolve(port)));
      probe.listen(port);
    };
    tryPort(start);
  });
}

const MAX_PLAYERS = 4;

interface Profile {
  name?: string;
  carId?: string;
  paint?: string;
}

interface RoomPlayer {
  id: string;
  name: string;
  carId: string;
  paint: string;
}

const clean = (v: unknown, fallback: string, max = 20) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;

interface Room {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  finished: string[];
  mapId: string;
  /** Free-form host-chosen settings synced to everyone (weather, time of day, mode, laps, ...). */
  options: Record<string, string>;
}

const rooms = new Map<string, Room>();
const roomOf = new Map<string, string>();

function makeCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
    if (!rooms.has(code)) return code;
  }
}

async function main() {
  const port = await findFreePort(preferredPort);
  if (port !== preferredPort) console.log(`> Port ${preferredPort} is busy, using ${port}`);
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res);
  });
  const io = new Server(httpServer);

  const broadcastPlayers = (room: Room) => {
    io.to(room.code).emit("room:players", {
      players: room.players,
      hostId: room.hostId,
      mapId: room.mapId,
      options: room.options,
    });
  };

  const leave = (socket: Socket) => {
    const code = roomOf.get(socket.id);
    if (!code) return;
    roomOf.delete(socket.id);
    socket.leave(code);
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== socket.id);
    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    if (room.hostId === socket.id) room.hostId = room.players[0].id;
    io.to(code).emit("player:left", socket.id);
    broadcastPlayers(room);
  };

  io.on("connection", (socket) => {
    socket.on("room:create", (profile: Profile, mapId: string, ack: (r: unknown) => void) => {
      leave(socket);
      const code = makeCode();
      const room: Room = {
        code,
        hostId: socket.id,
        players: [{ id: socket.id, name: clean(profile?.name, "Player 1"), carId: clean(profile?.carId, "race", 30), paint: clean(profile?.paint, "#e0322f", 9) }],
        finished: [],
        mapId: mapId || "circuit",
        options: {},
      };
      rooms.set(code, room);
      roomOf.set(socket.id, code);
      socket.join(code);
      ack({ ok: true, code, id: socket.id, players: room.players, hostId: room.hostId, mapId: room.mapId, options: room.options });
    });

    socket.on("room:join", (code: string, profile: Profile, ack: (r: unknown) => void) => {
      const room = rooms.get((code || "").toUpperCase());
      if (!room) return ack({ ok: false, error: "Room not found" });
      if (room.players.length >= MAX_PLAYERS) return ack({ ok: false, error: "Room is full" });
      leave(socket);
      room.players.push({
        id: socket.id,
        name: clean(profile?.name, `Player ${room.players.length + 1}`),
        carId: clean(profile?.carId, "race", 30),
        paint: clean(profile?.paint, "#3b82f6", 9),
      });
      roomOf.set(socket.id, room.code);
      socket.join(room.code);
      ack({ ok: true, code: room.code, id: socket.id, players: room.players, hostId: room.hostId, mapId: room.mapId, options: room.options });
      broadcastPlayers(room);
    });

    socket.on("room:map", (mapId: string) => {
      const room = rooms.get(roomOf.get(socket.id) ?? "");
      if (!room || room.hostId !== socket.id || typeof mapId !== "string") return;
      room.mapId = mapId;
      broadcastPlayers(room);
    });

    socket.on("room:options", (patch: Record<string, unknown>) => {
      const room = rooms.get(roomOf.get(socket.id) ?? "");
      if (!room || room.hostId !== socket.id || !patch || typeof patch !== "object") return;
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === "string" && k.length <= 16 && v.length <= 32 && Object.keys(room.options).length < 16) {
          room.options[k] = v;
        }
      }
      broadcastPlayers(room);
    });

    socket.on("room:start", () => {
      const room = rooms.get(roomOf.get(socket.id) ?? "");
      if (!room || room.hostId !== socket.id) return;
      room.finished = [];
      io.to(room.code).emit("race:start");
    });

    socket.on("car:state", (state: unknown) => {
      const code = roomOf.get(socket.id);
      if (code) socket.to(code).volatile.emit("car:state", { id: socket.id, ...(state as object) });
    });

    socket.on("race:finish", () => {
      const room = rooms.get(roomOf.get(socket.id) ?? "");
      if (!room || room.finished.includes(socket.id)) return;
      room.finished.push(socket.id);
      io.to(room.code).emit("race:results", room.finished);
    });

    socket.on("room:leave", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
