"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Assists, CamMode, Device, Quality } from "./contracts";
import { ControlsBody } from "./ui-controls";
import { Assist, Back, Bolt, Camera, Disc, Gamepad, Gears, Monitor, Music, Speed, Volume, Wheel } from "./ui-icons";
import { Range, Segmented, Toggle, cx } from "./ui-kit";
import { useNavRoot } from "./ui-nav";
import type { SteerMode } from "./ui-touch";

export type Settings = { quality: Quality; master: number; music: number; units: "kmh" | "mph"; assists: Assists; camera: CamMode; steer: SteerMode };

export const DEFAULT_SETTINGS: Settings = {
  quality: "high",
  master: 0.8,
  music: 0.6,
  units: "kmh",
  assists: { abs: true, tcs: true, stability: true, autoGear: true, steer: true, blip: true },
  camera: "chase",
  steer: "slider",
};

// Presets leave the gearbox alone: transmission is its own choice.
export type Preset = "easy" | "normal" | "pro";
type Helps = Pick<Assists, "abs" | "tcs" | "stability" | "steer">;
export const ASSIST_PRESETS: Record<Preset, Helps> = {
  easy: { abs: true, tcs: true, stability: true, steer: true },
  normal: { abs: true, tcs: true, stability: false, steer: true },
  pro: { abs: false, tcs: false, stability: false, steer: false },
};
export function presetOf(a: Assists): Preset | "custom" {
  for (const [k, p] of Object.entries(ASSIST_PRESETS) as [Preset, Helps][])
    if ((["abs", "tcs", "stability", "steer"] as const).every((f) => p[f] === a[f])) return k;
  return "custom";
}
export const withPreset = (a: Assists, p: Preset): Assists => ({ ...a, ...ASSIST_PRESETS[p] });
export const CAMS: readonly CamMode[] = ["chase", "far", "hood", "bumper", "cockpit"];

export function Transmission({ manual, onChange, className }: { manual: boolean; onChange: (manual: boolean) => void; className?: string }) {
  return (
    <div className={className}>
      <Segmented
        label="Transmission"
        value={manual ? "m" : "a"}
        onChange={(v) => onChange(v === "m")}
        options={[
          { v: "a", node: <><Gears /> <span className="ttl text-xl">Auto</span></>, title: "Automatic gears" },
          { v: "m", node: <><Gears /> <span className="ttl text-xl">Manual</span></>, title: "Manual gears" },
        ]}
      />
    </div>
  );
}

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
            <>
              <Segmented
                label="Preset"
                value={presetOf(value.assists)}
                onChange={(p) => p !== "custom" && set({ assists: withPreset(value.assists, p) })}
                options={(["easy", "normal", "pro"] as const).map((p) => ({ v: p, node: <span className="ttl text-xl">{p}</span> }))}
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Transmission manual={!value.assists.autoGear} onChange={(m) => assist("autoGear", !m)} />
                <Toggle label="Rev match" icon={<Gears />} on={value.assists.blip !== false} onChange={(v) => assist("blip", v)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Toggle label="ABS" icon={<Disc />} on={value.assists.abs} onChange={(v) => assist("abs", v)} />
                <Toggle label="TCS" icon={<Bolt />} on={value.assists.tcs} onChange={(v) => assist("tcs", v)} />
                <Toggle label="Stability" icon={<Assist />} on={value.assists.stability} onChange={(v) => assist("stability", v)} />
                <Toggle label="Steer" icon={<Wheel />} on={value.assists.steer} onChange={(v) => assist("steer", v)} />
              </div>
            </>
          )}
          {tab === "camera" && (
            <div className="grid grid-cols-5 gap-2">
              {CAMS.map((m) => (
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
          {tab === "controls" && <ControlsBody device={device} steer={value.steer} manual={!value.assists.autoGear} onSteer={(s) => set({ steer: s })} />}
        </div>
      </div>
    </div>
  );
}

const EYE: Record<CamMode, [number, number]> = { chase: [6, 9], far: [2, 4], hood: [27, 15], bumper: [41, 20], cockpit: [22, 14] };

export function CamGlyph({ mode, className = "h-[70%] w-[80%]" }: { mode: CamMode; className?: string }) {
  const [x, y] = EYE[mode];
  return (
    <svg viewBox="0 0 48 28" className={className} aria-hidden>
      <path d="M8 22v-4l6-1 7-6h12l7 6 4 1v4z" fill="currentColor" opacity="0.35" />
      <circle cx="15" cy="22.5" r="3" fill="currentColor" opacity="0.6" />
      <circle cx="37" cy="22.5" r="3" fill="currentColor" opacity="0.6" />
      <path d={`M${x} ${y}L${x + 14} ${y + 3}M${x} ${y}L${x + 14} ${y - 3}`} stroke="var(--color-hot)" strokeWidth="1" opacity="0.7" />
      <circle cx={x} cy={y} r="2.3" fill="var(--color-hot)" />
    </svg>
  );
}
