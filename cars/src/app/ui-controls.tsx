"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Device } from "./contracts";
import { Back, Brake, Camera, Fwd, Gamepad, Gas, Gears, Handbrake, Keyboard, Pause, Rewind, Tilt, Touch, Wheel } from "./ui-icons";
import { Key, Segmented, cx } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import type { SteerMode } from "./ui-touch";

export const Pad = ({ b, c }: { b: string; c?: string }) => (
  <span className="num inline-grid h-8 min-w-8 place-items-center rounded-full border border-line-hi bg-white/5 px-1.5 text-base not-italic" style={{ color: c }}>
    {b}
  </span>
);
const PAD_A = "#3ddc84";
const PAD_B = "#ff4d4d";
const PAD_X = "#4cc9ff";
const PAD_Y = "#ffc53d";

const Arrow = ({ d }: { d: "l" | "r" | "u" | "d" }) => (
  <span className="text-[0.8em] text-mute">{d === "l" ? "◀" : d === "r" ? "▶" : d === "u" ? "▲" : "▼"}</span>
);

export function ShiftKeys({ device }: { device: Device }) {
  if (device === "pad")
    return (
      <>
        <span className="flex items-center gap-1"><Arrow d="u" /><Pad b="B" c={PAD_B} /></span>
        <span className="flex items-center gap-1"><Arrow d="d" /><Pad b="X" c={PAD_X} /></span>
      </>
    );
  if (device === "touch")
    return (
      <>
        <span className="flex items-center gap-1"><Arrow d="u" /><Key>+</Key></span>
        <span className="flex items-center gap-1"><Arrow d="d" /><Key>−</Key></span>
      </>
    );
  return (
    <>
      <span className="flex items-center gap-1"><Arrow d="u" /><Key>E</Key></span>
      <span className="flex items-center gap-1"><Arrow d="d" /><Key>Q</Key></span>
    </>
  );
}

type Bind = { icon: ReactNode; label: string; keys: ReactNode; pad: ReactNode };
const BINDS: Bind[] = [
  { icon: <Gas />, label: "Gas", keys: <><Key>W</Key><Key>↑</Key></>, pad: <Pad b="RT" /> },
  { icon: <Brake />, label: "Brake", keys: <><Key>S</Key><Key>↓</Key></>, pad: <Pad b="LT" /> },
  { icon: <Wheel />, label: "Steer", keys: <><Key>A</Key><Key>D</Key></>, pad: <Pad b="LS" /> },
  { icon: <Handbrake />, label: "Handbrake", keys: <Key wide>Space</Key>, pad: <Pad b="A" c={PAD_A} /> },
  { icon: <Gears />, label: "Shift", keys: <ShiftKeys device="keys" />, pad: <ShiftKeys device="pad" /> },
  { icon: <Camera />, label: "Camera", keys: <Key>C</Key>, pad: <Pad b="RB" /> },
  { icon: <Rewind />, label: "Rewind", keys: <Key>R</Key>, pad: <Pad b="Y" c={PAD_Y} /> },
  { icon: <Pause />, label: "Pause", keys: <Key wide>Esc</Key>, pad: <Pad b="≡" /> },
];

export function TouchDiagram({ steer, manual }: { steer: SteerMode; manual?: boolean }) {
  return (
    <div className="relative aspect-[2.2/1] w-full max-w-[30rem] self-center rounded-[10px] border-2 border-line-hi bg-black/30">
      <div className="absolute left-[8%] top-[60%] flex w-[30%] items-center text-mute">
        {steer === "slider" ? (
          <>
            <Back className="text-lg" />
            <span className="h-2 flex-1 rounded-full bg-line-hi" />
            <span className="skew -mx-[40%] h-6 w-4 rounded-[2px] bg-hot" />
            <span className="h-2 flex-1 rounded-full bg-line-hi" />
            <Fwd className="text-lg" />
          </>
        ) : (
          <Tilt className="mx-auto text-4xl text-white" />
        )}
      </div>
      <div className="absolute left-1/2 top-[8%] flex -translate-x-1/2 gap-1.5 text-sm text-mute">
        <Camera />
        <Rewind />
        <Pause />
      </div>
      {manual && (
        <div className="num absolute right-[6%] top-[12%] flex gap-1 text-sm">
          <span className="grid h-6 w-6 place-items-center rounded-full border border-line-hi">−</span>
          <span className="grid h-6 w-6 place-items-center rounded-full border border-line-hi">+</span>
        </div>
      )}
      <div className="absolute bottom-[10%] right-[6%] flex items-end gap-2">
        <div className="flex flex-col items-center gap-1.5">
          <span className="grid h-8 w-8 place-items-center rounded-full border border-line-hi text-base">
            <Handbrake />
          </span>
          <span className="grid h-11 w-12 place-items-center rounded-[4px] border border-line-hi text-xl">
            <Brake />
          </span>
        </div>
        <span className="grid h-24 w-12 place-items-center rounded-[4px] border border-hot/70 text-xl text-hot">
          <Gas />
        </span>
      </div>
    </div>
  );
}

// Top view, nose up. steer: front wheel angle in degrees.
function TopCar({ x, y, rot, steer, brake, gas }: { x: number; y: number; rot: number; steer: number; brake?: boolean; gas?: boolean }) {
  const wheel = (wx: number, wy: number, a: number) => <rect x={wx - 1.6} y={wy - 3} width="3.2" height="6" rx="1" transform={`rotate(${a} ${wx} ${wy})`} fill="white" />;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      {wheel(-7, -8, steer)}
      {wheel(7, -8, steer)}
      {wheel(-7, 8, 0)}
      {wheel(7, 8, 0)}
      <rect x="-6" y="-14" width="12" height="28" rx="4" fill="var(--color-hot)" />
      <rect x="-4.5" y="-6" width="9" height="8" rx="1.5" fill="rgb(0 0 0 / 0.55)" />
      {brake && <rect x="-5.5" y="12" width="11" height="2.5" rx="1" fill="#ff3b30" style={{ filter: "drop-shadow(0 0 2px #ff3b30)" }} />}
      {gas && (
        <>
          <circle cx="-9" cy="20" r="4" fill="white" opacity="0.18" />
          <circle cx="9" cy="21" r="5" fill="white" opacity="0.14" />
        </>
      )}
    </g>
  );
}

const Or = () => <span className="text-xs text-mute">/</span>;
const Road = () => (
  <>
    <path d="M62 108 C62 62 50 34 -6 24" stroke="#2b3038" strokeWidth="36" fill="none" />
    <path d="M62 108 C62 62 50 34 -6 24" stroke="white" strokeWidth="1" strokeDasharray="5 6" opacity="0.35" fill="none" />
  </>
);

// A left corner: handbrake or brake while you turn in, then hold the gas and steer the other way.
export function DriftGuide({ device }: { device: Device }) {
  const k = device === "pad";
  const t = device === "touch";
  const brake = t ? null : k ? <Pad b="LT" /> : <Key>S</Key>;
  const hand = t ? null : k ? <Pad b="A" c={PAD_A} /> : <Key wide>Space</Key>;
  const left = t ? <Arrow d="l" /> : k ? <><Arrow d="l" /><Pad b="LS" /></> : <Key>A</Key>;
  const right = t ? <Arrow d="r" /> : k ? <><Pad b="LS" /><Arrow d="r" /></> : <Key>D</Key>;
  const gas = t ? null : k ? <Pad b="RT" /> : <Key>W</Key>;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2" aria-label="How to drift">
      <Step
        n={1}
        rows={[
          <><Handbrake className="text-xl" />{hand}<Or /><Brake className="text-xl" />{brake}</>,
          <><Wheel className="text-xl" />{left}</>,
        ]}
      >
        <Road />
        <path d="M62 92 C62 70 58 56 44 44" stroke="var(--color-hot)" strokeWidth="1.6" strokeDasharray="2 3" fill="none" />
        <TopCar x={62} y={74} rot={-6} steer={-30} brake />
      </Step>
      <Fwd className="self-center text-2xl text-hot" />
      <Step
        n={2}
        rows={[
          <><Gas className="text-xl text-hot" />{gas}</>,
          <><Wheel className="text-xl" />{right}</>,
        ]}
      >
        <Road />
        <path d="M70 76 q4 8 8 16 M58 80 q2 8 4 14" stroke="black" strokeWidth="2.4" opacity="0.6" fill="none" />
        <TopCar x={56} y={56} rot={-55} steer={32} gas />
      </Step>
    </div>
  );
}

function Step({ n, rows, children }: { n: number; rows: ReactNode[]; children: ReactNode }) {
  return (
    <div className="glass flex min-w-0 items-center gap-3 overflow-hidden rounded-[3px] p-2">
      <span className="num self-start text-2xl leading-none text-hot">{n}</span>
      <svg viewBox="0 0 100 100" className="h-[clamp(4.5rem,17vh,7.5rem)] w-[clamp(4.5rem,17vh,7.5rem)] shrink-0 rounded-[2px] bg-[#3b5b33]/40" aria-hidden>
        {children}
      </svg>
      <span className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <span key={i} className="flex items-center gap-1.5 text-mute">{r}</span>
        ))}
      </span>
    </div>
  );
}

export function ControlsBody({ device, steer, manual, onSteer }: { device: Device; steer: SteerMode; manual?: boolean; onSteer?: (s: SteerMode) => void }) {
  const [d, setD] = useState<Device>(device);
  return (
    <>
      <Segmented
        label="Device"
        value={d}
        onChange={setD}
        options={[
          { v: "keys", node: <Keyboard className="text-xl" />, title: "Keyboard" },
          { v: "pad", node: <Gamepad className="text-xl" />, title: "Gamepad" },
          { v: "touch", node: <Touch className="text-xl" />, title: "Touch" },
        ]}
      />
      {d === "touch" ? (
        <>
          <TouchDiagram steer={steer} manual={manual} />
          {onSteer && (
            <Segmented
              label="Steering"
              value={steer}
              onChange={onSteer}
              options={[
                { v: "slider", node: <span className="ttl">Slider</span>, title: "Slider" },
                { v: "tilt", node: <><Tilt className="text-xl" /> <span className="ttl">Tilt</span></>, title: "Tilt" },
              ]}
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-x-6">
          {BINDS.map((b) => (
            <div key={b.label} title={b.label} className="flex h-[clamp(2.25rem,6.5vh,2.75rem)] items-center gap-3 border-b border-line">
              <span className="w-6 text-xl text-mute">{b.icon}</span>
              <span className="ml-auto flex items-center gap-1.5">{d === "pad" ? b.pad : b.keys}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1 text-mute">
        <span className="ttl text-lg text-white">Drift</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div data-nav tabIndex={0} aria-label="Drift" className="rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-hot">
        <DriftGuide device={d} />
      </div>
    </>
  );
}

export function ControlsScreen({ device, steer, manual, onClose }: { device: Device; steer: SteerMode; manual?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onClose);
  return (
    <div ref={ref} className="safe fade absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-md">
      <div className="glass rise noscroll flex max-h-full w-full max-w-[52rem] flex-col gap-3 overflow-y-auto rounded-[4px] p-[clamp(0.75rem,2.5vh,1.25rem)]">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Back" title="Back" onClick={onClose} data-autofocus className="nav grid h-11 w-11 place-items-center rounded-[3px] border border-transparent text-xl">
            <Back />
          </button>
          <h2 className="ttl flex items-center gap-2 text-2xl leading-none text-mute">
            <Gamepad />
            <span className="text-white">Controls</span>
          </h2>
        </div>
        <ControlsBody device={device} steer={steer} manual={manual} />
      </div>
    </div>
  );
}

const HINT: { icon: ReactNode; keys: ReactNode; pad: ReactNode }[] = [
  { icon: <Gas />, keys: <Key>W</Key>, pad: <Pad b="RT" /> },
  { icon: <Brake />, keys: <Key>S</Key>, pad: <Pad b="LT" /> },
  { icon: <Wheel />, keys: <><Key>A</Key><Key>D</Key></>, pad: <Pad b="LS" /> },
  { icon: <Handbrake />, keys: <Key wide>Space</Key>, pad: <Pad b="A" c={PAD_A} /> },
];

export function ControlHint({ device, manual }: { device: Device; manual?: boolean }) {
  return (
    <div className={cx("pointer-events-none absolute inset-x-0 flex justify-center [animation:pop_7.5s_var(--ease-out)_both]", device === "touch" ? "top-[16%]" : "bottom-[max(1.5rem,env(safe-area-inset-bottom))]")}>
      {device === "touch" ? (
        <div className="w-[min(16rem,36vw)] opacity-95">
          <TouchDiagram steer="slider" manual={manual} />
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
