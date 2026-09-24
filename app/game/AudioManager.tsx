"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "./store";

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let started = false;

const bufferCache = new Map<string, AudioBuffer>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = useGameStore.getState().muted ? 0 : 0.8;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

/** Must be called from a user gesture (click/keydown) to satisfy autoplay policies. */
export function startAudio() {
  const c = getCtx();
  if (!c || started) return;
  started = true;
  if (c.state === "suspended") c.resume();
  buildEngineGraph();
  buildScreechGraph();
  startMusic();
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const c = getCtx();
  if (!c) return null;
  const cached = bufferCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const buf = await c.decodeAudioData(arr);
    bufferCache.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

function playOneShot(url: string, gain = 0.9) {
  const c = getCtx();
  if (!c || !masterGain) return;
  loadBuffer(url).then((buf) => {
    if (!buf || !c || !masterGain) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(masterGain);
    src.start();
  });
}

const CRASH_SOUNDS = [
  "/audio/impacts/crash-heavy.ogg",
  "/audio/impacts/crash-medium.ogg",
  "/audio/impacts/crash-light.ogg",
];

/** Impact sound; `intensity` 0..1 picks the sample and volume. */
export function playCrash(intensity = 0.6) {
  const url = intensity > 0.66 ? CRASH_SOUNDS[0] : intensity > 0.33 ? CRASH_SOUNDS[1] : CRASH_SOUNDS[2];
  playOneShot(url, 0.3 + 0.6 * Math.min(1, intensity));
}

export function playRaceStart() {
  playOneShot("/audio/jingles/race-start.ogg", 0.7);
}

export function playLapComplete() {
  playOneShot("/audio/jingles/lap-complete.ogg", 0.7);
}

export function playRaceWin() {
  playOneShot("/audio/jingles/race-win.ogg", 0.9);
}

function blip(freqs: number[], step: number, type: OscillatorType = "square", gain = 0.18) {
  const c = getCtx();
  if (!c || !masterGain) return;
  freqs.forEach((f, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    const t0 = c.currentTime + i * step;
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + step * 1.6);
    osc.connect(g).connect(masterGain!);
    osc.start(t0);
    osc.stop(t0 + step * 1.8);
  });
}

export const playPickup = () => blip([660, 880, 1320], 0.06);
export const playBoost = () => blip([220, 330, 440, 660, 880], 0.05, "sawtooth", 0.2);

export function setMuted(muted: boolean) {
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
  }
}

// --- Engine: six recorded loops (low to high revs) cross-faded by RPM -----------

const ENGINE_LOOPS = [0, 1, 2, 3, 4, 5].map((i) => `/audio/engine/loop${i}.wav`);
let engineNodes: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
let engineBus: GainNode | null = null;
let engineBuilding = false;

async function buildEngineGraph() {
  const c = getCtx();
  if (!c || !masterGain || engineNodes.length > 0 || engineBuilding) return;
  engineBuilding = true;
  const bufs = await Promise.all(ENGINE_LOOPS.map((u) => loadBuffer(u)));
  engineBus = c.createGain();
  engineBus.gain.value = 0;
  engineBus.connect(masterGain);
  engineNodes = bufs.flatMap((buf) => {
    if (!buf) return [];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = c.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(engineBus!);
    src.start();
    return [{ src, gain }];
  });
  engineBuilding = false;
}

function updateEngine(rpm: number, throttle: number) {
  const c = getCtx();
  if (!c || !engineBus || engineNodes.length === 0) return;
  const now = c.currentTime;
  const pos = Math.max(0, Math.min(1, rpm)) * (engineNodes.length - 1);
  const frac = pos - Math.floor(pos);
  engineNodes.forEach((n, i) => {
    const w = Math.max(0, 1 - Math.abs(pos - i));
    n.gain.gain.setTargetAtTime(w, now, 0.05);
    n.src.playbackRate.setTargetAtTime(0.94 + frac * 0.1 + (i === Math.round(pos) ? 0 : 0), now, 0.05);
  });
  engineBus.gain.setTargetAtTime(throttle < 0 ? 0 : 0.32 + 0.5 * throttle, now, 0.08);
}

// --- Music -------------------------------------------------------------------------

let musicSrc: AudioBufferSourceNode | null = null;
let musicGain: GainNode | null = null;

async function startMusic() {
  const c = getCtx();
  if (!c || !masterGain || musicSrc) return;
  const buf = await loadBuffer("/audio/music/race.ogg");
  if (!buf || musicSrc) return;
  musicGain = c.createGain();
  musicGain.gain.value = 0.28;
  musicGain.connect(masterGain);
  musicSrc = c.createBufferSource();
  musicSrc.buffer = buf;
  musicSrc.loop = true;
  musicSrc.connect(musicGain);
  musicSrc.start();
}

// --- Synthesized tire screech --------------------------------------------------

let screechSource: AudioBufferSourceNode | null = null;
let screechFilter: BiquadFilterNode | null = null;
let screechGain: GainNode | null = null;

function buildScreechGraph() {
  const c = getCtx();
  if (!c || !masterGain || screechSource) return;

  const bufferSize = c.sampleRate * 2;
  const noiseBuffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  screechSource = c.createBufferSource();
  screechSource.buffer = noiseBuffer;
  screechSource.loop = true;
  screechFilter = c.createBiquadFilter();
  screechFilter.type = "bandpass";
  screechFilter.frequency.value = 1800;
  screechFilter.Q.value = 6;
  screechGain = c.createGain();
  screechGain.gain.value = 0;

  screechSource.connect(screechFilter).connect(screechGain).connect(masterGain);
  screechSource.start();
}

function updateScreech(slip: number) {
  const c = getCtx();
  if (!c || !screechGain) return;
  const clamped = Math.max(0, Math.min(1, slip));
  const target = clamped > 0.35 ? (clamped - 0.35) * 0.55 : 0;
  screechGain.gain.setTargetAtTime(target, c.currentTime, 0.05);
}

/** Renders nothing; drives Web Audio from store telemetry on a rAF loop. */
export function AudioManager() {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const s = useGameStore.getState();
      updateEngine(s.player.rpm, s.phase === "playing" ? (s.player.throttle ?? 0) : -1);
      updateScreech(s.player.slip);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const unsub = useGameStore.subscribe((s, prev) => {
      if (s.muted !== prev.muted) setMuted(s.muted);
      if (s.raceState === "racing" && prev.raceState !== "racing") playRaceStart();
      if (s.player.lap > prev.player.lap && s.raceState === "racing") playLapComplete();
      if (s.raceState === "finished" && prev.raceState !== "finished" && s.player.place === 1) {
        playRaceWin();
      }
    });
    return unsub;
  }, []);

  return null;
}
