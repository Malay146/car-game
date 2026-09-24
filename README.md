# Chaos Circuit

A 3D arcade racing game that runs in the browser. Race a bot, or up to four friends online, on several tracks.
Built with Next.js 16, React 19, React Three Fiber, Rapier physics, zustand and Socket.IO.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrow keys | Drive and steer |
| Space | Brake |
| Shift | Handbrake (drift) |
| E | Use boost item |
| F | Flip the car upright |
| R | Back to the last checkpoint |

## Run it

```bash
npm install
npm run dev        # http://localhost:3000 (auto-picks a free port at or above PORT)
```

`npm run dev` starts `server.ts`, a custom server that runs Next.js and the Socket.IO multiplayer
server on the same port, so online rooms work locally with no extra setup. To try the peer-to-peer
mode that production uses, open `http://localhost:3000/?net=p2p` (or set `NEXT_PUBLIC_NET_MODE=p2p`).

```bash
npm run build      # production build of the frontend
npm start          # production: custom server (Next + realtime) via tsx
npm run lint
npm run dev:all    # frontend (:3000) and standalone realtime server (:4000) as two processes, like production
```

## Architecture

- `app/game/` is the client. `Car.tsx` is the arcade vehicle model on a Rapier body, `Track.tsx`,
  `trackPath.ts` and `maps.ts` build the tracks, `store.ts` (zustand) holds game state, `HUD.tsx`,
  `Results.tsx` and `Minimap.tsx` are the UI, `net.ts` is the network client (Socket.IO or
  peer-to-peer, see `p2p.ts`).
- `realtime/` is the multiplayer logic. `rooms.ts` holds all room and race logic behind a tiny
  socket-like interface (no Node-only imports) and is shared by
  - `server.ts` (dev / self-hosted: Next.js and Socket.IO in one process),
  - `realtime/server.ts` (standalone: plain http + Socket.IO with `/healthz`), and
  - the host's browser in peer-to-peer mode: `realtime/hub.ts` is an in-memory stand-in for a
    Socket.IO server, fed by WebRTC data channels (`app/game/p2p.ts`, PeerJS).
- Online play details:
  - Cars send their state ~30 times per second. Remote cars are drawn about 100 ms in the past by
    interpolating buffered, timestamped snapshots (`remoteBuffer.ts`), with capped extrapolation (250 ms)
    when a packet is late.
  - The server is authoritative for results. It rate-limits and validates every state message,
    drops teleports and speed hacks, recomputes each player's lap progress from their position on the
    track, and only accepts `race:finish` when that progress and the elapsed time are plausible.
    Finish times are measured with the server clock.
  - Dropped connections keep their seat for 25 s and the client reclaims it automatically (banner
    shown meanwhile). Host leaves: another player becomes host (dedicated server only; in P2P the
    room lives in the host's browser, so guests return to the menu with "The host left the room").
    If the room is gone the player is sent back to the menu with a message.
  - Hidden tabs: browsers stop `requestAnimationFrame` in background tabs. `HiddenTabKeeper` keeps the
    simulation running from a Web Worker timer while the tab is hidden, so your car keeps racing.
    It cannot help if the browser freezes or discards the tab (phone backgrounding, memory saver).

## Deploying

The frontend deploys to Vercel as a plain Next.js app (`npm run build`). Online play then works in one
of two ways, chosen when the client bundle is built:

| | Peer-to-peer (default) | Dedicated realtime server |
| --- | --- | --- |
| Enabled when | `NEXT_PUBLIC_REALTIME_URL` is **not** set | `NEXT_PUBLIC_REALTIME_URL` is set |
| Setup | none | deploy `realtime/server.ts` (below) |
| Who runs the room | the host's browser | the server |
| Host leaves | room closes, guests go back to the menu | another player becomes host |

### Peer-to-peer (no server)

When a player creates a room, their browser registers a PeerJS id `chaoscircuit-<CODE>` with the free
public PeerJS broker (`0.peerjs.com`, used only to exchange connection offers) and runs the same room
and race logic as the server (`realtime/rooms.ts`, including anti-cheat and server-clock results)
locally. Guests connect straight to the host over WebRTC data channels (Google's public STUN server
for NAT traversal); car states use an unordered, no-retransmit channel, everything else a reliable one.
The host plays through an in-memory loopback, so every player uses the same code path.

Limits:

- The host must keep the game open (backgrounding the tab on a phone may freeze it). If the host
  leaves, the room ends.
- There is no TURN relay: players behind strict/symmetric NATs, some mobile carriers and some
  corporate or school networks may not be able to connect ("Couldn't reach that room ..."). Try
  another network (e.g. Wi-Fi instead of mobile data), or deploy the dedicated server.
- Depends on the public PeerJS broker being up. Guests reconnect automatically for a few seconds
  after a drop; after that they return to the menu.

Force a mode for testing with `?net=p2p` / `?net=socket` in the URL, or `NEXT_PUBLIC_NET_MODE=p2p|socket`
at build time (`npm start`, the self-hosted custom server, needs `NEXT_PUBLIC_NET_MODE=socket` to use its
built-in Socket.IO server; `npm run dev` uses it by default).

### Dedicated realtime server (optional)

When `NEXT_PUBLIC_REALTIME_URL` is set, the client ignores P2P and connects to that Socket.IO server
instead. Use it when players hit NAT problems or rooms must survive the host leaving. It is deployed
separately, because Vercel cannot run a long-lived Socket.IO server.

```
Browser --https--> Vercel (Next.js frontend)
Browser --wss----> Render / Fly / Docker host (realtime/server.ts, Socket.IO)
```

### 1. Realtime server (Render, free plan)

1. Push the repo to GitHub. In Render choose **New > Blueprint** and select the repo; it reads
   [`render.yaml`](render.yaml) (build `npm ci --include=dev`, start `npx tsx realtime/server.ts`,
   health check `/healthz`). Or create a **Web Service** by hand with those two commands.
2. Environment variables on the Render service:

   | Variable | Value |
   | --- | --- |
   | `ALLOWED_ORIGINS` | Comma separated browser origins allowed to connect, e.g. `https://car-game-mu-seven.vercel.app`. `*` works as a wildcard inside an entry (`https://car-game-*.vercel.app` for preview deployments). Default if unset: the production Vercel domain plus `http://localhost:*`. |
   | `PORT` | Set by Render automatically. Local default is 4000. |
   | `NODE_VERSION` | `22` (set in `render.yaml`). |

3. Note the service URL, e.g. `https://chaos-circuit-realtime.onrender.com`.

Render's free web services sleep after ~15 minutes without traffic and take up to a minute to wake
up. The game shows "Online play is unavailable right now" if it cannot connect within 5 s; visiting
`/healthz` first, or retrying after a minute, wakes it up. A paid instance stays awake.

**Fly.io / Docker instead:** [`Dockerfile.realtime`](Dockerfile.realtime) builds the same server.

```bash
docker build -f Dockerfile.realtime -t chaos-realtime .
docker run -p 4000:4000 -e ALLOWED_ORIGINS=https://car-game-mu-seven.vercel.app chaos-realtime
# Fly: fly launch --dockerfile Dockerfile.realtime --internal-port 4000, then fly secrets set ALLOWED_ORIGINS=...
```

Run a single instance: rooms live in that process's memory.

### 2. Frontend (Vercel)

In the Vercel project, **Settings > Environment Variables**, add for Production (and Preview if you
use it):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_REALTIME_URL` | The realtime server's public URL, with `https://` and no trailing slash, e.g. `https://chaos-circuit-realtime.onrender.com` |

`NEXT_PUBLIC_*` values are compiled into the client bundle, so **redeploy** after adding or changing it.
Without it a production build uses peer-to-peer (see above); remove it to go back to P2P.

### 3. Verify

1. `curl https://<realtime-host>/healthz` returns `{"ok":true,...}`.
2. CORS check (should print an `access-control-allow-origin` header equal to the origin, and 403 for
   an origin that is not allowed):

   ```bash
   curl -si -H "Origin: https://car-game-mu-seven.vercel.app" "https://<realtime-host>/socket.io/?EIO=4&transport=polling" | head -5
   ```
3. Open the Vercel site in two browsers, **Create online room** in one, **Join** with the code in the other, start a race.
4. Optional protocol and anti-cheat self-test against any realtime server (takes ~40 s):

   ```bash
   REALTIME_URL=https://<realtime-host> npm run realtime:test
   ```

### Running the split locally

```bash
npm run dev:all
# or by hand:
PORT=4000 npm run realtime
NEXT_PUBLIC_REALTIME_URL=http://localhost:4000 npx next dev -p 3000
```

## Credits

Third-party assets keep their own licences: see the `LICENSE*.txt` files under `public/audio`, `public/hdr` and `public/models`.
