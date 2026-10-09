"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Assists, CamMode, Device, Quality } from "./contracts";
import { Assist, Back, Bolt, Brake, Camera, Disc, Fwd, Gamepad, Gas, Gears, Handbrake, Keyboard, Monitor, Music, Pause, Rewind, Slider, Speed, Tilt, Touch, Volume, Wheel } from "./ui-icons";
import { Key, Range, Segmented, Toggle, cx } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import type { SteerMode } from "./ui-touch";

export type Settings = { quality: Quality; master: number; music: number; units: "kmh" | "mph"; assists: Assists; camera: CamMode; steer: SteerMode };

export const DEFAULT_SETTINGS: Settings = {
  quality: "high",
  master: 0.8,
  music: 0.6,
  units: "kmh",
  assists: { abs: true, tcs: true, stability: true, autoGear: true, steer: true },
  camera: "chase",
  steer: "slider",
};

type Tab = "gfx" | "audio" | "assist" | "camera" | "controls";
const TABS: { id: Tab; icon: ReactNode; label: string }[] = [
  { id: "gfx", icon: <Monitor />, label: "Graphics" },
  { id: "audio", icon: <Volume />, label: "Sound" },
  { id: "assist", icon: <Assist />, label: "Assists" },
  { id: "camera", icon: <Camera />, label: "Camera" },
  { id: "controls", icon: <Gamepad />, label: "Controls" },
];

const PRESETS: { q: Quality; label: string; sub?: string }[] = [
  { q: "low", label: "Low", sub: "Phones" },
  { q: "medium", label: "Medium" },
  { q: "high", label: "High" },
  { q: "ultra", label: "Ultra", sub: "Needs a strong GPU" },
];

export function SettingsPanel({ value, onChange, onClose, device = "keys", tab: initial = "gfx" }: { value: Settings; onChange: (s: Settings) => void; onClose: () => void; device?: Device; tab?: Tab }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, onClose);
  const [tab, setTab] = useState<Tab>(initial);
  const set = (p: Partial<Settings>) => onChange({ ...value, ...p });
  const assist = (k: keyof Assists, v: boolean) => set({ assists: { ...value.assists, [k]: v } });

  return (
    <div ref={ref} className="safe fade absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-md">
      <div className="glass rise flex max-h-full min-h-[min(22rem,100%)] w-full max-w-[52rem] overflow-hidden rounded-[4px]">
        <div className="flex shrink-0 flex-col gap-1 border-r border-line p-2">
          <button type="button" aria-label="Back" title="Back" onClick={onClose} className="nav mb-2 grid h-12 w-12 place-items-center rounded-[3px] border border-transparent text-xl">
            <Back />
          </button>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              title={t.label}
              data-autofocus={t.id === tab || undefined}
              onClick={() => setTab(t.id)}
              onFocus={() => setTab(t.id)}
              className={cx("nav grid h-12 w-12 place-items-center rounded-[3px] border border-transparent text-xl", t.id === tab ? "bg-white text-black hover:bg-white" : "text-mute")}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div key={tab} className="fade noscroll flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-[clamp(0.75rem,2.5vh,1.25rem)]">
          <h2 className="ttl flex items-center gap-2 text-2xl leading-none text-mute">
            {TABS.find((t) => t.id === tab)?.icon}
            <span className="text-white">{TABS.find((t) => t.id === tab)?.label}</span>
          </h2>
          {tab === "gfx" && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((p, i) => (
                  <button
                    key={p.q}
                    type="button"
                    onClick={() => set({ quality: p.q })}
                    data-on={p.q === value.quality ? "1" : undefined}
                    className={cx("nav glass flex h-[clamp(6rem,22vh,8.5rem)] flex-col justify-between rounded-[3px] p-3 text-left", p.q !== value.quality && "text-mute")}
                  >
                    <span className="flex h-6 items-end gap-[3px]">
                      {[0, 1, 2, 3].map((j) => (
                        <span key={j} className={cx("skew w-2 rounded-[1px]", j <= i ? (p.q === value.quality ? "bg-hot" : "bg-white/70") : "bg-line")} style={{ height: `${30 + j * 23}%` }} />
                      ))}
                    </span>
                    <span>
                      <span className="ttl block text-2xl leading-none text-white">{p.label}</span>
                      <span className="mt-1 block min-h-[1.2em] text-xs leading-tight text-mute">{p.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
              <Segmented
                label="Units"
                value={value.units}
                onChange={(u) => set({ units: u })}
                options={[
                  { v: "kmh", node: <><Speed /> <span className="num">km/h</span></> },
                  { v: "mph", node: <><Speed /> <span className="num">mph</span></> },
                ]}
              />
            </>
          )}
          {tab === "audio" && (
            <>
              <Range label="Master" icon={<Volume />} value={value.master} onChange={(v) => set({ master: v })} />
              <Range label="Music" icon={<Music />} value={value.music} onChange={(v) => set({ music: v })} />
            </>
          )}
          {tab === "assist" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Toggle label="ABS" icon={<Disc />} on={value.assists.abs} onChange={(v) => assist("abs", v)} />
              <Toggle label="TCS" icon={<Bolt />} on={value.assists.tcs} onChange={(v) => assist("tcs", v)} />
              <Toggle label="Stability" icon={<Assist />} on={value.assists.stability} onChange={(v) => assist("stability", v)} />
              <Toggle label="Auto" icon={<Gears />} on={value.assists.autoGear} onChange={(v) => assist("autoGear", v)} />
              <Toggle label="Steer" icon={<Wheel />} on={value.assists.steer} onChange={(v) => assist("steer", v)} />
            </div>
          )}
          {tab === "camera" && (
            <div className="grid grid-cols-5 gap-2">
              {(["chase", "far", "hood", "bumper", "cockpit"] as CamMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={m}
                  title={m}
                  data-on={m === value.camera ? "1" : undefined}
                  onClick={() => set({ camera: m })}
                  className={cx("nav glass grid aspect-[4/3] place-items-center rounded-[3px]", m === value.camera ? "text-white" : "text-mute")}
                >
                  <CamGlyph mode={m} />
                </button>
              ))}
            </div>
          )}
          {tab === "controls" && <ControlsMap device={device} steer={value.steer} onSteer={(s) => set({ steer: s })} />}
        </div>
      </div>
    </div>
  );
}

const EYE: Record<CamMode, [number, number]> = { chase: [6, 9], far: [2, 4], hood: [27, 15], bumper: [41, 20], cockpit: [22, 14] };

function CamGlyph({ mode }: { mode: CamMode }) {
  const [x, y] = EYE[mode];
  return (
    <svg viewBox="0 0 48 28" className="h-[70%] w-[80%]" aria-hidden>
      <path d="M8 22v-4l6-1 7-6h12l7 6 4 1v4z" fill="currentColor" opacity="0.35" />
      <circle cx="15" cy="22.5" r="3" fill="currentColor" opacity="0.6" />
      <circle cx="37" cy="22.5" r="3" fill="currentColor" opacity="0.6" />
      <path d={`M${x} ${y}L${x + 14} ${y + 3}M${x} ${y}L${x + 14} ${y - 3}`} stroke="var(--color-hot)" strokeWidth="1" opacity="0.7" />
      <circle cx={x} cy={y} r="2.3" fill="var(--color-hot)" />
    </svg>
  );
}

type Bind = { icon: ReactNode; keys: ReactNode; pad: ReactNode };
const Pad = ({ b, c }: { b: string; c?: string }) => (
  <span className="num inline-grid h-8 min-w-8 place-items-center rounded-full border border-line-hi bg-white/5 px-1.5 text-base not-italic" style={{ color: c }}>
    {b}
  </span>
);
const BINDS: Bind[] = [
  { icon: <Gas />, keys: <><Key>W</Key><Key>↑</Key></>, pad: <Pad b="RT" /> },
  { icon: <Brake />, keys: <><Key>S</Key><Key>↓</Key></>, pad: <Pad b="LT" /> },
  { icon: <Wheel />, keys: <><Key>A</Key><Key>D</Key></>, pad: <Pad b="LS" /> },
  { icon: <Handbrake />, keys: <Key wide>Space</Key>, pad: <Pad b="A" c="#3ddc84" /> },
  { icon: <Gears />, keys: <><Key>Q</Key><Key>E</Key></>, pad: <><Pad b="X" c="#4cc9ff" /><Pad b="B" c="#ff4d4d" /></> },
  { icon: <Camera />, keys: <Key>C</Key>, pad: <Pad b="⧉" /> },
  { icon: <Rewind />, keys: <Key>R</Key>, pad: <Pad b="Y" c="#ffc53d" /> },
  { icon: <Pause />, keys: <Key wide>Esc</Key>, pad: <Pad b="≡" /> },
];

function ControlsMap({ device, steer, onSteer }: { device: Device; steer: SteerMode; onSteer: (s: SteerMode) => void }) {
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
          <TouchDiagram steer={steer} />
          <Segmented
            label="Steering"
            value={steer}
            onChange={onSteer}
            options={[
              { v: "slider", node: <Slider className="text-xl" />, title: "Slider" },
              { v: "tilt", node: <Tilt className="text-xl" />, title: "Tilt" },
            ]}
          />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {BINDS.map((b, i) => (
            <div key={i} className="flex h-10 items-center gap-3 border-b border-line">
              <span className="w-6 text-xl text-mute">{b.icon}</span>
              <span className="ml-auto flex gap-1.5">{d === "pad" ? b.pad : b.keys}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TouchDiagram({ steer }: { steer: SteerMode }) {
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
