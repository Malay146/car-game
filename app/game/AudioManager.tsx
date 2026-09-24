"use client";

import { useEffect } from "react";
import { useGameStore } from "./store";
import { useSettings } from "./settings";

/*
 * Web Audio mixer for Chaos Circuit.
 *
 * Bus layout (everything is ramped, never stepped, so there are no clicks):
 *   engine loops -> engineFilter -> engineBus -----------.
 *   skid / wind loops, one-shots, ambience, UI -> sfxBus -+-> master -> compressor -> destination
 *   music elements -> musicSlot gains -> musicDuck -> musicBus -----'
 *
 * Nothing touches the AudioContext before the first user gesture (mobile autoplay policies). Raw
 * bytes for the essential sounds are prefetched at idle time and decoded once the context exists.
 * Long tracks stream through <audio> elements (MediaElementSource) so they never sit decoded in RAM.
 */

const AUDIO = "/audio";
const sfx = (n: string) => `${AUDIO}/sfx/${n}.mp3`;
const amb = (n: string) => `${AUDIO}/ambience/${n}.mp3`;
const mus = (n: string) => `${AUDIO}/music/${n}.mp3`;

const ENGINE_LOOPS = [0, 1, 2, 3, 4, 5].map((i) => `${AUDIO}/engine/loop${i}.wav`);
const CRASH_SOUNDS = [
  `${AUDIO}/impacts/crash-heavy.ogg`,
  `${AUDIO}/impacts/crash-medium.ogg`,
  `${AUDIO}/impacts/crash-light.ogg`,
];
const JINGLE_START = `${AUDIO}/jingles/race-start.ogg`;
const JINGLE_LAP = `${AUDIO}/jingles/lap-complete.ogg`;
const JINGLE_WIN = `${AUDIO}/jingles/race-win.ogg`;
const SKID = sfx("skid-loop");
const WIND = sfx("wind-loop");
const WHOOSH = sfx("boost-whoosh");
const CHIME = sfx("chime");
const LAND = sfx("land");
const THUNDER = [sfx("thunder-1"), sfx("thunder-2"), sfx("thunder-3")];
const UI_CLICK = sfx("ui-click");
const UI_HOVER = sfx("ui-hover");

/** Music playlists per scene. Tracks that fail to load are skipped. */
const MUSIC: Record<string, string[]> = {
  menu: [mus("menu")],
  circuit: [mus("circuit"), mus("circuit-b")],
  desert: [mus("desert")],
  snow: [mus("snow"), mus("snow-b")],
  night: [mus("night")],
};

interface AmbienceLayer {
  url: string;
  gain: number;
  /** Lowpass cutoff in Hz (omit for none). */
  lowpass?: number;
  rate?: number;
}
/** Per-map bed of environmental sound. */
const AMBIENCE: Record<string, AmbienceLayer[]> = {
  circuit: [
    { url: amb("birds"), gain: 1.0 },
    { url: WIND, gain: 0.14, lowpass: 900 },
  ],
  desert: [{ url: amb("wind-desert"), gain: 0.9, lowpass: 2600 }],
  snow: [{ url: amb("wind-snow"), gain: 0.9 }],
  night: [
    { url: amb("crickets"), gain: 0.9 },
    { url: amb("city"), gain: 0.5, lowpass: 3000 },
  ],
};

// What must be ready by the time the countdown ends.
const ESSENTIALS = [...ENGINE_LOOPS, SKID, WIND, WHOOSH, CHIME, LAND, JINGLE_START, ...CRASH_SOUNDS, UI_CLICK, UI_HOVER];

// --- Volume mapping ---------------------------------------------------------------

const taper = (v: number) => Math.max(0, Math.min(1, v)) ** 2; // audio-taper for sliders
const MASTER_TRIM = 1.3;
const SFX_TRIM = 1.5;
const MUSIC_TRIM = 1.8;
const RACE_MUSIC_BED = 0.7; // music level while racing (sits under the engine)

// --- Core graph -------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let musicDuck: GainNode | null = null;
let ambBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let started = false;
let hidden = false;

function ramp(param: AudioParam, value: number, tc = 0.05) {
  if (!ctx) return;
  param.setTargetAtTime(value, ctx.currentTime, tc);
}

function initGraph(c: AudioContext) {
  master = c.createGain();
  master.gain.value = 0; // faded up by applyVolumes so the first sound never pops
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  master.connect(comp).connect(c.destination);

  sfxBus = c.createGain();
  sfxBus.connect(master);
  ambBus = c.createGain();
  ambBus.connect(sfxBus);

  musicBus = c.createGain();
  musicBus.connect(master);
  musicDuck = c.createGain();
  musicDuck.connect(musicBus);

  noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/** Applies master/music/sfx sliders and the mute flag (live, ramped). */
function applyVolumes() {
  if (!ctx || !master || !sfxBus || !musicBus) return;
  const s = useSettings.getState();
  const muted = useGameStore.getState().muted;
  ramp(master.gain, muted ? 0 : taper(s.masterVolume) * MASTER_TRIM, 0.04);
  ramp(sfxBus.gain, taper(s.sfxVolume) * SFX_TRIM, 0.04);
  ramp(musicBus.gain, taper(s.musicVolume) * MUSIC_TRIM, 0.04);
}

/** Must be called from a user gesture. Safe to call repeatedly. */
export function startAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor({ latencyHint: "interactive" });
      initGraph(ctx);
    } catch {
      ctx = null;
      return;
    }
  }
  const c = ctx;
  if (c.state !== "running" && !hidden) {
    c.resume().catch(() => {
      /* autoplay policy: the next gesture retries */
    });
  }
  if (started) return;
  started = true;
  // iOS unlock: a 1-sample buffer started inside the gesture.
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start();
  } catch {
    /* ignore */
  }
  applyVolumes();
  primeMusic();
  syncScene();
  void buildEngineGraph();
  void buildContinuousLoops();
  void preloadEssentials();
}

// --- Buffers: prefetch raw bytes early, decode lazily, share everything ------------

const rawCache = new Map<string, Promise<ArrayBuffer | null>>();
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();

function fetchRaw(url: string): Promise<ArrayBuffer | null> {
  let p = rawCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    rawCache.set(url, p);
  }
  return p;
}

function loadBuffer(url: string): Promise<AudioBuffer | null> {
  let p = bufferCache.get(url);
  if (!p) {
    const c = ctx;
    if (!c) return Promise.resolve(null);
    p = fetchRaw(url)
      .then((raw) => (raw ? c.decodeAudioData(raw.slice(0)) : null))
      .then((buf) => {
        rawCache.delete(url); // bytes no longer needed once decoded
        return buf;
      })
      .catch(() => null);
    bufferCache.set(url, p);
  }
  return p;
}

let preloadPromise: Promise<unknown> | null = null;
function preloadEssentials() {
  if (!preloadPromise) preloadPromise = Promise.all(ESSENTIALS.map(loadBuffer));
  return preloadPromise;
}

/** Fetches (without decoding) so the bytes are warm when audio unlocks. Runs at idle. */
function prefetchEssentials() {
  ESSENTIALS.forEach((u, i) => {
    window.setTimeout(() => void fetchRaw(u), 200 + i * 60);
  });
}

// --- One-shots --------------------------------------------------------------------

const voices = new Map<string, number>();
const MAX_VOICES = 5;

interface ShotOpts {
  gain?: number;
  rate?: number;
  bus?: AudioNode | null;
  lowpass?: number;
  delay?: number;
}

function playSample(url: string, o: ShotOpts = {}) {
  const c = ctx;
  if (!c || hidden) return;
  const asked = performance.now();
  void loadBuffer(url).then((buf) => {
    if (!buf || !ctx || ctx !== c) return;
    if (performance.now() - asked > 900) return; // too late to be useful
    const bus = o.bus ?? sfxBus;
    if (!bus) return;
    const n = voices.get(url) ?? 0;
    if (n >= MAX_VOICES) return;
    voices.set(url, n + 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    let tail: AudioNode = src;
    if (o.lowpass) {
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = o.lowpass;
      tail.connect(f);
      tail = f;
    }
    tail.connect(g).connect(bus);
    src.onended = () => {
      voices.set(url, Math.max(0, (voices.get(url) ?? 1) - 1));
      src.disconnect();
      g.disconnect();
    };
    src.start(c.currentTime + (o.delay ?? 0));
  });
}

/** Short enveloped tone, used for beeps and stingers. Cleans itself up. */
function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine", bus?: AudioNode | null) {
  const c = ctx;
  const out = bus ?? sfxBus;
  if (!c || !out || hidden) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  const t0 = c.currentTime + start;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

function noiseBurst(dur: number, gain: number, f0: number, f1: number, q = 1.2) {
  const c = ctx;
  if (!c || !noiseBuf || !sfxBus || hidden) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = q;
  const g = c.createGain();
  const t0 = c.currentTime;
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

// --- Ducking ----------------------------------------------------------------------

let bedDuck = 1; // constant reduction while racing
let stingDuck = 1; // temporary reduction under jingles / stingers
let stingTimer: number | undefined;

function applyDuck() {
  if (musicDuck) ramp(musicDuck.gain, Math.min(bedDuck, stingDuck), 0.12);
}

/** Lowers the music while a stinger plays, then eases it back. */
function duckMusic(ms: number, level = 0.3) {
  stingDuck = level;
  applyDuck();
  window.clearTimeout(stingTimer);
  stingTimer = window.setTimeout(() => {
    stingDuck = 1;
    applyDuck();
  }, ms);
}

// --- Public one-shot API ----------------------------------------------------------

let lastCrashAt = 0;

/** Impact sound; `intensity` 0..1 picks the sample and volume. */
export function playCrash(intensity = 0.6) {
  const url = intensity > 0.66 ? CRASH_SOUNDS[0] : intensity > 0.33 ? CRASH_SOUNDS[1] : CRASH_SOUNDS[2];
  lastCrashAt = performance.now();
  playSample(url, { gain: 0.3 + 0.6 * Math.min(1, intensity), rate: 0.94 + Math.random() * 0.12 });
}

/** Soft suspension thud after a jump (`intensity` 0..1). Hard hits are covered by playCrash. */
export function playLanding(intensity = 0.5) {
  if (performance.now() - lastCrashAt < 300) return;
  const i = Math.max(0, Math.min(1, intensity));
  playSample(LAND, { gain: 0.35 + 0.55 * i, rate: 1.1 - 0.3 * i + Math.random() * 0.06 });
}

export function playCheckpoint() {
  playSample(CHIME, { gain: 0.5 });
}

export function playRaceStart() {
  duckMusic(2200, 0.35);
  playSample(JINGLE_START, { gain: 0.6 });
}

export function playLapComplete() {
  duckMusic(1800, 0.35);
  playSample(JINGLE_LAP, { gain: 0.65 });
}

/** Stinger for entering the last lap. */
export function playFinalLap() {
  duckMusic(2400, 0.3);
  playSample(JINGLE_LAP, { gain: 0.6 });
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.12 + i * 0.09, 0.5, 0.16, "triangle"));
}

export function playRaceWin() {
  duckMusic(4500, 0.25);
  playSample(JINGLE_WIN, { gain: 0.9 });
}

/** `n` is 3, 2, 1 for the beeps and 0 for GO. */
export function playCountdownBeep(n: number) {
  if (n > 0) {
    tone(440, 0, 0.22, 0.28, "sine");
    tone(880, 0, 0.12, 0.06, "sine");
  } else {
    tone(880, 0, 0.7, 0.3, "sine");
    tone(1320, 0, 0.6, 0.12, "sine");
    tone(1760, 0, 0.35, 0.05, "sine");
  }
}

export function playPickup() {
  [660, 880, 1320].forEach((f, i) => tone(f, i * 0.06, 0.18, 0.16, "square"));
}

export function playBoost() {
  playSample(WHOOSH, { gain: 1.3 });
  [220, 330, 440, 660].forEach((f, i) => tone(f, i * 0.05, 0.2, 0.05, "sawtooth"));
}

/** Turbo blow-off hiss when a boost ends. */
function playBlowOff() {
  noiseBurst(0.45, 0.22, 3800, 1400, 0.9);
}

/** Thunder crack; `distance` 0 (overhead) .. 1 (far away, muffled). */
export function playThunder(distance = 0.5) {
  const d = Math.max(0, Math.min(1, distance));
  const url = THUNDER[Math.floor(Math.random() * THUNDER.length)];
  duckMusic(1800 - 800 * d, 0.6);
  playSample(url, {
    gain: 1 - 0.55 * d,
    rate: 0.9 + Math.random() * 0.2,
    lowpass: 9000 - 7500 * d,
    delay: d * 0.4,
  });
}

let lastClickAt = 0;
export function playUiClick() {
  const now = performance.now();
  if (now - lastClickAt < 40) return;
  lastClickAt = now;
  playSample(UI_CLICK, { gain: 0.5, rate: 0.98 + Math.random() * 0.05 });
}

let lastHoverAt = 0;
export function playUiHover() {
  const now = performance.now();
  if (now - lastHoverAt < 70) return;
  lastHoverAt = now;
  playSample(UI_HOVER, { gain: 0.22 });
}

export function setMuted(muted: boolean) {
  void muted; // the flag lives in the store; applyVolumes reads it
  applyVolumes();
}

// --- Continuous loops: engine, skid, wind ------------------------------------------

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  filter?: BiquadFilterNode;
}

let engineVoices: LoopVoice[] = [];
let engineBus: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let engineBuilding = false;
let skid: LoopVoice | null = null;
let wind: LoopVoice | null = null;
let loopsBuilding = false;

function makeLoop(c: AudioContext, buf: AudioBuffer, out: AudioNode, opts: { lowpass?: number; gain?: number; rate?: number } = {}): LoopVoice {
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  if (opts.rate) src.playbackRate.value = opts.rate;
  const gain = c.createGain();
  gain.gain.value = opts.gain ?? 0;
  let filter: BiquadFilterNode | undefined;
  if (opts.lowpass) {
    filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = opts.lowpass;
    src.connect(filter).connect(gain);
  } else {
    src.connect(gain);
  }
  gain.connect(out);
  // Start at a random offset so layered loops don't phase together.
  src.start(0, Math.random() * buf.duration * 0.9);
  return { src, gain, filter };
}

function stopLoop(v: LoopVoice, fade = 1.2) {
  const c = ctx;
  if (!c) return;
  ramp(v.gain.gain, 0, fade / 4);
  window.setTimeout(() => {
    try {
      v.src.stop();
    } catch {
      /* already stopped */
    }
    v.src.disconnect();
    v.gain.disconnect();
    v.filter?.disconnect();
  }, fade * 1000 + 200);
}

async function buildEngineGraph() {
  const c = ctx;
  if (!c || !sfxBus || engineVoices.length > 0 || engineBuilding) return;
  engineBuilding = true;
  const bufs = await Promise.all(ENGINE_LOOPS.map(loadBuffer));
  engineBuilding = false;
  if (ctx !== c || !sfxBus) return;
  engineFilter = c.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 4000;
  engineFilter.Q.value = 0.6;
  engineFilter.connect(sfxBus);
  engineBus = c.createGain();
  engineBus.gain.value = 0;
  engineBus.connect(engineFilter);
  engineVoices = bufs.flatMap((buf) => (buf ? [makeLoop(c, buf, engineBus!)] : []));
}

async function buildContinuousLoops() {
  const c = ctx;
  if (!c || !sfxBus || loopsBuilding || (skid && wind)) return;
  loopsBuilding = true;
  const [skidBuf, windBuf] = await Promise.all([loadBuffer(SKID), loadBuffer(WIND)]);
  loopsBuilding = false;
  if (ctx !== c || !sfxBus) return;
  if (skidBuf && !skid) skid = makeLoop(c, skidBuf, sfxBus, { lowpass: 9000 });
  if (windBuf && !wind) wind = makeLoop(c, windBuf, sfxBus, { lowpass: 800 });
}

// Engine state carried between frames (module scope: it is audio state, not React state).
let smRpm = 0.2;
let lastRpm = 0.2;
let dip = 0; // seconds of gear-shift dip remaining
let lastShiftAt = 0;
let wasBoosting = false;
let lastFrameAt = 0;
let engineLevel = 0;

function updateContinuous(now: number) {
  const c = ctx;
  if (!c || hidden) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  const s = useGameStore.getState();
  const p = s.player;
  const playing = s.phase === "playing";

  const rawRpm = Math.max(0, Math.min(1, p.rpm));
  const throttle = Math.abs(p.throttle ?? 0);
  const boosting = !!p.boosting;
  const speed = Math.max(0, Math.min(1.4, p.speedKmh / 190));

  // Smooth revs: quick to rise, slower to fall, so shifts and lifts feel weighty.
  const rate = rawRpm > smRpm ? 14 : 8;
  smRpm += (rawRpm - smRpm) * (1 - Math.exp(-dt * rate));

  // Gear-shift dip: revs fall fast while the driver is still on the throttle.
  const slope = (rawRpm - lastRpm) / dt;
  lastRpm = rawRpm;
  if (playing && slope < -1.1 && throttle > 0.2 && now - lastShiftAt > 450) {
    dip = 0.16;
    lastShiftAt = now;
  }
  if (dip > 0) dip = Math.max(0, dip - dt);
  const dipK = dip > 0 ? 1 - 0.45 * Math.min(1, dip / 0.08) : 1;

  if (engineBus && engineFilter && engineVoices.length > 0) {
    const idle = p.speedKmh < 4 && throttle < 0.1;
    const n = engineVoices.length;
    const pos = Math.max(0, Math.min(1, smRpm)) * (n - 1);
    const boostPitch = boosting ? 1.05 : 1;
    const wobble = idle ? Math.sin(now * 0.007) * 0.012 : 0;
    engineVoices.forEach((v, i) => {
      const d = Math.abs(pos - i);
      const w = d >= 1 ? 0 : Math.cos(d * Math.PI * 0.5); // equal-power crossfade
      ramp(v.gain.gain, w, 0.035);
      const pitch = (1 + Math.max(-0.12, Math.min(0.12, (pos - i) * 0.09))) * boostPitch * (idle ? 0.93 : 1) + wobble;
      ramp(v.src.playbackRate, pitch, 0.04);
    });
    const load = 0.3 + 0.7 * throttle;
    const target = playing ? (idle ? 0.26 : 0.3 + 0.5 * throttle + (boosting ? 0.12 : 0)) * dipK : 0;
    engineLevel += (target - engineLevel) * (1 - Math.exp(-dt * 10));
    ramp(engineBus.gain, engineLevel, 0.04);
    // Throttle opens the tone up; lifting off makes the engine duller.
    const cutoff = 900 + 7000 * load * (0.45 + 0.55 * smRpm) * (dip > 0 ? 0.6 : 1) + (boosting ? 1500 : 0);
    ramp(engineFilter.frequency, cutoff, 0.05);
  }

  if (skid) {
    const slip = Math.max(0, Math.min(1, p.slip));
    const on = playing && p.speedKmh > 10 && slip > 0.3;
    const target = on ? Math.min(1, (slip - 0.3) / 0.45) * 0.5 : 0;
    ramp(skid.gain.gain, target, 0.06);
    ramp(skid.src.playbackRate, 0.9 + 0.3 * slip + 0.15 * speed, 0.08);
  }

  if (wind) {
    const v = playing ? Math.min(1, speed + (boosting ? 0.2 : 0)) : 0;
    ramp(wind.gain.gain, 0.85 * v ** 1.6, 0.12);
    if (wind.filter) ramp(wind.filter.frequency, 450 + 5500 * v, 0.12);
    ramp(wind.src.playbackRate, 0.8 + 0.4 * v, 0.12);
  }

  if (wasBoosting && !boosting && playing && p.speedKmh > 40) playBlowOff();
  wasBoosting = boosting;
}

// --- Ambience ---------------------------------------------------------------------

let ambKey: string | null = null;
let ambVoices: LoopVoice[] = [];
let ambToken = 0;

function setAmbience(key: string | null) {
  const c = ctx;
  if (!c || !ambBus || key === ambKey) return;
  ambKey = key;
  const token = ++ambToken;
  const old = ambVoices;
  ambVoices = [];
  old.forEach((v) => stopLoop(v, 1.5));
  if (!key) return;
  const layers = AMBIENCE[key] ?? AMBIENCE.circuit;
  layers.forEach((layer) => {
    void loadBuffer(layer.url).then((buf) => {
      if (!buf || token !== ambToken || ctx !== c || !ambBus) return;
      const v = makeLoop(c, buf, ambBus, { lowpass: layer.lowpass, rate: layer.rate });
      ambVoices.push(v);
      ramp(v.gain.gain, layer.gain, 0.6); // fade in
    });
  });
}

// --- Music (streamed via <audio> elements, cross-faded) -----------------------------

interface MusicSlot {
  el: HTMLAudioElement;
  gain: GainNode;
  url: string | null;
}

const MUSIC_FADE = 1.6; // seconds
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
let slots: MusicSlot[] = [];
let activeSlot = 0;
let musicKey: string | null = null;
let playlistIdx = 0;
let crossfading = false;
let fadeTimer: number | undefined;

function ensureSlots(): boolean {
  const c = ctx;
  if (!c || !musicDuck) return false;
  if (slots.length === 2) return true;
  slots = [0, 1].map(() => {
    const el = new Audio();
    el.preload = "auto";
    el.loop = false;
    const source = c.createMediaElementSource(el);
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(musicDuck!);
    const slot: MusicSlot = { el, gain, url: null };
    el.addEventListener("ended", () => {
      // Safety net if the timer missed the early cross-fade (e.g. a starved main thread).
      if (slot.url && slots[activeSlot] === slot && !crossfading) advanceMusic();
    });
    el.addEventListener("error", () => {
      // Skip a broken track (unsupported codec, 404) unless this was just a silent primer.
      if (slot.url && slots[activeSlot] === slot) advanceMusic(true);
    });
    return slot;
  });
  return true;
}

/** Inside the first gesture, "play" both elements so iOS lets us start them later without one. */
function primeMusic() {
  if (!ensureSlots()) return;
  slots.forEach((s) => {
    s.el.src = SILENT_WAV;
    s.el.play().catch(() => {});
  });
}

function trackFor(key: string, idx: number): string {
  const list = MUSIC[key] ?? MUSIC.circuit;
  return list[idx % list.length];
}

function fadeSlot(slot: MusicSlot, to: number, seconds: number) {
  if (!ctx) return;
  const g = slot.gain.gain;
  const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(to, t + seconds);
}

/** Starts `url` on the idle slot and cross-fades from whatever is playing. */
function crossfadeTo(url: string, fade = MUSIC_FADE) {
  if (!ensureSlots()) return;
  const from = slots[activeSlot];
  const to = slots[1 - activeSlot];
  activeSlot = 1 - activeSlot;
  crossfading = true;
  to.url = url;
  to.el.src = url;
  to.el.currentTime = 0;
  to.gain.gain.cancelScheduledValues(0);
  to.gain.gain.value = 0;
  if (!hidden) to.el.play().catch(() => {});
  fadeSlot(to, 1, fade);
  if (from.url) fadeSlot(from, 0, fade);
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => {
    crossfading = false;
    if (slots[activeSlot] !== from) {
      from.el.pause();
      from.url = null;
    }
  }, fade * 1000 + 150);
}

function advanceMusic(skip = false) {
  if (!musicKey) return;
  playlistIdx += 1;
  const list = MUSIC[musicKey] ?? MUSIC.circuit;
  // A single failing track would retry forever; a 1-track list that errors just stays silent.
  if (skip && list.length < 2) return;
  crossfadeTo(trackFor(musicKey, playlistIdx));
}

function setMusicScene(key: string) {
  if (!ctx || key === musicKey) return;
  musicKey = key;
  playlistIdx = 0;
  crossfadeTo(trackFor(key, 0));
}

/** Called on a timer: starts the next track early enough to overlap the end of this one. */
function watchMusic() {
  if (!ctx || hidden || crossfading || !musicKey) return;
  const slot = slots[activeSlot];
  if (!slot || !slot.url) return;
  const { duration, currentTime, ended } = slot.el;
  if (ended || (Number.isFinite(duration) && duration > 0 && duration - currentTime < MUSIC_FADE + 0.9)) advanceMusic();
}

// --- Scene sync and lifecycle -------------------------------------------------------

function syncScene() {
  if (!ctx) return;
  const g = useGameStore.getState();
  const playing = g.phase === "playing";
  setMusicScene(playing ? g.mapId : "menu");
  setAmbience(playing ? g.mapId : null);
  bedDuck = playing ? RACE_MUSIC_BED : 1;
  applyDuck();
  if (playing) void preloadEssentials();
}

function onVisibility() {
  const c = ctx;
  hidden = document.hidden;
  if (!c) return;
  if (hidden) {
    slots.forEach((s) => s.el.pause());
    c.suspend().catch(() => {});
  } else {
    lastFrameAt = performance.now();
    c.resume().catch(() => {});
    const slot = slots[activeSlot];
    if (slot?.url) slot.el.play().catch(() => {});
    const other = slots[1 - activeSlot];
    if (crossfading && other?.url) other.el.play().catch(() => {});
  }
}

function uiTarget(e: Event): HTMLElement | null {
  const t = e.target;
  if (!(t instanceof Element)) return null;
  const el = t.closest<HTMLElement>("button, a[href], [role='button'], select, summary");
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

/** Renders nothing; owns the audio lifecycle and drives Web Audio from store telemetry. */
export function AudioManager() {
  useEffect(() => {
    useSettings.getState().hydrate();
    hidden = document.hidden;

    // Warm the cache once the page is idle so first paint is never blocked.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(prefetchEssentials, { timeout: 3000 });
    else window.setTimeout(prefetchEssentials, 1500);

    // First gesture unlocks audio (also retried whenever the browser suspends the context).
    const unlock = () => {
      if (!ctx || ctx.state !== "running" || !started) startAudio();
    };
    const unlockEvents = ["pointerdown", "pointerup", "touchstart", "touchend", "keydown", "click"] as const;
    unlockEvents.forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

    // Menu button sounds, delegated so no component needs to call anything.
    let hovered: HTMLElement | null = null;
    const onDown = (e: PointerEvent) => {
      if (uiTarget(e)) playUiClick();
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = uiTarget(e);
      if (el && el !== hovered) playUiHover();
      hovered = el;
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    let raf = 0;
    const tick = (t: number) => {
      updateContinuous(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const musicTimer = window.setInterval(watchMusic, 400);

    const unsubSettings = useSettings.subscribe(applyVolumes);
    const unsubGame = useGameStore.subscribe((s, prev) => {
      if (s.muted !== prev.muted) applyVolumes();
      if (s.phase !== prev.phase || s.mapId !== prev.mapId) syncScene();

      // Countdown beeps: 3, 2, 1, then GO.
      const enteredCountdown = s.phase === "playing" && prev.phase !== "playing" && s.raceState === "countdown";
      if (enteredCountdown || (s.phase === "playing" && s.raceState === "countdown" && s.countdownValue !== prev.countdownValue)) {
        playCountdownBeep(s.countdownValue);
      }
      if (s.raceState === "racing" && prev.raceState === "countdown") {
        playCountdownBeep(0);
        playRaceStart();
      }

      if (s.player.lap > prev.player.lap && s.raceState === "racing") {
        if (s.player.lap === s.totalLaps - 1) playFinalLap();
        else if (s.player.lap < s.totalLaps) playLapComplete();
      }
      if (s.raceState === "finished" && prev.raceState !== "finished") {
        if (s.player.place === 1) playRaceWin();
        else playLapComplete();
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(musicTimer);
      unlockEvents.forEach((ev) => window.removeEventListener(ev, unlock, { capture: true }));
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubSettings();
      unsubGame();
    };
  }, []);

  return null;
}
