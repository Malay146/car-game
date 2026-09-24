/**
 * Standalone realtime server: plain http + Socket.IO, no Next.js. Deploy this next to (or instead of)
 * the custom Next server when the frontend is hosted somewhere that cannot keep WebSockets open (Vercel).
 *
 *   PORT             port to listen on (default 4000)
 *   ALLOWED_ORIGINS  comma separated browser origins allowed to connect; `*` wildcards work
 *                    (default: the Vercel site plus localhost)
 */
import { createServer } from "http";
import { Server } from "socket.io";
import { makeIoOptions, parseAllowedOrigins } from "./cors";
import { registerRealtime } from "./rooms";

const port = parseInt(process.env.PORT || "4000", 10);
const origins = parseAllowedOrigins();
const startedAt = Date.now();

const httpServer = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/healthz" || url.startsWith("/healthz?")) {
    const body = JSON.stringify({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000), ...realtime.stats() });
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(body);
    return;
  }
  if (url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Chaos Circuit realtime server. Socket.IO endpoint: /socket.io/  Health: /healthz\n");
    return;
  }
  // Socket.IO answers /socket.io/ itself; anything else is not ours.
  if (!url.startsWith("/socket.io")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found\n");
  }
});

const io = new Server(httpServer, makeIoOptions(origins));
const realtime = registerRealtime(io);

httpServer.listen(port, () => {
  console.log(`> Realtime server listening on :${port}`);
  console.log(`> Allowed origins: ${origins.join(", ")}`);
});

const shutdown = () => {
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
