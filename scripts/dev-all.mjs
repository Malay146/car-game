// Runs the standalone realtime server and the Next dev server (pointed at it) together, as on Vercel + Render.
import { spawn } from "node:child_process";

const rtPort = process.env.REALTIME_PORT || "4000";
const webPort = process.env.PORT || "3000";
const children = [
  spawn("npx", ["tsx", "realtime/server.ts"], { stdio: "inherit", env: { ...process.env, PORT: rtPort } }),
  spawn("npx", ["next", "dev", "-p", webPort], {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_REALTIME_URL: `http://localhost:${rtPort}` },
  }),
];
const stop = () => children.forEach((c) => c.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((c) => c.on("exit", stop));
