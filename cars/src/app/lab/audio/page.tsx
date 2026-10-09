"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Audio, CarId, EngineVoice, MapId, MusicState, Sfx, Surface, Weather } from "../../contracts";
import { CARS } from "../../cars";
import { createAudio } from "../../audio";
import { SFX } from "../../audio-sfx";
import { input, passBy, renderAmbience, renderEngine, renderMusic, renderSfx, skidRun, steady, sweep } from "./render";

const b64 = (a: Float32Array) => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

const MAPS: MapId[] = ["monaco", "nordschleife", "tokyo", "sanfrancisco", "stelvio", "spa"];
const SURF: Surface[] = ["asphalt", "curb", "grass", "gravel", "dirt", "snow", "cobble"];
const WEATHER: Weather[] = ["clear", "overcast", "rain", "fog", "snow"];
const STATES: MusicState[] = ["menu", "race", "final", "results", "off"];

type Ctl = { car: CarId; rpm: number; thr: number; auto: boolean; skid: number; surface: Surface; tunnel: boolean; cockpit: boolean };

export default function AudioLab() {
  const audio = useRef<Audio | null>(null);
  const ctl = useRef<Ctl>({ car: "gt3", rpm: 3000, thr: 0, auto: false, skid: 0, surface: "asphalt", tunnel: false, cockpit: false });
  const [on, setOn] = useState(false);
  const [ui, setUi] = useState({ ...ctl.current, music: "menu" as MusicState, map: "tokyo" as MapId, weather: "clear" as Weather, night: 0, vol: 1, mvol: 1, muted: false });
  const hud = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__audioLab = {
      async engine(id: string, kind: string, arg: number[] = []) {
        const spec = CARS.find((c) => c.id === id)!;
        const [fr, dur] = kind === "sweep" ? [sweep(spec), 14] : kind === "steady" ? [steady(arg[0], arg[1]), 2] : kind === "passby" ? [passBy(), 6] : [skidRun(kind.slice(5) as Surface), 4];
        const r = await renderEngine(spec, fr, dur, { count: arg[2] ?? 1, player: arg[3] !== 0, ear: arg[4] === 1 ? [0, 0.6, 0.2] : undefined });
        return { L: b64(r.L), R: b64(r.R), ms: r.ms };
      },
      async sfx() {
        const r = await renderSfx();
        return { L: b64(r.L), R: b64(r.R), ms: 0, info: r.info };
      },
      async amb(map: MapId, weather: Weather, night: number, dur: number) {
        const r = await renderAmbience(map, weather, night, dur);
        return { L: b64(r.L), R: b64(r.R), ms: r.ms };
      },
      async music(script: never[], dur: number, seed = 3) {
        const r = await renderMusic(script, dur, seed);
        return { L: b64(r.L), R: b64(r.R), ms: r.ms };
      },
    };
    return () => {
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    const a = audio.current!;
    let voice: EngineVoice | null = null;
    let car: CarId | null = null;
    let raf = 0;
    let last = performance.now();
    let rpm = 1000;
    let gear = 1;
    let boost = 0;
    let shiftT = 0;
    const carPos = new THREE.Vector3();
    const ear = new THREE.Vector3();
    const fwd = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const ai: { v: EngineVoice; pos: THREE.Vector3 }[] = [];
    (window as unknown as Record<string, unknown>).__passBy = () => {
      const spec = CARS[Math.floor(Math.random() * CARS.length)];
      ai.push({ v: a.engine(spec, false), pos: new THREE.Vector3(-260, 0.5, 12) });
    };
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = ctl.current;
      const spec = CARS.find((s) => s.id === c.car)!;
      if (car !== c.car) {
        voice?.dispose();
        voice = a.engine(spec, true);
        car = c.car;
        rpm = spec.engine.idle;
        gear = 1;
      }
      const e = spec.engine;
      let thr = c.thr;
      let lim = false;
      if (c.auto) {
        thr = shiftT > 0 ? 0.2 : 1;
        shiftT -= dt;
        rpm += (e.redline * 0.9 * dt) / (0.5 + 0.5 * gear);
        if (rpm > e.redline * 0.98) {
          if (gear < spec.gears.length) {
            rpm *= spec.gears[gear] / spec.gears[gear - 1];
            gear++;
            shiftT = spec.shiftTime;
            a.sfx("shift", { volume: 0.6 });
          } else {
            gear = 1;
            rpm = e.idle * 1.5;
          }
        }
      } else {
        rpm += (Math.max(e.idle, c.rpm) - rpm) * Math.min(1, dt * 8);
        if (rpm > e.limiter - 100) lim = true;
      }
      boost += ((thr > 0.5 ? Math.min(1, rpm / e.redline + 0.2) : 0) - boost) * Math.min(1, dt * (thr > 0.5 ? 2 : 8));
      const speed = ((rpm / 60) * 2 * Math.PI * spec.body.wheelR) / (spec.gears[Math.min(gear, spec.gears.length) - 1] * spec.final);
      ear.set(0, c.cockpit ? 1 : 2, c.cockpit ? 0.3 : -6);
      a.listener(ear, fwd, up);
      voice?.update(input({ rpm, throttle: thr, load: thr > 0.05 ? thr : rpm > e.idle * 1.3 ? -1 : 0, gear, boost, speed, limiter: lim, skid: c.skid, surface: c.surface, pos: carPos, tunnel: c.tunnel }));
      for (let i = ai.length - 1; i >= 0; i--) {
        const p = ai[i];
        p.pos.x += 70 * dt;
        p.v.update(input({ rpm: 7000, throttle: 1, load: 1, gear: 4, speed: 70, pos: p.pos }));
        if (p.pos.x > 260) {
          p.v.dispose();
          ai.splice(i, 1);
        }
      }
      if (hud.current) hud.current.textContent = `rpm ${rpm.toFixed(0)}  gear ${gear}  speed ${(speed * 3.6).toFixed(0)} km/h  boost ${boost.toFixed(2)}${lim ? "  LIMITER" : ""}`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      voice?.dispose();
      for (const p of ai) p.v.dispose();
    };
  }, [on]);

  const set = (o: Partial<typeof ui>) => {
    const n = { ...ui, ...o };
    setUi(n);
    Object.assign(ctl.current, { car: n.car, rpm: n.rpm, thr: n.thr, auto: n.auto, skid: n.skid, surface: n.surface, tunnel: n.tunnel, cockpit: n.cockpit });
    const a = audio.current;
    if (!a) return;
    if ("music" in o || "map" in o) a.music(n.music, n.map);
    if ("map" in o || "weather" in o || "night" in o) a.ambience(n.map, n.weather, n.night);
    if ("vol" in o || "mvol" in o) a.setVolume(n.vol, n.mvol);
    if ("muted" in o) a.setMuted(n.muted);
  };
  const start = () => {
    if (audio.current) return;
    const a = createAudio();
    audio.current = a;
    a.music(ui.music, ui.map);
    a.ambience(ui.map, ui.weather, ui.night);
    setOn(true);
  };
  const spec = CARS.find((c) => c.id === ui.car)!;
  const row = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const, margin: "10px 0" };
  const btn = { padding: "6px 12px", background: "#2a2f3a", color: "#eee", border: "1px solid #444", borderRadius: 6, cursor: "pointer" };
  return (
    <main style={{ padding: 16, color: "#ddd", background: "#111", minHeight: "100vh", fontFamily: "system-ui", fontSize: 14 }}>
      <div style={row}>
        <button style={{ ...btn, background: on ? "#264" : "#a33" }} onClick={start}>
          {on ? "Audio on" : "Start audio"}
        </button>
        <label>
          <input type="checkbox" checked={ui.muted} onChange={(e) => set({ muted: e.target.checked })} /> mute
        </label>
        master <input type="range" min={0} max={1} step={0.01} value={ui.vol} onChange={(e) => set({ vol: +e.target.value })} />
        music <input type="range" min={0} max={1} step={0.01} value={ui.mvol} onChange={(e) => set({ mvol: +e.target.value })} />
      </div>
      <div style={row}>
        <select value={ui.car} onChange={(e) => set({ car: e.target.value as CarId })}>
          {CARS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} · {c.engine.layout} {c.engine.aspiration}
            </option>
          ))}
        </select>
        rpm <input type="range" min={spec.engine.idle} max={spec.engine.limiter} step={10} value={Math.max(spec.engine.idle, ui.rpm)} onChange={(e) => set({ rpm: +e.target.value })} />
        throttle <input type="range" min={0} max={1} step={0.01} value={ui.thr} onChange={(e) => set({ thr: +e.target.value })} />
        <label>
          <input type="checkbox" checked={ui.auto} onChange={(e) => set({ auto: e.target.checked })} /> auto rev
        </label>
        <label>
          <input type="checkbox" checked={ui.tunnel} onChange={(e) => set({ tunnel: e.target.checked })} /> tunnel
        </label>
        <label>
          <input type="checkbox" checked={ui.cockpit} onChange={(e) => set({ cockpit: e.target.checked })} /> cockpit
        </label>
        <button style={btn} onClick={() => (window as unknown as { __passBy?: () => void }).__passBy?.()}>
          AI pass-by
        </button>
      </div>
      <div style={row}>
        skid <input type="range" min={0} max={1} step={0.01} value={ui.skid} onChange={(e) => set({ skid: +e.target.value })} />
        <select value={ui.surface} onChange={(e) => set({ surface: e.target.value as Surface })}>
          {SURF.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div ref={hud} style={{ fontFamily: "monospace", color: "#8cf" }} />
      <div style={row}>
        {(Object.keys(SFX) as Sfx[]).map((s) => (
          <button key={s} style={btn} onClick={() => audio.current?.sfx(s, { volume: 1 })} onMouseEnter={() => s === "hover" && audio.current?.sfx("hover")}>
            {s}
          </button>
        ))}
        <button style={btn} onClick={() => audio.current?.sfx("impact", { volume: 0.3 })}>
          impact soft
        </button>
        <button style={btn} onClick={() => audio.current?.sfx("backfire", { at: new THREE.Vector3(8, 0, 10) })}>
          backfire right
        </button>
      </div>
      <div style={row}>
        music
        <select value={ui.music} onChange={(e) => set({ music: e.target.value as MusicState })}>
          {STATES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        map
        <select value={ui.map} onChange={(e) => set({ map: e.target.value as MapId })}>
          {MAPS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        weather
        <select value={ui.weather} onChange={(e) => set({ weather: e.target.value as Weather })}>
          {WEATHER.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        night <input type="range" min={0} max={1} step={0.05} value={ui.night} onChange={(e) => set({ night: +e.target.value })} />
      </div>
    </main>
  );
}
