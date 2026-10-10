"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import type { Action, HudState, VirtualPad } from "./contracts";
import { PARTS } from "./ui-hud";

const STICK_R = 58;
const LOOK_GAIN = 1.8;
const LONG_MS = 450;
const SWIPE_PX = 26;

export function isTouch() {
  return window.matchMedia("(pointer: coarse)").matches;
}

export function isPhone() {
  return isTouch() && Math.min(screen.width, screen.height) < 600;
}

export function enterFullscreen() {
  const el = document.documentElement;
  if (!el.requestFullscreen || document.fullscreenElement) return;
  el.requestFullscreen({ navigationUI: "hide" })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => {});
}

type Kind = Action | "both";
const ACTIONS: Record<Kind, Action[]> = {
  anchorL: ["anchorL"],
  anchorR: ["anchorR"],
  both: ["anchorL", "anchorR"],
  gas: ["gas"],
  dash: ["dash"],
  attack: ["attack"],
  lock: ["lock"],
  cycle: ["cycle"],
  autoHook: ["autoHook"],
  swap: ["swap"],
  weapon: ["weapon"],
  teamAttack: ["teamAttack"],
  shift: ["shift"],
};

const at = (right: number, bottom: number, size: number) => ({
  right: `calc(env(safe-area-inset-right) + var(--u) * ${right - size / 2})`,
  bottom: `calc(env(safe-area-inset-bottom) + var(--u) * ${bottom - size / 2})`,
  width: `calc(var(--u) * ${size})`,
  height: `calc(var(--u) * ${size})`,
});

export function TouchControls({ pad, h, onPause, onOrder }: { pad: VirtualPad; h: HudState; onPause: () => void; onOrder: () => void }) {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, { stick: boolean; x0: number; y0: number; x: number; y: number }>());

  useEffect(() => {
    const map = touches.current;
    return () => {
      map.clear();
      pad.stick(0, 0);
      for (const a of Object.keys(ACTIONS) as Kind[]) for (const x of ACTIONS[a]) pad.up(x);
    };
  }, [pad]);

  const moveStick = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy);
    const k = d > STICK_R ? STICK_R / d : 1;
    knob.current!.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    pad.stick((dx * k) / STICK_R, (-dy * k) / STICK_R);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const stick = e.clientX < window.innerWidth * 0.42;
    touches.current.set(e.pointerId, { stick, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    if (stick && base.current) {
      for (const [id, t] of touches.current) if (t.stick && id !== e.pointerId) touches.current.delete(id);
      base.current.style.left = `${e.clientX}px`;
      base.current.style.top = `${e.clientY}px`;
      base.current.dataset.on = "1";
      moveStick(0, 0);
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    if (t.stick) moveStick(e.clientX - t.x0, e.clientY - t.y0);
    else pad.look((e.clientX - t.x) * LOOK_GAIN, (e.clientY - t.y) * LOOK_GAIN);
    t.x = e.clientX;
    t.y = e.clientY;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const t = touches.current.get(e.pointerId);
    touches.current.delete(e.pointerId);
    if (t?.stick && base.current && knob.current) {
      delete base.current.dataset.on;
      base.current.style.left = "";
      base.current.style.top = "";
      knob.current.style.transform = "";
      pad.stick(0, 0);
    }
  };

  const charge = h.charge ?? 0;
  const held = h.escape !== null;
  const lockLabel = h.lock ? PARTS[h.lock.part].en : "Lock";

  return (
    <div
      className="touch-ui absolute inset-0"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={base} className="touch-stick">
        <div ref={knob} className="touch-knob" />
      </div>

      <HoldButton pad={pad} kind="attack" style={at(78, 76, 96)} big pulse={held}>
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute -inset-[7%] h-[114%] w-[114%] -rotate-90">
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(239,230,210,0.12)" strokeWidth="5" />
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke={charge >= 0.98 ? "#ffd27a" : "#ff4a2e"}
            strokeWidth="5"
            strokeDasharray="289"
            strokeDashoffset={289 * (1 - charge)}
            className="transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <Face jp="斬" en={held ? "Mash" : "Slash"} />
      </HoldButton>
      <HoldButton pad={pad} kind="gas" style={at(188, 50, 78)}>
        <Face jp="ガス" en="Gas" />
      </HoldButton>
      <HoldButton pad={pad} kind="anchorL" style={at(170, 150, 68)} lit={h.hooks[0]}>
        <Face jp="L" en="Anchor" latin />
      </HoldButton>
      <HoldButton pad={pad} kind="anchorR" style={at(84, 186, 68)} lit={h.hooks[1]}>
        <Face jp="R" en="Anchor" latin />
      </HoldButton>
      <HoldButton pad={pad} kind="both" style={at(250, 140, 56)} lit={h.hooks[0] && h.hooks[1]}>
        <Face jp="L+R" en="Both" latin small />
      </HoldButton>
      <HoldButton pad={pad} kind="dash" style={at(282, 44, 58)}>
        <Face jp="翔" en="Dash" small />
      </HoldButton>

      <LockButton pad={pad} locked={!!h.lock} label={lockLabel} style={at(34, 248, 54)} />
      <HoldButton pad={pad} kind="autoHook" style={at(108, 250, 48)} small>
        <Face jp="アンカー" en="Hook" small />
      </HoldButton>
      <HoldButton pad={pad} kind="swap" style={at(168, 246, 44)} small>
        <Face jp="刃" en={`Swap ${h.blades}`} small />
      </HoldButton>
      {h.squad.max > 0 && (
        <div
          role="button"
          aria-label="order"
          className="touch-btn text-[calc(var(--u)*13)]"
          data-lit={h.squad.order === "attack" ? "1" : undefined}
          style={at(226, 236, 44)}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOrder();
          }}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <Face jp={h.squad.order === "attack" ? "攻撃" : "集合"} en="Squad" small />
        </div>
      )}

      <button
        aria-label="Pause"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={onPause}
        className="touch-pause"
      >
        <span className="h-3.5 w-1 bg-bone" />
        <span className="h-3.5 w-1 bg-bone" />
      </button>
    </div>
  );
}

function Face({ jp, en, latin, small }: { jp: string; en: string; latin?: boolean; small?: boolean }) {
  return (
    <span className="pointer-events-none relative flex flex-col items-center leading-none">
      <span className={`${latin ? "font-display" : "font-jp font-black"} whitespace-nowrap ${!latin && jp.length > 3 ? "text-[0.62em]" : small ? "text-[1.05em]" : "text-[1.6em]"}`}>{jp}</span>
      <span className="mt-[0.2em] text-[0.55em] font-semibold uppercase tracking-[0.15em] text-bone/70">{en}</span>
    </span>
  );
}

function HoldButton({
  pad,
  kind,
  style,
  children,
  big,
  small,
  lit,
  pulse,
}: {
  pad: VirtualPad;
  kind: Kind;
  style: React.CSSProperties;
  children: ReactNode;
  big?: boolean;
  small?: boolean;
  lit?: boolean;
  pulse?: boolean;
}) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.dataset.on = "1";
    for (const a of ACTIONS[kind]) pad.down(a);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    delete e.currentTarget.dataset.on;
    for (const a of ACTIONS[kind]) pad.up(a);
  };
  return (
    <div
      role="button"
      aria-label={kind}
      className={`touch-btn ${big ? "text-[calc(var(--u)*22)]" : small ? "text-[calc(var(--u)*15)]" : "text-[calc(var(--u)*18)]"} ${pulse ? "pulse" : ""}`}
      data-lit={lit ? "1" : undefined}
      style={style}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerMove={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

function LockButton({ pad, locked, label, style }: { pad: VirtualPad; locked: boolean; label: string; style: React.CSSProperties }) {
  const start = useRef({ x: 0, y: 0, t: 0 });
  const tap = (a: Action) => {
    pad.down(a);
    pad.up(a);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.dataset.on = "1";
    start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    delete e.currentTarget.dataset.on;
    if (e.type === "pointercancel") return;
    const s = start.current;
    const swipe = Math.hypot(e.clientX - s.x, e.clientY - s.y) > SWIPE_PX;
    const long = performance.now() - s.t > LONG_MS;
    if (!locked) tap("lock");
    else if (long && !swipe) tap("lock");
    else tap("cycle");
  };
  return (
    <div
      role="button"
      aria-label="lock"
      className="touch-btn text-[calc(var(--u)*15)]"
      data-lit={locked ? "1" : undefined}
      style={style}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute inset-[18%] text-bone/25">
        <path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="pointer-events-none relative text-center text-[0.62em] font-semibold uppercase leading-tight tracking-wider">
        {label}
      </span>
    </div>
  );
}

export function RotateHint() {
  return (
    <div className="rotate-hint grain absolute inset-0 z-50 flex-col items-center justify-center gap-5 bg-ink px-8 text-center">
      <svg viewBox="0 0 64 64" className="rotate-phone h-20 w-20 text-bone">
        <rect x="20" y="8" width="24" height="48" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="32" cy="50" r="2" fill="currentColor" />
      </svg>
      <div className="font-jp text-base font-black tracking-[0.4em] text-blood">横向き</div>
      <div className="font-display text-3xl uppercase tracking-wide">Rotate to landscape</div>
    </div>
  );
}

const TOUCH_HELP: [string, string][] = [
  ["Left side", "Drag to move"],
  ["Right side", "Drag to look"],
  ["L / R", "Tap to latch, hold to reel"],
  ["L+R", "Fire both anchors"],
  ["Gas", "Hold to boost, tap on ground to jump"],
  ["Dash", "Gas dash"],
  ["Slash", "Hold to charge, release to strike"],
  ["Lock", "Tap to lock, tap again for next part"],
  ["Lock hold", "Hold to drop the lock"],
  ["Hook", "Anchor to the locked titan"],
  ["Swap", "Swap blades"],
  ["Squad", "Attack my target or regroup"],
  ["Grabbed", "Tap Slash fast"],
];

export function TouchHelp({ onClose }: { onClose: () => void }) {
  return (
    <section className="panel-in relative w-full max-w-[620px] border border-brass/40 bg-gradient-to-b from-char/95 to-ink/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.7)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blood via-blood/70 to-transparent" />
      <header className="mb-3 flex items-end justify-between gap-4 border-b border-brass/25 pb-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-2xl uppercase tracking-wide">Controls</h2>
          <span className="font-jp text-sm font-bold tracking-[0.25em] text-blood">操作</span>
        </div>
        <button onClick={onClose} className="px-2 py-1 text-xs font-semibold uppercase tracking-widest text-bone/60">
          Back
        </button>
      </header>
      <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs sm:grid-cols-[max-content_1fr_max-content_1fr]">
        {TOUCH_HELP.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="font-semibold uppercase tracking-wider text-brass">{k}</span>
            <span className="text-bone/85">{v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
