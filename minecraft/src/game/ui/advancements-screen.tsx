"use client";

import { useRef, useState, type CSSProperties } from "react";
import { paintBlockTexture } from "../textures";
import { ADVANCEMENTS, TABS, type AdvDef } from "../systems/advancements/defs";
import { Text, useGui } from "./gui";
import { ItemIcon } from "./item-icon";
import { panelUrl, pixelUrl } from "./sprites";
import { textWidth } from "./font";
import { keyFor } from "./settings";
import { Button, Screen, useKeyDown } from "./widgets";

const W = 252, H = 140, IW = 234, IH = 113, IX = 9, IY = 18;
const SX = 28, SY = 27;
const O = (c: number) => (0xff000000 | c) >>> 0;
const abs = (x: number, y: number, w: number, h: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h, ...extra });

function bgUrl(block: string): string {
  return pixelUrl(`adv_bg:${block}`, 16, 16, (x, y) => {
    if (typeof document === "undefined") return O(0x202020);
    const t = paintBlockTexture(block);
    const o = (y * 16 + x) * 4;
    const k = 0.55;
    return O(((t[o] * k) << 16) | ((t[o + 1] * k) << 8) | (t[o + 2] * k));
  });
}

function frameUrl(kind: AdvDef["kind"], done: boolean): string {
  const edge = done ? 0xf0c020 : 0xb0b0b0;
  const fill = done ? 0xc08818 : 0x606060;
  const dark = done ? 0x6a4808 : 0x303030;
  return pixelUrl(`adv_frame:${kind}:${done}`, 26, 26, (x, y) => {
    const cx = Math.abs(x - 12.5), cy = Math.abs(y - 12.5);
    if (kind === "challenge") {
      const spike = (x % 6 < 2 && (y < 2 || y > 23)) || (y % 6 < 2 && (x < 2 || x > 23));
      if (cx > 10.5 || cy > 10.5) return spike ? O(edge) : 0;
    } else if (kind === "goal") {
      if (cx + cy > 21) return 0;
    }
    const ex = Math.min(x, 25 - x, kind === "challenge" ? x - 2 : 99, kind === "challenge" ? 23 - x : 99);
    const ey = Math.min(y, 25 - y, kind === "challenge" ? y - 2 : 99, kind === "challenge" ? 23 - y : 99);
    const e = kind === "goal" ? Math.min(ex, ey, 21 - (cx + cy)) : Math.min(ex, ey);
    if (e < 1) return O(0x000000);
    if (e < 2) return O(edge);
    if (e < 3) return O(dark);
    return O(fill);
  });
}

function tabUrl(active: boolean): string {
  return panelUrl(28, active ? 32 : 28, active ? 0xc6c6c6 : 0x8b8b8b);
}

function Line({ x0, y0, x1, y1, done }: { x0: number; y0: number; x1: number; y1: number; done: boolean }) {
  const mx = Math.round((x0 + x1) / 2);
  const c = done ? "#ffffff" : "#a0a0a0";
  const seg = (x: number, y: number, w: number, h: number, k: number) => (
    <>
      <div key={`b${k}`} style={abs(x - 1, y - 1, w + 2, h + 2, { background: "#000" })} />
      <div key={`w${k}`} style={abs(x, y, w, h, { background: c })} />
    </>
  );
  return (
    <>
      {seg(Math.min(x0, mx), y0, Math.abs(mx - x0) + 1, 1, 0)}
      {seg(mx, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, 1)}
      {seg(Math.min(mx, x1), y1, Math.abs(x1 - mx) + 1, 1, 2)}
    </>
  );
}

export function AdvancementsScreen({ done: doneIds, onDone }: { done: Record<string, number>; onDone: () => void }) {
  const { width, height } = useGui();
  const [tab, setTab] = useState<AdvDef["tab"]>("story");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useKeyDown((e) => (e.key === "Escape" || e.code === keyFor("advancements")) && onDone());
  const wx = Math.floor((width - W) / 2), wy = Math.floor((height - H) / 2);
  const list = ADVANCEMENTS.filter((d) => d.tab === tab).map((def) => ({ def, done: def.id in doneIds }));
  const done = new Set(list.filter((a) => a.done).map((a) => a.def.id));
  const pos = (d: AdvDef) => ({ x: 12 + d.x * SX + pan.x, y: 8 + d.y * SY + pan.y });
  const tabDef = TABS.find((t) => t.id === tab)!;
  const hovered = list.find((a) => a.def.id === hover);
  return (
    <Screen background="ingame">
      {TABS.map((t, i) => (
        <div
          key={t.id}
          onMouseDown={() => {
            setTab(t.id);
            setPan({ x: 0, y: 0 });
          }}
          style={abs(wx + i * 32, wy - (t.id === tab ? 28 : 26), 28, t.id === tab ? 32 : 28, { backgroundImage: `url(${tabUrl(t.id === tab)})`, cursor: "pointer", zIndex: t.id === tab ? 2 : 0 })}
        >
          <ItemIcon stack={{ item: t.icon, count: 1 }} x={6} y={t.id === tab ? 9 : 7} count={false} />
        </div>
      ))}
      <div style={abs(wx, wy, W, H, { backgroundImage: `url(${panelUrl(W, H)})`, zIndex: 1 })}>
        <Text text={tabDef.title} color={0x404040} shadow={false} x={8} y={6} />
        <div
          onMouseDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          }}
          onMouseMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const s = (e.currentTarget.getBoundingClientRect().width || IW) / IW;
            setPan({ x: Math.max(-200, Math.min(40, d.px + (e.clientX - d.x) / s)), y: Math.max(-120, Math.min(40, d.py + (e.clientY - d.y) / s)) });
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => {
            drag.current = null;
            setHover(null);
          }}
          style={abs(IX, IY, IW, IH, { overflow: "hidden", backgroundImage: `url(${bgUrl(tabDef.bg)})`, backgroundSize: "16px 16px", backgroundPosition: `${pan.x}px ${pan.y}px`, imageRendering: "pixelated", boxShadow: "inset 0 0 0 1px #373737", cursor: "grab" })}
        >
          {list.map(({ def }) => {
            const parent = def.parent ? ADVANCEMENTS.find((a) => a.id === def.parent) : undefined;
            if (!parent) return null;
            const a = pos(parent), b = pos(def);
            return <Line key={`l${def.id}`} x0={a.x + 13} y0={a.y + 13} x1={b.x + 13} y1={b.y + 13} done={done.has(def.id)} />;
          })}
          {list.map(({ def, done: d }) => {
            const p = pos(def);
            return (
              <div key={def.id} onMouseEnter={() => setHover(def.id)} onMouseLeave={() => setHover((h) => (h === def.id ? null : h))} style={abs(p.x, p.y, 26, 26, { backgroundImage: `url(${frameUrl(def.kind, d)})` })}>
                <ItemIcon stack={{ item: def.icon, count: 1 }} x={5} y={5} count={false} />
              </div>
            );
          })}
          {hovered && (() => {
            const p = pos(hovered.def);
            const tw = Math.max(textWidth(hovered.def.title), textWidth(hovered.def.desc)) + 36;
            const left = Math.min(p.x, IW - tw);
            return (
              <div style={abs(left, p.y, tw, 46, { pointerEvents: "none" })}>
                <div style={abs(0, 0, tw, 26, { background: hovered.done ? "#c08818" : "#1c4d8c", boxShadow: "inset 0 0 0 1px #000, inset 0 0 0 2px #ffffff40" })} />
                <div style={abs(0, 24, tw, 22, { background: "#212121", boxShadow: "inset 0 0 0 1px #000, inset 0 0 0 2px #555" })} />
                <div style={abs(p.x - left, 0, 26, 26, { backgroundImage: `url(${frameUrl(hovered.def.kind, hovered.done)})` })}>
                  <ItemIcon stack={{ item: hovered.def.icon, count: 1 }} x={5} y={5} count={false} />
                </div>
                <Text text={hovered.def.title} x={p.x - left === 0 ? 30 : 4} y={9} />
                <Text text={hovered.def.desc} color={hovered.def.kind === "challenge" ? 0xaa00aa : 0x55ff55} x={6} y={31} />
              </div>
            );
          })()}
        </div>
      </div>
      <Button x={Math.floor(width / 2 - 100)} y={wy + H + 8} width={200} label="Done" onClick={onDone} />
    </Screen>
  );
}
