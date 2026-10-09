"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { Controls, Press } from "./contracts";
import { Brake, Camera, Gas, Handbrake, Pause, Rewind, Rotate } from "./ui-icons";
import { cx } from "./ui-kit";

export type TouchInput = Partial<Controls> & { held?: Partial<Record<Press, boolean>> };
export type SteerMode = "slider" | "tilt";

export function isTouch() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
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

export function useIsTouch() {
  const [t, setT] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(pointer: coarse)");
    const f = () => setT(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return t;
}

type Btn = "gas" | "brake" | "hand" | "camera" | "rewind" | "pause";
const PEDALS: Btn[] = ["gas", "brake", "hand"];
const SMALL: Btn[] = ["camera", "rewind", "pause"];
const STEER_PX = 0.09;

export function TouchControls({ onControls, steer = "slider", force }: { onControls: (t: TouchInput) => void; steer?: SteerMode; force?: boolean }) {
  const touch = useIsTouch();
  const els = useRef<Partial<Record<Btn, HTMLElement | null>>>({});
  const track = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, { steer: boolean; x0: number; btn: Btn | null }>());
  const state = useRef({ steer: 0, tilt: 0, on: new Set<Btn>() });
  const cb = useRef(onControls);
  useEffect(() => {
    cb.current = onControls;
  });

  const emit = () => {
    const s = state.current;
    const on = s.on;
    cb.current({
      steer: steer === "tilt" ? s.tilt : s.steer,
      throttle: on.has("gas") ? 1 : 0,
      brake: on.has("brake") ? 1 : 0,
      handbrake: on.has("hand") ? 1 : 0,
      held: { camera: on.has("camera"), rewind: on.has("rewind"), pause: on.has("pause") },
    });
    for (const b of [...PEDALS, ...SMALL]) {
      const e = els.current[b];
      if (e) e.dataset.on = on.has(b) ? "1" : "0";
    }
  };

  const showSteer = (v: number) => {
    if (knob.current) knob.current.style.transform = `translateX(${v * 100}%)`;
  };

  useEffect(() => {
    if (steer !== "tilt") return;
    const f = (e: DeviceOrientationEvent) => {
      const a = (screen.orientation?.angle ?? 0) % 360;
      const raw = a === 90 ? (e.beta ?? 0) : a === 270 ? -(e.beta ?? 0) : (e.gamma ?? 0);
      const v = Math.max(-1, Math.min(1, raw / 28));
      state.current.tilt = Math.abs(v) < 0.04 ? 0 : v;
      showSteer(state.current.tilt);
      emit();
    };
    window.addEventListener("deviceorientation", f);
    return () => window.removeEventListener("deviceorientation", f);
  });

  useEffect(() => {
    const p = ptrs.current;
    const s = state.current;
    return () => {
      p.clear();
      s.on.clear();
      s.steer = 0;
      cb.current({ steer: 0, throttle: 0, brake: 0, handbrake: 0, held: { camera: false, rewind: false, pause: false } });
    };
  }, []);

  const hit = (x: number, y: number): Btn | null => {
    for (const b of [...SMALL, ...PEDALS]) {
      const r = els.current[b]?.getBoundingClientRect();
      const pad = b === "gas" || b === "brake" ? 14 : 4;
      if (r && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return b;
    }
    return null;
  };

  const sync = () => {
    const s = state.current;
    s.on.clear();
    for (const t of ptrs.current.values()) if (t.btn) s.on.add(t.btn);
    emit();
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (steer === "tilt" && D.requestPermission) D.requestPermission().catch(() => {});
    const btn = hit(e.clientX, e.clientY);
    const isSteer = !btn && steer === "slider" && e.clientX < window.innerWidth * 0.45;
    if (isSteer) {
      for (const [id, t] of ptrs.current) if (t.steer) ptrs.current.delete(id);
      const tr = track.current;
      if (tr) {
        tr.style.left = `${e.clientX - tr.offsetWidth / 2}px`;
        tr.style.top = `${e.clientY - tr.offsetHeight / 2}px`;
        tr.style.bottom = "auto";
        tr.dataset.on = "1";
      }
    }
    ptrs.current.set(e.pointerId, { steer: isSteer, x0: e.clientX, btn });
    sync();
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const t = ptrs.current.get(e.pointerId);
    if (!t) return;
    if (t.steer) {
      const v = Math.max(-1, Math.min(1, (e.clientX - t.x0) / (window.innerWidth * STEER_PX)));
      state.current.steer = v;
      showSteer(v);
      emit();
      return;
    }
    const b = hit(e.clientX, e.clientY);
    if (b !== t.btn && (b === null || PEDALS.includes(b)) && (t.btn === null || PEDALS.includes(t.btn))) {
      t.btn = b;
      sync();
    }
  };

  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    const t = ptrs.current.get(e.pointerId);
    ptrs.current.delete(e.pointerId);
    if (t?.steer) {
      state.current.steer = 0;
      showSteer(0);
      if (track.current) {
        track.current.style.left = track.current.style.top = track.current.style.bottom = "";
        delete track.current.dataset.on;
      }
    }
    sync();
  };

  if (!touch && !force) return null;

  const set = (b: Btn) => (el: HTMLElement | null) => {
    els.current[b] = el;
  };

  return (
    <div
      className="touch-ui absolute inset-0"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pointer-events-none absolute left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] flex -translate-x-1/2 gap-3">
        <Small el={set("camera")} icon={<Camera />} />
        <Small el={set("rewind")} icon={<Rewind />} />
        <Small el={set("pause")} icon={<Pause />} />
      </div>

      {steer === "slider" ? (
        <div
          ref={track}
          className="pointer-events-none absolute bottom-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] left-[max(2rem,calc(env(safe-area-inset-left)+1rem))] flex h-20 w-[clamp(11rem,30vw,18rem)] items-center opacity-70 transition-opacity duration-150 data-[on=1]:opacity-100"
        >
          <div className="glass absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full" />
          <div className="absolute left-1/2 top-1/2 h-8 w-px -translate-y-1/2 bg-line-hi" />
          <svg viewBox="0 0 24 24" className="absolute -left-1 h-6 w-6 text-mute" aria-hidden>
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <svg viewBox="0 0 24 24" className="absolute -right-1 h-6 w-6 text-mute" aria-hidden>
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="absolute left-1/2 top-0 h-full w-[18%] -translate-x-1/2">
            <div ref={knob} className="h-full w-full transition-transform duration-75" style={{ transform: "translateX(0%)" }}>
              <div className="skew h-full w-full rounded-[4px] border-2 border-white bg-hot shadow-[0_0_1.5rem_-0.25rem_var(--color-hot)]" />
            </div>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))] left-[max(2rem,calc(env(safe-area-inset-left)+1rem))] h-16 w-16 opacity-60">
          <div ref={knob} className="h-full w-full">
            <svg viewBox="0 0 24 24" className="h-full w-full text-white" aria-hidden>
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M3.5 10.5l6 1M20.5 10.5l-6 1M12 14.5V21" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.5rem,env(safe-area-inset-right))] flex items-end gap-[clamp(0.75rem,2.5vw,1.5rem)]">
        <div className="flex flex-col items-center gap-[clamp(0.75rem,3vh,1.25rem)]">
          <Pedal el={set("hand")} icon={<Handbrake />} className="h-[clamp(4rem,17vh,6rem)] w-[clamp(4rem,17vh,6rem)] rounded-full" />
          <Pedal el={set("brake")} icon={<Brake />} className="h-[clamp(5.5rem,24vh,9rem)] w-[clamp(6rem,24vh,9.5rem)] rounded-[6px]" />
        </div>
        <Pedal el={set("gas")} icon={<Gas />} hot className="h-[clamp(10rem,44vh,17rem)] w-[clamp(6rem,24vh,9.5rem)] rounded-[6px]" />
      </div>
    </div>
  );
}

function Pedal({ el, icon, className, hot }: { el: (e: HTMLElement | null) => void; icon: ReactNode; className: string; hot?: boolean }) {
  return (
    <div
      ref={el}
      data-on="0"
      className={cx(
        "glass grid place-items-center border-2 text-[clamp(2rem,8vh,3.25rem)] transition-[transform,background-color,border-color] duration-75 data-[on=1]:scale-95",
        hot ? "border-hot/60 text-hot data-[on=1]:bg-hot data-[on=1]:text-white" : "border-line-hi text-white/90 data-[on=1]:border-white data-[on=1]:bg-white/30",
        className,
      )}
    >
      {icon}
    </div>
  );
}

function Small({ el, icon }: { el: (e: HTMLElement | null) => void; icon: ReactNode }) {
  return (
    <div ref={el} data-on="0" className="glass grid h-12 w-12 place-items-center rounded-full text-xl text-white/85 transition-colors duration-75 data-[on=1]:bg-white/30">
      {icon}
    </div>
  );
}

export function RotateHint() {
  return (
    <div className="fixed inset-0 z-50 hidden place-items-center bg-night pointer-coarse:portrait:grid">
      <Rotate className="text-[7rem] text-white [animation:rot_2s_var(--ease-out)_infinite]" />
      <style>{`@keyframes rot{0%,20%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}`}</style>
    </div>
  );
}
