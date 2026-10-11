"use client";

import { useState } from "react";
import type { Rules } from "../contracts";
import { Text, useGui } from "./gui";
import { Button, ListArea, Screen, Slider, onOff, useKeyDown } from "./widgets";
import { KEY_BINDS, brightnessLabel, fovLabel, guiScaleLabel, sensitivityLabel, volumeLabel, type Settings } from "./settings";

type Item =
  | { kind: "slider"; label: string; value: number; set: (v: number) => void }
  | { kind: "button"; label: string; onClick?: () => void; disabled?: boolean };

export interface OptionsScreenProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onDone: () => void;
  inGame?: boolean; // dark overlay over the world instead of dirt
  difficulty?: Rules["difficulty"];
  onDifficulty?: (d: Rules["difficulty"]) => void;
  difficultyLocked?: boolean;
}

type Page = "main" | "video" | "sound" | "controls" | "mouse" | "keys";
const TITLES: Record<Page, string> = {
  main: "Options",
  video: "Video Settings",
  sound: "Music & Sound Options",
  controls: "Controls",
  mouse: "Mouse Settings",
  keys: "Key Binds",
};
const DIFFS: Rules["difficulty"][] = ["peaceful", "easy", "normal", "hard"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const steps = (v: number, lo: number, hi: number) => Math.round(lo + v * (hi - lo));
const frac = (v: number, lo: number, hi: number) => (v - lo) / (hi - lo);

export function OptionsScreen({ settings: s, onChange, onDone, inGame, difficulty, onDifficulty, difficultyLocked }: OptionsScreenProps) {
  const { width, height } = useGui();
  const [page, setPage] = useState<Page>("main");
  const back = () => setPage(page === "mouse" || page === "keys" ? "controls" : page === "main" ? page : "main");
  const done = () => (page === "main" ? onDone() : back());
  useKeyDown((e) => e.key === "Escape" && done());
  const bg = inGame ? "ingame" : "dirt";
  const cx = Math.floor(width / 2);

  if (page === "main") {
    const y0 = Math.floor(height / 6 - 12);
    const g = Math.floor(height / 6 + 42);
    const grid: [string, Page | null][] = [
      ["Skin Customization...", null],
      ["Music & Sounds...", "sound"],
      ["Video Settings...", "video"],
      ["Controls...", "controls"],
      ["Language...", null],
      ["Chat Settings...", null],
      ["Resource Packs...", null],
      ["Accessibility Settings...", null],
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

  if (page === "keys") return <KeyBinds onDone={back} background={bg} />;

  const rows: Item[][] =
    page === "video"
      ? [
          [
            { kind: "button", label: `Graphics: ${s.graphics === "fancy" ? "Fancy" : "Fast"}`, onClick: () => onChange({ graphics: s.graphics === "fancy" ? "fast" : "fancy" }) },
            { kind: "slider", label: `Render Distance: ${s.renderDistance} chunks`, value: frac(s.renderDistance, 2, 32), set: (v) => onChange({ renderDistance: steps(v, 2, 32) }) },
          ],
          [
            { kind: "slider", label: guiScaleLabel(s.guiScale), value: s.guiScale / 4, set: (v) => onChange({ guiScale: steps(v, 0, 4) }) },
            { kind: "slider", label: brightnessLabel(s.brightness), value: s.brightness, set: (v) => onChange({ brightness: Math.round(v * 100) / 100 }) },
          ],
          [
            { kind: "button", label: `View Bobbing: ${onOff(s.viewBobbing)}`, onClick: () => onChange({ viewBobbing: !s.viewBobbing }) },
            { kind: "button", label: `Clouds: ${s.clouds ? "Fancy" : "OFF"}`, onClick: () => onChange({ clouds: !s.clouds }) },
          ],
          [{ kind: "slider", label: fovLabel(s.fov), value: frac(s.fov, 30, 110), set: (v) => onChange({ fov: steps(v, 30, 110) }) }],
        ]
      : page === "sound"
        ? [
            [{ kind: "slider", label: volumeLabel("Master Volume", s.master), value: s.master, set: (v) => onChange({ master: Math.round(v * 100) / 100 }) }],
            [
              { kind: "slider", label: volumeLabel("Music", s.music), value: s.music, set: (v) => onChange({ music: Math.round(v * 100) / 100 }) },
              { kind: "slider", label: volumeLabel("Sounds", s.sound), value: s.sound, set: (v) => onChange({ sound: Math.round(v * 100) / 100 }) },
            ],
          ]
        : page === "controls"
          ? [
              [
                { kind: "button", label: "Mouse Settings...", onClick: () => setPage("mouse") },
                { kind: "button", label: "Key Binds...", onClick: () => setPage("keys") },
              ],
              [
                { kind: "button", label: "Sneak: Hold", disabled: true },
                { kind: "button", label: "Sprint: Hold", disabled: true },
              ],
            ]
          : [
              [
                { kind: "slider", label: sensitivityLabel(s.sensitivity), value: s.sensitivity, set: (v) => onChange({ sensitivity: Math.round(v * 200) / 200 }) },
                { kind: "button", label: `Invert Mouse: ${onOff(s.invertMouse)}`, onClick: () => onChange({ invertMouse: !s.invertMouse }) },
              ],
            ];

  return (
    <Screen background={bg}>
      <Text text={TITLES[page]} x={cx} y={13} align="center" />
      <ListArea top={33} bottom={height - 33}>
        {rows.map((row, r) =>
          row.map((it, c) => {
            const full = row.length === 1;
            const x = full ? cx - 155 : c ? cx + 5 : cx - 155;
            const w = full ? 310 : 150;
            const y = 4 + r * 25;
            return it.kind === "slider" ? (
              <Slider key={`${r}-${c}`} x={x} y={y} width={w} value={it.value} label={it.label} onChange={it.set} />
            ) : (
              <Button key={`${r}-${c}`} x={x} y={y} width={w} label={it.label} onClick={it.onClick} disabled={it.disabled} />
            );
          }),
        )}
      </ListArea>
      <Button x={cx - 100} y={height - 27} label="Done" onClick={done} />
    </Screen>
  );
}

function KeyBinds({ onDone, background }: { onDone: () => void; background: "dirt" | "ingame" }) {
  const { width, height } = useGui();
  const [scroll, setScroll] = useState(0);
  const cx = Math.floor(width / 2);
  const lines: { cat?: string; name?: string; key?: string }[] = [];
  for (const [cat, binds] of KEY_BINDS) {
    lines.push({ cat });
    for (const [name, key] of binds) lines.push({ name, key });
  }
  const rowH = 20;
  const view = height - 66;
  const max = Math.max(0, lines.length * rowH + 8 - view);
  return (
    <Screen background={background}>
      <Text text="Key Binds" x={cx} y={13} align="center" />
      <ListArea top={33} bottom={height - 33}>
        <div style={{ position: "absolute", inset: 0 }} onWheel={(e) => setScroll(Math.max(0, Math.min(max, scroll + Math.sign(e.deltaY) * rowH)))}>
          {lines.map((l, i) => {
            const y = 4 + i * rowH - scroll;
            if (y < -rowH || y > view) return null;
            return l.cat ? (
              <Text key={i} text={l.cat} x={cx} y={y + 6} align="center" />
            ) : (
              <div key={i}>
                <Text text={l.name ?? ""} x={cx - 90 + 85} y={y + 6} align="right" />
                <Button x={cx + 5} y={y} width={75} label={l.key ?? ""} disabled />
                <Button x={cx + 85} y={y} width={50} label="Reset" disabled />
              </div>
            );
          })}
        </div>
      </ListArea>
      <Button x={cx - 155} y={height - 27} width={150} label="Reset Keys" disabled />
      <Button x={cx + 5} y={height - 27} width={150} label="Done" onClick={onDone} />
    </Screen>
  );
}
