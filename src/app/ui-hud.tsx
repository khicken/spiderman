"use client";

import { useRef } from "react";
import type { HudState, Marker } from "./contracts";
import { BLOCKS, HALF, PERIOD } from "./city";
import { Key } from "./ui-menu";

export type Pop =
  | { id: number; type: "xp"; amount: number; reason: string }
  | { id: number; type: "penalty"; reason: string }
  | { id: number; type: "toast"; title: string; text?: string }
  | { id: number; type: "hurt"; amount: number };

const R = 74;
const RANGE = 230;
const K = R / RANGE;

const MARKER: Record<Marker["kind"], { color: string; r: number; edge: boolean }> = {
  race: { color: "#3fa9ff", r: 5, edge: true },
  crime: { color: "#ff2a3c", r: 5, edge: true },
  chase: { color: "#ff9a1f", r: 5, edge: true },
  checkpoint: { color: "#5ff2ff", r: 5, edge: true },
  boss: { color: "#c13cff", r: 6.5, edge: true },
  hideout: { color: "#ff5a1f", r: 5, edge: true },
  challenge: { color: "#2ee6a6", r: 5, edge: true },
  request: { color: "#ffffff", r: 4.5, edge: true },
  photo: { color: "#9be15d", r: 4, edge: false },
  cache: { color: "#c58bff", r: 4, edge: false },
  collectible: { color: "#ffd34d", r: 2.5, edge: false },
  pigeon: { color: "#b9c2cc", r: 2.5, edge: false },
  enemy: { color: "#ff4d5a", r: 2.8, edge: false },
  civilian: { color: "#ffffff", r: 1.8, edge: false },
};

const GRID = Array.from({ length: BLOCKS + 1 }, (_, i) => -HALF + i * PERIOD);
const SHADOW = "drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]";

function Minimap({ h }: { h: HudState }) {
  const prev = useRef<{ raw: number; acc: number } | null>(null);
  if (!prev.current) prev.current = { raw: h.heading, acc: h.heading };
  else if (prev.current.raw !== h.heading) {
    const d = Math.atan2(Math.sin(h.heading - prev.current.raw), Math.cos(h.heading - prev.current.raw));
    prev.current = { raw: h.heading, acc: prev.current.acc + d };
  }
  const rot = prev.current.acc + Math.PI;
  const c = Math.cos(h.heading);
  const n = Math.sin(h.heading);
  const ease = "transform 125ms linear";
  return (
    <div className="relative shrink-0 overflow-hidden rounded-full bg-black/60 ring-2 ring-white/25 backdrop-blur-sm" style={{ width: R * 2, height: R * 2 }}>
      <div className="absolute" style={{ left: R, top: R, transform: `rotate(${rot}rad)`, transition: ease }}>
        <div style={{ transform: `translate(${-h.x * K}px, ${-h.z * K}px)`, transition: ease }}>
          <svg className="absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1}>
            <g transform={`scale(${K})`}>
              <rect x={-HALF} y={-HALF} width={HALF * 2} height={HALF * 2} fill="rgba(255,255,255,0.04)" />
              <g stroke="rgba(255,255,255,0.17)" strokeWidth={22}>
                {GRID.map((l) => (
                  <g key={l}>
                    <line x1={l} y1={-HALF} x2={l} y2={HALF} />
                    <line x1={-HALF} y1={l} x2={HALF} y2={l} />
                  </g>
                ))}
              </g>
            </g>
          </svg>
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
    <div className={`w-[min(300px,60vw)] transition-opacity duration-700 ${SHADOW} ${show ? "opacity-100" : "opacity-0"}`}>
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
    <div className={`glitch-in absolute left-1/2 top-4 w-[min(560px,calc(100%-32px))] -translate-x-1/2 ${SHADOW}`}>
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

function Objective({ o }: { o: NonNullable<HudState["objective"]> }) {
  const medal: Record<string, string> = { gold: "#ffcf3a", silver: "#d5dbe3", bronze: "#d48a4f" };
  return (
    <div key={o.title} className={`panel-in absolute right-4 top-4 flex max-w-[min(340px,calc(100%-32px))] flex-col items-end text-right sm:right-6 sm:top-6 ${SHADOW}`}>
      <div className="-skew-x-12 bg-spider px-3 py-0.5 font-cond text-sm font-black uppercase italic tracking-wider shadow-[3px_3px_0_#000]">{o.title}</div>
      <div className="mt-2 text-[15px] font-semibold leading-snug">{o.text}</div>
      {(o.timer !== undefined || o.progress || o.medal) && (
        <div className="mt-1 flex items-baseline gap-3 font-cond font-black italic tabular-nums">
          {o.medal && (
            <span className="text-xs uppercase tracking-widest" style={{ color: medal[o.medal.toLowerCase()] ?? "#fff" }}>
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

export function Hud({ h, pops, showVitals }: { h: HudState; pops: Pop[]; showVitals: boolean }) {
  const lines = Math.min(Math.max((h.speed - 110) / 160, 0), 0.45);
  const toast = [...pops].reverse().find((p) => p.type === "toast");
  const penalty = [...pops].reverse().find((p) => p.type === "penalty");
  const hurt = [...pops].reverse().find((p) => p.type === "hurt");
  const xps = pops.filter((p) => p.type === "xp");
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

      <div className="absolute left-4 top-4 sm:left-6 sm:top-6">
        <Health h={h} show={showVitals} />
      </div>

      {h.boss && <Boss b={h.boss} />}
      {h.objective && <Objective o={h.objective} />}
      {h.sense && <Sense s={h.sense} />}

      <div className="absolute left-1/2 top-1/2 -ml-[2px] -mt-[2px] h-1 w-1 rounded-full bg-white/80" />

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
        <div key={penalty.id} className="warn-in absolute bottom-40 left-1/2 w-max max-w-[calc(100%-32px)] -translate-x-1/2">
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
        <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-x-4 gap-y-2 px-4">
          {h.prompts.map((p) => (
            <div key={p.key + p.label} className="flex items-center gap-2 rounded-sm bg-black/55 py-1 pl-1 pr-3 backdrop-blur-sm">
              <Key>{p.key}</Key>
              <span className="font-cond text-sm font-bold uppercase tracking-wide">{p.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-4 left-4 flex items-end gap-3 sm:bottom-6 sm:left-6">
        <Minimap h={h} />
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
