"use client";

import { useRef, useState, type ReactNode } from "react";
import type { CameraMode, Device, Difficulty, HintMode, Quality, Settings } from "./contracts";
import { DIFFICULTY, QUALITY } from "./contracts";
import { SFX_ATTRIBUTION } from "./audio-samples";
import { ControlsMap } from "./ui-controls-map";
import { Glyph, Hints, type Act, type PadFamily } from "./ui-glyphs";
import { Picker, Range, SectionTitle, Toggle, cx } from "./ui-kit";
import { useNavRoot } from "./ui-nav";

const CAMS: { v: CameraMode; label: string; hint: string }[] = [
  { v: "broadcast", label: "Broadcast", hint: "Classic sideline view, pans with the ball" },
  { v: "broadcastHigh", label: "High", hint: "Higher and wider, see every cut" },
  { v: "baseline", label: "Baseline", hint: "Behind the offense, looking at the rim" },
  { v: "follow", label: "Follow", hint: "Low behind your player" },
  { v: "skycam", label: "Sky cam", hint: "Overhead cable cam" },
];
const QUALS = (Object.keys(QUALITY) as Quality[]).map((v) => ({ v, label: QUALITY[v].label, hint: v === "ultra" ? "Desktop GPUs" : v === "low" ? "Older laptops" : "" }));
const DIFFS = (Object.keys(DIFFICULTY) as Difficulty[]).map((v) => ({ v, label: DIFFICULTY[v].label }));
const HINTS: { v: HintMode; label: string; hint: string }[] = [
  { v: "always", label: "Always", hint: "Coach prompts and the action bar every game" },
  { v: "first", label: "First games", hint: "Coach prompts for your first three games" },
  { v: "off", label: "Off", hint: "No prompts, no action bar" },
];
const QTRS = [1, 2, 3, 4, 5, 6, 8, 10, 12].map((v) => ({ v, label: `${v} min` }));

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="eyebrow flex items-center gap-2">
        <span className="h-2 w-2 rotate-45 bg-hot" /> {title}
      </div>
      {children}
    </div>
  );
}

export function SettingsPanel({ value, onChange, inGame }: { value: Settings; onChange: (s: Settings) => void; inGame?: boolean }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5">
      <Group title="Gameplay">
        <Picker label="Difficulty" value={value.difficulty} options={DIFFS} onChange={(v) => set("difficulty", v)} />
        <Picker label="Quarter length" sub={inGame ? "Applies from the next quarter" : undefined} value={value.quarterMinutes} options={QTRS} onChange={(v) => set("quarterMinutes", v)} />
        <Picker label="Button hints" value={value.hints ?? "first"} options={HINTS} onChange={(v) => set("hints", v)} />
        <Toggle label="Shot meter" sub="Off: timing still counts, only the grade shows" on={value.shotMeter} onChange={(v) => set("shotMeter", v)} />
        <Toggle label="Fatigue" sub="Stamina drains and recovers on the bench" on={value.fatigue} onChange={(v) => set("fatigue", v)} />
        <Toggle label="All fouls" sub="Off: only shooting fouls are called" on={value.fouls} onChange={(v) => set("fouls", v)} />
        <Toggle label="Auto substitutions" sub="Coach manages your rotation" on={value.autoSubs} onChange={(v) => set("autoSubs", v)} />
      </Group>
      <div className="flex flex-col gap-5">
        <Group title="Presentation">
          <Picker label="Camera" value={value.camera} options={CAMS} onChange={(v) => set("camera", v)} wrap />
          <Picker label="Graphics" value={value.quality} options={QUALS} onChange={(v) => set("quality", v)} />
          <Toggle label="Player name tag" on={value.playerNames} onChange={(v) => set("playerNames", v)} />
          <Toggle label="Instant replays" on={value.replays ?? true} onChange={(v) => set("replays", v)} />
          <Toggle label="Controller vibration" on={value.vibration} onChange={(v) => set("vibration", v)} />
        </Group>
        <Group title="Audio">
          <Range label="Master" value={value.master} onChange={(v) => set("master", v)} />
          <Range label="Music" value={value.music} onChange={(v) => set("music", v)} />
          <Range label="Crowd" value={value.crowd} onChange={(v) => set("crowd", v)} />
          <Range label="Effects" value={value.sfx} onChange={(v) => set("sfx", v)} />
          <details className="mt-1 text-[11px] leading-snug text-white/50">
            <summary className="cursor-pointer select-none text-white/60 hover:text-white">Sound credits</summary>
            <ul className="mt-1.5 flex flex-col gap-1">
              {SFX_ATTRIBUTION.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </Group>
      </div>
    </div>
  );
}

type Row = { act: Act; label: string; note: string };
const OFFENSE: Row[] = [
  { act: "move", label: "Move", note: "Steer the ball handler" },
  { act: "sprint", label: "Sprint", note: "Turbo. Drains stamina" },
  { act: "shoot", label: "Shoot", note: "Hold, release at the gold notch. Drive + hold: layup or dunk" },
  { act: "pass", label: "Pass", note: "Aim with the move stick" },
  { act: "bounce", label: "Bounce pass", note: "Safer through traffic" },
  { act: "lob", label: "Lob / alley-oop", note: "Throw it up to a cutter" },
  { act: "dribble", label: "Dribble moves", note: "Flick: crossover, behind back, spin, step-back" },
  { act: "icon", label: "Icon pass", note: "Hold, then pick a teammate's icon" },
  { act: "screen", label: "Call screen", note: "Bring a big up for a pick" },
  { act: "post", label: "Post up", note: "Back your man down" },
];
const DEFENSE: Row[] = [
  { act: "move", label: "Move", note: "Slide with your man" },
  { act: "switch", label: "Switch player", note: "Take the defender nearest the ball" },
  { act: "steal", label: "Steal", note: "Reach. Mistimed reaches foul" },
  { act: "block", label: "Block / contest", note: "Jump at the release; also rebounds" },
  { act: "charge", label: "Take charge", note: "Plant your feet in his path" },
  { act: "intense", label: "Intense D", note: "Lower stance, quicker feet" },
  { act: "handsUp", label: "Hands up", note: "Arms up without jumping" },
];
const GENERAL: Row[] = [
  { act: "pause", label: "Pause", note: "Box score, subs, timeouts" },
  { act: "camera", label: "Camera", note: "Cycle camera angles" },
];

export function ControlsPanel({ device, family }: { device: Device; family: PadFamily }) {
  const [view, setView] = useState<Device>(device);
  const col = (title: string, rows: Row[]) => (
    <div className="flex flex-col gap-1.5">
      <div className="eyebrow mb-1 flex items-center gap-2">
        <span className="h-2 w-2 rotate-45 bg-hot" /> {title}
      </div>
      {rows.map((r) => (
        <div key={title + r.label} className="tile flex min-h-[3.1rem] items-center gap-3 rounded-[3px] px-3 py-1.5">
          <span className="flex w-[6.6rem] flex-none justify-center text-[1.05rem]">
            <Glyph act={r.act} device={view} family={family} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[0.95rem] font-semibold">{r.label}</span>
            <span className="truncate text-[0.72rem] text-mute">{r.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ControlsMap device={device} family={family} view={view} onView={setView} />
      <div className="eyebrow mt-2 flex items-center gap-2">
        <span className="h-2 w-2 rotate-45 bg-hot" /> Full list
      </div>
      <div className="grid grid-cols-2 gap-6">
        {col("Offense", OFFENSE)}
        <div className="flex flex-col gap-5">
          {col("Defense", DEFENSE)}
          {col("Anytime", GENERAL)}
        </div>
      </div>
    </div>
  );
}

/** Full-screen wrapper used from the main menu. */
export function OverlayScreen({ title, eyebrow, onBack, device, family, children, active = true }: { title: string; eyebrow: string; onBack: () => void; device: Device; family: PadFamily; children: ReactNode; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useNavRoot(ref, { back: onBack, active });
  return (
    <div ref={ref} className="absolute inset-0">
      <div className="absolute inset-0 bg-night/80 backdrop-blur-md" />
      <div className="safe absolute inset-0 flex flex-col gap-5">
        <SectionTitle eyebrow={eyebrow} title={title} className="fade" />
        <div className={cx("noscroll rise min-h-0 flex-1 overflow-y-auto pb-2")}>{children}</div>
        <div className="flex items-center justify-between">
          <Hints items={[["ok", "Change"], ["navigate", "Move"], ["back", "Done"]]} device={device} family={family} />
          <button type="button" onClick={onBack} className="nav tile ttl h-12 rounded-[3px] px-8 text-[1.4rem]">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
