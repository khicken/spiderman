"use client";

import { memo, type CSSProperties, type ReactNode } from "react";
import type { Device } from "./contracts";

// Ink and gold-leaf drawing kit: flames, ornaments, frames, the illuminated capital. Inline SVG only.

export const FLAME_PATH = "M12 1.2C14.6 6.4 20.6 10.6 20.6 18.9A8.6 8.6 0 0 1 3.4 18.9C3.4 14.2 6 11.3 7.9 7.6C8.6 10.3 10 11.9 11.4 12.6C10.4 8.6 10.9 4.7 12 1.2Z";
export const FLAME_CORE = "M12 13.6C14.1 16.4 15.9 18.4 15.9 21.6A3.9 3.9 0 0 1 8.1 21.6C8.1 18.6 10 16.6 12 13.6Z";

const HEART_PATH = "M12 21.5C5 16.4 2 12.6 2 8.4A5.4 5.4 0 0 1 12 5.6A5.4 5.4 0 0 1 22 8.4C22 12.6 19 16.4 12 21.5Z";

/** One heart, filled in quarters from the bottom (q 0..4). Red, so it reads as health. */
export const HeartIcon = memo(function HeartIcon({ q, id, danger, size = 1.9 }: { q: number; id: string; danger?: boolean; size?: number }) {
  const h = 20 * (q / 4);
  return (
    <svg viewBox="0 0 24 24" style={{ width: `${size}em`, height: `${size}em`, overflow: "visible" }} aria-hidden>
      <defs>
        <clipPath id={`hc-${id}`}>
          <rect x="0" y={22 - h} width="24" height={h + 4} />
        </clipPath>
      </defs>
      <path d={HEART_PATH} fill="rgb(8 25 28 / 0.55)" stroke="rgb(248 240 221 / 0.7)" strokeWidth="1.3" strokeLinejoin="round" />
      {q > 0 && (
        <g clipPath={`url(#hc-${id})`} className={danger ? "hm-gutter" : undefined}>
          <path d={HEART_PATH} fill={danger ? "#d8452f" : "#e0533f"} stroke="var(--color-ink)" strokeWidth="1" strokeLinejoin="round" />
          <path d="M6 7.4C6.6 5.9 8.2 5.3 9.4 5.9" stroke="#ffd3c4" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </g>
      )}
      <path d={HEART_PATH} fill="none" stroke="var(--color-ink)" strokeWidth="0.7" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
});

/** Shared gradient defs (mount once per SVG tree root, here inside a 0x0 svg). */
export const InkDefs = memo(function InkDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="hm-ember-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#b4511e" />
          <stop offset="0.45" stopColor="#f08a3c" />
          <stop offset="1" stopColor="#ffc07a" />
        </linearGradient>
        <linearGradient id="hm-gold-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8f6d22" />
          <stop offset="0.3" stopColor="#e8c766" />
          <stop offset="0.45" stopColor="#fff3c4" />
          <stop offset="0.6" stopColor="#c9a13b" />
          <stop offset="1" stopColor="#8f6d22" />
        </linearGradient>
        <linearGradient id="hm-gloam-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a2347" />
          <stop offset="0.5" stopColor="#5b3a6e" />
          <stop offset="1" stopColor="#a47cc6" />
        </linearGradient>
        <filter id="hm-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
      </defs>
    </svg>
  );
});

export function Flame({ color = "var(--color-ember)", lit = true, style, className }: { color?: string; lit?: boolean; style?: CSSProperties; className?: string }) {
  return (
    <svg viewBox="0 0 24 30" style={style} className={className} aria-hidden>
      <path d={FLAME_PATH} fill={lit ? color : "rgb(248 240 221 / 0.12)"} stroke={lit ? "var(--color-ink)" : "rgb(248 240 221 / 0.6)"} strokeWidth="1.2" />
      {lit && <path d={FLAME_CORE} fill="#fff3c4" opacity="0.85" />}
    </svg>
  );
}

export function Diamond({ style, className }: { style?: CSSProperties; className?: string }) {
  return (
    <svg viewBox="0 0 20 24" style={style} className={className} aria-hidden>
      <path d="M10 1L18.5 12L10 23L1.5 12Z" fill="url(#hm-gold-grad)" stroke="var(--color-ink)" strokeWidth="1.1" />
      <path d="M10 1L13 12L10 23M1.5 12H18.5" stroke="rgb(43 33 24 / 0.45)" strokeWidth="0.7" fill="none" />
      <path d="M10 4L5 11.2" stroke="#fff3c4" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function Arrow({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" style={style} aria-hidden>
      <path d="M3 21L19 5" stroke="var(--color-parchment-hi)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M19 5l-6.2 1.2M19 5l-1.2 6.2" stroke="var(--color-parchment-hi)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 21l1-4.2M3 21l4.2-1M5.2 18.8l1-4M5.2 18.8l4-1" stroke="var(--color-ember-hi)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Ink corner flourish. Drawn on with stroke-dashoffset. Rotate per corner. */
export function Corner({ pos, size = "3.4rem", color = "var(--color-ink)", delay = 0 }: { pos: "tl" | "tr" | "bl" | "br"; size?: string; color?: string; delay?: number }) {
  const rot = { tl: 0, tr: 90, br: 180, bl: 270 }[pos];
  const place: CSSProperties = {
    position: "absolute", width: size, height: size, pointerEvents: "none",
    top: pos[0] === "t" ? "0.35rem" : undefined, bottom: pos[0] === "b" ? "0.35rem" : undefined,
    left: pos[1] === "l" ? "0.35rem" : undefined, right: pos[1] === "r" ? "0.35rem" : undefined,
    transform: `rotate(${rot}deg)`,
  };
  const d = { animationDelay: `${delay}ms` };
  return (
    <svg viewBox="0 0 60 60" style={place} className="hm-draw" fill="none" stroke={color} strokeLinecap="round" aria-hidden>
      <path pathLength={1} style={d} strokeWidth="1.6" d="M4 58V22C4 11 11 4 22 4H58" />
      <path pathLength={1} style={d} strokeWidth="1.1" d="M9 58V25C9 15.5 15.5 9 25 9H58" />
      <path pathLength={1} style={d} strokeWidth="1.3" d="M9 34C17 34 21 28 21 21C21 15 25 12 29 12C34 12 36 16 34 19.5C32.5 22 28.5 21.5 28.5 18.5" />
      <path pathLength={1} style={d} strokeWidth="1.1" d="M34 9C37 15 44 16 48 13M40 9.5C41 6 44.5 5.2 47 6.5" />
      <path pathLength={1} style={d} strokeWidth="1.1" d="M9 40C15 42.5 15.5 49 12.5 52M9 46C5.5 47.5 5 51 6.5 53.5" />
      <circle cx="22" cy="22" r="2.2" fill="var(--color-gold)" stroke="none" />
      <circle cx="47.5" cy="13" r="1.3" fill="var(--color-ember)" stroke="none" />
    </svg>
  );
}

export function InkFrame({ children, className = "", style, corners = true, dark = false }: { children: ReactNode; className?: string; style?: CSSProperties; corners?: boolean; dark?: boolean }) {
  return (
    <div className={`relative ${dark ? "hm-parchment-dark" : "hm-parchment"} ${className}`} style={{ border: "2px solid var(--color-gold)", boxShadow: `inset 0 0 0 0.3rem ${dark ? "rgb(8 25 28 / 0.6)" : "rgb(248 240 221 / 0.6)"}, inset 0 0 0 calc(0.3rem + 1px) ${dark ? "rgb(232 199 102 / 0.35)" : "var(--color-ink-soft)"}, 0 1.5rem 3.5rem rgb(8 25 28 / 0.6)`, ...style }}>
      {corners && (
        <>
          <Corner pos="tl" color={dark ? "var(--color-gold)" : "var(--color-ink)"} />
          <Corner pos="tr" color={dark ? "var(--color-gold)" : "var(--color-ink)"} delay={80} />
          <Corner pos="br" color={dark ? "var(--color-gold)" : "var(--color-ink)"} delay={160} />
          <Corner pos="bl" color={dark ? "var(--color-gold)" : "var(--color-ink)"} delay={240} />
        </>
      )}
      {children}
    </div>
  );
}

export function Rule({ color = "var(--color-gold)", className = "", style }: { color?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 240 14" preserveAspectRatio="none" className={className} style={{ height: "0.9rem", width: "100%", ...style }} aria-hidden>
      <path d="M2 7H104M136 7H238" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d="M104 7C110 1 114 1 120 7C126 13 130 13 136 7" stroke={color} strokeWidth="1.2" fill="none" vectorEffect="non-scaling-stroke" />
      <path d="M120 2.5L124.5 7L120 11.5L115.5 7Z" fill={color} />
    </svg>
  );
}

/** Illuminated capital: a gold letter on a deep teal ground, in a gold frame with vine tendrils. */
export function IlluminatedCapital({ letter, size = "7rem", className = "" }: { letter: string; size?: string; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" style={{ width: size, height: size, overflow: "visible" }} className={className} aria-hidden>
      <defs>
        <radialGradient id="hm-cap-ground" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#2a6e70" />
          <stop offset="0.6" stopColor="#1f5a5e" />
          <stop offset="1" stopColor="#0f2e33" />
        </radialGradient>
        <pattern id="hm-cap-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="0.7" fill="#e8c766" opacity="0.35" />
        </pattern>
      </defs>
      <rect x="6" y="6" width="108" height="108" fill="url(#hm-cap-ground)" />
      <rect x="6" y="6" width="108" height="108" fill="url(#hm-cap-dots)" />
      <g className="hm-draw slow" fill="none" stroke="#e8c766" strokeLinecap="round" opacity="0.8">
        <path pathLength={1} strokeWidth="1.3" d="M14 106C24 92 22 78 32 70C40 64 48 70 44 78C41 84 33 81 35 75" />
        <path pathLength={1} strokeWidth="1.3" d="M106 14C96 26 98 40 88 48C80 54 72 48 76 40C79 34 87 37 85 43" />
        <path pathLength={1} strokeWidth="1" d="M20 22C30 22 34 30 30 36M100 98C90 98 86 90 90 84" />
      </g>
      <g fill="#f08a3c" stroke="#2b2118" strokeWidth="0.6">
        <path d="M36 75c-4-2-6-6-4-10 3 2 5 5 4 10z" />
        <path d="M84 45c4 2 6 6 4 10-3-2-5-5-4-10z" />
        <circle cx="30" cy="37" r="2.2" />
        <circle cx="90" cy="83" r="2.2" />
      </g>
      <text x="60" y="88" textAnchor="middle" fontSize="86" fontWeight="700" fill="url(#hm-gold-grad)" stroke="#2b2118" strokeWidth="1.3" style={{ fontFamily: "var(--font-display), Georgia, serif" }}>
        {letter}
      </text>
      <rect x="6" y="6" width="108" height="108" fill="none" stroke="url(#hm-gold-grad)" strokeWidth="5" />
      <rect x="1.5" y="1.5" width="117" height="117" fill="none" stroke="#2b2118" strokeWidth="1.2" />
      <rect x="11" y="11" width="98" height="98" fill="none" stroke="#2b2118" strokeWidth="0.8" />
      {[[6, 6], [114, 6], [6, 114], [114, 114]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="url(#hm-gold-grad)" stroke="#2b2118" strokeWidth="0.9" />
      ))}
    </svg>
  );
}

/** Drop cap for prose pages: the first letter as an illuminated block, the rest flows. */
export function DropCap({ text, size = "4.6rem" }: { text: string; size?: string }) {
  return (
    <p className="font-display" style={{ fontSize: "1.35rem", lineHeight: 1.5 }}>
      <span style={{ float: "left", marginRight: "0.6rem", marginTop: "0.25rem" }}>
        <IlluminatedCapital letter={text[0]} size={size} />
      </span>
      {text.slice(1)}
    </p>
  );
}

export function Glyph({ device, keys, pad, touch }: { device: Device; keys: string; pad: string; touch?: string }) {
  if (device === "pad") return <span className="hm-key pad">{pad}</span>;
  if (device === "touch") return <span className="hm-key" style={{ borderRadius: "50%" }}>{touch ?? "✋"}</span>;
  return <span className="hm-key">{keys}</span>;
}

export function Lozenge({ className = "hm-btn-glyph" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M8 1L15 8L8 15L1 8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5L11 8L8 11L5 8Z" fill="currentColor" />
    </svg>
  );
}

export function Quill({ style, className }: { style?: CSSProperties; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" style={style} className={className} aria-hidden>
      <path d="M36 3C24 5 14 14 9 26L7 33L13 30C25 25 33 15 36 3Z" fill="var(--color-parchment-hi)" stroke="var(--color-ink)" strokeWidth="1.2" />
      <path d="M36 3C27 11 18 20 9 32" stroke="var(--color-ink-soft)" strokeWidth="1" fill="none" />
      <path d="M30 9l-4 1M26 14l-5 1M21 19l-5 1" stroke="var(--color-ink-faint)" strokeWidth="0.9" />
      <path d="M7 33L4.5 37.5" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
