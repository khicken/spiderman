"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Device, GameEvent, HudState } from "./contracts";
import { Brake, Clock, Flag, Gas, Handbrake, Laps, Rewind, Trophy, Turn, Wheel } from "./ui-icons";
import { Key, cx, fmtDelta, fmtTime } from "./ui-kit";
import { Pad, TouchDiagram } from "./ui-settings";

export { Results } from "./ui-results";

// yaw: rotation about +y. Forward is (sin yaw, cos yaw) in x,z.
export type MiniCar = { x: number; z: number; yaw: number; color: string; me: boolean };

export type HudHandle = {
  needle(rpm: number): void;
  minimap(cars: readonly MiniCar[]): void;
  event(e: GameEvent): void;
};

type Pop = { id: number; kind: "split" | "lap" | "toast"; text: string; sub?: string; good?: boolean | null };

export function Hud({ h, units = "kmh", outline, touch, ref }: { h: HudState; units?: "kmh" | "mph"; outline?: ArrayLike<number>; touch?: boolean; ref?: Ref<HudHandle> }) {
  const tach = useRef<TachHandle>(null);
  const mini = useRef<MiniHandle>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const seq = useRef(0);

  useImperativeHandle(ref, () => ({
    needle: (rpm) => tach.current?.set(rpm),
    minimap: (cars) => mini.current?.draw(cars),
    event: (e) => {
      let p: Pop | null = null;
      const id = ++seq.current;
      if (e.type === "checkpoint") p = { id, kind: "split", text: fmtTime(e.split), sub: e.delta == null ? undefined : fmtDelta(e.delta), good: e.delta == null ? null : e.delta <= 0 };
      else if (e.type === "lap") p = { id, kind: "lap", text: `${e.lap}`, sub: fmtTime(e.time), good: e.best };
      else if (e.type === "toast") p = { id, kind: "toast", text: e.text };
      if (!p) return;
      const pop = p;
      setPops((l) => [...l.filter((x) => x.kind !== pop.kind), pop]);
      setTimeout(() => setPops((l) => l.filter((x) => x.id !== id)), 2600);
    },
  }));

  const racing = h.mode !== "free";
  const split = pops.find((p) => p.kind !== "toast");
  const toast = pops.find((p) => p.kind === "toast");

  return (
    <div className="safe pointer-events-none absolute inset-0 select-none">
      {racing && (
        <div className="fade absolute left-[max(1.5rem,env(safe-area-inset-left))] top-[max(1.25rem,env(safe-area-inset-top))] flex items-stretch gap-3">
          {h.mode === "race" && (
            <div className="flex items-baseline [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
              <span className="num text-[clamp(3.5rem,11vh,6rem)] leading-[0.8]">{h.place}</span>
              <span className="num text-[clamp(1.5rem,4.5vh,2.25rem)] leading-none text-mute">/{h.total}</span>
            </div>
          )}
          <div className={cx("flex flex-col justify-end gap-1", h.mode === "race" && "border-l border-line-hi pl-3")}>
            <span className="flex items-center gap-1.5 text-mute">
              <Laps className="text-lg" />
              <span className="num text-[clamp(1.5rem,4.4vh,2.25rem)] leading-none text-white">
                {Math.min(h.lap, h.laps)}
                <span className="text-mute">/{h.laps}</span>
              </span>
            </span>
          </div>
        </div>
      )}

      {racing && (
        <div className="fade absolute right-[max(1.5rem,env(safe-area-inset-right))] top-[max(1.25rem,env(safe-area-inset-top))] flex flex-col items-end gap-1 [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
          <span className="num text-[clamp(1.75rem,5.5vh,2.75rem)] leading-none">{fmtTime(h.time)}</span>
          {h.delta != null && (
            <span className={cx("num rounded-[2px] px-1.5 text-[clamp(1rem,2.8vh,1.35rem)] leading-tight text-black", h.delta <= 0 ? "bg-good" : "bg-bad")}>{fmtDelta(h.delta)}</span>
          )}
          <span className="flex items-center gap-1.5 text-[clamp(0.9rem,2.6vh,1.2rem)] text-mute">
            <Clock />
            <span className="num text-white/85">{fmtTime(h.last)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-[clamp(0.9rem,2.6vh,1.2rem)] text-gold">
            <Trophy />
            <span className="num">{fmtTime(h.best)}</span>
          </span>
        </div>
      )}

      {h.wrongWay && (
        <div className="absolute left-1/2 top-[18%] flex -translate-x-1/2 items-center gap-3 rounded-[3px] bg-bad/90 px-5 py-2 text-[clamp(2rem,7vh,3.5rem)] text-white blink">
          <Turn />
        </div>
      )}

      {split && (
        <div key={split.id} className="absolute left-1/2 top-[30%] flex -translate-x-1/2 items-center gap-2 [animation:pop_2.6s_var(--ease-out)_both]">
          <span className="glass num flex items-center gap-2 rounded-[3px] px-3 py-1 text-[clamp(1.4rem,4.4vh,2rem)]">
            {split.kind === "lap" ? (
              <>
                {split.good ? <Trophy className="text-gold" /> : <Flag className="text-hot" />}
                <span>{split.sub}</span>
              </>
            ) : (
              split.text
            )}
          </span>
          {split.kind === "split" && split.sub && (
            <span className={cx("num rounded-[3px] px-2 py-1 text-[clamp(1.4rem,4.4vh,2rem)] text-black", split.good ? "bg-good" : "bg-bad")}>{split.sub}</span>
          )}
        </div>
      )}

      {toast && (
        <div key={toast.id} className="glass absolute left-1/2 top-[19%] -translate-x-1/2 rounded-[3px] px-4 py-1.5 text-lg font-semibold [animation:pop_2.6s_var(--ease-out)_both]">
          {toast.text}
        </div>
      )}

      <Countdown n={h.countdown} />

      <div className={cx("absolute left-[max(1.5rem,env(safe-area-inset-left))]", touch ? "top-[calc(max(1.25rem,env(safe-area-inset-top))+clamp(4.5rem,14vh,7rem))] [&>*]:w-[clamp(6rem,24vh,9rem)]" : "bottom-[max(1.25rem,env(safe-area-inset-bottom))]")}>
        <Minimap ref={mini} outline={outline} />
      </div>
      <div className={cx("absolute bottom-[max(1rem,env(safe-area-inset-bottom))]", touch ? "left-1/2 -translate-x-1/2 [&>*]:w-[clamp(8rem,30vh,12rem)]" : "right-[max(1.25rem,env(safe-area-inset-right))]")}>
        <Tach ref={tach} redline={h.redline} limiter={h.limiter} speed={h.speed} gear={h.gear} units={units} />
      </div>
    </div>
  );
}

export function Countdown({ n }: { n: number }) {
  if (n < 0) return null;
  const go = n === 0;
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span
        key={n}
        className={cx("ttl text-[clamp(7rem,32vh,18rem)] leading-none [animation:count_1s_var(--ease-out)_both]", go ? "text-volt" : "text-white")}
        style={{ textShadow: `0 0 0.3em ${go ? "rgb(212 255 42 / 0.5)" : "rgb(0 0 0 / 0.6)"}` }}
      >
        {go ? "GO" : n}
      </span>
    </div>
  );
}

type TachHandle = { set(rpm: number): void };

const A0 = -225;
const SWEEP = 270;
const R = 84;

function polar(deg: number, r: number) {
  const a = (deg * Math.PI) / 180;
  return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r] as const;
}

function arc(d0: number, d1: number, r: number) {
  const [x0, y0] = polar(d0, r);
  const [x1, y1] = polar(d1, r);
  return `M${x0} ${y0}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function Tach({ redline, limiter, speed, gear, units, ref }: { redline: number; limiter: number; speed: number; gear: string; units: "kmh" | "mph"; ref?: Ref<TachHandle> }) {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const max = Math.ceil((limiter + 400) / 1000) * 1000;
  const last = useRef({ deg: -1, shift: false });

  useImperativeHandle(ref, () => ({
    set(rpm) {
      const f = Math.min(1, Math.max(0, rpm / max));
      const deg = Math.round(f * SWEEP * 4) / 4;
      const l = last.current;
      if (deg !== l.deg) {
        l.deg = deg;
        needle.current!.style.transform = `rotate(${deg}deg)`;
        fill.current!.style.strokeDashoffset = `${1 - f}`;
      }
      const shift = rpm >= redline * 0.97;
      if (shift !== l.shift) {
        l.shift = shift;
        root.current!.dataset.shift = shift ? "1" : "0";
      }
    },
  }));

  const ticks = [];
  for (let r = 0; r <= max; r += 500) {
    const d = A0 + (r / max) * SWEEP;
    const major = r % 1000 === 0;
    const [x0, y0] = polar(d, R - (major ? 9 : 5));
    const [x1, y1] = polar(d, R);
    const hot = r >= redline;
    ticks.push(<line key={r} x1={x0} y1={y0} x2={x1} y2={y1} stroke={hot ? "var(--color-hot)" : "white"} strokeWidth={major ? 2 : 1} opacity={major ? 1 : 0.5} />);
    if (major) {
      const [tx, ty] = polar(d, R - 18);
      ticks.push(
        <text key={`t${r}`} x={tx} y={ty + 4} textAnchor="middle" className="num" fontSize="11" fill={hot ? "var(--color-hot)" : "white"}>
          {r / 1000}
        </text>,
      );
    }
  }
  const red = A0 + (redline / max) * SWEEP;

  return (
    <div ref={root} className="tach relative aspect-square w-[clamp(9.5rem,34vh,17rem)]" data-shift="0">
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id="tachbg">
            <stop offset="0.55" stopColor="rgb(8 10 14 / 0.78)" />
            <stop offset="1" stopColor="rgb(8 10 14 / 0.35)" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#tachbg)" stroke="var(--color-line)" />
        <path d={arc(A0, A0 + SWEEP, R + 6)} fill="none" stroke="var(--color-line-hi)" strokeWidth="1" />
        <path d={arc(red, A0 + SWEEP, R + 3)} fill="none" stroke="var(--color-hot)" strokeWidth="6" opacity="0.9" />
        <path ref={fill} d={arc(A0, A0 + SWEEP, R + 6)} fill="none" stroke="white" strokeWidth="3" pathLength={1} strokeDasharray="1 1" strokeDashoffset="1" />
        {ticks}
        <g ref={needle} style={{ transformOrigin: "100px 100px", transform: "rotate(0deg)" }}>
          <path d={`M${polar(A0, R + 7)[0]} ${polar(A0, R + 7)[1]}L${polar(A0 + 2.2, 50)[0]} ${polar(A0 + 2.2, 50)[1]}L${polar(A0 - 2.2, 50)[0]} ${polar(A0 - 2.2, 50)[1]}Z`} fill="var(--color-hot)" />
        </g>
        <g className="shift-lamp opacity-0 transition-opacity duration-150">
          {[-2, -1, 0, 1, 2].map((i) => (
            <circle key={i} cx={100 + i * 8} cy="58" r="2.6" fill="var(--color-hot)" />
          ))}
        </g>
      </svg>
      <div className="absolute inset-x-0 top-[34%] flex flex-col items-center">
        <span className="num text-[clamp(2.4rem,9vh,4.6rem)] leading-[0.9]">{Math.round(Math.abs(speed))}</span>
        <span className="text-[clamp(0.55rem,1.5vh,0.75rem)] font-semibold uppercase tracking-widest text-mute">{units === "mph" ? "mph" : "km/h"}</span>
      </div>
      <div className="absolute bottom-[4%] left-1/2 grid aspect-square w-[20%] -translate-x-1/2 place-items-center rounded-[4px] border border-line-hi bg-black/70">
        <span className="tach-gear num text-[clamp(1.4rem,4.6vh,2.4rem)] leading-none transition-colors duration-100">{gear}</span>
      </div>
    </div>
  );
}

type MiniHandle = { draw(cars: readonly MiniCar[]): void };

const VIEW = 520;

export function Minimap({ outline, ref }: { outline?: ArrayLike<number>; ref?: Ref<MiniHandle> }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const path = useRef<Path2D | null>(null);

  useEffect(() => {
    if (!outline || outline.length < 4) return void (path.current = null);
    const p = new Path2D();
    p.moveTo(outline[0], outline[1]);
    for (let i = 2; i < outline.length; i += 2) p.lineTo(outline[i], outline[i + 1]);
    p.closePath();
    path.current = p;
  }, [outline]);

  useImperativeHandle(ref, () => ({
    draw(cars) {
      const c = cv.current;
      if (!c) return;
      const w = c.clientWidth;
      const px = Math.round(w * Math.min(2, devicePixelRatio));
      if (c.width !== px) c.width = c.height = px;
      const g = c.getContext("2d")!;
      const me = cars.find((x) => x.me) ?? cars[0];
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, px, px);
      if (!me) return;
      const k = px / VIEW;
      g.translate(px / 2, px / 2);
      g.rotate(me.yaw - Math.PI);
      g.scale(k, k);
      g.translate(-me.x, -me.z);
      if (path.current) {
        g.lineJoin = g.lineCap = "round";
        g.strokeStyle = "rgba(255,255,255,0.16)";
        g.lineWidth = 26;
        g.stroke(path.current);
        g.strokeStyle = "rgba(255,255,255,0.9)";
        g.lineWidth = 7;
        g.stroke(path.current);
      }
      const r = VIEW / 40;
      for (const o of cars) {
        if (o === me) continue;
        g.beginPath();
        g.arc(o.x, o.z, r, 0, Math.PI * 2);
        g.fillStyle = o.color;
        g.fill();
        g.lineWidth = r * 0.4;
        g.strokeStyle = "#000";
        g.stroke();
      }
    },
  }));

  return (
    <div className="relative aspect-square w-[clamp(7.5rem,26vh,13rem)] overflow-hidden rounded-full border border-line-hi bg-black/45 backdrop-blur-md">
      <canvas ref={cv} className="absolute inset-0 h-full w-full" />
      <svg viewBox="0 0 24 24" className="absolute left-1/2 top-1/2 h-[14%] w-[14%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_4px_rgb(0_0_0)]" aria-hidden>
        <path d="M12 2l8 19-8-5-8 5z" fill="var(--color-hot)" stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="absolute inset-0 rounded-full shadow-[inset_0_0_1.5rem_rgb(0_0_0/0.7)]" />
    </div>
  );
}

const HINT = [
  { icon: <Gas />, keys: <Key>W</Key>, pad: <Pad b="RT" /> },
  { icon: <Brake />, keys: <Key>S</Key>, pad: <Pad b="LT" /> },
  { icon: <Wheel />, keys: <><Key>A</Key><Key>D</Key></>, pad: <Pad b="LS" /> },
  { icon: <Handbrake />, keys: <Key wide>Space</Key>, pad: <Pad b="A" c="#3ddc84" /> },
  { icon: <Rewind />, keys: <Key>R</Key>, pad: <Pad b="Y" c="#ffc53d" /> },
];

// First race only: the core controls for the current device, then it fades.
export function ControlHint({ device }: { device: Device }) {
  return (
    <div className={cx("pointer-events-none absolute inset-x-0 flex justify-center [animation:pop_4s_var(--ease-out)_both]", device === "touch" ? "top-[14%]" : "bottom-[max(1.5rem,env(safe-area-inset-bottom))]")}>
      {device === "touch" ? (
        <div className="w-[min(10rem,30vw)] opacity-90">
          <TouchDiagram steer="slider" />
        </div>
      ) : (
        <div className="glass flex gap-6 rounded-[4px] px-5 py-3">
          {HINT.map((h, i) => (
            <span key={i} className="flex items-center gap-2">
              <span className="text-2xl text-white/90">{h.icon}</span>
              <span className="flex gap-1">{device === "pad" ? h.pad : h.keys}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
