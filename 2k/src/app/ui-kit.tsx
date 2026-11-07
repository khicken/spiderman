"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { PlayerData, TeamData } from "./contracts";
import { useLR } from "./ui-nav";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function fmtClock(s: number) {
  if (s <= 0) return "0.0";
  if (s < 60) return s.toFixed(1);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function fmtShot(s: number) {
  if (s <= 0) return "0";
  return s < 5 ? s.toFixed(1) : String(Math.ceil(s));
}

export function fmtMin(sec: number) {
  // round: float accumulation lands a full 4:00 at 239.99 s
  const t = Math.round(sec);
  const m = Math.floor(t / 60);
  const r = t % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function pct(m: number, a: number) {
  return a > 0 ? `${Math.round((m / a) * 100)}%` : "–";
}

export function ordinal(n: number) {
  if (n > 4) return n === 5 ? "OT" : `${n - 4}OT`;
  return ["1ST", "2ND", "3RD", "4TH"][n - 1];
}

export function rgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luma(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function alpha(hex: string, a: number) {
  const [r, g, b] = rgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function inkOn(bg: string) {
  return luma(bg) > 0.42 ? "#0a0d14" : "#ffffff";
}

/** A team color bright enough to glow on the dark UI. */
export function vivid(t: { primary: string; secondary: string; accent?: string }) {
  // a saturated primary (navy, wine, forest) is the team's identity: lift it rather than jump to the gold trim
  if (chroma(t.primary) > 70) return lift(t.primary);
  for (const c of [t.primary, t.secondary, t.accent ?? "#ffffff"]) {
    const l = luma(c);
    if (l > 0.07 && l < 0.85) return c;
  }
  return luma(t.primary) < 0.07 ? mix(t.primary, "#ffffff", 0.55) : t.primary;
}

function chroma(hex: string) {
  const c = rgb(hex);
  return Math.max(...c) - Math.min(...c);
}

/** Mix toward white until the color reads on the dark UI. */
function lift(hex: string) {
  let c = hex;
  for (let i = 1; i <= 6 && luma(c) < 0.075; i++) c = mix(hex, "#ffffff", i * 0.1);
  return luma(c) > 0.85 ? hex : c;
}

function colorDist(a: string, b: string) {
  const x = rgb(a);
  const y = rgb(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
}

/** Two team colors that can be told apart side by side: the second team falls back to its trim when they clash. */
export function pairVivid(a: { primary: string; secondary: string; accent?: string }, b: { primary: string; secondary: string; accent?: string }): [string, string] {
  const ca = vivid(a);
  const cb = vivid(b);
  if (colorDist(ca, cb) >= 130) return [ca, cb];
  for (const c of [b.secondary, b.accent ?? "#ffffff", "#e8ecf4"]) {
    const l = luma(c);
    if (l > 0.06 && colorDist(ca, lift(c)) >= 130) return [ca, lift(c)];
  }
  return [ca, "#e8ecf4"];
}

export function trim(t: Pick<TeamData, "primary" | "secondary" | "accent">) {
  const a = rgb(t.primary);
  const b = rgb(t.secondary);
  const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  return d > 90 ? t.secondary : t.accent;
}

export function tier(v: number) {
  if (v >= 90) return "#ffd166";
  if (v >= 82) return "#2fe39a";
  if (v >= 75) return "#46d2ff";
  if (v >= 65) return "#c9d1de";
  return "#8d96a8";
}

// Emblems are original geometric badges from abbreviation + colors. Never real logos.
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const SHAPES = [
  "M50 4 L92 18 V52 C92 76 72 90 50 97 C28 90 8 76 8 52 V18 Z", // shield
  "M50 3 L91 26.5 V73.5 L50 97 L9 73.5 V26.5 Z", // hexagon
  "M50 3 L97 50 L50 97 L3 50 Z", // diamond
  "M22 6 H78 L95 30 V70 L78 94 H22 L5 70 V30 Z", // octagon badge
  "", // roundel (circle)
];

export function Emblem({ team, size = "4rem", className }: { team: TeamData; size?: string; className?: string }) {
  const h = hash(team.abbr + team.name);
  const shape = h % SHAPES.length;
  const motif = (h >> 4) % 4;
  const p = team.primary;
  const s = trim(team);
  const ink = luma(p) > 0.42 ? "#0a0d14" : luma(s) > 0.3 && luma(s) < 0.9 ? s : "#ffffff";
  const id = `em-${team.abbr}`;
  const outline = SHAPES[shape];
  const base = ({ inset = 0, ...rest }: { inset?: number } & React.SVGProps<SVGPathElement & SVGCircleElement>) =>
    outline ? (
      <path d={outline} transform={inset ? `translate(${inset} ${inset}) scale(${(100 - inset * 2) / 100})` : undefined} {...rest} />
    ) : (
      <circle cx="50" cy="50" r={47 - inset} {...rest} />
    );
  return (
    <svg viewBox="0 0 100 100" className={className} style={{ width: size, height: size, flex: "none" }} aria-label={`${team.city} ${team.name}`}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={mix(p, "#ffffff", 0.18)} />
          <stop offset="1" stopColor={mix(p, "#000000", 0.35)} />
        </linearGradient>
        <clipPath id={`${id}-c`}>
          {base({})}
        </clipPath>
      </defs>
      {base({ fill: `url(#${id}-g)` })}
      <g clipPath={`url(#${id}-c)`} opacity="0.9">
        {motif === 0 && <path d="M-10 70 L110 30 L110 46 L-10 86 Z" fill={s} opacity="0.85" />}
        {motif === 1 && (
          <g fill="none" stroke={s} strokeWidth="3.2" opacity="0.7">
            <circle cx="50" cy="50" r="30" />
            <path d="M50 0 V100 M0 50 H100 M22 10 C42 34 42 66 22 90 M78 10 C58 34 58 66 78 90" />
          </g>
        )}
        {motif === 2 && (
          <g fill={s} opacity="0.8">
            <rect x="-5" y="74" width="110" height="7" />
            <rect x="-5" y="85" width="110" height="4" />
          </g>
        )}
        {motif === 3 && <path d="M50 -5 L105 50 L50 105 L50 -5 Z" fill="#000" opacity="0.18" />}
      </g>
      {base({ inset: 6, fill: "none", stroke: s, strokeWidth: 2.4, opacity: 0.95 })}
      {base({ fill: "none", stroke: "rgb(255 255 255 / 0.35)", strokeWidth: 1.2 })}
      <text
        x="50"
        y={team.abbr.length > 3 ? 60 : 62}
        textAnchor="middle"
        fontSize={team.abbr.length > 3 ? 28 : 34}
        fontWeight="900"
        fill={ink}
        style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.01em" }}
        stroke={luma(p) > 0.42 ? "none" : "rgb(0 0 0 / 0.35)"}
        strokeWidth="1"
        paintOrder="stroke"
      >
        {team.abbr}
      </text>
    </svg>
  );
}

export function Ovr({ v, className, label }: { v: number; className?: string; label?: string }) {
  const c = tier(v);
  return (
    <span className={cx("inline-flex flex-col items-center justify-center leading-none", className)}>
      <span className="num" style={{ color: c }}>
        {v}
      </span>
      {label && <span className="mt-0.5 text-[0.5em] font-bold tracking-[0.18em] text-mute">{label}</span>}
    </span>
  );
}

export function Bar({ v, max = 99, color, className }: { v: number; max?: number; color?: string; className?: string }) {
  const w = Math.max(0, Math.min(1, v / max));
  return (
    <span className={cx("relative block h-1.5 overflow-hidden bg-white/10", className)}>
      <span className="absolute inset-y-0 left-0 transition-[width] duration-300" style={{ width: `${w * 100}%`, background: color ?? tier(v) }} />
    </span>
  );
}

export type KeyRating = { k: string; v: number };

export function keyRatings(p: PlayerData): KeyRating[] {
  const r = p.ratings;
  return [
    { k: "3PT", v: r.three },
    { k: "MID", v: r.mid },
    { k: "INSIDE", v: Math.round((r.close + r.layup) / 2) },
    { k: "DUNK", v: r.dunk },
    { k: "HANDLE", v: r.handle },
    { k: "PASS", v: r.passing },
    { k: "PERIM D", v: r.perimeterD },
    { k: "INT D", v: r.interiorD },
    { k: "REBOUND", v: Math.round((r.offReb + r.defReb) / 2) },
    { k: "ATHLETIC", v: Math.round((r.speed + r.vertical + r.strength) / 3) },
  ];
}

export function heightLabel(inches: number) {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

export function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="nav tile flex min-h-12 items-center gap-3 rounded-[3px] px-4 py-2 text-left"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("text-[0.95rem] font-semibold", on ? "text-ink" : "text-mute")}>{label}</span>
        {sub && <span className="text-[0.72rem] text-dim">{sub}</span>}
      </span>
      <span className={cx("relative h-5 w-10 flex-none rounded-full transition-colors duration-200", on ? "bg-hot" : "bg-line-hi")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200", on ? "translate-x-[1.35rem]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

export function Range({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const p = Math.round(value * 100);
  return (
    <label className="tile flex min-h-12 items-center gap-4 rounded-[3px] px-4">
      <span className="w-24 flex-none text-[0.95rem] font-semibold">{label}</span>
      <input
        type="range"
        aria-label={label}
        className="rng nav min-w-0 flex-1"
        min={0}
        max={100}
        step={5}
        value={p}
        style={{ "--v": `${p}%` } as CSSProperties}
        onChange={(e) => onChange(+e.target.value / 100)}
      />
      <span className="num w-9 text-right text-xl">{p}</span>
    </label>
  );
}

export function Picker<T extends string | number>({
  value, options, onChange, label, sub, className, wrap = false,
}: {
  value: T;
  options: readonly { v: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  sub?: string;
  className?: string;
  wrap?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const i = Math.max(0, options.findIndex((o) => o.v === value));
  const step = (d: -1 | 1) => {
    let n = i + d;
    if (wrap) n = (n + options.length) % options.length;
    if (n < 0 || n >= options.length) return;
    onChange(options[n].v);
  };
  useLR(ref, step);
  const o = options[i];
  return (
    <div
      ref={ref}
      tabIndex={0}
      data-nav="1"
      data-lr="1"
      role="spinbutton"
      aria-label={label}
      aria-valuetext={o?.label}
      onClick={() => step(1)}
      className={cx("nav tile flex min-h-12 select-none items-center gap-3 rounded-[3px] px-4 py-2", className)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.95rem] font-semibold">{label}</span>
        {(o?.hint || sub) && <span className="truncate text-[0.72rem] text-dim">{o?.hint ?? sub}</span>}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Previous"
        className="grid h-8 w-6 place-items-center text-mute hover:text-ink disabled:opacity-25"
        disabled={!wrap && i === 0}
        onClick={(e) => {
          e.stopPropagation();
          step(-1);
        }}
      >
        ◀
      </button>
      <span className="ttl min-w-[6.5rem] text-center text-[1.35rem] text-ink">{o?.label}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Next"
        className="grid h-8 w-6 place-items-center text-mute hover:text-ink disabled:opacity-25"
        disabled={!wrap && i === options.length - 1}
        onClick={(e) => {
          e.stopPropagation();
          step(1);
        }}
      >
        ▶
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: readonly { v: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cx("tile flex gap-1 rounded-[3px] p-1", className)} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={o.v === value}
          onClick={() => onChange(o.v)}
          className={cx(
            "nav ttl flex min-w-0 flex-1 items-center justify-center rounded-[2px] border border-transparent px-3 py-2 text-[1.05rem]",
            o.v === value ? "bg-white text-night hover:bg-white" : "text-mute",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-[1em] w-[1em] animate-spin rounded-full border-2 border-line-hi border-t-hot", className)} aria-hidden />;
}

export function SectionTitle({ eyebrow, title, className, right }: { eyebrow?: string; title: string; className?: string; right?: ReactNode }) {
  return (
    <div className={cx("flex items-end justify-between gap-4", className)}>
      <div>
        {eyebrow && <div className="eyebrow mb-1.5 text-hot">{eyebrow}</div>}
        <h2 className="ttl text-[2.6rem] text-ink">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function Wordmark({ className, size = "2rem" }: { className?: string; size?: string }) {
  return (
    <span className={cx("ttl relative inline-flex items-center gap-[0.12em] italic", className)} style={{ fontSize: size }}>
      <svg viewBox="0 0 24 24" style={{ width: "0.9em", height: "0.9em" }} aria-hidden>
        <circle cx="12" cy="12" r="10.5" fill="var(--color-hot)" />
        <path d="M1.5 12h21M12 1.5v21M4.6 4.6c3.6 3.4 3.6 11.4 0 14.8M19.4 4.6c-3.6 3.4-3.6 11.4 0 14.8" stroke="#05060a" strokeWidth="1.5" fill="none" />
      </svg>
      <span>HOOPS</span>
    </span>
  );
}
