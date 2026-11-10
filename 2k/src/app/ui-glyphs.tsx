"use client";

import type { ReactNode } from "react";
import type { Device } from "./contracts";
import { padStyleOf } from "./input-glyphs";

// Button glyphs for the detected device. Pad families differ only in face-button shapes and shoulder names.

export type PadFamily = "xbox" | "ps";
export type GlyphDevice = { device: Device; family: PadFamily };

/** Same detection as input-glyphs padStyleOf, folded to the two families the HUD draws. */
export function padFamily(id: string | null | undefined): PadFamily {
  return padStyleOf(id) === "playstation" ? "ps" : "xbox";
}

export type Act =
  | "move" | "sprint" | "shoot" | "pass" | "bounce" | "lob" | "screen" | "icon" | "post" | "dribble"
  | "steal" | "block" | "switch" | "charge" | "intense" | "handsUp" | "pause" | "camera"
  | "ok" | "back" | "tabL" | "tabR" | "navigate" | "cycle" | "navigate4";

type PadBtn = "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "LS" | "RS" | "START" | "BACK" | "DPAD" | "DPAD_UD" | "DPAD_LR";

const PAD: Record<Act, PadBtn> = {
  move: "LS", sprint: "RT", shoot: "X", pass: "A", bounce: "B", lob: "Y", screen: "LB", icon: "RB", post: "LT",
  dribble: "RS", steal: "X", block: "Y", switch: "A", charge: "B", intense: "LT", handsUp: "RS", pause: "START",
  camera: "BACK", ok: "A", back: "B", tabL: "LB", tabR: "RB", navigate: "DPAD_UD", cycle: "DPAD_LR", navigate4: "DPAD",
};

const KEYS: Record<Act, string[]> = {
  move: ["W", "A", "S", "D"], sprint: ["Shift"], shoot: ["J"], pass: ["K"], bounce: ["L"], lob: ["I"], screen: ["E"],
  icon: ["R"], post: ["Q"], dribble: ["←", "↑", "→", "↓"], steal: ["L"], block: ["J"], switch: ["K"], charge: ["F"],
  intense: ["Q"], handsUp: ["Space"], pause: ["Esc"], camera: ["C"], ok: ["Enter"], back: ["Esc"], tabL: ["Q"], tabR: ["E"],
  navigate: ["↑", "↓"], cycle: ["←", "→"], navigate4: ["←", "↑", "↓", "→"],
};

export const FACE_COLOR: Record<PadFamily, Record<"A" | "B" | "X" | "Y", string>> = {
  xbox: { A: "#4fd66b", B: "#ff5a5f", X: "#3fa7ff", Y: "#ffc93c" },
  ps: { A: "#8fb8ff", B: "#ff6d7d", X: "#f58cd8", Y: "#47dcc0" },
};

const SHOULDER: Record<PadFamily, Record<"LB" | "RB" | "LT" | "RT", string>> = {
  xbox: { LB: "LB", RB: "RB", LT: "LT", RT: "RT" },
  ps: { LB: "L1", RB: "R1", LT: "L2", RT: "R2" },
};

function FaceShape({ b, family }: { b: "A" | "B" | "X" | "Y"; family: PadFamily }) {
  const c = FACE_COLOR[family][b];
  if (family === "xbox")
    return (
      <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="900" fill={c} style={{ fontFamily: "var(--font-ui)" }}>
        {b}
      </text>
    );
  const s = { fill: "none", stroke: c, strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (b === "A") return <path d="M8 8l8 8M16 8l-8 8" {...s} />;
  if (b === "B") return <circle cx="12" cy="12" r="4.8" {...s} />;
  if (b === "X") return <rect x="7.6" y="7.6" width="8.8" height="8.8" {...s} />;
  return <path d="M12 6.8l5.4 9.2H6.6z" {...s} />;
}

/** Face button: round cap with letter (Xbox style) or shape (PlayStation style). */
export function Face({ b, family, className }: { b: "A" | "B" | "X" | "Y"; family: PadFamily; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={{ width: "1.6em", height: "1.6em", flex: "none" }} aria-label={b}>
      <circle cx="12" cy="12" r="11" fill="#0b0e15" stroke="rgb(255 255 255 / 0.28)" strokeWidth="1" />
      <FaceShape b={b} family={family} />
    </svg>
  );
}

function Shoulder({ label, trigger }: { label: string; trigger: boolean }) {
  return (
    <span
      className="num inline-grid h-[1.6em] min-w-[2.3em] flex-none place-items-center border border-white/30 bg-[#0b0e15] px-[0.35em] text-[0.82em] leading-none text-white"
      style={{ borderRadius: trigger ? "0.25em 0.25em 0.7em 0.7em" : "0.7em 0.7em 0.25em 0.25em" }}
    >
      {label}
    </span>
  );
}

function StickGlyph({ side }: { side: "L" | "R" }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1.6em", height: "1.6em", flex: "none" }} aria-label={`${side} stick`}>
      <circle cx="12" cy="12" r="11" fill="#0b0e15" stroke="rgb(255 255 255 / 0.28)" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.4" />
      <text x="12" y="15.4" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-ui)" }}>
        {side}
      </text>
    </svg>
  );
}

function MenuGlyph({ kind, family }: { kind: "START" | "BACK"; family: PadFamily }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1.6em", height: "1.6em", flex: "none" }} aria-label={kind === "START" ? "Menu" : "View"}>
      <circle cx="12" cy="12" r="11" fill="#0b0e15" stroke="rgb(255 255 255 / 0.28)" />
      {kind === "START" ? (
        <path d="M7.5 9h9M7.5 12h9M7.5 15h9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      ) : family === "ps" ? (
        <path d="M9 7.5v9M12 7.5v9M15 7.5v9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      ) : (
        <>
          <rect x="6.5" y="7.5" width="8" height="6" rx="1" fill="none" stroke="#fff" strokeWidth="1.4" />
          <rect x="9.5" y="10.5" width="8" height="6" rx="1" fill="#0b0e15" stroke="#fff" strokeWidth="1.4" />
        </>
      )}
    </svg>
  );
}

/** D-pad cross. `hl` lights only the vertical or horizontal arms (up/down = move, left/right = change). */
function Dpad({ hl }: { hl?: "ud" | "lr" }) {
  const on = "rgb(255 255 255 / 0.95)";
  const off = hl ? "rgb(255 255 255 / 0.22)" : on;
  const ud = hl === "lr" ? off : on;
  const lr = hl === "ud" ? off : on;
  return (
    <svg viewBox="0 0 24 24" style={{ width: "1.6em", height: "1.6em", flex: "none" }} aria-label={hl === "ud" ? "D-pad up/down" : hl === "lr" ? "D-pad left/right" : "D-pad"}>
      <circle cx="12" cy="12" r="11" fill="#0b0e15" stroke="rgb(255 255 255 / 0.28)" />
      <rect x="10" y="10" width="4" height="4" fill="rgb(255 255 255 / 0.6)" />
      <path d="M10 5.5h4V10h-4zM10 14h4v4.5h-4z" fill={ud} />
      <path d="M5.5 10H10v4H5.5zM14 10h4.5v4H14z" fill={lr} />
      {hl === "ud" && <path d="M12 3.2l1.6 1.6h-3.2zM12 20.8l1.6-1.6h-3.2z" fill={on} />}
      {hl === "lr" && <path d="M3.2 12l1.6-1.6v3.2zM20.8 12l-1.6-1.6v3.2z" fill={on} />}
    </svg>
  );
}

export function PadGlyph({ b, family }: { b: PadBtn; family: PadFamily }) {
  if (b === "A" || b === "B" || b === "X" || b === "Y") return <Face b={b} family={family} />;
  if (b === "LB" || b === "RB" || b === "LT" || b === "RT") return <Shoulder label={SHOULDER[family][b]} trigger={b === "LT" || b === "RT"} />;
  if (b === "LS" || b === "RS") return <StickGlyph side={b === "LS" ? "L" : "R"} />;
  if (b === "DPAD") return <Dpad />;
  if (b === "DPAD_UD") return <Dpad hl="ud" />;
  if (b === "DPAD_LR") return <Dpad hl="lr" />;
  return <MenuGlyph kind={b} family={family} />;
}

const ARROW_PATH: Record<string, string> = {
  "↑": "M12 5l6 7h-4v7h-4v-7H6z",
  "↓": "M12 19l-6-7h4V5h4v7h4z",
  "←": "M5 12l7-6v4h7v4h-7v4z",
  "→": "M19 12l-7 6v-4H5v-4h7V6z",
};

export function KeyCap({ children }: { children: ReactNode }) {
  // arrow keys draw a heavy vector arrow at keycap size (the font's arrows render tiny)
  const arrow = typeof children === "string" ? ARROW_PATH[children] : undefined;
  return (
    <span className="num inline-grid h-[1.6em] min-w-[1.6em] flex-none place-items-center rounded-[0.25em] border border-white/30 border-b-[3px] bg-white/[0.07] px-[0.35em] text-[0.82em] leading-none text-white">
      {arrow ? (
        <>
          <svg viewBox="0 0 24 24" style={{ width: "1.15em", height: "1.15em" }} aria-hidden>
            <path d={arrow} fill="currentColor" />
          </svg>
          <span className="sr-only">{children}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}

/** The glyph(s) for a semantic action on the current device. */
export function Glyph({ act, device, family }: { act: Act; device: Device; family: PadFamily }) {
  if (device === "pad") return <PadGlyph b={PAD[act]} family={family} />;
  const keys = KEYS[act];
  if (keys.length > 1)
    return (
      <span className="inline-flex flex-none gap-[0.15em]">
        {keys.map((k) => (
          <KeyCap key={k}>{k}</KeyCap>
        ))}
      </span>
    );
  return <KeyCap>{keys[0]}</KeyCap>;
}

/** Icon-pass glyph for teammate i (0..3) as drawn over heads. */
export function iconGlyph(i: number, device: Device, family: PadFamily): ReactNode {
  if (device === "pad") return <Face b={(["A", "B", "X", "Y"] as const)[i]} family={family} />;
  return <KeyCap>{i + 1}</KeyCap>;
}

/** Footer hint bar: glyph + label pairs. */
export function Hints({ items, device, family, className }: { items: [Act, string][]; device: Device; family: PadFamily; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-mute ${className ?? ""}`}>
      {items.map(([a, label]) => (
        <span key={a + label} className="flex items-center gap-2">
          <Glyph act={a} device={device} family={family} />
          {label}
        </span>
      ))}
    </div>
  );
}
