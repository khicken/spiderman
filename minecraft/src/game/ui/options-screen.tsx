"use client";

import { useState } from "react";
import type { Rules } from "../contracts";
import { Text, useGui } from "./gui";
import { Button, ListArea, Screen, Slider, TextField, onOff, useKeyDown } from "./widgets";
import { playerName, setPlayerNameStored } from "../net/profile";
import { KeyBinds } from "./key-binds";
import { PacksScreen } from "./packs-screen";
import {
  SOUND_CATEGORIES, brightnessLabel, fovEffectsLabel, fovLabel, fpsLabel, guiScaleLabel, pctLabel, sensitivityLabel, volumeLabel,
  type Settings, type SoundCategory,
} from "./settings";

type Item =
  | { kind: "slider"; label: string; value: number; set: (v: number) => void }
  | { kind: "button"; label: string; onClick?: () => void; disabled?: boolean }
  | null;

export interface OptionsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onDone: () => void;
  inGame?: boolean; // blurred world instead of the panorama
  difficulty?: Rules["difficulty"];
  onDifficulty?: (d: Rules["difficulty"]) => void;
  difficultyLocked?: boolean;
}

type Page = "main" | "video" | "sound" | "controls" | "mouse" | "keys" | "chat" | "packs" | "skin";
const TITLES: Record<Page, string> = {
  main: "Options",
  video: "Video Settings",
  sound: "Music & Sound Options",
  controls: "Controls",
  mouse: "Mouse Settings",
  keys: "Key Binds",
  chat: "Chat Settings",
  packs: "Select Resource Packs",
  skin: "Skin Customization",
};
const DIFFS: Rules["difficulty"][] = ["peaceful", "easy", "normal", "hard"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const steps = (v: number, lo: number, hi: number) => Math.round(lo + v * (hi - lo));
const frac = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);
const r2 = (v: number) => Math.round(v * 100) / 100;
const cycle = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length];
const PARTICLES = ["all", "decreased", "minimal"] as const;
const CLOUDS = ["fancy", "fast", "off"] as const;

function isFullscreen() {
  return typeof document !== "undefined" && !!document.fullscreenElement;
}

export function OptionsScreen({ settings: s, onChange, onDone, inGame, difficulty, onDifficulty, difficultyLocked }: OptionsScreenProps) {
  const { width, height } = useGui();
  const [page, setPage] = useState<Page>("main");
  const [, setFs] = useState(0);
  const back = () => setPage(page === "mouse" || page === "keys" ? "controls" : "main");
  const done = () => (page === "main" ? onDone() : back());
  useKeyDown((e) => e.key === "Escape" && page !== "keys" && done());
  const bg = inGame ? "ingame" : "menu";
  const cx = Math.floor(width / 2);

  if (page === "main") {
    const y0 = Math.floor(height / 6 - 12);
    const g = Math.floor(height / 6 + 42);
    const grid: [string, Page | null][] = [
      ["Skin Customization...", "skin"],
      ["Music & Sounds...", "sound"],
      ["Video Settings...", "video"],
      ["Controls...", "controls"],
      ["Language...", null],
      ["Chat Settings...", "chat"],
      ["Resource Packs...", "packs"],
      ["Accessibility Settings...", null],
      ["Telemetry Data...", null],
      ["Credits & Attribution...", null],
    ];
    return (
      <Screen background={bg}>
        <Text text="Options" x={cx} y={15} align="center" />
        <Slider x={cx - 155} y={y0} value={frac(s.fov, 30, 110)} label={fovLabel(s.fov)} onChange={(v) => onChange({ fov: steps(v, 30, 110) })} />
        {difficulty && onDifficulty ? (
          <Button
            x={cx + 5}
            y={y0}
            width={150}
            label={`Difficulty: ${cap(difficulty)}`}
            disabled={difficultyLocked}
            onClick={() => onDifficulty(DIFFS[(DIFFS.indexOf(difficulty) + 1) % 4])}
          />
        ) : (
          <Button x={cx + 5} y={y0} width={150} label="Online..." disabled />
        )}
        {grid.map(([label, to], i) => (
          <Button key={label} x={i % 2 ? cx + 5 : cx - 155} y={g + Math.floor(i / 2) * 24} width={150} label={label} disabled={!to} onClick={() => to && setPage(to)} />
        ))}
        <Button x={cx - 100} y={Math.floor(height / 6 + 168)} label="Done" onClick={onDone} />
      </Screen>
    );
  }

  if (page === "packs") return <PacksScreen onDone={back} background={bg} />;
  if (page === "skin") return <SkinPage background={bg} onDone={back} />;
  if (page === "keys") return <KeyBinds settings={s} onChange={onChange} onDone={back} background={bg} />;

  const vol = (c: SoundCategory, name: string): Item => ({
    kind: "slider",
    label: volumeLabel(name, s.volumes[c]),
    value: s.volumes[c],
    set: (v) => onChange({ volumes: { ...s.volumes, [c]: r2(v) }, ...(c === "music" ? { music: r2(v) } : c === "blocks" ? { sound: r2(v) } : {}) }),
  });

  const video: Item[] = [
    { kind: "button", label: `Graphics: ${s.graphics === "fancy" ? "Fancy" : "Fast"}`, onClick: () => onChange({ graphics: s.graphics === "fancy" ? "fast" : "fancy" }) },
    { kind: "slider", label: `Render Distance: ${s.renderDistance} chunks`, value: frac(s.renderDistance, 2, 32), set: (v) => onChange({ renderDistance: steps(v, 2, 32) }) },
    { kind: "button", label: "Chunk Builder: Threaded", disabled: true },
    { kind: "slider", label: `Simulation Distance: ${s.simulationDistance} chunks`, value: frac(s.simulationDistance, 5, 32), set: (v) => onChange({ simulationDistance: steps(v, 5, 32) }) },
    { kind: "button", label: `Smooth Lighting: ${onOff(s.smoothLighting)}`, onClick: () => onChange({ smoothLighting: !s.smoothLighting }) },
    { kind: "slider", label: fpsLabel(s.maxFps), value: frac(s.maxFps, 10, 260), set: (v) => onChange({ maxFps: Math.round(steps(v, 10, 260) / 10) * 10 }) },
    { kind: "button", label: "VSync: ON", disabled: true },
    { kind: "button", label: `View Bobbing: ${onOff(s.viewBobbing)}`, onClick: () => onChange({ viewBobbing: !s.viewBobbing }) },
    { kind: "slider", label: guiScaleLabel(s.guiScale), value: s.guiScale / 4, set: (v) => onChange({ guiScale: steps(v, 0, 4) }) },
    { kind: "button", label: "Attack Indicator: Crosshair", disabled: true },
    { kind: "slider", label: brightnessLabel(s.brightness), value: s.brightness, set: (v) => onChange({ brightness: r2(v) }) },
    {
      kind: "button",
      label: `Clouds: ${s.cloudMode === "off" ? "OFF" : cap(s.cloudMode)}`,
      onClick: () => {
        const m = cycle(CLOUDS, s.cloudMode);
        onChange({ cloudMode: m, clouds: m !== "off" });
      },
    },
    {
      kind: "button",
      label: `Fullscreen: ${onOff(isFullscreen())}`,
      onClick: () => {
        const p = isFullscreen() ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        void p.catch(() => {}).finally(() => setTimeout(() => setFs((n) => n + 1), 100));
      },
    },
    { kind: "button", label: `Particles: ${cap(s.particles)}`, onClick: () => onChange({ particles: cycle(PARTICLES, s.particles) }) },
    { kind: "button", label: "Mipmap Levels: OFF", disabled: true },
    { kind: "button", label: `Entity Shadows: ${onOff(s.entityShadows)}`, onClick: () => onChange({ entityShadows: !s.entityShadows }) },
    { kind: "slider", label: fovEffectsLabel(s.fovEffects), value: s.fovEffects, set: (v) => onChange({ fovEffects: r2(v) }) },
    { kind: "button", label: `Advanced Tooltips: ${onOff(s.advancedTooltips)}`, onClick: () => onChange({ advancedTooltips: !s.advancedTooltips }) },
  ];

  const sound: Item[] = [
    vol("music", "Music"),
    ...SOUND_CATEGORIES.slice(1).map(([c, name]) => vol(c, name)),
    null,
    { kind: "button", label: `Show Subtitles: ${onOff(!!s.showSubtitles)}`, onClick: () => onChange({ showSubtitles: !s.showSubtitles }) },
    { kind: "button", label: "Directional Audio: OFF", disabled: true },
  ];

  const controls: Item[] = [
    { kind: "button", label: "Mouse Settings...", onClick: () => setPage("mouse") },
    { kind: "button", label: "Key Binds...", onClick: () => setPage("keys") },
    { kind: "button", label: `Sneak: ${s.toggleSneak ? "Toggle" : "Hold"}`, onClick: () => onChange({ toggleSneak: !s.toggleSneak }) },
    { kind: "button", label: `Sprint: ${s.toggleSprint ? "Toggle" : "Hold"}`, onClick: () => onChange({ toggleSprint: !s.toggleSprint }) },
    { kind: "button", label: "Auto-Jump: OFF", disabled: true },
    { kind: "button", label: "Operator Items Tab: OFF", disabled: true },
  ];

  const mouse: Item[] = [
    { kind: "slider", label: sensitivityLabel(s.sensitivity), value: s.sensitivity, set: (v) => onChange({ sensitivity: Math.round(v * 200) / 200 }) },
    { kind: "button", label: `Invert Mouse: ${onOff(s.invertMouse)}`, onClick: () => onChange({ invertMouse: !s.invertMouse }) },
  ];

  const chat: Item[] = [
    { kind: "button", label: "Chat: Shown", disabled: true },
    { kind: "button", label: "Colors: ON", disabled: true },
    { kind: "slider", label: pctLabel("Chat Text Opacity", s.chatOpacity), value: frac(s.chatOpacity, 0.1, 1), set: (v) => onChange({ chatOpacity: r2(0.1 + v * 0.9) }) },
    { kind: "slider", label: pctLabel("Text Background Opacity", s.chatBackground), value: s.chatBackground, set: (v) => onChange({ chatBackground: r2(v) }) },
    { kind: "slider", label: pctLabel("Line Spacing", s.chatLineSpacing), value: s.chatLineSpacing, set: (v) => onChange({ chatLineSpacing: r2(v) }) },
    { kind: "slider", label: `Width: ${s.chatWidth}px`, value: frac(s.chatWidth, 40, 320), set: (v) => onChange({ chatWidth: steps(v, 40, 320) }) },
  ];

  const lists: Partial<Record<Page, { big?: Item; items: Item[] }>> = {
    video: { items: video },
    sound: { big: { kind: "slider", label: volumeLabel("Master Volume", s.master), value: s.master, set: (v) => onChange({ master: r2(v) }) }, items: sound },
    controls: { items: controls },
    mouse: { items: mouse },
    chat: { items: chat },
  };
  const list = lists[page] ?? { items: [] };
  const top = 33;
  const bottom = height - 33;
  const rows: { item: Item; x: number; y: number; w: number }[] = [];
  let y = 4;
  if (list.big) {
    rows.push({ item: list.big, x: cx - 155, y, w: 310 });
    y += 25;
  }
  list.items.forEach((item, i) => {
    rows.push({ item, x: i % 2 ? cx + 5 : cx - 155, y: y + Math.floor(i / 2) * 25, w: 150 });
  });
  return (
    <Screen background={bg}>
      <Text text={TITLES[page]} x={cx} y={Math.floor((top - 9) / 2) + 1} align="center" />
      <ScrollList top={top} bottom={bottom} content={y + Math.ceil(list.items.length / 2) * 25 + 4}>
        {(scroll) =>
          rows.map(({ item, x, y: ry, w }, i) => {
            if (!item) return null;
            const yy = ry - scroll;
            if (yy < -20 || yy > bottom - top) return null;
            return item.kind === "slider" ? (
              <Slider key={i} x={x} y={yy} width={w} value={item.value} label={item.label} onChange={item.set} />
            ) : (
              <Button key={i} x={x} y={yy} width={w} label={item.label} onClick={item.onClick} disabled={item.disabled} />
            );
          })
        }
      </ScrollList>
      <Button x={cx - 100} y={height - 27} label="Done" onClick={onDone} />
    </Screen>
  );
}

export function ScrollList({ top, bottom, content, children }: { top: number; bottom: number; content: number; children: (scroll: number) => React.ReactNode }) {
  const { width } = useGui();
  const [scroll, setScroll] = useState(0);
  const view = bottom - top;
  const max = Math.max(0, content - view);
  const sc = Math.min(scroll, max);
  const barH = max > 0 ? Math.max(32, Math.floor((view * view) / content)) : 0;
  const barY = max > 0 ? Math.floor(((view - barH) * sc) / max) : 0;
  return (
    <ListArea top={top} bottom={bottom}>
      <div style={{ position: "absolute", inset: 0 }} onWheel={(e) => setScroll(Math.max(0, Math.min(max, sc + Math.sign(e.deltaY) * 20)))}>
        {children(sc)}
      </div>
      {max > 0 && (
        <>
          <div style={{ position: "absolute", left: Math.floor(width / 2) + 164, top: 0, width: 6, height: view, background: "#000" }} />
          <div style={{ position: "absolute", left: Math.floor(width / 2) + 164, top: barY, width: 6, height: barH, background: "#808080", boxShadow: "inset -1px -1px 0 #000, inset 0 0 0 1px #c0c0c0" }} />
        </>
      )}
    </ListArea>
  );
}

function SkinPage({ background, onDone }: { background: "menu" | "ingame"; onDone: () => void }) {
  const { width, height } = useGui();
  const [name, setName] = useState(playerName);
  const cx = Math.floor(width / 2);
  const ok = name.length >= 3;
  const edit = (v: string) => {
    const n = v.replace(/[^A-Za-z0-9_]/g, "");
    setName(n);
    if (n.length >= 3) setPlayerNameStored(n);
  };
  return (
    <Screen background={background}>
      <Text text={TITLES.skin} x={cx} y={15} align="center" />
      <Text text="Multiplayer Name" x={cx - 100} y={Math.floor(height / 6) + 4} color={0xa0a0a0} />
      <TextField x={cx - 100} y={Math.floor(height / 6) + 16} width={200} value={name} onChange={edit} onEnter={onDone} maxLength={16} hint="Player name" autoFocus />
      <Text text={ok ? "Other players see this name." : "Use 3 to 16 letters, digits or _."} x={cx} y={Math.floor(height / 6) + 44} color={ok ? 0x808080 : 0xff5555} align="center" />
      <Button x={cx - 100} y={height - 27} label="Done" onClick={onDone} />
    </Screen>
  );
}
