"use client";

import { useRef, type ReactNode } from "react";
import type { HudState, Marker } from "./contracts";
import { BOUNDS, BRIDGES, CENTRAL_PARK, LAND, ROADS, ROAD_W, type Pt } from "./city-geo";
import { Key } from "./ui-menu";

export type Pop =
  | { id: number; type: "xp"; amount: number; reason: string }
  | { id: number; type: "penalty"; reason: string }
  | { id: number; type: "toast"; title: string; text?: string }
  | { id: number; type: "hurt"; amount: number }
  | { id: number; type: "token"; amount: number; reason: string };

const R = 74;
const RANGE = 230;
const K = R / RANGE;

export type Labeled = Marker & { label?: string };
type Target = { x: number; y?: number; z: number };

// One color per task type, matched to its beam in the world.
export const MARKER: Record<Marker["kind"], { color: string; r: number; edge: boolean; name: string; hint: string }> = {
  race: { color: "#3fa9ff", r: 5, edge: true, name: "Swing Race", hint: "Land in the blue beam to start" },
  crime: { color: "#ff2a3c", r: 5, edge: true, name: "Crime", hint: "Swing to the red beam" },
  chase: { color: "#ff9a1f", r: 5, edge: true, name: "Getaway Car", hint: "Catch the car, then press F" },
  checkpoint: { color: "#5ff2ff", r: 5, edge: true, name: "Objective", hint: "" },
  boss: { color: "#ffc21f", r: 6.5, edge: true, name: "Boss", hint: "Swing to the gold beam" },
  hideout: { color: "#f4f4f4", r: 5, edge: true, name: "Hideout", hint: "Step into the white beam" },
  challenge: { color: "#d36bff", r: 5, edge: true, name: "Challenge", hint: "Step into the purple beam" },
  request: { color: "#3ee67f", r: 4.5, edge: true, name: "Request", hint: "Walk up to the green beam" },
  photo: { color: "#9fd4ff", r: 4, edge: false, name: "Photo Op", hint: "Face the landmark and hold still" },
  cache: { color: "#ffae2e", r: 4, edge: false, name: "Signal Cache", hint: "Enter the zone, then press V" },
  collectible: { color: "#ff6b6b", r: 2.5, edge: false, name: "Backpack", hint: "Grab the backpack" },
  pigeon: { color: "#b9c2cc", r: 2.5, edge: false, name: "Pigeons", hint: "Get close to the flock" },
  enemy: { color: "#ff4d5a", r: 2.8, edge: false, name: "Enemy", hint: "" },
  civilian: { color: "#ffffff", r: 1.8, edge: false, name: "Civilian", hint: "" },
};
const SUGGEST: Marker["kind"][] = ["race", "crime", "chase", "boss", "hideout", "challenge", "request", "photo", "cache", "pigeon"];

export function nextUp(h: HudState): (Labeled & { d: number }) | null {
  let best: (Labeled & { d: number }) | null = null;
  for (const m of h.markers as Labeled[]) {
    if (!SUGGEST.includes(m.kind)) continue;
    const d = Math.hypot(m.x - h.x, m.z - h.z);
    if (!best || d < best.d) best = { ...m, d };
  }
  return best;
}

// Angle of a world point from the camera forward, positive to the right. Forward is (sin h, cos h).
const relAngle = (h: HudState, t: Target) => {
  const dx = t.x - h.x;
  const dz = t.z - h.z;
  return Math.atan2(-dx * Math.cos(h.heading) + dz * Math.sin(h.heading), dx * Math.sin(h.heading) + dz * Math.cos(h.heading));
};
const meters = (d: number) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);

const pathOf = (p: readonly Pt[]) => `M${p.map(([x, z]) => `${x.toFixed(1)} ${z.toFixed(1)}`).join("L")}Z`;
const rectPath = (minX: number, minZ: number, maxX: number, maxZ: number) => `M${minX.toFixed(1)} ${minZ.toFixed(1)}H${maxX.toFixed(1)}V${maxZ.toFixed(1)}H${minX.toFixed(1)}Z`;
export const GEO = {
  land: LAND.map((l) => ({ borough: l.borough, d: pathOf(l.poly) })),
  roads: ROADS.map((q) => (q.axis === 0 ? `M${q.min.toFixed(1)} ${q.line.toFixed(1)}H${q.max.toFixed(1)}` : `M${q.line.toFixed(1)} ${q.min.toFixed(1)}V${q.max.toFixed(1)}`)).join(""),
  park: rectPath(CENTRAL_PARK.minX, CENTRAL_PARK.minZ, CENTRAL_PARK.maxX, CENTRAL_PARK.maxZ),
  bridges: BRIDGES.map((b) => ({ name: b.name, d: `M${b.a[0].toFixed(1)} ${b.a[1].toFixed(1)}L${b.b[0].toFixed(1)} ${b.b[1].toFixed(1)}`, w: b.width })),
  rectPath,
};

const MINI_PAD = 320;
const MINI = (() => {
  const x0 = BOUNDS.minX - MINI_PAD;
  const z0 = BOUNDS.minZ - MINI_PAD;
  const w = BOUNDS.maxX - BOUNDS.minX + MINI_PAD * 2;
  const hh = BOUNDS.maxZ - BOUNDS.minZ + MINI_PAD * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${z0} ${w} ${hh}" width="${Math.round(w * K)}" height="${Math.round(hh * K)}">` +
    `<rect x="${x0}" y="${z0}" width="${w}" height="${hh}" fill="rgba(30,80,140,0.35)"/>` +
    GEO.land.map((l) => `<path d="${l.d}" fill="rgba(255,255,255,0.07)"/>`).join("") +
    `<path d="${GEO.park}" fill="rgba(70,150,90,0.35)"/>` +
    `<path d="${GEO.roads}" stroke="rgba(255,255,255,0.2)" stroke-width="${ROAD_W}" fill="none"/>` +
    GEO.bridges.map((b) => `<path d="${b.d}" stroke="rgba(255,255,255,0.3)" stroke-width="${b.w}" fill="none"/>`).join("") +
    `</svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, x: x0 * K, z: z0 * K, w: Math.round(w * K), h: Math.round(hh * K) };
})();
const SHADOW = "drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]";

// Heading without the jump at +-PI, so CSS transitions never spin the long way round.
function useUnwrapped(a: number) {
  const prev = useRef<{ raw: number; acc: number } | null>(null);
  if (!prev.current) prev.current = { raw: a, acc: a };
  else if (prev.current.raw !== a) {
    const d = Math.atan2(Math.sin(a - prev.current.raw), Math.cos(a - prev.current.raw));
    prev.current = { raw: a, acc: prev.current.acc + d };
  }
  return prev.current.acc;
}

function Minimap({ h }: { h: HudState }) {
  const rot = useUnwrapped(h.heading) + Math.PI;
  const c = Math.cos(h.heading);
  const n = Math.sin(h.heading);
  const ease = "transform 125ms linear";
  return (
    <div className="relative shrink-0 overflow-hidden rounded-full bg-black/60 ring-2 ring-white/25 backdrop-blur-sm" style={{ width: R * 2, height: R * 2 }}>
      <div className="absolute" style={{ left: R, top: R, transform: `rotate(${rot}rad)`, transition: ease }}>
        <div style={{ transform: `translate(${-h.x * K}px, ${-h.z * K}px)`, transition: ease }}>
          <img src={MINI.src} alt="" draggable={false} className="absolute max-w-none" style={{ left: MINI.x, top: MINI.z, width: MINI.w, height: MINI.h }} />
        </div>
      </div>
      <svg className="absolute inset-0" width={R * 2} height={R * 2}>
        {h.markers.map((m, i) => {
          const st = MARKER[m.kind] ?? MARKER.civilian;
          const dx = m.x - h.x;
          const dz = m.z - h.z;
          let x = (-c * dx + n * dz) * K;
          let y = -(n * dx + c * dz) * K;
          const d = Math.hypot(x, y);
          if (m.kind === "request" && d > 250 * K) return null;
          const lim = R - 9;
          if (d > lim) {
            if (!st.edge) return null;
            x *= lim / d;
            y *= lim / d;
          }
          return <circle key={i} cx={R + x} cy={R + y} r={st.r} fill={st.color} stroke={st.r > 3 ? "#000" : "none"} strokeWidth={1.5} />;
        })}
        <path d={`M ${R} ${R - 8} L ${R + 6} ${R + 6} L ${R} ${R + 3} L ${R - 6} ${R + 6} Z`} fill="#fff" stroke="#e2231a" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function Health({ h, show }: { h: HudState; show: boolean }) {
  const low = h.health < 0.3;
  return (
    <div className={`w-[min(300px,42vw)] transition-opacity duration-700 ${SHADOW} ${show ? "opacity-100" : "opacity-0"}`}>
      <div className="h-3.5 -skew-x-[20deg] bg-black/55 p-[2px] ring-1 ring-white/25">
        <div className={`h-full transition-[width] duration-200 ${low ? "bg-spider" : "bg-white"}`} style={{ width: `${Math.max(0, h.health) * 100}%` }} />
      </div>
      <div className="mt-1.5 flex gap-1 pl-1">
        {Array.from({ length: Math.max(0, Math.round(h.focusMax)) }, (_, i) => {
          const f = Math.min(1, Math.max(0, h.focus - i));
          return (
            <div key={i} className="h-2 flex-1 -skew-x-[20deg] bg-black/55 ring-1 ring-white/15">
              <div className={`h-full bg-focus ${f >= 1 ? "shadow-[0_0_8px_#ff8a1f]" : "opacity-70"}`} style={{ width: `${f * 100}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Boss({ b }: { b: NonNullable<HudState["boss"]> }) {
  return (
    <div className={`glitch-in absolute bottom-[200px] left-1/2 w-[min(560px,calc(100%-32px))] sm:bottom-auto sm:top-16 -translate-x-1/2 ${SHADOW}`}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-cond text-3xl font-black uppercase italic leading-none tracking-tight">{b.name}</div>
          <div className="mt-0.5 font-cond text-xs font-bold uppercase tracking-[0.25em] text-spider">{b.title}</div>
        </div>
        <div className="flex gap-1.5 pb-1">
          {Array.from({ length: b.phases }, (_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rotate-45 ${i < b.phase ? "bg-spider" : "bg-white/25"}`} />
          ))}
        </div>
      </div>
      <div className="relative mt-2 h-3 -skew-x-[20deg] bg-black/60 ring-1 ring-white/30">
        <div className="absolute inset-y-0 left-0 bg-white/80 transition-[width] delay-300 duration-700" style={{ width: `${b.health * 100}%` }} />
        <div className="absolute inset-y-0 left-0 bg-spider transition-[width] duration-150" style={{ width: `${b.health * 100}%` }} />
      </div>
    </div>
  );
}

function Sense({ s }: { s: NonNullable<HudState["sense"]> }) {
  const red = s.level === "red";
  const col = red ? "#ff2a1f" : "#ffffff";
  return (
    <div className="pointer-events-none absolute" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, transform: "translate(-50%,-100%)" }}>
      <svg width="64" height="36" viewBox="0 0 64 36" className={red ? "sense-red" : ""} style={{ filter: `drop-shadow(0 0 4px ${col})` }}>
        <g fill="none" stroke={col} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M32 34 L30 26 L34 20 L30 13 L33 6" />
          <path d="M24 33 L18 28 L20 22 L13 18 L12 11" />
          <path d="M40 33 L46 28 L44 22 L51 18 L52 11" />
          <path d="M18 35 L9 32 L6 26" />
          <path d="M46 35 L55 32 L58 26" />
        </g>
      </svg>
    </div>
  );
}

function Objective({ o, dist }: { o: NonNullable<HudState["objective"]>; dist: number | null }) {
  const medal: Record<string, string> = { gold: "#ffcf3a", silver: "#d5dbe3", bronze: "#d48a4f" };
  return (
    <div key={o.title} className={`panel-in flex flex-col items-end text-right ${SHADOW}`}>
      <div className="-skew-x-12 bg-spider px-3 py-0.5 font-cond text-sm font-black uppercase italic tracking-wider shadow-[3px_3px_0_#000]">{o.title}</div>
      <div className="mt-2 text-[13px] font-semibold leading-snug sm:text-[15px]">
        {o.text}
        {dist !== null && dist > 8 && <span className="ml-2 font-cond font-bold italic tabular-nums text-white/60">{meters(dist)}</span>}
      </div>
      {(o.timer !== undefined || o.progress || o.medal) && (
        <div className="mt-1 flex items-baseline gap-3 font-cond font-black italic tabular-nums">
          {o.medal && (
            <span className="text-xs uppercase tracking-widest" style={{ color: medal[o.medal.split(" ")[0].toLowerCase()] ?? "#fff" }}>
              {o.medal}
            </span>
          )}
          {o.progress && <span className="text-xl text-white/85">{o.progress}</span>}
          {o.timer !== undefined && <span className="text-3xl">{o.timer.toFixed(1)}</span>}
        </div>
      )}
    </div>
  );
}

function Gadget({ g }: { g: NonNullable<HudState["gadget"]> }) {
  return (
    <div className={`flex flex-col items-start gap-1 ${SHADOW}`}>
      <div className="flex items-center gap-2">
        <div className="relative grid h-10 w-10 place-items-center rounded-full bg-black/60 ring-2 ring-white/25">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.6}>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
          </svg>
          <span className="absolute -bottom-1 -right-1">
            <Key>G</Key>
          </span>
        </div>
        <div>
          <div className="font-cond text-xs font-bold uppercase tracking-wider">{g.name}</div>
          <div className="mt-1 flex gap-1">
            {Array.from({ length: g.max }, (_, i) => (
              <span key={i} className={`h-1.5 w-3 -skew-x-12 ${i < g.charges ? "bg-white" : "bg-white/20"}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function clockText(hours: number) {
  const m = Math.floor((((hours % 24) + 24) % 24) * 60);
  const h24 = Math.floor(m / 60);
  return `${((h24 + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function TokenIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0">
      <path d="M8 1 14 4.5v7L8 15 2 11.5v-7Z" fill="#ffc21f" stroke="#000" strokeWidth={1.2} />
      <path d="M8 4.5 11 6.25v3.5L8 11.5 5 9.75v-3.5Z" fill="#e2231a" />
    </svg>
  );
}

function Status({ h, token }: { h: HudState; token: Extract<Pop, { type: "token" }> | undefined }) {
  const p = h.progress;
  return (
    <div className={`flex items-center gap-3 ${SHADOW}`}>
      <div className="flex items-center gap-1.5">
        <span className="-skew-x-12 bg-white px-1.5 font-cond text-sm font-black italic leading-tight text-black">{p.level}</span>
        <div className="h-1.5 w-14 -skew-x-12 bg-black/55 ring-1 ring-white/20 sm:w-20">
          <div className="h-full bg-spider" style={{ width: `${Math.min(1, Math.max(0, p.levelProgress)) * 100}%` }} />
        </div>
      </div>
      <div className="relative flex items-center gap-1 font-cond text-sm font-black italic tabular-nums" data-hud="tokens">
        <TokenIcon />
        <span key={`n${h.tokens}`} className={token ? "glitch-in text-[#ffc21f]" : ""}>
          {h.tokens}
        </span>
        {token && (
          <div key={`p${token.id}`} className="xp-rise absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap">
            <span className="text-[#ffc21f]">+{token.amount}</span> <span className="text-xs font-bold not-italic uppercase text-white/75">{token.reason}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Stealth({ s }: { s: NonNullable<HudState["stealth"]> }) {
  const a = Math.min(1, Math.max(0, s.alert));
  const col = s.hidden ? "#ffffff" : "#ff2a3c";
  return (
    <div className={`absolute left-1/2 top-[calc(50%+26px)] w-24 -translate-x-1/2 text-center ${SHADOW}`} data-hud="stealth">
      <div className="font-cond text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: col }}>
        {s.hidden ? "Hidden" : "Seen"}
      </div>
      <div className="mt-1 h-1 bg-black/55 ring-1 ring-white/20">
        <div className="h-full transition-[width] duration-150" style={{ width: `${a * 100}%`, background: a > 0.66 ? "#ff2a3c" : a > 0.33 ? "#ffd23a" : "#ffffff" }} />
      </div>
    </div>
  );
}

const SPAN = Math.PI / 2;
const CW = 440;
const PX = CW / 2 / SPAN;
const STEP = Math.PI / 12;
const CARDINAL = ["N", "E", "S", "W"];

function Compass({ h, t, color, dist }: { h: HudState; t: Target | null; color: string; dist: number }) {
  // Compass bearing: north (-z) is 0, east (+x) is +90 degrees.
  const bearing = Math.PI - useUnwrapped(h.heading);
  const ticks = [];
  for (let k = Math.floor((bearing - SPAN) / STEP) - 1; k <= Math.ceil((bearing + SPAN) / STEP) + 1; k++) {
    const q = ((k % 24) + 24) % 24;
    ticks.push(
      q % 6 === 0 ? (
        <span key={k} className="absolute top-1 -translate-x-1/2 font-cond text-[13px] font-black italic leading-none" style={{ left: k * STEP * PX }}>
          {CARDINAL[q / 6]}
        </span>
      ) : (
        <span key={k} className={`absolute top-1.5 w-px -translate-x-1/2 bg-white ${q % 3 === 0 ? "h-2.5 opacity-60" : "h-1.5 opacity-35"}`} style={{ left: k * STEP * PX }} />
      ),
    );
  }
  const rel = t ? relAngle(h, t) : 0;
  const inView = t && Math.abs(rel) <= SPAN;
  const dy = t?.y !== undefined ? t.y - h.height - 1 : 0;
  return (
    <div className={`absolute left-1/2 top-3 h-11 -translate-x-1/2 ${SHADOW}`} style={{ width: `min(${CW}px, 38vw)` }} data-hud="compass">
      <div
        className="absolute inset-x-0 top-0 h-6 overflow-hidden border-b border-white/25 bg-gradient-to-b from-black/45 to-black/10"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 18%, black 82%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 18%, black 82%, transparent)" }}
      >
        <div className="absolute left-1/2 top-0 h-full" style={{ transform: `translateX(${-bearing * PX}px)`, transition: "transform 125ms linear" }}>
          {ticks}
          {inView && (
            <span className="absolute top-[3px] h-3.5 w-3.5 -translate-x-1/2 rotate-45 ring-2 ring-black/70" style={{ left: (bearing + rel) * PX, background: color }} />
          )}
        </div>
      </div>
      <div data-hud="clock" className="absolute -left-3 top-[3px] -translate-x-full whitespace-nowrap font-cond text-[13px] font-black italic leading-none tabular-nums text-white/85">{clockText(h.clock)}</div>
      <span className="absolute left-1/2 top-6 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-spider" />
      {t && !inView && (
        <span className={`absolute top-[5px] font-cond text-sm font-black leading-none ${rel > 0 ? "-right-4" : "-left-4"}`} style={{ color }}>
          {rel > 0 ? "\u25B6" : "\u25C0"}
        </span>
      )}
      {t && (
        <div className="absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap font-cond text-xs font-bold italic tabular-nums text-white/85">
          {Math.abs(dy) > 10 && <span style={{ color }}>{dy > 0 ? "\u25B2 " : "\u25BC "}</span>}
          {meters(dist)}
        </div>
      )}
    </div>
  );
}

// Screen spot from yaw only: the camera pitch is not in the HUD state, so height assumes the default tilt.
function Waypoint({ h, t, color, dist }: { h: HudState; t: Target; color: string; dist: number }) {
  if (typeof window === "undefined" || dist < 12) return null;
  const rel = relAngle(h, t);
  const tanV = Math.tan((30 * Math.PI) / 180);
  const tanH = tanV * (window.innerWidth / Math.max(1, window.innerHeight));
  const sx = Math.tan(rel) / tanH;
  if (Math.abs(rel) < Math.PI / 2 && Math.abs(sx) < 0.9) {
    const elev = Math.atan2((t.y ?? h.height + 1) - h.height - 1.5, Math.max(dist, 1));
    const sy = Math.min(0.8, Math.max(-0.75, Math.tan(elev + 0.15) / tanV));
    return (
      <div className={`absolute -translate-x-1/2 -translate-y-1/2 text-center ${SHADOW}`} style={{ left: `${50 + sx * 50}%`, top: `${50 - sy * 50}%`, transition: "left 125ms linear, top 125ms linear" }}>
        <div className="mx-auto h-3 w-3 rotate-45 ring-2 ring-black/60" style={{ background: color }} />
        <div className="mt-1 font-cond text-[11px] font-bold italic tabular-nums text-white/80">{meters(dist)}</div>
      </div>
    );
  }
  const right = rel > 0;
  return (
    <div className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1 ${right ? "right-3 flex-row-reverse" : "left-3"} ${SHADOW}`}>
      <span className="font-cond text-2xl font-black leading-none" style={{ color }}>
        {right ? "\u25B6" : "\u25C0"}
      </span>
      <span className="font-cond text-xs font-bold italic tabular-nums text-white/80">{meters(dist)}</span>
    </div>
  );
}

function NextUp({ m }: { m: Labeled & { d: number } }) {
  const st = MARKER[m.kind];
  return (
    <div key={m.label ?? m.kind} className={`panel-in flex flex-col items-end text-right ${SHADOW}`}>
      <div className="font-cond text-[11px] font-black uppercase tracking-[0.3em] text-white/60">Next up</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rotate-45" style={{ background: st.color }} />
        <span className="font-cond text-base font-black uppercase italic leading-none sm:text-lg">{m.label ?? st.name}</span>
        <span className="font-cond text-sm font-bold italic tabular-nums text-white/70">{meters(m.d)}</span>
      </div>
      <div className="mt-1 text-[13px] leading-snug text-white/80">{st.hint}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-white/55">
        <Key dark>Esc</Key> Map
      </div>
    </div>
  );
}

const AIM: Record<HudState["aim"], { color: string; op: number; gap: number }> = {
  aim: { color: "#ffffff", op: 1, gap: 5 },
  auto: { color: "#ffffff", op: 0.85, gap: 7 },
  far: { color: "#9aa0a8", op: 0.8, gap: 8 },
  blocked: { color: "#e2231a", op: 0.95, gap: 8 },
  none: { color: "#ffffff", op: 0.3, gap: 8 },
};

function Crosshair({ h }: { h: HudState }) {
  const st = AIM[h.aim] ?? AIM.none;
  const g = st.gap;
  const glow = h.aim === "aim" ? "drop-shadow(0 0 3px rgba(255,255,255,0.9)) drop-shadow(0 1px 2px #000)" : "drop-shadow(0 1px 2px rgba(0,0,0,0.9))";
  const showDist = (h.aim === "aim" || h.aim === "auto" || h.aim === "far") && h.aimDist > 0;
  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ opacity: st.op, transition: "opacity 120ms" }}>
      <svg viewBox="-30 -30 60 60" className="h-[60px] w-[60px] overflow-visible" style={{ filter: glow }}>
        <g stroke={st.color} strokeWidth={h.aim === "aim" ? 2 : 1.6} strokeLinecap="round" fill="none" style={{ transition: "stroke 120ms" }}>
          <path d={`M${-g} 0h${-5}M${g} 0h5M0 ${-g}v-5M0 ${g}v5`} />
          {h.aim === "blocked" && <path d="M-4 -4L4 4M4 -4L-4 4" />}
        </g>
        {h.aim !== "blocked" && <circle r={h.aim === "aim" ? 1.8 : 1.3} fill={st.color} />}
        {h.aim === "aim" && <path d="M-16 -9L-19 0L-16 9M16 -9L19 0L16 9" stroke="#e2231a" strokeWidth={2} fill="none" strokeLinejoin="round" />}
        {h.aim === "auto" && <path d="M13 -13l4 -4M13 -17h4v4" stroke={st.color} strokeWidth={1.6} fill="none" strokeLinecap="round" />}
      </svg>
      {showDist && (
        <div className={`absolute left-1/2 top-[50px] -translate-x-1/2 font-cond text-xs font-bold italic tabular-nums tracking-wider ${SHADOW}`} style={{ color: st.color }}>
          {Math.round(h.aimDist)} m
        </div>
      )}
    </div>
  );
}

export function Hud({ h, pops, showVitals, tip }: { h: HudState; pops: Pop[]; showVitals: boolean; tip?: ReactNode }) {
  const lines = Math.min(Math.max((h.speed - 110) / 160, 0), 0.45);
  const toast = [...pops].reverse().find((p) => p.type === "toast");
  const penalty = [...pops].reverse().find((p) => p.type === "penalty");
  const hurt = [...pops].reverse().find((p) => p.type === "hurt");
  const xps = pops.filter((p) => p.type === "xp");
  const token = [...pops].reverse().find((p): p is Extract<Pop, { type: "token" }> => p.type === "token");
  const next = h.objective ? null : nextUp(h);
  const goal: Target | null = h.objective?.target ?? next;
  const goalColor = h.objective ? "#e2231a" : next ? MARKER[next.kind].color : "#fff";
  const dist = goal ? Math.hypot(goal.x - h.x, goal.z - h.z) : 0;
  return (
    <div className="pointer-events-none absolute inset-0 font-sans">
      {lines > 0 && (
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: lines,
            background: "repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0.22) 0deg 0.5deg, transparent 0.5deg 7deg)",
            maskImage: "radial-gradient(circle at 50% 50%, transparent 34%, black 80%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 50%, transparent 34%, black 80%)",
          }}
        />
      )}
      {h.health < 0.3 && <div className="absolute inset-0 shadow-[inset_0_0_140px_rgba(226,35,26,0.55)]" />}
      {hurt?.type === "hurt" && (
        <div
          key={hurt.id}
          className="hurt-flash absolute inset-0"
          style={{ boxShadow: `inset 0 0 ${120 + Math.min(1, hurt.amount * 3) * 120}px rgba(255,20,20,${0.45 + Math.min(0.5, hurt.amount * 2)})` }}
        />
      )}

      <div className="absolute left-4 top-[60px] flex max-w-[42vw] flex-col gap-2 sm:left-6 sm:top-6 sm:max-w-[340px]">
        <Health h={h} show={showVitals} />
        <Status h={h} token={token} />
        {tip}
      </div>

      <Compass h={h} t={goal} color={goalColor} dist={dist} />
      {goal && <Waypoint h={h} t={goal} color={goalColor} dist={dist} />}
      {h.boss && <Boss b={h.boss} />}
      <div data-hud="right" className="absolute right-4 top-[60px] flex max-w-[46vw] flex-col items-end sm:right-6 sm:top-6 sm:max-w-[340px]">
        {h.objective && <Objective o={h.objective} dist={h.objective.target ? dist : null} />}
        {next && <NextUp m={next} />}
      </div>
      {h.sense && <Sense s={h.sense} />}
      {h.stealth && <Stealth s={h.stealth} />}

      <Crosshair h={h} />

      {toast?.type === "toast" && (
        <div key={toast.id} className="banner-in absolute left-1/2 top-[20%] w-max max-w-[calc(100%-32px)] -translate-x-1/2 text-center">
          <div className="glitch-in inline-block">
            <div className="relative -skew-x-12 bg-spider px-8 py-2 shadow-[6px_6px_0_#000]">
              <div className="halftone absolute inset-0 text-black/20" />
              <div className="relative skew-x-12 font-cond text-4xl font-black uppercase italic leading-none tracking-tight sm:text-5xl">{toast.title}</div>
            </div>
          </div>
          {toast.text && <div className={`mt-3 font-cond text-lg font-bold uppercase italic tracking-wide ${SHADOW}`}>{toast.text}</div>}
        </div>
      )}

      {penalty?.type === "penalty" && (
        <div key={penalty.id} className="warn-in absolute bottom-[210px] left-1/2 sm:bottom-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
          <div className="flex items-center gap-2.5 -skew-x-12 border-l-4 border-warn bg-black/75 px-4 py-2 shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
            <svg width="20" height="18" viewBox="0 0 20 18" className="skew-x-12">
              <path d="M10 1 L19 17 H1 Z" fill="#ffd23a" />
              <path d="M10 6.5v5M10 13.6v1.2" stroke="#000" strokeWidth={2} strokeLinecap="round" />
            </svg>
            <span className="skew-x-12 font-cond text-base font-black uppercase italic tracking-wide text-warn">{penalty.reason}</span>
          </div>
        </div>
      )}

      <div className="absolute right-4 top-[38%] flex flex-col items-end gap-1 sm:right-8">
        {xps.map(
          (x) =>
            x.type === "xp" && (
              <div key={x.id} className={`xp-rise font-cond font-black uppercase italic ${SHADOW}`}>
                <span className={x.amount < 0 ? "text-warn" : "text-white"}>
                  {x.amount > 0 ? "+" : ""}
                  {x.amount} XP
                </span>{" "}
                <span className="text-sm text-white/75">{x.reason}</span>
              </div>
            ),
        )}
      </div>

      {h.combo > 1 && (
        <div className={`absolute right-4 top-1/2 text-right font-cond font-black italic leading-none sm:right-8 ${SHADOW}`}>
          <div key={h.combo} className="glitch-in text-5xl tabular-nums">
            <span className="text-2xl text-spider">x</span>
            {h.combo}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.3em] text-white/70">Combo</div>
        </div>
      )}

      {h.prompts.length > 0 && (
        <div className="absolute bottom-[132px] left-1/2 flex w-full -translate-x-1/2 flex-wrap justify-center gap-x-4 gap-y-2 px-4 sm:bottom-24 sm:w-auto" data-hud="prompts">
          {h.prompts.map((p) => (
            <div key={p.key + p.label} className="flex items-center gap-2 rounded-sm bg-black/55 py-1 pl-1 pr-3 backdrop-blur-sm">
              {p.key && <Key>{p.key}</Key>}
              <span className="font-cond text-sm font-bold uppercase tracking-wide">{p.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex items-end gap-3 sm:bottom-6 sm:left-6">
        <div className="h-[104px] w-[104px] sm:h-[148px] sm:w-[148px]" data-hud="minimap">
          <div className="origin-top-left scale-[0.7027] sm:scale-100">
            <Minimap h={h} />
          </div>
        </div>
        {h.gadget && <Gadget g={h.gadget} />}
      </div>

      {h.speed > 8 && (
        <div className={`absolute bottom-4 right-4 text-right font-cond font-bold italic tabular-nums text-white/55 sm:bottom-6 sm:right-6 ${SHADOW}`}>
          <span className="text-2xl text-white/80">{Math.round(h.speed)}</span> <span className="text-xs uppercase">km/h</span>
          <span className="ml-3 text-xs uppercase">{Math.round(h.height)} m</span>
        </div>
      )}
    </div>
  );
}
