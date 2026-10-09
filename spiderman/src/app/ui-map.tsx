"use client";

import { useState } from "react";
import type { HudState, Marker } from "./contracts";
import { BLOCK, BLOCKS, HALF, PERIOD, STREET } from "./city";
import { DISTRICT_RECTS } from "./city-districts";
import { MARKER, type Labeled } from "./ui-hud";
import { PanelFrame } from "./ui-menu";

const lineAt = (k: number) => -HALF + k * PERIOD;
const RIVER_X = HALF + 30;
const BRIDGE_Z = lineAt(12);
const PAD = 24;
const VB = { x: -HALF - PAD, y: -HALF - PAD, w: HALF * 2 + PAD + 110, h: HALF * 2 + PAD * 2 };
const ASPECT = VB.w / VB.h;
const LEGEND: Marker["kind"][] = ["race", "crime", "chase", "boss", "hideout", "challenge", "request", "photo", "cache", "pigeon", "collectible"];
const SHOWN = new Set<Marker["kind"]>([...LEGEND, "checkpoint"]);

const pctOf = (h: HudState, name: string) => h.progress.districts.find((d) => d.name === name)?.pct;

export function MapPanel({ h, onClose }: { h: HudState; onClose: () => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const markers = (h.markers as Labeled[]).filter((m) => SHOWN.has(m.kind));
  const counts = new Map<Marker["kind"], number>();
  for (const m of markers) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  const goal = h.objective?.target;
  const blocks = [];
  for (let i = 0; i < BLOCKS; i++) {
    for (let j = 0; j < BLOCKS; j++) {
      const park = i >= 5 && i <= 8 && j >= 2 && j <= 4;
      blocks.push(<rect key={i * 100 + j} x={lineAt(i) + STREET / 2} y={lineAt(j) + STREET / 2} width={BLOCK} height={BLOCK} rx={3} fill={park ? "rgba(70,150,90,0.45)" : "rgba(255,255,255,0.09)"} />);
    }
  }
  return (
    <PanelFrame title="Map" onClose={onClose} xl>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="relative w-full min-w-0" style={{ maxWidth: `min(${Math.round(540 * ASPECT)}px, ${Math.round(66 * ASPECT)}vh)` }}>
          <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} className="block h-auto w-full bg-[#07090d]" onMouseLeave={() => setHover(null)}>
            <rect x={RIVER_X} y={VB.y} width={VB.w} height={VB.h} fill="#0d2238" />
            <rect x={RIVER_X - 6} y={BRIDGE_Z - 5} width={VB.w} height={10} fill="rgba(255,255,255,0.22)" />
            <text x={RIVER_X + 52} y={-40} fill="rgba(160,200,255,0.5)" fontSize={20} fontWeight={700} textAnchor="middle" transform={`rotate(90 ${RIVER_X + 52} -40)`} className="font-cond uppercase">
              East River
            </text>
            {blocks}
            {DISTRICT_RECTS.map((d) => {
              const x = lineAt(d.i0) + STREET / 2;
              const y = lineAt(d.j0) + STREET / 2;
              const w = lineAt(d.i1 + 1) - STREET / 2 - x;
              const hh = lineAt(d.j1 + 1) - STREET / 2 - y;
              const pct = pctOf(h, d.name);
              return (
                <g key={d.name} data-done={pct !== undefined && pct >= 100 ? "" : undefined}>
                  {pct !== undefined && pct >= 100 ? (
                    <rect x={x - 4} y={y - 4} width={w + 8} height={hh + 8} fill="rgba(226,35,26,0.14)" stroke="#e2231a" strokeWidth={4} />
                  ) : (
                    <rect x={x - 4} y={y - 4} width={w + 8} height={hh + 8} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={2} strokeDasharray="10 8" />
                  )}
                  <text x={x + w / 2} y={y + hh / 2 - 4} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize={d.name.length > 14 ? 22 : 26} fontWeight={900} fontStyle="italic" className="font-cond uppercase" style={{ paintOrder: "stroke", stroke: "#07090d", strokeWidth: 6 }}>
                    {d.name}
                  </text>
                  {pct !== undefined && (
                    <text x={x + w / 2} y={y + hh / 2 + 22} textAnchor="middle" fill={pct >= 100 ? "#ff5a4f" : "rgba(255,255,255,0.55)"} fontSize={20} fontWeight={800} className="font-cond uppercase" style={{ paintOrder: "stroke", stroke: "#07090d", strokeWidth: 6 }}>
                      {pct >= 100 ? "\u2713 Complete" : `${pct}%`}
                    </text>
                  )}
                </g>
              );
            })}
            {markers.map((m, i) => {
              const st = MARKER[m.kind];
              const big = st.edge;
              const label = m.label ?? st.name;
              return (
                <g key={i} transform={`translate(${m.x} ${m.z})`} onMouseEnter={() => setHover(label)} className="cursor-pointer">
                  {big ? <rect x={-9} y={-9} width={18} height={18} transform="rotate(45)" fill={st.color} stroke="#000" strokeWidth={3} /> : <circle r={m.kind === "collectible" || m.kind === "pigeon" ? 6 : 8} fill={st.color} stroke="#000" strokeWidth={2.5} />}
                  <title>{label}</title>
                </g>
              );
            })}
            {goal && <circle cx={goal.x} cy={goal.z} r={22} fill="none" stroke="#e2231a" strokeWidth={5} />}
            <g transform={`translate(${h.x} ${h.z}) rotate(${((Math.PI - h.heading) * 180) / Math.PI})`}>
              <circle r={26} fill="rgba(226,35,26,0.25)" />
              <path d="M 0 -24 L 15 16 L 0 8 L -15 16 Z" fill="#fff" stroke="#e2231a" strokeWidth={4} />
            </g>
          </svg>
          <div className="pointer-events-none absolute left-2 top-2 font-cond text-xs font-bold uppercase tracking-widest text-white/70">{hover ?? "\u25B2 N"}</div>
        </div>
        <div className="grid shrink-0 grid-cols-2 content-start gap-x-4 gap-y-2 sm:w-36 sm:grid-cols-1">
          {LEGEND.map((k) => (
            <div key={k} className={`flex items-center gap-2 text-xs ${counts.get(k) ? "text-white/85" : "text-white/35"}`}>
              <span className={`h-2.5 w-2.5 shrink-0 ${MARKER[k].edge ? "rotate-45" : "rounded-full"}`} style={{ background: MARKER[k].color }} />
              <span className="truncate font-cond font-bold uppercase tracking-wide">{MARKER[k].name}</span>
              <span className="ml-auto tabular-nums text-white/50">{counts.get(k) ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelFrame>
  );
}

type Row = { kind: Marker["kind"]; name: string; done: number; total?: number };

export function JournalPanel({ h, onClose }: { h: HudState; onClose: () => void }) {
  const p = h.progress;
  const c = p.completed;
  const row = (kind: Marker["kind"], name: string, key: string): Row => ({ kind, name, done: c[key] ?? 0, total: c[`total:${key}`] });
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "Story and crime",
      rows: [row("boss", "Bosses", "bosses"), row("hideout", "Hideouts", "hideouts"), row("crime", "Crimes stopped", "crimes"), row("chase", "Car chases", "chases")],
    },
    {
      title: "Activities",
      rows: [row("race", "Swing races", "races"), row("challenge", "Challenges", "challenges"), row("request", "Requests", "requests"), row("pigeon", "Pigeon flocks", "pigeons")],
    },
    {
      title: "Collectibles",
      rows: [{ kind: "collectible", name: "Backpacks", done: p.collected, total: p.totalCollectibles }, row("photo", "Photo ops", "photos"), row("cache", "Signal caches", "caches")],
    },
  ];
  return (
    <PanelFrame title="Journal" onClose={onClose} wide>
      <div className="flex items-center gap-4">
        <div className="-skew-x-12 bg-white px-3 py-1 font-cond text-4xl font-black italic leading-none text-black shadow-[4px_4px_0_#e2231a]">{p.level}</div>
        <div className="flex-1">
          <div className="flex justify-between font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">
            <span>Level {p.level}</span>
            <span className="tabular-nums">{Math.round(p.levelProgress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 -skew-x-12 bg-white/15">
            <div className="h-full bg-spider" style={{ width: `${p.levelProgress * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className={g.title === "Collectibles" ? "sm:col-span-2" : ""}>
            <div className="mb-2 font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">{g.title}</div>
            <div className={`grid gap-2 ${g.title === "Collectibles" ? "sm:grid-cols-2 sm:gap-x-6" : ""}`}>
              {g.rows.map((r) => (
                <div key={r.name}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 ${MARKER[r.kind].edge ? "rotate-45" : "rounded-full"}`} style={{ background: MARKER[r.kind].color }} />
                    <span className="font-cond text-sm font-bold uppercase tracking-wide">{r.name}</span>
                    <span className="ml-auto font-cond text-sm font-black italic tabular-nums">
                      {r.done}
                      {r.total !== undefined && <span className="text-white/45">/{r.total}</span>}
                    </span>
                  </div>
                  {r.total !== undefined && (
                    <div className="mt-1 h-1 bg-white/12">
                      <div className="h-full" style={{ width: `${r.total ? (100 * r.done) / r.total : 0}%`, background: r.done >= r.total ? "#e2231a" : "#fff" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {p.districts.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 font-cond text-xs font-bold uppercase tracking-[0.2em] text-white/50">Districts</div>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {p.districts.map((d) => (
              <div key={d.name} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-sm">
                <span className="truncate font-cond font-bold uppercase">{d.name}</span>
                <div className="h-1.5 bg-white/15">
                  <div className={`h-full ${d.pct >= 100 ? "bg-spider" : "bg-white"}`} style={{ width: `${Math.min(100, d.pct)}%` }} />
                </div>
                <span className="text-right font-cond tabular-nums text-white/70">{Math.round(d.pct)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PanelFrame>
  );
}
