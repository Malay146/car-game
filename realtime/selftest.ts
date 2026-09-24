/**
 * End-to-end check of a running realtime server (local or deployed) using headless socket clients:
 * rooms, host migration, reconnect, anti-cheat (teleport / NaN / flood / early finish) and a full
 * server-timed one-lap race.
 *
 *   npm run realtime                          # in one terminal
 *   REALTIME_URL=http://localhost:4000 npm run realtime:test
 *
 * Takes about 40 seconds (one real lap at ~70 units/s).
 */
import { io, type Socket } from "socket.io-client";
import { generateCenterline, getTrackLength } from "../app/game/trackPath";

const URL = process.env.REALTIME_URL || "http://localhost:4000";
const MAP = "circuit";
const path = generateCenterline(MAP);
const LEN = getTrackLength(MAP);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ["websocket"], reconnection: false, timeout: 8000 });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
}
const call = (s: Socket, ev: string, ...args: unknown[]) =>
  new Promise<Any>((resolve) => s.timeout(5000).emit(ev, ...args, (err: Error | null, ack: Any) => resolve(err ? { ok: false, error: "timeout" } : ack)));

/** State for a car at fractional path index `f` (in samples). */
function stateAt(f: number, extra: Any = {}): Any {
  const n = path.length;
  const i = Math.floor(f);
  const k = f - i;
  const a = path[((i % n) + n) % n];
  const b = path[(((i + 1) % n) + n) % n];
  const h = a.heading;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + 0.6,
    z: a.z + (b.z - a.z) * k,
    qx: 0,
    qy: Math.sin(h / 2),
    qz: 0,
    qw: Math.cos(h / 2),
    vx: 0,
    vz: 0,
    speedKmh: 200,
    steer: 0,
    t: performance.now(),
    ...extra,
  };
}

async function main() {
  console.log(`Testing ${URL} (track ${Math.round(LEN)} units)`);
  const a = await connect();
  const b = await connect();
  const profileA = { name: "Alice", carId: "race", paint: "#ff0000" };
  const created = await call(a, "room:create", profileA, MAP);
  check("create room", created.ok && /^[A-Z]{4}$/.test(created.code) && created.id && created.token, created.code);
  const joined = await call(b, "room:join", created.code, { name: "Bob", carId: "race", paint: "#00ff00" });
  check("join room", joined.ok && joined.players.length === 2 && joined.players[1].name === "Bob");
  check("join unknown room fails", (await call(await connect(), "room:join", "ZZZZ", {})).ok === false);

  a.emit("room:options", { laps: "1" });
  await sleep(150);

  // --- start, then cheating attempts by Bob --------------------------------------------------
  const seenByA: Any[] = [];
  a.on("car:state", (m: Any) => seenByA.push(m));
  const results: Any[] = [];
  a.on("race:results", (m: Any) => results.push(m));
  const startedAt = Date.now();
  const startAck = await call(b, "room:start");
  check("non-host cannot start", startAck.ok === false);
  const start = await call(a, "room:start");
  check("host starts race", start.ok === true);
  const startIdx = path.length - 6;

  b.volatile.emit("car:state", stateAt(startIdx));
  await sleep(120);
  check("valid state is relayed", seenByA.length === 1 && seenByA[0].id === joined.id);
  seenByA.length = 0;

  b.volatile.emit("car:state", stateAt(startIdx + 4, { x: NaN }));
  b.volatile.emit("car:state", stateAt(startIdx + 4, { speedKmh: 1e9 }));
  b.volatile.emit("car:state", stateAt(startIdx + 4, { y: 5000 }));
  await sleep(150);
  check("non-finite / absurd values are dropped", seenByA.length === 0);

  b.volatile.emit("car:state", stateAt(startIdx + 400)); // ~600 units ahead in a blink
  await sleep(150);
  check("forward teleport is dropped", seenByA.length === 0);

  const fin0 = await call(b, "race:finish", { bestLapMs: 1000 });
  check("early finish is rejected", fin0.ok === false, fin0.error);

  // A backwards jump (respawn) is allowed.
  b.volatile.emit("car:state", stateAt(startIdx - 60));
  await sleep(150);
  check("respawn-style backward jump is accepted", seenByA.length === 1);
  seenByA.length = 0;

  for (let i = 0; i < 300; i++) b.volatile.emit("car:state", stateAt(startIdx - 60));
  await sleep(400);
  check("state flood is rate limited", seenByA.length > 0 && seenByA.length < 40, `${seenByA.length} of 300 relayed`);

  // --- reconnect + host migration ------------------------------------------------------------
  const c = await connect();
  const cj = await call(c, "room:join", created.code, { name: "Cara" });
  check("cannot join a race in progress", cj.ok === false, cj.error);
  b.disconnect();
  await sleep(300);
  const b2 = await connect();
  const re = await call(b2, "room:rejoin", created.code, joined.id, joined.token);
  check("reconnect reclaims the seat", re.ok === true && re.id === joined.id);
  const bad = await call(await connect(), "room:rejoin", created.code, joined.id, "wrongtoken");
  check("reconnect with wrong token fails", bad.ok === false);
  c.disconnect();

  // --- a full, honestly driven lap by Alice ---------------------------------------------------
  await sleep(Math.max(0, startedAt + 2400 - Date.now())); // wait for the countdown to finish
  const speed = 70; // units / second, under the server's limit
  const hz = 30;
  const step = speed / hz / 1.5; // samples per message
  let idx = startIdx;
  const bestLap = Math.round((LEN / speed) * 1000);
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      idx += step;
      a.volatile.emit("car:state", stateAt(idx));
      if (idx - startIdx > path.length + 3) {
        clearInterval(timer);
        resolve();
      }
    }, 1000 / hz);
  });
  const fin = await call(a, "race:finish", { bestLapMs: bestLap });
  const elapsed = Date.now() - startedAt;
  check("honest finish is accepted", fin.ok === true, fin.error);
  await sleep(200);
  const last = results[results.length - 1];
  const entry = last?.entries?.[0];
  check("results carry server timing", !!entry && entry.name === "Alice" && Math.abs(entry.timeMs - (elapsed - 2400)) < 2500, `timeMs=${entry?.timeMs}`);
  check("best lap is clamped to sane range", !!entry && entry.bestLapMs !== null && entry.bestLapMs <= entry.timeMs);
  check("race stays open while Bob races", last?.over === false);

  const bobLeaves = new Promise<Any>((resolve) => a.on("room:players", (m: Any) => m.players.length === 1 && resolve(m)));
  const over = new Promise<Any>((resolve) => a.on("race:results", (m: Any) => m.over && resolve(m)));
  b2.emit("room:leave");
  const snap = await Promise.race([bobLeaves, sleep(3000).then(() => null)]);
  check("player leaving mid-race updates the room", !!snap);
  const overMsg = await Promise.race([over, sleep(3000).then(() => null)]);
  check("race closes once nobody is left racing", !!overMsg);

  a.disconnect();
  b2.disconnect();
  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("selftest crashed:", e);
  process.exit(1);
});
