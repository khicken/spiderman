"use client";

import { useState } from "react";
import type { Device } from "./contracts";
import { FACE_COLOR, type PadFamily } from "./ui-glyphs";
import { Segmented } from "./ui-kit";

// v2 onboarding: the Controls page as a picture. A generic controller (or a keyboard) with each control labelled for
// offense or defense. Original drawing, no console maker's artwork.

type Side = "offense" | "defense";
type PadKey = "LT" | "LB" | "LS" | "DPAD" | "VIEW" | "RT" | "RB" | "Y" | "B" | "A" | "X" | "RS" | "MENU";

const PAD_LABEL: Record<Side, Partial<Record<PadKey, [string, string?]>>> = {
  offense: {
    LS: ["Move", "Steer your player"],
    RT: ["Sprint", "Hold"],
    X: ["Shoot", "Hold, release at the gold notch"],
    A: ["Pass", "Aim with the left stick"],
    B: ["Bounce pass"],
    Y: ["Lob / alley-oop"],
    RS: ["Dribble moves", "Flick: crossover, spin, step-back"],
    RB: ["Icon pass", "Hold, then a face button"],
    LB: ["Call a screen"],
    LT: ["Post up", "Hold"],
    MENU: ["Pause"],
    VIEW: ["Camera"],
  },
  defense: {
    LS: ["Move", "Slide with your man"],
    RT: ["Sprint", "Hold"],
    X: ["Steal", "When the dribbler is in front"],
    A: ["Switch player", "Take the man nearest the ball"],
    B: ["Take a charge"],
    Y: ["Block / contest", "Jump as he rises; also rebounds"],
    RS: ["Hands up", "Hold: arms up, no jump"],
    LT: ["Intense D", "Hold: quicker feet"],
    MENU: ["Pause"],
    VIEW: ["Camera"],
  },
};

// button centers on the drawing (viewBox 1000 x 440) and where each label pill sits: l / r / t / b of the button
const PAD_AT: Record<PadKey, { x: number; y: number; at: "l" | "r" | "t" | "b"; gap: number }> = {
  LT: { x: 372, y: 62, at: "l", gap: 44 },
  LB: { x: 370, y: 104, at: "l", gap: 52 },
  RT: { x: 628, y: 62, at: "r", gap: 44 },
  RB: { x: 630, y: 104, at: "r", gap: 52 },
  LS: { x: 392, y: 212, at: "l", gap: 42 },
  DPAD: { x: 448, y: 300, at: "b", gap: 40 },
  VIEW: { x: 462, y: 180, at: "t", gap: 22 },
  MENU: { x: 538, y: 180, at: "t", gap: 22 },
  Y: { x: 624, y: 166, at: "t", gap: 22 },
  X: { x: 580, y: 210, at: "l", gap: 28 },
  B: { x: 668, y: 210, at: "r", gap: 28 },
  A: { x: 624, y: 254, at: "r", gap: 26 },
  RS: { x: 552, y: 300, at: "b", gap: 44 },
};

function FaceBtn({ b, family, x, y, lit }: { b: "A" | "B" | "X" | "Y"; family: PadFamily; x: number; y: number; lit: boolean }) {
  const c = FACE_COLOR[family][b];
  const st = { fill: "none", stroke: c, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g transform={`translate(${x} ${y})`} opacity={lit ? 1 : 0.35}>
      <circle r="17" fill="#0b0e15" stroke={lit ? c : "rgb(255 255 255 / 0.25)"} strokeWidth={lit ? 2.5 : 1.5} />
      {family === "xbox" ? (
        <text y="7" textAnchor="middle" fontSize="19" fontWeight="900" fill={c} style={{ fontFamily: "var(--font-ui)" }}>
          {b}
        </text>
      ) : b === "A" ? (
        <path d="M-6-6l12 12M6-6l-12 12" {...st} />
      ) : b === "B" ? (
        <circle r="7" {...st} />
      ) : b === "X" ? (
        <rect x="-6.5" y="-6.5" width="13" height="13" {...st} />
      ) : (
        <path d="M0-8l8 13h-16z" {...st} />
      )}
    </g>
  );
}

function Pill({ x, y, at, text, color }: { x: number; y: number; at: "l" | "r" | "t" | "b"; text: string; color: string }) {
  const w = text.length * 8.4 + 20;
  const h = 26;
  const left = at === "l" ? x - w : at === "r" ? x : x - w / 2;
  const top = at === "t" ? y - h : at === "b" ? y : y - h / 2;
  return (
    <g>
      <rect x={left} y={top} width={w} height={h} rx="5" fill="#05060a" fillOpacity="0.92" stroke={color} strokeWidth="1.6" />
      <text x={left + w / 2} y={top + 18} textAnchor="middle" fontSize="15" fontWeight="900" fill="#fff" style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {text}
      </text>
    </g>
  );
}

function PadPicture({ side, family }: { side: Side; family: PadFamily }) {
  const labels = PAD_LABEL[side];
  const lit = (k: PadKey) => !!labels[k];
  const sh = family === "ps" ? { LT: "L2", LB: "L1", RT: "R2", RB: "R1" } : { LT: "LT", LB: "LB", RT: "RT", RB: "RB" };
  const faceCol = (k: PadKey) => (k === "A" || k === "B" || k === "X" || k === "Y" ? FACE_COLOR[family][k] : "#ff8a3d");
  return (
    <svg viewBox="140 20 720 410" className="h-auto w-full" role="img" aria-label={`Controller map, ${side}`}>
      <defs>
        <linearGradient id="cm-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a3142" />
          <stop offset="1" stopColor="#131722" />
        </linearGradient>
      </defs>
      {(["LT", "RT"] as const).map((k) => (
        <g key={k} opacity={lit(k) ? 1 : 0.35}>
          <rect x={PAD_AT[k].x - 32} y={PAD_AT[k].y - 20} width={64} height={40} rx={14} fill="#1b2130" stroke={lit(k) ? "#ff8a3d" : "rgb(255 255 255 / 0.2)"} strokeWidth="2" />
          <text x={PAD_AT[k].x} y={PAD_AT[k].y + 6} textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-ui)" }}>
            {sh[k]}
          </text>
        </g>
      ))}
      {(["LB", "RB"] as const).map((k) => (
        <g key={k} opacity={lit(k) ? 1 : 0.35}>
          <rect x={PAD_AT[k].x - 40} y={PAD_AT[k].y - 13} width={80} height={26} rx={12} fill="#1b2130" stroke={lit(k) ? "#ff8a3d" : "rgb(255 255 255 / 0.2)"} strokeWidth="2" />
          <text x={PAD_AT[k].x} y={PAD_AT[k].y + 6} textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-ui)" }}>
            {sh[k]}
          </text>
        </g>
      ))}
      <path
        d="M360 122 H640 C700 122 735 162 748 222 L780 372 C790 422 750 450 712 434 C680 422 662 382 636 357 H364 C338 382 320 422 288 434 C250 450 210 422 220 372 L252 222 C265 162 300 122 360 122 Z"
        fill="url(#cm-body)"
        stroke="rgb(255 255 255 / 0.18)"
        strokeWidth="2"
      />
      {(["LS", "RS"] as const).map((k) => {
        const a = PAD_AT[k];
        return (
          <g key={k} opacity={lit(k) ? 1 : 0.35}>
            <circle cx={a.x} cy={a.y} r="30" fill="#0b0e15" stroke={lit(k) ? "#ff8a3d" : "rgb(255 255 255 / 0.2)"} strokeWidth="2.5" />
            <circle cx={a.x} cy={a.y} r="19" fill="#1d2433" stroke="rgb(255 255 255 / 0.35)" />
            <text x={a.x} y={a.y + 6} textAnchor="middle" fontSize="16" fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-ui)" }}>
              {k === "LS" ? "L" : "R"}
            </text>
          </g>
        );
      })}
      <g opacity={0.35} transform={`translate(${PAD_AT.DPAD.x} ${PAD_AT.DPAD.y})`}>
        <path d="M-9 -27h18v18h18v18h-18v18h-18v-18h-18v-18h18z" fill="#0b0e15" stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" />
      </g>
      {(["VIEW", "MENU"] as const).map((k) => {
        const a = PAD_AT[k];
        return (
          <g key={k} opacity={lit(k) ? 1 : 0.35}>
            <rect x={a.x - 14} y={a.y - 9} width="28" height="18" rx="9" fill="#0b0e15" stroke="rgb(255 255 255 / 0.4)" />
            {k === "MENU" ? (
              <path d={`M${a.x - 6} ${a.y - 4}h12M${a.x - 6} ${a.y}h12M${a.x - 6} ${a.y + 4}h12`} stroke="#fff" strokeWidth="1.6" />
            ) : (
              <rect x={a.x - 6} y={a.y - 4} width="12" height="8" rx="1.5" fill="none" stroke="#fff" strokeWidth="1.4" />
            )}
          </g>
        );
      })}
      {(["Y", "B", "X", "A"] as const).map((b) => (
        <FaceBtn key={b} b={b} family={family} x={PAD_AT[b].x} y={PAD_AT[b].y} lit={lit(b)} />
      ))}
      {(Object.keys(PAD_AT) as PadKey[]).map((k) => {
        const l = labels[k];
        if (!l) return null;
        const a = PAD_AT[k];
        const px = a.at === "l" ? a.x - a.gap : a.at === "r" ? a.x + a.gap : a.x;
        const py = a.at === "t" ? a.y - a.gap : a.at === "b" ? a.y + a.gap : a.y;
        return <Pill key={k} x={px} y={py} at={a.at} text={l[0]} color={faceCol(k)} />;
      })}
    </svg>
  );
}

const PAD_ORDER: PadKey[] = ["LS", "RT", "X", "A", "B", "Y", "RS", "RB", "LB", "LT", "MENU", "VIEW"];

function PadLegend({ side, family }: { side: Side; family: PadFamily }) {
  const labels = PAD_LABEL[side];
  const sh: Record<string, string> = family === "ps" ? { LT: "L2", LB: "L1", RT: "R2", RB: "R1" } : { LT: "LT", LB: "LB", RT: "RT", RB: "RB" };
  const name = (k: PadKey) => (k === "LS" ? "Left stick" : k === "RS" ? "Right stick" : k === "MENU" ? "Menu" : k === "VIEW" ? "View" : sh[k] ?? k);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
      {PAD_ORDER.filter((k) => labels[k]).map((k) => (
        <div key={k} className="flex items-center gap-3 border-t border-line pt-1.5 text-[0.88rem]">
          <span className="num w-[6.5rem] flex-none text-[1rem]" style={{ color: k === "A" || k === "B" || k === "X" || k === "Y" ? FACE_COLOR[family][k] : "#fff" }}>
            {family === "ps" && (k === "A" || k === "B" || k === "X" || k === "Y") ? { A: "Cross", B: "Circle", X: "Square", Y: "Triangle" }[k] : name(k)}
          </span>
          <span className="font-semibold text-white">{labels[k]![0]}</span>
          {labels[k]![1] && <span className="truncate text-mute">· {labels[k]![1]}</span>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard picture
// ---------------------------------------------------------------------------------------------------------------------
type KeyDef = { k: string; x: number; y: number; w?: number };
const U = 54;
const ROWS: KeyDef[] = [
  { k: "Esc", x: 0, y: 0 },
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((k, i) => ({ k, x: 1.5 + i, y: 0 })),
  { k: "Tab", x: 0, y: 1, w: 1.5 },
  ...["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"].map((k, i) => ({ k, x: 1.5 + i, y: 1 })),
  { k: "Caps", x: 0, y: 2, w: 1.8 },
  ...["A", "S", "D", "F", "G", "H", "J", "K", "L"].map((k, i) => ({ k, x: 1.8 + i, y: 2 })),
  { k: "Shift", x: 0, y: 3, w: 2.3 },
  ...["Z", "X", "C", "V", "B", "N", "M"].map((k, i) => ({ k, x: 2.3 + i, y: 3 })),
  { k: "↑", x: 13.4, y: 2.9 },
  { k: "←", x: 12.4, y: 3.9 },
  { k: "↓", x: 13.4, y: 3.9 },
  { k: "→", x: 14.4, y: 3.9 },
];

const KEY_LABEL: Record<Side, Record<string, [string, string]>> = {
  offense: {
    W: ["MOVE", "#46d2ff"], A: ["MOVE", "#46d2ff"], S: ["MOVE", "#46d2ff"], D: ["MOVE", "#46d2ff"], Shift: ["SPRINT", "#46d2ff"],
    J: ["SHOOT", "#ff8a3d"], K: ["PASS", "#2fe39a"], L: ["BOUNCE", "#2fe39a"], I: ["LOB", "#2fe39a"], E: ["SCREEN", "#ffd166"],
    R: ["ICON", "#2fe39a"], Q: ["POST", "#ffd166"], "1": ["MAN 1", "#2fe39a"], "2": ["MAN 2", "#2fe39a"], "3": ["MAN 3", "#2fe39a"], "4": ["MAN 4", "#2fe39a"],
    "↑": ["MOVES", "#ff8a3d"], "←": ["MOVES", "#ff8a3d"], "↓": ["MOVES", "#ff8a3d"], "→": ["MOVES", "#ff8a3d"],
    Esc: ["PAUSE", "#8d96a8"], C: ["CAMERA", "#8d96a8"],
  },
  defense: {
    W: ["MOVE", "#46d2ff"], A: ["MOVE", "#46d2ff"], S: ["MOVE", "#46d2ff"], D: ["MOVE", "#46d2ff"], Shift: ["SPRINT", "#46d2ff"],
    J: ["BLOCK/CONTEST", "#ff8a3d"], K: ["SWITCH", "#2fe39a"], L: ["STEAL", "#ff8a3d"], F: ["CHARGE", "#ffd166"], Q: ["INTENSE", "#ffd166"],
    "↑": ["HANDS UP", "#ff8a3d"], "←": ["HANDS UP", "#ff8a3d"], "↓": ["HANDS UP", "#ff8a3d"], "→": ["HANDS UP", "#ff8a3d"],
    Esc: ["PAUSE", "#8d96a8"], C: ["CAMERA", "#8d96a8"],
  },
};

const KEY_LEGEND: Record<Side, [string, string][]> = {
  offense: [
    ["W A S D", "Move your player"], ["Shift", "Sprint (hold)"], ["J", "Shoot: hold, release at the gold notch"], ["K", "Pass toward where you push"],
    ["L / I", "Bounce pass / lob"], ["Arrows / Space+WASD", "Dribble moves (tap)"], ["R or 1-4", "Icon pass to a teammate"], ["E / Q", "Call screen / post up"],
  ],
  defense: [
    ["W A S D", "Slide with your man"], ["K", "Switch to the man nearest the ball"], ["L", "Steal (dribbler in front of you)"], ["J", "Block / contest: jump as he rises (also rebounds)"],
    ["Space (hold)", "Hands up, no jump"], ["Q", "Intense D (hold)"], ["F", "Take a charge"], ["Shift", "Sprint back"],
  ],
};

function KeyboardPicture({ side }: { side: Side }) {
  const labels = KEY_LABEL[side];
  return (
    <div className="flex flex-col gap-4">
      <svg viewBox={`-6 -6 ${15.6 * U + 12} ${5 * U + 12}`} className="h-auto w-full" role="img" aria-label={`Keyboard map, ${side}`}>
        {ROWS.map((d) => {
          const l = labels[d.k];
          const w = (d.w ?? 1) * U - 6;
          const x = d.x * U;
          const y = d.y * U;
          return (
            <g key={d.k + d.x} opacity={l ? 1 : 0.32}>
              <rect x={x} y={y} width={w} height={U - 6} rx="7" fill={l ? "#141a26" : "#0d1018"} stroke={l ? l[1] : "rgb(255 255 255 / 0.2)"} strokeWidth={l ? 2.4 : 1.2} />
              <rect x={x + 2} y={y + U - 12} width={w - 4} height="4" rx="2" fill="rgb(0 0 0 / 0.35)" />
              <text x={x + w / 2} y={y + (l ? 21 : 30)} textAnchor="middle" fontSize={d.k.length > 2 ? 13 : 19} fontWeight="800" fill="#fff" style={{ fontFamily: "var(--font-ui)" }}>
                {d.k}
              </text>
              {l && (
                <text x={x + w / 2} y={y + 39} textAnchor="middle" fontSize={l[0].length > 6 ? 8.5 : 10} fontWeight="900" fill={l[1]} style={{ fontFamily: "var(--font-ui)", letterSpacing: "0.04em" }}>
                  {l[0]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {KEY_LEGEND[side].map(([k, t]) => (
          <div key={k} className="flex items-center gap-3 border-t border-line pt-1.5 text-[0.88rem]">
            <span className="num w-[6.5rem] flex-none text-[1.05rem] text-white">{k}</span>
            <span className="text-ink/85">{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Picture of the controller (or keyboard) with every button labelled, switchable between offense and defense. */
export function ControlsMap({ device, family, compact, view: vIn, onView }: { device: Device; family: PadFamily; compact?: boolean; view?: Device; onView?: (d: Device) => void }) {
  const [vOwn, setOwn] = useState<Device>(device);
  const view = vIn ?? vOwn;
  const setView = onView ?? setOwn;
  const [side, setSide] = useState<Side>("offense");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Device"
          value={view}
          onChange={setView}
          options={[
            { v: "pad", label: family === "ps" ? "Controller (PS)" : "Controller" },
            { v: "keys", label: "Keyboard" },
          ]}
          className="w-[22rem]"
        />
        <Segmented
          label="Side of the ball"
          value={side}
          onChange={setSide}
          options={[
            { v: "offense", label: "Offense" },
            { v: "defense", label: "Defense" },
          ]}
          className="w-[20rem]"
        />
      </div>
      <div className={compact ? "mx-auto w-full max-w-[60rem]" : "mx-auto w-full max-w-[68rem]"}>
        {view === "pad" ? (
          <div className="flex flex-col gap-4">
            <div className="mx-auto w-full max-w-[52rem]">
              <PadPicture side={side} family={family} />
            </div>
            <PadLegend side={side} family={family} />
          </div>
        ) : (
          <KeyboardPicture side={side} />
        )}
      </div>
    </div>
  );
}
