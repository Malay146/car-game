import { create } from "zustand";

/** Connection health shown by the ConnectionBanner and the menu; written by net.ts. */
interface NetStatus {
  /** True while an in-room connection dropped and we are retrying. */
  reconnecting: boolean;
  /** A one-off message for the menu (e.g. the room disappeared while we were away). */
  menuMessage: string | null;
  setReconnecting: (v: boolean) => void;
  setMenuMessage: (m: string | null) => void;
}

export const useNetStatus = create<NetStatus>((set) => ({
  reconnecting: false,
  menuMessage: null,
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setMenuMessage: (menuMessage) => set({ menuMessage }),
}));
