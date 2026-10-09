"use client";

import { useEffect, useRef, useState } from "react";
import { CARS } from "../../cars";
import type { Entrant, HudState, Lobby as LobbyState, Standing } from "../../contracts";
import { mockMap } from "../mock-map";
import { Hud, Results, type HudHandle, type MiniCar } from "../../ui-hud";
import { mapCard, type MapCard } from "../../ui-kit";
import { Loading } from "../../ui-loading";
import { Lobby, type LobbyPlayer } from "../../ui-lobby";
import { Menu, type MenuPick, type MenuStep } from "../../ui-menu";
import { Pause } from "../../ui-pause";
import { DEFAULT_SETTINGS, SettingsPanel } from "../../ui-settings";
import { RotateHint, TouchControls } from "../../ui-touch";

function shape(n: number, f: (a: number) => [number, number]) {
  const o: number[] = [];
  for (let i = 0; i < n; i++) o.push(...f((i / n) * Math.PI * 2));
  return o;
}

function mapCards(): MapCard[] {
  const m = mockMap();
  const loop: number[] = [];
  for (let i = 0; i < m.center.length; i += 6) loop.push(m.center[i], m.center[i + 2]);
  const S = Math.sin, C = Math.cos;
  return [
    { id: "monaco", name: "Monaco", place: "Monte Carlo", outline: shape(200, (a) => [C(a) * 500 + 160 * C(3 * a), S(a) * 260 + 90 * S(2 * a) + 60 * S(5 * a)]), length: 3337, weather: "clear", hour: 14 },
    { id: "nordschleife", name: "Nordschleife", place: "Nürburg", outline: loop, length: 20832, weather: "overcast", hour: 11 },
    { id: "tokyo", name: "Shuto C1", place: "Tokyo", outline: shape(200, (a) => [C(a) * 600 + 90 * C(4 * a), S(a) * 380 - 120 * S(3 * a)]), length: 14800, weather: "rain", hour: 22 },
    { id: "sanfrancisco", name: "San Francisco", place: "Russian Hill", outline: shape(200, (a) => [Math.sign(C(a)) * Math.pow(Math.abs(C(a)), 0.4) * 400, Math.sign(S(a)) * Math.pow(Math.abs(S(a)), 0.4) * 300 + 40 * S(7 * a)]), length: 5200, weather: "fog", hour: 8 },
    { id: "stelvio", name: "Stelvio Pass", place: "Lombardy", closed: false, outline: shape(160, (a) => [a * 120 + 40 * S(a * 9), 220 * S(a * 0.9) + 60 * S(a * 6)]).slice(0, 300), length: 24300, weather: "snow", hour: 9 },
    { id: "spa", name: "Spa", place: "Francorchamps", outline: shape(200, (a) => [C(a) * 700 + 200 * C(2 * a), S(a) * 420 + 160 * C(3 * a)]), length: 7004, weather: "overcast", hour: 17 },
  ];
}

const NAMES = ["You", "Hana", "Marco", "Léa", "Kofi", "Rin", "Sven", "Ana"];
const COLORS = ["#ff2d55", "#4cc9ff", "#ffc53d", "#3ddc84", "#a855f7", "#ff8a3d", "#e5e7eb", "#2dd4bf"];
const entrants: Entrant[] = NAMES.map((n, i) => ({ id: `p${i}`, name: n, color: COLORS[i], car: CARS[i % CARS.length].id, me: i === 0, ai: i >= 3 }));

export default function Lab() {
  const [view, setView] = useState<string | null>(null);
  const [maps, setMaps] = useState(mapCards);
  useEffect(() => {
    const load = () => import("../../maps/monaco").then((m) => m.MAP);
    load().then((d) => setMaps((l) => l.map((m) => (m.id === "monaco" ? mapCard({ id: "monaco", name: d.name, place: d.place, load }, d) : m))));
  }, []);
  const [pick, setPick] = useState<MenuPick>({ mode: "race", map: "monaco", car: CARS[0].id, paint: CARS[0].paints[0], laps: 3 });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [lobby, setLobby] = useState<LobbyState>({ map: "spa", mode: "race", laps: 3, weather: "map", hour: "map", startAt: null, ai: 4 });
  const [host, setHost] = useState(true);
  const [touch, setTouch] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setView(q.get("view") ?? "menu");
    setHost(q.get("host") !== "0");
  }, []);
  if (!view) return null;

  const players: LobbyPlayer[] = entrants.slice(0, 4).map((e, i) => ({ ...e, ai: false, host: i === 1, ping: [0, 34, 95, 240][i] }));
  const step: MenuStep | null = view === "menu" ? "home" : view === "maps" ? "maps" : view === "cars" ? "cars" : null;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_70%,#3a4350_0%,#161a20_45%,#07080a_100%)]">
      <Scene />
      {step && <Menu cars={CARS} maps={maps} pick={pick} onPick={setPick} onGo={() => {}} onOnline={() => {}} onSettings={() => {}} step={step} />}
      {view === "lobby" && (
        <Lobby room="K7Q2X" players={players} lobby={lobby} host={host} maps={maps} cars={CARS} onName={() => {}} onLobby={setLobby} onStart={() => {}} onLeave={() => {}} onCar={() => {}} />
      )}
      {(view === "hud" || view === "touch") && <HudMock outline={maps[1].outline!} touch={view === "touch"} />}
      {view === "touch" && (
        <>
          <TouchControls force onControls={(t) => setTouch(JSON.stringify(t))} />
          <pre className="pointer-events-none absolute left-2 top-24 text-[10px] text-white/50">{touch}</pre>
          <RotateHint />
        </>
      )}
      {view === "results" && <Results standings={standingsMock()} entrants={entrants} onRestart={() => {}} onNext={() => {}} onMenu={() => {}} />}
      {view === "pause" && <Pause onResume={() => {}} onRestart={() => {}} onSettings={() => {}} onQuit={() => {}} />}
      {view === "settings" && <SettingsPanel value={settings} onChange={setSettings} onClose={() => {}} tab={(new URLSearchParams(location.search).get("tab") as "gfx") ?? "gfx"} />}
      {view === "loading" && <Loading map={maps[0]} progress={0.62} />}
    </main>
  );
}

function Scene() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className="absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-b from-[#232830] to-[#0b0d10]" />
      <div className="absolute bottom-[30%] left-1/2 h-[16%] w-[34%] -translate-x-1/2 rounded-[40%_45%_8%_8%/70%_70%_10%_10%] bg-gradient-to-b from-[#c8102e] to-[#5a0614] shadow-[0_2rem_3rem_rgba(0,0,0,0.6)]" />
    </div>
  );
}

function standingsMock(): Standing[] {
  return entrants.map((e, i) => ({ id: e.id, place: [2, 1, 3, 4, 5, 6, 7, 8][i], lap: 3, progress: 1, finished: i !== 7, time: 251.4 + [1.8, 0, 3.2, 5.9, 9.1, 12.4, 18.8, 0][i], best: 82.1 + [0.3, 0.6, 0, 1.1, 1.4, 2, 2.6, 3][i], gap: 0 }));
}

function HudMock({ outline, touch }: { outline: ArrayLike<number>; touch: boolean }) {
  const ref = useRef<HudHandle>(null);
  const [h, setH] = useState<HudState>({ speed: 0, gear: "3", rpm: 0, redline: 7800, limiter: 8200, place: 2, total: 8, lap: 2, laps: 3, time: 84.231, last: 83.902, best: 82.517, delta: -0.214, countdown: -1, wrongWay: false, phase: "racing", mode: "race", device: "keys" });
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const cars: MiniCar[] = COLORS.map((c, i) => ({ x: 0, z: 0, yaw: 0, color: c, me: i === 0 }));
    const n = outline.length / 2;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      const rpm = 3500 + 4600 * Math.abs(Math.sin(t * 0.9));
      ref.current?.needle(rpm);
      cars.forEach((c, i) => {
        const k = Math.floor(t * 4 + n - i * 3) % n;
        const k2 = (k + 1) % n;
        c.x = outline[k * 2];
        c.z = outline[k * 2 + 1];
        c.yaw = Math.atan2(outline[k2 * 2] - c.x, outline[k2 * 2 + 1] - c.z);
      });
      ref.current?.minimap(cars);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const iv = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      setH((s) => ({ ...s, speed: 140 + 90 * Math.abs(Math.sin(t * 0.9)), time: 84.231 + t, rpm: 0, countdown: q.get("cd") ? +q.get("cd")! : -1, wrongWay: q.has("ww") }));
    }, 100);
    const ev = setTimeout(() => ref.current?.event({ type: "checkpoint", id: "p0", split: 41.322, delta: -0.214 }), 400);
    const ev2 = setTimeout(() => ref.current?.event({ type: "toast", text: "Hana joined" }), 600);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      clearTimeout(ev);
      clearTimeout(ev2);
    };
  }, [outline]);
  return <Hud ref={ref} h={h} outline={outline} touch={touch} />;
}

