import type { ServerOptions } from "socket.io";

/** Origins allowed by default: the production site and local development. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://car-game-mu-seven.vercel.app",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

/**
 * Turns the comma separated `ALLOWED_ORIGINS` env value into patterns. Entries are exact
 * origins or contain `*` as a wildcard (e.g. `https://car-game-*.vercel.app`). A lone `*` allows everything.
 */
export function parseAllowedOrigins(raw: string | undefined = process.env.ALLOWED_ORIGINS): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : DEFAULT_ALLOWED_ORIGINS;
}

export function makeOriginCheck(patterns: string[]): (origin: string | undefined, host?: string) => boolean {
  const regexes = patterns.map((p) =>
    p === "*"
      ? /^.*$/
      : new RegExp("^" + p.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$", "i")
  );
  return (origin, host) => {
    // Requests without an Origin header (curl, health checks, server-to-server) are not browsers: allow.
    if (!origin) return true;
    if (regexes.some((r) => r.test(origin))) return true;
    // Same-origin requests (e.g. the dev server opened through a LAN address) are always fine.
    try {
      return !!host && new URL(origin).host === host;
    } catch {
      return false;
    }
  };
}

/** Socket.IO options shared by the dev server and the standalone realtime server. */
export function makeIoOptions(patterns: string[] = parseAllowedOrigins()): Partial<ServerOptions> {
  const allowed = makeOriginCheck(patterns);
  return {
    // Plain WebSocket upgrades are not subject to CORS, so the origin list is enforced here for both
    // transports; the cors block only adds the response headers browsers need for polling.
    allowRequest: (req, cb) => cb(null, allowed(req.headers.origin, req.headers.host)),
    cors: {
      origin: true, // reflect the request origin; disallowed origins are already rejected by allowRequest
      methods: ["GET", "POST"],
    },
    pingInterval: 10000,
    pingTimeout: 8000,
  };
}
