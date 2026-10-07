'use client';

import { useEffect, useRef, useState } from "react";
import { HALF, PERIOD, BLOCKS } from "./city";
import { SUITS, type SuitName } from "./hero";
import { QUALITIES, startGame, type Game, type Quality, type Stats, type UiEvent } from "./game";

const MODES = Object.entries(QUALITIES).map(([id, q]) => ({ id: id as Quality, ...q }));

const CONTROLS = [
  ["Mouse", "Look"],
  ["Hold left click", "Swing"],
  ["Right click / E", "Web zip"],
  ["F", "Web strike"],
  ["WASD", "Move and steer"],
  ["Space", "Jump, air trick"],
  ["Shift", "Sprint, dive"],
  ["Run into a wall", "Wall run"],
  ["V", "Change suit"],
  ["M", "Mute"],
  ["1 2 3", "Graphics mode"],
  ["R", "Reset"],
];

const MARKER_COLOR: Record<string, string> = {
  race: "#3fa9ff",
  crime: "#ff2a3c",
  chase: "#ff9a1f",
  collectible: "#ffd34d",
  checkpoint: "#5ff2ff",
  enemy: "#ff5a6a",
};

const SUIT_SWATCH: Record<string, string> = {
  miles: "linear-gradient(135deg,#0d0d10 55%,#e3172b 55%)",
  classic: "linear-gradient(135deg,#d0142a 55%,#1d4fb8 55%)",
  symbiote: "linear-gradient(135deg,#050507 60%,#f2f2f2 60%)",
};

const MAP = 84;
const MAP_RANGE = 260;

function load<T extends string>(key: string, ok: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && ok.includes(v)) return v;
  } catch {}
  return fallback;
}

function Minimap({ s }: { s: Stats }) {
  const k = MAP / MAP_RANGE;
  const c = Math.cos(s.heading);
  const n = Math.sin(s.heading);
  const lines = Array.from({ length: BLOCKS + 1 }, (_, i) => -HALF + i * PERIOD);
  const toScreen = (x: number, z: number) => {
    const dx = x - s.x;
    const dz = z - s.z;
    return [(-c * dx + n * dz) * k, -(n * dx + c * dz) * k] as const;
  };
  return (
    <svg width={MAP * 2} height={MAP * 2} className="rounded-full bg-black/55 ring-2 ring-white/20 backdrop-blur-sm">
      <defs>
        <clipPath id="mm">
          <circle cx={MAP} cy={MAP} r={MAP - 2} />
        </clipPath>
      </defs>
      <g clipPath="url(#mm)">
        <g transform={`translate(${MAP} ${MAP}) matrix(${-c} ${-n} ${n} ${-c} 0 0) scale(${k}) translate(${-s.x} ${-s.z})`}>
          {lines.map((l) => (
            <g key={l} stroke="rgba(255,255,255,0.16)" strokeWidth={22}>
              <line x1={l} y1={-HALF} x2={l} y2={HALF} />
              <line x1={-HALF} y1={l} x2={HALF} y2={l} />
            </g>
          ))}
        </g>
        {s.hud.markers.map((m, i) => {
          let [x, y] = toScreen(m.x, m.z);
          const d = Math.hypot(x, y);
          const edge = d > MAP - 8;
          if (edge) {
            if (m.kind === "collectible" || m.kind === "enemy") return null;
            x *= (MAP - 8) / d;
            y *= (MAP - 8) / d;
          }
          const big = m.kind !== "collectible" && m.kind !== "enemy";
          return (
            <circle key={i} cx={MAP + x} cy={MAP + y} r={big ? 5 : 2.5} fill={MARKER_COLOR[m.kind]} stroke={big ? "#000" : "none"} strokeWidth={1.5} />
          );
        })}
      </g>
      <path d={`M ${MAP} ${MAP - 8} L ${MAP + 6} ${MAP + 6} L ${MAP} ${MAP + 3} L ${MAP - 6} ${MAP + 6} Z`} fill="#fff" stroke="#e3172b" strokeWidth={1.5} />
    </svg>
  );
}

type Toast = { id: number; title: string; text?: string };
type Xp = { id: number; amount: number; reason: string };

export default function SpidermanPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [quality, setQuality] = useState<Quality>("medium");
  const [suit, setSuit] = useState<SuitName>(SUITS[0].id);
  const [touch, setTouch] = useState(false);
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [xps, setXps] = useState<Xp[]>([]);

  useEffect(() => {
    const q = load<Quality>("spiderman-quality", ["low", "medium", "high"], "medium");
    const st = load<SuitName>("spiderman-suit", SUITS.map((x) => x.id), SUITS[0].id);
    setQuality(q);
    setSuit(st);
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const h = setTimeout(() => {
        timers.delete(h);
        fn();
      }, ms);
      timers.add(h);
    };
    const onEvent = (e: UiEvent) => {
      const key = ++id;
      if (e.type === "toast") {
        setToast({ id: key, title: e.title, text: e.text });
        later(() => setToast((t) => (t?.id === key ? null : t)), 2600);
      } else {
        setXps((list) => [...list.slice(-3), { id: key, amount: e.amount, reason: e.reason }]);
        later(() => setXps((list) => list.filter((x) => x.id !== key)), 1800);
      }
    };
    const game = startGame(canvasRef.current!, (s) => {
      setStats(s);
      setQuality(s.quality);
      setSuit(s.suit);
    }, onEvent, q, st);
    gameRef.current = game;
    return () => {
      timers.forEach(clearTimeout);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const pickQuality = (q: Quality) => {
    setQuality(q);
    gameRef.current?.setQuality(q);
  };
  const pickSuit = (id: SuitName) => {
    setSuit(id);
    gameRef.current?.setSuit(id);
  };

  const playing = stats?.playing;
  const hud = stats?.hud;
  const speedLines = stats ? Math.min(Math.max((stats.speed - 110) / 120, 0), 0.75) : 0;
  const prompt = stats?.prompt ?? hud?.nearPrompt;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none text-white">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {playing && stats && hud && (
        <>
          <div
            className="pointer-events-none absolute inset-0 transition-opacity duration-300"
            style={{
              opacity: speedLines,
              background: "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0.22) 0deg 0.6deg, transparent 0.6deg 7deg)",
              maskImage: "radial-gradient(circle at 50% 50%, transparent 32%, black 78%)",
              WebkitMaskImage: "radial-gradient(circle at 50% 50%, transparent 32%, black 78%)",
            }}
          />
          <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_160px_rgba(0,0,0,0.55)]" />

          <div className="absolute left-5 top-5 max-w-sm drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
            {hud.activity ? (
              <div>
                <div className="inline-block -skew-x-12 bg-red-600 px-3 py-0.5 font-black italic uppercase tracking-wide">{hud.activity.title}</div>
                <div className="mt-2 text-lg font-semibold">{hud.activity.objective}</div>
                <div className="mt-1 flex items-baseline gap-4 font-black italic tabular-nums">
                  {hud.activity.timer !== undefined && <span className="text-4xl">{hud.activity.timer.toFixed(1)}s</span>}
                  {hud.activity.progress && <span className="text-2xl text-white/85">{hud.activity.progress}</span>}
                  {hud.activity.medal && <span className="text-lg text-amber-300 uppercase">{hud.activity.medal}</span>}
                </div>
              </div>
            ) : (
              <div className="text-sm text-white/75">Find a beam on the map: blue for races, red for crimes.</div>
            )}
            <div className="mt-3 text-sm font-bold italic uppercase text-white/85">
              <span className="text-amber-300">◆</span> {hud.collected}/{hud.totalCollectibles} tokens
              <span className="ml-3 text-white/60">
                {hud.completed.races} races · {hud.completed.crimes} crimes · {hud.completed.chases} chases
              </span>
            </div>
          </div>

          <div className="absolute right-5 top-5">
            <Minimap s={stats} />
          </div>

          {toast && (
            <div key={toast.id} className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2 text-center animate__animated animate__fadeInDown animate__faster">
              <div className="-skew-x-12 bg-red-600 px-8 py-2 font-black italic uppercase text-4xl tracking-tight shadow-[6px_6px_0_#000]">{toast.title}</div>
              {toast.text && <div className="mt-2 font-bold italic uppercase text-lg drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">{toast.text}</div>}
            </div>
          )}

          <div className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-end gap-1">
            {xps.map((x) => (
              <div key={x.id} className="font-black italic uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] animate__animated animate__fadeInRight animate__faster">
                <span className="text-amber-300">+{x.amount} XP</span> <span className="text-sm text-white/80">{x.reason}</span>
              </div>
            ))}
          </div>

          <div className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-white/80" />

          {prompt && (
            <div className="absolute left-1/2 bottom-24 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm font-bold uppercase tracking-wide">{prompt}</div>
          )}

          <div className="absolute left-5 bottom-5 w-72 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            <div className="flex items-end gap-3">
              <div className="-skew-x-12 bg-white px-2.5 py-1 font-black italic text-2xl leading-none text-black">{hud.level}</div>
              <div className="flex-1">
                <div className="text-xs font-bold uppercase text-white/75">Level {hud.level}</div>
                <div className="mt-1 h-2 -skew-x-12 bg-white/20">
                  <div className="h-full bg-red-600 transition-[width] duration-300" style={{ width: `${hud.levelProgress * 100}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-white/55 tabular-nums">
              {MODES.find((m) => m.id === stats.quality)?.label} · {stats.fps} fps{stats.muted ? " · muted" : ""} · Esc for menu
            </div>
          </div>

          <div className="absolute right-6 bottom-5 text-right font-black italic uppercase leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
            {stats.combo > 1 && <div className="mb-1 text-2xl text-amber-300">x{stats.combo} combo</div>}
            <div className="text-6xl tabular-nums">
              {Math.round(stats.speed)}
              <span className="ml-1 text-xl text-red-500">km/h</span>
            </div>
            <div className="mt-1 text-base tabular-nums text-white/75">{Math.round(stats.height)} m up</div>
          </div>
        </>
      )}

      {!playing && (
        <div className="absolute inset-0 overflow-y-auto bg-gradient-to-r from-black/85 via-black/55 to-transparent">
          <div className="min-h-full flex items-center p-4 sm:p-10">
            <div className="w-full max-w-xl">
              <h1 className="font-black italic uppercase text-6xl sm:text-8xl tracking-tighter leading-[0.85]">
                Spider<span className="text-red-600">-</span>
                <br />
                Man
              </h1>
              <p className="mt-3 text-white/75">Swing through a snowy city at dusk. Win races, stop crimes, chase getaway cars, and find all the tokens.</p>

              {started && hud && (
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-bold italic uppercase">
                  <span>Level {hud.level}</span>
                  <span>{hud.completed.races} races</span>
                  <span>{hud.completed.crimes} crimes</span>
                  <span>{hud.completed.chases} chases</span>
                  <span>{hud.collected}/{hud.totalCollectibles} tokens</span>
                </div>
              )}

              {touch ? (
                <p className="mt-6 text-red-300">This game needs a keyboard and a mouse.</p>
              ) : (
                <button
                  onClick={() => {
                    setStarted(true);
                    gameRef.current?.play();
                  }}
                  disabled={!stats}
                  className="cursor-pointer mt-6 w-full -skew-x-6 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-wait py-3 font-black italic uppercase text-2xl shadow-[6px_6px_0_#000]"
                >
                  {stats ? (started ? "Resume" : "Play") : "Loading city"}
                </button>
              )}

              <div className="mt-6 text-xs font-bold uppercase tracking-widest text-white/50">Suit</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {SUITS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickSuit(s.id)}
                    className={`cursor-pointer flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${suit === s.id ? "border-red-500 bg-red-600/25" : "border-white/25 hover:border-white/60"}`}
                  >
                    <span className="h-6 w-6 shrink-0 rounded-full ring-1 ring-white/40" style={{ background: SUIT_SWATCH[s.id] ?? "linear-gradient(135deg,#222 50%,#fff 50%)" }} />
                    <span className="text-sm font-bold italic uppercase leading-tight">{s.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 text-xs font-bold uppercase tracking-widest text-white/50">Graphics</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickQuality(m.id)}
                    className={`cursor-pointer text-left rounded-md border px-3 py-2 transition-colors ${quality === m.id ? "border-red-500 bg-red-600/25" : "border-white/25 hover:border-white/60"}`}
                  >
                    <div className="font-bold uppercase italic">{m.label}</div>
                    <div className="text-xs text-white/65">{m.detail}</div>
                  </button>
                ))}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {CONTROLS.map(([k, a]) => (
                  <div key={k} className="contents">
                    <div className="text-white/55">{k}</div>
                    <div>{a}</div>
                  </div>
                ))}
              </div>

              <a href="https://kalebkim.com" className="mt-6 inline-block text-sm text-white/60 hover:text-white underline">
                home
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
