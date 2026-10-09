"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { HudState, Marker } from "./contracts";
import { BLOCKS, BOUNDS, DISTRICT_NAMES, type GeoBlock } from "./city-geo";
import { GEO, MARKER, type Labeled } from "./ui-hud";
import { PanelFrame } from "./ui-menu";

const PAD = 20;
const VB = { x: BOUNDS.minX - PAD, y: BOUNDS.minZ - PAD, w: BOUNDS.maxX - BOUNDS.minX + PAD * 2, h: BOUNDS.maxZ - BOUNDS.minZ + PAD * 2 };
const MAX_ZOOM = 8;
const LEGEND: Marker["kind"][] = ["race", "crime", "chase", "boss", "hideout", "challenge", "request", "photo", "cache", "pigeon", "collectible"];
const SHOWN = new Set<Marker["kind"]>([...LEGEND, "checkpoint"]);
const OTHER = ["Manhattan", "Brooklyn", "Queens"] as const;
const DETAIL_ZOOM = 1.6;
const LABEL = { stroke: "#07090d", paintOrder: "stroke" } as const;

const pctOf = (h: HudState, name: string) => h.progress.districts.find((d) => d.name === name)?.pct;

const anchor = (bs: GeoBlock[]) => {
  let ax = 0;
  let az = 0;
  let a = 0;
  for (const b of bs) {
    const w = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    ax += ((b.minX + b.maxX) / 2) * w;
    az += ((b.minZ + b.maxZ) / 2) * w;
    a += w;
  }
  ax /= a;
  az /= a;
  const near = bs.reduce((p, b) => (Math.hypot((b.minX + b.maxX) / 2 - ax, (b.minZ + b.maxZ) / 2 - az) < Math.hypot((p.minX + p.maxX) / 2 - ax, (p.minZ + p.maxZ) / 2 - az) ? b : p));
  return { x: (near.minX + near.maxX) / 2, z: (near.minZ + near.maxZ) / 2 };
};

const DISTRICTS = DISTRICT_NAMES.map((name) => {
  const bs = BLOCKS.filter((b) => b.district === name);
  return { name, d: bs.map((b) => GEO.rectPath(b.minX, b.minZ, b.maxX, b.maxZ)).join(""), ...(bs.length ? anchor(bs) : { x: 0, z: 0 }), n: bs.length };
}).filter((d) => d.n);
const BOROUGHS = OTHER.map((name) => ({ name, ...anchor(BLOCKS.filter((b) => b.borough === name)) }));
const PARKS = BLOCKS.filter((b) => b.tag === "park")
  .map((b) => GEO.rectPath(b.minX, b.minZ, b.maxX, b.maxZ))
  .join("");
const WATER = [
  { name: "Hudson River", x: BOUNDS.minX + 55, z: 120 },
  { name: "East River", x: 360, z: 200 },
];

type View = { cx: number; cz: number; zoom: number };
const FIT: View = { cx: VB.x + VB.w / 2, cz: VB.y + VB.h / 2, zoom: 1 };

export function MapPanel({ h, onClose }: { h: HudState; onClose: () => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View>(FIT);
  const [size, setSize] = useState({ w: 600, h: 440 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cz: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 600, h: el.clientHeight || 440 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fitU = Math.max(VB.w / size.w, VB.h / size.h);
  const u = fitU / view.zoom;
  const vw = size.w * u;
  const vh = size.h * u;
  const clampView = (v: View): View => {
    const uu = fitU / v.zoom;
    const hw = Math.max(0, VB.w - size.w * uu) / 2;
    const hh = Math.max(0, VB.h - size.h * uu) / 2;
    return { zoom: v.zoom, cx: Math.min(FIT.cx + hw, Math.max(FIT.cx - hw, v.cx)), cz: Math.min(FIT.cz + hh, Math.max(FIT.cz - hh, v.cz)) };
  };
  const zoomAt = (k: number, px: number, py: number) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom * k));
    const wx = view.cx + (px - size.w / 2) * u;
    const wz = view.cz + (py - size.h / 2) * u;
    const nu = fitU / zoom;
    setView(clampView({ zoom, cx: wx - (px - size.w / 2) * nu, cz: wz - (py - size.h / 2) * nu }));
  };
  const wheel = useRef(zoomAt);
  useEffect(() => {
    wheel.current = zoomAt;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      wheel.current(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView(clampView({ zoom: view.zoom, cx: d.cx - (e.clientX - d.x) * u, cz: d.cz - (e.clientY - d.y) * u }));
  };
  const onUp = () => {
    drag.current = null;
  };
  const markers = (h.markers as Labeled[]).filter((m) => SHOWN.has(m.kind));
  const counts = new Map<Marker["kind"], number>();
  for (const m of markers) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
  const goal = h.objective?.target;
  const fs = (px: number) => px * u;
  const btn = "flex h-7 w-7 cursor-pointer items-center justify-center bg-black/70 font-cond text-base font-black text-white/80 ring-1 ring-white/25 hover:text-white";
  return (
    <PanelFrame title="Map" onClose={onClose} xl>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div ref={box} className="relative w-full min-w-0 touch-none select-none overflow-hidden" style={{ height: "min(62vh, 600px)" }}>
          <svg
            viewBox={`${view.cx - vw / 2} ${view.cz - vh / 2} ${vw} ${vh}`}
            className={`block h-full w-full bg-[#0d2238] ${drag.current ? "cursor-grabbing" : "cursor-grab"}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onMouseLeave={() => setHover(null)}
          >
            {GEO.land.map((l) => (
              <path key={l.borough} d={l.d} fill="#1a1e26" />
            ))}
            <path d={GEO.roads} stroke="rgba(255,255,255,0.08)" strokeWidth={22} fill="none" />
            <path d={DISTRICTS.map((d) => d.d).join("")} fill="rgba(255,255,255,0.1)" />
            <path d={PARKS} fill="rgba(70,150,90,0.55)" />
            <path d={GEO.park} fill="rgba(70,150,90,0.45)" />
            {DISTRICTS.map((d) => {
              const pct = pctOf(h, d.name);
              return pct !== undefined && pct >= 100 ? <path key={d.name} data-done="" d={d.d} fill="rgba(226,35,26,0.3)" stroke="#e2231a" strokeWidth={fs(1.5)} /> : null;
            })}
            {GEO.bridges.map((b) => (
              <path key={b.name} d={b.d} stroke="rgba(255,255,255,0.35)" strokeWidth={b.w} fill="none">
                <title>{b.name}</title>
              </path>
            ))}
            {WATER.map((w) => (
              <text key={w.name} x={w.x} y={w.z} fill="rgba(160,200,255,0.5)" fontSize={fs(11)} fontWeight={700} textAnchor="middle" transform={`rotate(-90 ${w.x} ${w.z})`} className="font-cond uppercase">
                {w.name}
              </text>
            ))}
            {view.zoom < DETAIL_ZOOM && BOROUGHS.map((b) => (
              <text key={b.name} x={b.x} y={b.z} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={fs(18)} fontWeight={900} fontStyle="italic" className="font-cond uppercase" style={{ ...LABEL, strokeWidth: fs(4) }}>
                {b.name}
              </text>
            ))}
            {view.zoom >= DETAIL_ZOOM && DISTRICTS.map((d) => {
              const pct = pctOf(h, d.name);
              return (
                <g key={d.name}>
                  <text x={d.x} y={d.z} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={fs(10)} fontWeight={900} fontStyle="italic" className="font-cond uppercase" style={{ ...LABEL, strokeWidth: fs(3) }}>
                    {d.name}
                  </text>
                  {pct !== undefined && (
                    <text x={d.x} y={d.z + fs(11)} textAnchor="middle" fill={pct >= 100 ? "#ff5a4f" : "rgba(255,255,255,0.55)"} fontSize={fs(9)} fontWeight={800} className="font-cond uppercase" style={{ ...LABEL, strokeWidth: fs(3) }}>
                      {pct >= 100 ? "\u2713 Complete" : `${pct}%`}
                    </text>
                  )}
                </g>
              );
            })}
            {markers.map((m, i) => {
              const st = MARKER[m.kind];
              const label = m.label ?? st.name;
              return (
                <g key={i} transform={`translate(${m.x} ${m.z}) scale(${u})`} onMouseEnter={() => setHover(label)} className="cursor-pointer">
                  {st.edge ? <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill={st.color} stroke="#000" strokeWidth={1.5} /> : <circle r={m.kind === "collectible" || m.kind === "pigeon" ? 3 : 4.5} fill={st.color} stroke="#000" strokeWidth={1.2} />}
                  <title>{label}</title>
                </g>
              );
            })}
            {goal && <circle cx={goal.x} cy={goal.z} r={fs(12)} fill="none" stroke="#e2231a" strokeWidth={fs(2.5)} />}
            <g data-hero="" transform={`translate(${h.x} ${h.z}) scale(${u}) rotate(${((Math.PI - h.heading) * 180) / Math.PI})`}>
              <circle r={13} fill="rgba(226,35,26,0.25)" />
              <path d="M 0 -12 L 7.5 8 L 0 4 L -7.5 8 Z" fill="#fff" stroke="#e2231a" strokeWidth={2} />
            </g>
          </svg>
          <div className="pointer-events-none absolute left-2 top-2 font-cond text-xs font-bold uppercase tracking-widest text-white/70">{hover ?? "\u25B2 N \u00B7 Scroll to zoom"}</div>
          <div className="absolute bottom-2 right-2 flex flex-col gap-1">
            <button className={btn} onClick={() => zoomAt(1.6, size.w / 2, size.h / 2)} aria-label="Zoom in">+</button>
            <button className={btn} onClick={() => zoomAt(1 / 1.6, size.w / 2, size.h / 2)} aria-label="Zoom out">-</button>
            <button className={btn} onClick={() => setView(clampView({ zoom: 3, cx: h.x, cz: h.z }))} aria-label="Center on me">{"\u25CE"}</button>
          </div>
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
