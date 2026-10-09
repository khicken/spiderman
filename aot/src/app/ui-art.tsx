import { useId } from "react";
import type { TitanKind } from "./contracts";

type Pt = [number, number];
const f = (n: number) => n.toFixed(1);

function wing(mirror: boolean) {
  const R: Pt = [92, 170];
  const C: Pt = [84, 92];
  const T: Pt = [140, 44];
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [
      u * u * R[0] + 2 * t * u * C[0] + t * t * T[0],
      u * u * R[1] + 2 * t * u * C[1] + t * t * T[1],
    ];
  };
  const m = (p: Pt) => `${f(mirror ? 200 - p[0] : p[0])} ${f(p[1])}`;
  const layer = (
    n: number,
    t0: number,
    a0: number,
    a1: number,
    l0: number,
    l1: number,
  ) => {
    const ts = Array.from(
      { length: n },
      (_, i) => t0 + ((1 - t0) * i) / (n - 1),
    );
    const tip = (t: number, k = 1): Pt => {
      const [x, y] = at(t);
      const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
      const L = (l0 + (l1 - l0) * t) * k;
      return [x + Math.cos(a) * L, y + Math.sin(a) * L];
    };
    const valley = (i: number) => tip((ts[i] + ts[i + 1]) / 2, 0.5);
    let d = `M${m(R)}`;
    for (let k = 1; k <= 16; k++) d += ` L${m(at(k / 16))}`;
    for (let i = n - 1; i >= 0; i--) {
      d += ` L${m(tip(ts[i]))}`;
      if (i > 0) d += ` L${m(valley(i - 1))}`;
    }
    d += " Z";
    const lines = ts
      .slice(0, -1)
      .map((t, i) => `M${m(at((t + ts[i + 1]) / 2))} L${m(valley(i))}`)
      .join(" ");
    return { d, lines };
  };
  return {
    primary: layer(9, 0.1, 78, -30, 28, 62),
    covert: layer(7, 0.04, 70, -24, 16, 34),
  };
}

const BLUE = wing(true);
const WHITE = wing(false);
const SHIELD =
  "M100 14 L174 34 V98 C174 146 142 172 100 192 C58 172 26 146 26 98 V34 Z";

export function Emblem({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 200 206" className={className} aria-hidden>
      <defs>
        <linearGradient id={`sh${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2a1c" />
          <stop offset="1" stopColor="#120c08" />
        </linearGradient>
        <linearGradient id={`bl${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d86de" />
          <stop offset="1" stopColor="#1d3f84" />
        </linearGradient>
        <linearGradient id={`wh${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9cdd2" />
        </linearGradient>
      </defs>
      <path
        d={SHIELD}
        fill={`url(#sh${id})`}
        stroke="#c9a25a"
        strokeWidth="5"
      />
      <path
        d={SHIELD}
        fill="none"
        stroke="#0b0807"
        strokeWidth="1.5"
        transform="translate(100 103) scale(0.9) translate(-100 -103)"
      />
      <g
        stroke="#0b0807"
        strokeWidth="2"
        strokeLinejoin="round"
        transform="translate(100 110) scale(0.8) translate(-100 -104)"
      >
        <path d={BLUE.primary.d} fill={`url(#bl${id})`} />
        <path d={BLUE.primary.lines} fill="none" strokeWidth="1.2" />
        <path d={BLUE.covert.d} fill="#3b70c6" />
        <path d={BLUE.covert.lines} fill="none" strokeWidth="1" />
        <path d={WHITE.primary.d} fill={`url(#wh${id})`} />
        <path d={WHITE.primary.lines} fill="none" strokeWidth="1.2" />
        <path d={WHITE.covert.d} fill="#f6f7f8" />
        <path d={WHITE.covert.lines} fill="none" strokeWidth="1" />
      </g>
    </svg>
  );
}

export function Brush({
  className = "",
  color = "#b3121b",
  seed = 3,
}: {
  className?: string;
  color?: string;
  seed?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 600 120"
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <filter id={`br${id}`} x="-5%" y="-30%" width="110%" height="160%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.035 0.9"
          numOctaves="3"
          seed={seed}
        />
        <feDisplacementMap in="SourceGraphic" scale="14" />
      </filter>
      <g filter={`url(#br${id})`} fill={color}>
        <path d="M8 74 C90 36 210 28 330 34 C450 40 540 26 594 16 C566 62 474 82 330 86 C206 90 96 100 8 74 Z" />
        <path
          d="M40 92 C160 84 300 88 470 80 C430 92 300 102 150 104 Z"
          opacity="0.7"
        />
        <path
          d="M120 24 C240 14 380 18 520 10 C470 22 330 28 200 32 Z"
          opacity="0.55"
        />
      </g>
    </svg>
  );
}

const HUMAN =
  "M10 0.5a4.2 4.2 0 1 1 0 8.4a4.2 4.2 0 1 1 0-8.4ZM4.6 9.6h10.8l3.6 13.4h-3.2l-1.6-7v23.5h-3.6l-0.6-12.5l-0.6 12.5h-3.6V16l-1.6 7H1Z";
const CRAWLER =
  "M3 13l5-5h17a5 5 0 1 1 9 3.5l4 8h-3.6l-3-5.5H19l-4 5.5h-3.6l3-5.5H9l-3 5.5H2.4l3-6Z";

export function TitanIcon({
  kind,
  className = "",
  style,
}: {
  kind: TitanKind;
  className?: string;
  style?: React.CSSProperties;
}) {
  return kind === "crawler" ? (
    <svg viewBox="0 0 40 20" className={className} style={style} aria-hidden>
      <path d={CRAWLER} fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 40" className={className} style={style} aria-hidden>
      <path d={HUMAN} fill="currentColor" />
    </svg>
  );
}

export const SHIELD_PATH = SHIELD;
