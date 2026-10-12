"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { CarSpec, MapData, MapId, MapInfo, Track, Weather } from "./contracts";
import { Minus, Plus } from "./ui-icons";

export type MapCard = {
  id: MapId;
  name: string;
  place: string;
  outline?: ArrayLike<number>; // x,z pairs
  closed?: boolean;
  length?: number; // m
  weather?: Weather;
  hour?: number;
};

export function mapCard(info: MapInfo, data?: MapData, track?: Track): MapCard {
  const card: MapCard = { id: info.id, name: info.name, place: info.place };
  if (!data) return card;
  let outline: ArrayLike<number> | undefined = track?.outline;
  if (!outline) {
    const o: number[] = [];
    for (let i = 0; i < data.center.length; i += 3 * 4) o.push(data.center[i], data.center[i + 2]);
    outline = o;
  }
  return { ...card, outline, closed: data.closed, length: track?.length ?? (data.center.length / 3) * 5, weather: data.env.weather, hour: data.env.hour };
}

export const CLASS_COLOR: Record<CarSpec["klass"], string> = { S2: "var(--color-s2)", S1: "var(--color-s1)", A: "var(--color-a)", B: "var(--color-b)" };

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function fmtTime(t: number, plus = false) {
  if (!isFinite(t) || t <= 0) return plus ? "+0.000" : "-:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}

export function fmtDelta(d: number) {
  return `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(3)}`;
}

export function fmtLength(m: number, mph: boolean) {
  return mph ? `${(m / 1609.34).toFixed(1)} mi` : `${(m / 1000).toFixed(1)} km`;
}

// 0..1 scores from physics specs. Ranges cover the eight cars in cars.ts.
export function carStats(c: CarSpec) {
  let p = 0;
  for (const [rpm, tq] of c.engine.curve) p = Math.max(p, (tq * rpm * Math.PI) / 30);
  const vmax = Math.cbrt((2 * p) / (1.2 * c.aero.cd * c.aero.area));
  const df = ((c.aero.clF + c.aero.clR) * 0.6 * 45 * 45) / (c.mass * 9.81);
  const grip = c.tire.muLat * (1 + df);
  const traction = c.drive === "awd" ? 1.15 : c.drive === "fwd" ? 0.9 : 1;
  const k = (v: number, a: number, b: number) => Math.min(1, Math.max(0.05, (v - a) / (b - a)));
  return {
    speed: k(vmax * 3.6, 180, 400),
    handling: k(grip - c.mass / 20000, 0.85, 1.75),
    accel: k((p / c.mass) * traction, 60, 650),
    braking: k(c.tire.mu * (1 + df * 0.6) + (c.brake * 2) / (c.mass * c.body.wheelR * 9.81 * 4), 1, 2.4),
  };
}

export function ClassBadge({ klass, pi, className }: { klass: CarSpec["klass"]; pi: number; className?: string }) {
  return (
    <span className={cx("inline-flex h-[1.6em] items-stretch overflow-hidden rounded-[2px] text-[1em] leading-none", className)}>
      <span className="num grid min-w-[2em] place-items-center px-[0.35em] text-white" style={{ background: CLASS_COLOR[klass] }}>
        {klass}
      </span>
      <span className="num grid min-w-[2.4em] place-items-center bg-white px-[0.35em] text-black">{pi}</span>
    </span>
  );
}

// Fits x,z pairs into a 100 x 100 box. North up: +z is south, so z maps to y directly.
export function outlinePath(pts: ArrayLike<number> | undefined, closed = true, pad = 6) {
  if (!pts || pts.length < 4) return "";
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    z0 = Math.min(z0, pts[i + 1]);
    z1 = Math.max(z1, pts[i + 1]);
  }
  const s = (100 - pad * 2) / Math.max(x1 - x0, z1 - z0, 1);
  const ox = (100 - (x1 - x0) * s) / 2;
  const oz = (100 - (z1 - z0) * s) / 2;
  const step = Math.max(2, Math.floor(pts.length / 2 / 240) * 2);
  let d = "";
  for (let i = 0; i < pts.length; i += step) d += `${i ? "L" : "M"}${(ox + (pts[i] - x0) * s).toFixed(1)} ${(oz + (pts[i + 1] - z0) * s).toFixed(1)}`;
  return closed ? d + "Z" : d;
}

export function TrackLine({ pts, closed = true, className, width = 2.2, glow = false }: { pts?: ArrayLike<number>; closed?: boolean; className?: string; width?: number; glow?: boolean }) {
  const d = outlinePath(pts, closed);
  const start = d.match(/^M([\d.]+) ([\d.]+)/);
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      {glow && <path d={d} fill="none" stroke="var(--color-hot)" strokeWidth={width * 4} strokeLinejoin="round" opacity="0.2" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" stroke="currentColor" strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {start && <circle cx={start[1]} cy={start[2]} r={1.6} fill="var(--color-hot)" />}
    </svg>
  );
}

export function IconBtn({ children, className, label, big, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("nav glass grid shrink-0 place-items-center rounded-[3px]", big ? "h-14 w-14 text-2xl" : "h-11 w-11 text-xl", className)}
      {...p}
    >
      {children}
    </button>
  );
}

export function Stepper({ value, min, max, onChange, icon, label }: { value: number; min: number; max: number; onChange: (v: number) => void; icon: ReactNode; label: string }) {
  return (
    <div className="glass flex h-14 items-center justify-between gap-0.5 rounded-[3px] px-1" role="group" aria-label={label}>
      <span className="pl-1.5 text-xl text-mute">{icon}</span>
      <button type="button" aria-label="−" className="nav grid h-11 w-10 place-items-center rounded-[2px] border border-transparent text-lg" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus />
      </button>
      <span className="num w-8 text-center text-3xl">{value}</span>
      <button type="button" aria-label="+" className="nav grid h-11 w-10 place-items-center rounded-[2px] border border-transparent text-lg" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus />
      </button>
    </div>
  );
}

export function Toggle({ on, onChange, icon, label }: { on: boolean; onChange: (v: boolean) => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx("nav glass flex h-12 items-center gap-3 rounded-[3px] px-3 text-left", on ? "text-white" : "text-mute")}
    >
      <span className="text-xl">{icon}</span>
      <span className="ttl flex-1 text-lg">{label}</span>
      <span className={cx("relative h-5 w-9 rounded-full transition-colors duration-200", on ? "bg-hot" : "bg-line-hi")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200", on ? "translate-x-[1.1rem]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

export function Range({ value, onChange, icon, label }: { value: number; onChange: (v: number) => void; icon: ReactNode; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <label className="glass flex h-12 items-center gap-3 rounded-[3px] px-3">
      <span className="text-xl text-mute">{icon}</span>
      <input
        type="range"
        aria-label={label}
        className="rng nav min-w-0 flex-1"
        min={0}
        max={100}
        step={5}
        value={pct}
        style={{ "--v": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(+e.target.value / 100)}
      />
      <span className="num w-9 text-right text-xl">{pct}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { v: T; node: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="glass flex h-12 rounded-[3px] p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={o.v === value}
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cx("nav flex flex-1 items-center justify-center gap-1.5 rounded-[2px] border border-transparent px-2 text-lg", o.v === value ? "bg-white text-black hover:bg-white" : "text-mute")}
        >
          {o.node}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-[1em] w-[1em] animate-spin rounded-full border-2 border-line-hi border-t-hot", className)} aria-hidden />;
}

export function Key({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <span className={cx("num inline-grid h-8 place-items-center rounded-[3px] border border-line-hi border-b-[3px] bg-white/5 px-1.5 text-base not-italic", wide ? "min-w-16" : "min-w-8")}>{children}</span>
  );
}
