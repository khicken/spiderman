"use client";

import { useEffect, useState } from "react";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { Button, Screen, type BackgroundKind } from "./widgets";
import { ScrollList } from "./options-screen";
import { DEFAULT_KEYS, KEY_BIND_GROUPS, keyName, type Settings } from "./settings";

const ROW = 20;

export function KeyBinds({ settings, onChange, onDone, background }: { settings: Settings; onChange: (p: Partial<Settings>) => void; onDone: () => void; background: BackgroundKind }) {
  const { width, height } = useGui();
  const [editing, setEditing] = useState<string | null>(null);
  const keys = settings.keys;
  const cx = Math.floor(width / 2);

  useEffect(() => {
    if (!editing) return;
    const bind = (code: string) => {
      onChange({ keys: { ...keys, [editing]: code } });
      setEditing(null);
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bind(e.code === "Escape" ? "" : e.code);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bind(`Mouse${e.button}`);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
    };
  }, [editing, keys, onChange]);

  useEffect(() => {
    if (editing) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [editing, onDone]);

  const rows: ({ cat: string } | { id: string; label: string })[] = [];
  for (const [cat, list] of KEY_BIND_GROUPS) {
    rows.push({ cat });
    for (const [id, label] of list) rows.push({ id, label });
  }
  const used = new Map<string, number>();
  for (const v of Object.values(keys)) if (v) used.set(v, (used.get(v) ?? 0) + 1);
  const nameW = Math.max(...KEY_BIND_GROUPS.flatMap(([, l]) => l.map(([, label]) => textWidth(label))));
  const left = cx - 120;
  const top = 33;
  const bottom = height - 33;

  return (
    <Screen background={background}>
      <Text text="Key Binds" x={cx} y={13} align="center" />
      <ScrollList top={top} bottom={bottom} content={rows.length * ROW + 8}>
        {(scroll) =>
          rows.map((r, i) => {
            const y = 4 + i * ROW - scroll;
            if (y < -ROW || y > bottom - top) return null;
            if ("cat" in r) return <Text key={i} text={r.cat} x={cx} y={y + 10 - 4} align="center" />;
            const code = keys[r.id] ?? "";
            const conflict = !!code && (used.get(code) ?? 0) > 1;
            const label = editing === r.id ? `§e> §f§n${keyName(code)}§r§e <` : conflict ? `§c[ §f${keyName(code)}§c ]` : keyName(code);
            return (
              <div key={i}>
                <Text text={r.label} x={left + 90 - nameW} y={y + 6} />
                {conflict && editing !== r.id && <div style={{ position: "absolute", left: left + 101, top: y, width: 3, height: 20, background: "#ff5555" }} />}
                <Button x={left + 105} y={y} width={75} label={label} onClick={() => setEditing(r.id)} />
                <Button
                  x={left + 190}
                  y={y}
                  width={50}
                  label="Reset"
                  disabled={code === DEFAULT_KEYS[r.id]}
                  onClick={() => onChange({ keys: { ...keys, [r.id]: DEFAULT_KEYS[r.id] } })}
                />
              </div>
            );
          })
        }
      </ScrollList>
      <Button x={cx - 155} y={height - 27} width={150} label="Reset Keys" disabled={Object.keys(DEFAULT_KEYS).every((id) => keys[id] === DEFAULT_KEYS[id])} onClick={() => onChange({ keys: { ...DEFAULT_KEYS } })} />
      <Button x={cx + 5} y={height - 27} width={150} label="Done" onClick={onDone} />
    </Screen>
  );
}
