"use client";

import { useEffect, useState } from "react";
import type { Action } from "./contracts";
import { Key } from "./ui-menu";
import { BUTTONS, KEYS } from "./input";

export const HELP = { code: "KeyH", key: "H" };
const MOUSE = ["LMB", "MMB", "RMB"];
const NAMES: Record<string, string> = { ShiftLeft: "Shift", ShiftRight: "Shift", Escape: "Esc" };
const keyName = (code: string) => NAMES[code] ?? code.replace(/^(Key|Digit|Arrow)/, "");

export const keyFor = (a: Action) => keysOf(a).at(-1);

function keysOf(a: Action) {
  const out = new Set<string>();
  for (const [b, x] of Object.entries(BUTTONS)) if (x === a) out.add(MOUSE[Number(b)]);
  for (const [c, x] of Object.entries(KEYS)) if (x === a) out.add(keyName(c));
  if (a === "cycle") out.add("Wheel");
  return [...out];
}

type Row = { a?: Action; keys?: string[]; pc?: string; btn?: string; tap?: string };
type Group = { group: string; jp: string; rows: Row[]; note?: string };

const GROUPS: Group[] = [
  {
    group: "Move",
    jp: "移動",
    rows: [
      { keys: ["W", "A", "S", "D"], pc: "Move", btn: "Left side", tap: "Drag to move" },
      { keys: ["Mouse"], pc: "Look", btn: "Right side", tap: "Drag to look" },
      { a: "gas", pc: "Gas boost, jump", btn: "Gas", tap: "Boost, jump" },
      { a: "dash", pc: "Dash", btn: "Dash", tap: "Dash" },
    ],
  },
  {
    group: "Hook",
    jp: "アンカー",
    note: "Tap an anchor to latch, tap again to let go. Hold it to swing.",
    rows: [
      { a: "anchorL", pc: "Left", btn: "L", tap: "Left anchor" },
      { a: "anchorR", pc: "Right", btn: "R", tap: "Right anchor" },
      { btn: "L+R", tap: "Both" },
      { a: "autoHook", pc: "Both at the lock", btn: "Hook", tap: "Both at the lock" },
    ],
  },
  {
    group: "Attack",
    jp: "攻撃",
    rows: [
      { a: "lock", pc: "Lock on", btn: "Lock", tap: "Lock on, tap for next part" },
      { a: "cycle", pc: "Next part" },
      { a: "attack", pc: "Hold, release to strike", btn: "Slash", tap: "Hold, release to strike" },
      { a: "swap", pc: "Swap blades", btn: "Swap", tap: "Swap blades" },
      { a: "weapon", pc: "Next weapon", btn: "Weapon", tap: "Next weapon" },
      { a: "shift", pc: "Titan shift", btn: "Shift", tap: "Titan shift" },
      { keys: ["E", "Space"], pc: "Mash to break a grab", btn: "Slash", tap: "Mash to break a grab" },
    ],
  },
  {
    group: "Squad",
    jp: "分隊",
    rows: [
      { keys: ["G"], pc: "Attack or regroup", btn: "Squad", tap: "Attack or regroup" },
      { a: "teamAttack", pc: "Team attack on the lock", btn: "Team", tap: "Team attack on the lock" },
    ],
  },
];

const LOOP: [Action, string, string][] = [
  ["lock", "Lock", "Lock on"],
  ["autoHook", "Hook", "Hook"],
  ["attack", "Slash", "Strike the nape"],
];

const SYSTEM: [string, string][] = [
  ["Esc", "Pause"],
  ["M", "Mute"],
  [HELP.key, "Controls"],
  ["1-3", "Pick upgrade"],
];

const known = new Set(GROUPS.flatMap((g) => g.rows.map((r) => r.a)));
const extra: Row[] = [...new Set(Object.values(KEYS))]
  .filter((a) => !known.has(a))
  .map((a) => ({ a, pc: a.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) }));
const ALL = GROUPS.map((g) => (g.group === "Attack" ? { ...g, rows: [...g.rows, ...extra] } : g));

export function ControlsGrid({ touch }: { touch: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-bone/85">
        {LOOP.map(([a, btn, text], i) => (
          <span key={a} className="flex items-center gap-1.5">
            {i > 0 && <span className="mr-0.5 text-brass">→</span>}
            {touch ? <span className="text-[11px] font-semibold uppercase tracking-wider text-brass">{btn}</span> : <Key>{keyFor(a)}</Key>}
            {text}
          </span>
        ))}
      </div>
      {ALL.map((g) => (
        <div key={g.group} className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-brass">
            {g.group}
            <div className="font-jp text-[10px] tracking-[0.15em] text-bone/40">{g.jp}</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] leading-tight text-bone/85">
            {g.rows.map((r, i) =>
              touch ? (
                r.btn && (
                  <span key={i}>
                    <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-brass">{r.btn}</span>
                    {r.tap}
                  </span>
                )
              ) : (
                r.pc && (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="flex gap-1">
                      {(r.keys ?? keysOf(r.a!)).map((k) => (
                        <Key key={k}>{k}</Key>
                      ))}
                    </span>
                    {r.pc}
                  </span>
                )
              ),
            )}
            {g.note && <span className="basis-full text-[11px] text-bone/55">{g.note}</span>}
          </div>
        </div>
      ))}
      {!touch && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-brass/20 pt-2 text-[13px] text-bone/80">
          {SYSTEM.map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <Key>{k}</Key> {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ControlsCard({ touch, close }: { touch: boolean; close?: string }) {
  return (
    <section className="plate relative w-full max-w-[480px] border border-brass/40 bg-gradient-to-b from-char/90 to-ink/90 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood via-blood/70 to-transparent" />
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className="font-display text-xl uppercase tracking-wide">Controls</span>
          <span className="font-jp text-xs font-bold tracking-[0.25em] text-blood">操作</span>
        </span>
        {close && <span className="text-[11px] font-semibold uppercase tracking-widest text-bone/55">{close}</span>}
      </header>
      <ControlsGrid touch={touch} />
    </section>
  );
}

export function ControlsOverlay({ touch }: { touch: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === HELP.code && !e.repeat) setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      {touch && (
        <button aria-label="Controls" onClick={() => setOpen((o) => !o)} className="touch-help font-display text-xl text-bone">
          ?
        </button>
      )}
      {open && (
        <div
          className={`hud-z absolute ${touch ? "inset-0 flex items-center justify-center bg-ink/40" : "pointer-events-none right-4 top-[calc(50%+34px)] w-[460px] -translate-y-1/2"}`}
          onClick={() => setOpen(false)}
        >
          <ControlsCard touch={touch} close={touch ? "Tap to close" : `${HELP.key} to close`} />
        </div>
      )}
    </>
  );
}
