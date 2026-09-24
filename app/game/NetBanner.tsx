"use client";

import { useNetStatus } from "./netStatus";

/** Top-of-screen banner shown while an in-room connection is down and being retried. */
export function ConnectionBanner() {
  const reconnecting = useNetStatus((s) => s.reconnecting);
  if (!reconnecting) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-amber-500/90 px-5 py-2 text-sm font-bold text-black shadow-lg"
    >
      Connection lost. Reconnecting...
    </div>
  );
}

/** A one-off notice on the menu (e.g. "the room no longer exists"), dismissed by the next join/create attempt. */
export function MenuNetMessage() {
  const message = useNetStatus((s) => s.menuMessage);
  if (!message) return null;
  return (
    <p role="alert" className="max-w-sm rounded-md bg-amber-500/20 px-3 py-2 text-center text-sm text-amber-200">
      {message}
    </p>
  );
}
