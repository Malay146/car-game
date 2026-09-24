import { createServer } from "http";
import net from "net";
import next from "next";
import { Server } from "socket.io";
import { makeIoOptions } from "./realtime/cors";
import { registerRealtime } from "./realtime/rooms";

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

async function main() {
  const port = await findFreePort(preferredPort);
  if (port !== preferredPort) console.log(`> Port ${preferredPort} is busy, using ${port}`);
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res);
  });
  registerRealtime(new Server(httpServer, makeIoOptions()));

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (${dev ? "dev" : "production"})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
