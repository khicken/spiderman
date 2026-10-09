import * as THREE from "three";
import type { CarSpec, EngineInput, MapId, Sfx, Surface, Weather } from "../../contracts";
import { SFX, bakeSfx } from "../../audio-sfx";
import { createAmbience } from "../../audio-ambience";
import { createVoice, type Ears } from "../../audio-engine";
import { workletCode } from "../../audio-code";
import { loadWorklet } from "../../audio-worklet";
import { gain, impulse, masterChain } from "../../audio-dsp";
import { type MusicCmd, musicNode } from "../../audio-music";

// Lab only: offline renders for measurement.
export type Frame = { t: number; i: EngineInput };

export function input(o: Partial<EngineInput> = {}): EngineInput {
  return { rpm: 1000, throttle: 0, load: 0, gear: 1, boost: 0, speed: 0, limiter: false, skid: 0, surface: "asphalt", pos: new THREE.Vector3(), tunnel: false, ...o };
}

// Full throttle through the gears, lift off, limiter bounce, idle.
export function sweep(spec: CarSpec, dur = 14, hz = 120): Frame[] {
  const e = spec.engine;
  const ev = e.layout === "electric";
  const fr: Frame[] = [];
  let rpm = ev ? 0 : e.idle;
  let gear = 1;
  let boost = 0;
  let speed = 0;
  let shift = 0;
  const ratio = (g: number) => spec.gears[Math.min(spec.gears.length, g) - 1] * spec.final;
  for (let k = 0; k < dur * hz; k++) {
    const t = k / hz;
    const dt = 1 / hz;
    let thr = 0;
    let load = 0;
    let lim = false;
    if (t < 1.2) rpm += ((ev ? 0 : e.idle) - rpm) * 0.1;
    else if (t < 8.5) {
      thr = shift > 0 ? 0.2 : 1;
      load = shift > 0 ? 0 : 1;
      if (shift > 0) shift -= dt;
      rpm += (ev ? 2600 : e.redline * 0.9) * dt / (0.5 + 0.55 * gear);
      if (!ev && rpm >= e.redline * 0.98 && gear < Math.min(5, spec.gears.length)) {
        rpm *= ratio(gear + 1) / ratio(gear);
        gear++;
        shift = spec.shiftTime;
      }
      if (ev) rpm = Math.min(rpm, e.redline);
      if (!ev && gear === Math.min(5, spec.gears.length) && rpm > e.limiter) {
        rpm = e.limiter - 250;
        lim = true;
      }
    } else if (t < 11) {
      load = -1;
      rpm = Math.max(ev ? 0 : e.idle * 1.2, rpm - (ev ? 1500 : 1300) * dt);
    } else if (t < 12.6 && !ev) {
      gear = 0;
      thr = 1;
      load = 0.3;
      rpm += 9000 * dt;
      if (rpm > e.limiter) {
        rpm = e.limiter - 400;
        lim = true;
      }
    } else {
      gear = 1;
      rpm += ((ev ? 0 : e.idle) - rpm) * 0.05;
    }
    speed = gear > 0 ? (rpm / 60) * 2 * Math.PI * spec.body.wheelR / ratio(gear) : speed * 0.99;
    boost += ((thr > 0.5 ? Math.min(1, rpm / e.redline + 0.2) : 0) - boost) * (thr > 0.5 ? 0.02 : 0.15);
    fr.push({ t, i: input({ rpm, throttle: thr, load, gear, boost, speed, limiter: lim }) });
  }
  return fr;
}

export function steady(rpm: number, throttle: number, dur = 2, hz = 60, o: Partial<EngineInput> = {}): Frame[] {
  return Array.from({ length: dur * hz }, (_, k) => ({ t: k / hz, i: input({ rpm, throttle, load: throttle, speed: 20, ...o }) }));
}

export function skidRun(surface: Surface, dur = 4, hz = 60): Frame[] {
  return Array.from({ length: dur * hz }, (_, k) => {
    const t = k / hz;
    const skid = t < 0.5 ? 0 : Math.min(1, (t - 0.5) / 1.2) * (t > 3.4 ? 0 : 1);
    return { t, i: input({ rpm: 3500, throttle: 0.5, load: 0.4, gear: 3, speed: 22, skid, surface }) };
  });
}

const ears: Ears = { pos: { x: 0, y: 1, z: -4 }, vel: { x: 0, y: 0, z: 0 }, wet: 0 };

export function passBy(dur = 6, hz = 60, v = 70): Frame[] {
  return Array.from({ length: dur * hz }, (_, k) => {
    const t = k / hz;
    return { t, i: input({ rpm: 6000, throttle: 1, load: 1, gear: 4, speed: v, pos: new THREE.Vector3(-v * dur * 0.5 + v * t, 0.5, 12) }) };
  });
}

export async function renderEngine(spec: CarSpec, frames: Frame[], dur: number, opts: { player?: boolean; count?: number; ear?: number[] } = {}) {
  ears.pos = { x: opts.ear?.[0] ?? 0, y: opts.ear?.[1] ?? 1, z: opts.ear?.[2] ?? -4 };
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const ready = loadWorklet(ctx, workletCode());
  await ready;
  const count = opts.count ?? 1;
  const voices = Array.from({ length: count }, (_, j) => createVoice(ctx, ctx.destination, spec, j === 0 && opts.player !== false, ears, ready));
  await new Promise((r) => setTimeout(r, 0));
  for (const f of frames) for (const v of voices) v.apply(f.i, f.t);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), ms };
}

export async function renderMusic(script: MusicCmd[], dur: number, seed = 3) {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  await loadWorklet(ctx, workletCode());
  const m = masterChain(ctx, ctx.destination);
  const bus = gain(ctx, m.input, 0.8);
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, "hall");
  verb.connect(bus);
  musicNode(ctx, bus, verb, { script, seed });
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), ms: performance.now() - t0 };
}

export async function renderSfx() {
  const sr = 48000;
  const parts: { name: string; k: number; buf: AudioBuffer }[] = [];
  for (const name of Object.keys(SFX) as Sfx[]) for (let k = 0; k < SFX[name].n; k++) parts.push({ name, k, buf: await bakeSfx(sr, name, k) });
  const gap = Math.floor(sr * 0.25);
  const total = parts.reduce((a, p) => a + p.buf.length + gap, 0);
  const L = new Float32Array(total);
  let o = 0;
  const info: string[] = [];
  for (const p of parts) {
    const d = p.buf.getChannelData(0);
    let rms = 0;
    for (let i = 0; i < d.length; i++) {
      L[o + i] = d[i] * SFX[p.name as Sfx].g;
      rms += d[i] * d[i];
    }
    info.push(`${p.name}${p.k}@${(o / sr).toFixed(2)}s rms${(10 * Math.log10(rms / d.length + 1e-12)).toFixed(0)}`);
    o += d.length + gap;
  }
  return { L, R: L, ms: 0, info: info.join(" ") };
}

export async function renderAmbience(map: MapId, weather: Weather, night: number, dur: number) {
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const m = masterChain(ctx, ctx.destination);
  const amb = createAmbience(ctx, gain(ctx, m.input, 0.9));
  amb.set(map, weather, night);
  for (let t = 0.25; t < dur; t += 0.25) void ctx.suspend(t).then(() => { amb.tick(); void ctx.resume(); });
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  return { L: buf.getChannelData(0), R: buf.getChannelData(1), ms: performance.now() - t0 };
}
