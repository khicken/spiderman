"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { paintBlockTexture } from "../textures";
import { TABS, type AdvDef, type TabId } from "../systems/advancements/defs";
import { advancementList, type AdvView } from "../systems/advancements";
import { Text, useGui } from "./gui";
import { ItemIcon } from "./item-icon";
import { panelUrl, pixelUrl } from "./sprites";
import { textWidth, wrapText } from "./font";
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
  const edge = done ? 0xf0c020 : 0xd8d8d8;
  const fill = done ? 0xc08818 : 0x8b8b8b;
  const dark = done ? 0x6a4808 : 0x4a4a4a;
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

function Line({ x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) {
  const mx = Math.round((x0 + x1) / 2);
  const segs: [number, number, number, number][] = [
    [Math.min(x0, mx), y0, Math.abs(mx - x0) + 1, 1],
    [mx, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1],
    [Math.min(mx, x1), y1, Math.abs(x1 - mx) + 1, 1],
  ];
  return (
    <>
      {segs.map(([x, y, w, h], k) => <div key={`b${k}`} style={abs(x - 1, y - 1, w + 2, h + 2, { background: "#000" })} />)}
      {segs.map(([x, y, w, h], k) => <div key={`w${k}`} style={abs(x, y, w, h, { background: "#fff" })} />)}
    </>
  );
}

// Vanilla: shown when done, or when the parent or grandparent is done, or a child is done; hidden ones only once done.
function visibleSet(list: AdvView[]): Set<string> {
  const by = new Map(list.map((v) => [v.def.id, v]));
  const doneId = (id?: string) => !!id && !!by.get(id)?.done;
  const childDone = new Set(list.filter((v) => v.done && v.def.parent).map((v) => v.def.parent!));
  const out = new Set<string>();
  for (const v of list) {
    if (v.def.hidden && !v.done) continue;
    const p = v.def.parent ? by.get(v.def.parent) : undefined;
    if (v.done || doneId(v.def.parent) || doneId(p?.def.parent) || childDone.has(v.def.id)) out.add(v.def.id);
  }
  return out;
}

function Tooltip({ v, x, y }: { v: AdvView; x: number; y: number }) {
  const { def, done, got, total } = v;
  const prog = total > 1 && !done ? `${got}/${total}` : "";
  const titleW = textWidth(def.title) + 32 + (prog ? textWidth(prog) + 16 : 0);
  const wrapW = Math.max(titleW - 10, Math.min(163, textWidth(def.desc)));
  const lines = wrapText(def.desc, wrapW);
  const tw = Math.max(titleW, ...lines.map((l) => textWidth(l) + 10));
  const right = x + tw > IW;
  const left = right ? x + 26 - tw : x;
  const descH = lines.length * 9 + 8;
  const descY = y + 26 + descH > IH && y > descH ? 2 - descH : 24;
  return (
    <div style={abs(IX + left, IY + y, tw, 26, { pointerEvents: "none", zIndex: 5 })}>
      <div style={abs(0, descY, tw, descH, { background: "#212121", boxShadow: "inset 0 0 0 1px #000, inset 0 0 0 2px #555" })} />
      <div style={abs(0, 0, tw, 26, { background: done ? "#c08818" : "#1c4d8c", boxShadow: "inset 0 0 0 1px #000, inset 0 0 0 2px #ffffff40" })} />
      <div style={abs(x - left, 0, 26, 26, { backgroundImage: `url(${frameUrl(def.kind, done)})` })}>
        <ItemIcon stack={{ item: def.icon, count: 1 }} x={5} y={5} count={false} />
      </div>
      <Text text={def.title} x={right ? 6 : 30} y={9} />
      {prog && <Text text={prog} x={right ? tw - 32 : tw - 6} y={9} align="right" />}
      {lines.map((l, i) => (
        <Text key={i} text={l} color={def.kind === "challenge" ? 0xaa00aa : 0x55ff55} x={6} y={descY + 4 + i * 9} />
      ))}
    </div>
  );
}

export function AdvancementsScreen({ onDone }: { done?: unknown; onDone: () => void }) {
  const { width, height } = useGui();
  const all = useMemo(() => advancementList(), []);
  const visible = useMemo(() => visibleSet(all), [all]);
  const tabs = TABS.filter((t) => all.some((v) => v.def.tab === t.id && visible.has(v.def.id)));
  const [tab, setTab] = useState<TabId | null>(tabs[0]?.id ?? null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useKeyDown((e) => (e.key === "Escape" || e.code === keyFor("advancements")) && onDone());
  const wx = Math.floor((width - W) / 2), wy = Math.floor((height - H) / 2);
  const list = all.filter((v) => v.def.tab === tab && visible.has(v.def.id));
  const pos = (d: AdvDef) => ({ x: Math.floor(d.x * SX), y: Math.floor(d.y * SY) });
  const bounds = list.reduce((b, v) => {
    const p = pos(v.def);
    return { x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x + SX), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y + SY) };
  }, { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const fitX = bounds.x1 - bounds.x0 <= IW, fitY = bounds.y1 - bounds.y0 <= IH;
  const centerX = Math.floor(IW / 2 - (bounds.x1 + bounds.x0) / 2), centerY = Math.floor(IH / 2 - (bounds.y1 + bounds.y0) / 2);
  const limX = (v: number) => (fitX ? centerX : clamp(v, IW - bounds.x1, -bounds.x0));
  const limY = (v: number) => (fitY ? centerY : clamp(v, IH - bounds.y1, -bounds.y0));
  const sx = limX(pan?.x ?? centerX), sy = limY(pan?.y ?? centerY);
  const tabDef = TABS.find((t) => t.id === tab);
  const hovered = list.find((v) => v.def.id === hover);
  const byId = new Map(list.map((v) => [v.def.id, v]));
  return (
    <Screen background="ingame">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          onMouseDown={() => {
            setTab(t.id);
            setPan(null);
            setHover(null);
          }}
          style={abs(wx + i * 32, wy - (t.id === tab ? 28 : 26), 28, t.id === tab ? 32 : 28, { backgroundImage: `url(${tabUrl(t.id === tab)})`, cursor: "pointer", zIndex: t.id === tab ? 2 : 0 })}
          title={t.title}
        >
          <ItemIcon stack={{ item: t.icon, count: 1 }} x={6} y={t.id === tab ? 9 : 7} count={false} />
        </div>
      ))}
      <div style={abs(wx, wy, W, H, { backgroundImage: `url(${panelUrl(W, H)})`, zIndex: 1 })}>
        <Text text="Advancements" color={0x404040} shadow={false} x={8} y={6} />
        {!tabDef ? (
          <div style={abs(IX, IY, IW, IH, { background: "#000" })}>
            <Text text="There doesn't seem to be anything here! :(" x={IW / 2} y={IH / 2 - 4} align="center" />
          </div>
        ) : (
          <div
            onMouseDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, px: sx, py: sy };
            }}
            onMouseMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const s = (e.currentTarget.getBoundingClientRect().width || IW) / IW;
              setPan({ x: limX(d.px + (e.clientX - d.x) / s), y: limY(d.py + (e.clientY - d.y) / s) });
            }}
            onMouseUp={() => (drag.current = null)}
            onMouseLeave={() => {
              drag.current = null;
              setHover(null);
            }}
            style={abs(IX, IY, IW, IH, { overflow: "hidden", backgroundImage: `url(${bgUrl(tabDef.bg)})`, backgroundSize: "16px 16px", backgroundPosition: `${sx % 16}px ${sy % 16}px`, imageRendering: "pixelated", cursor: drag.current ? "grabbing" : "grab" })}
          >
            {list.map((v) => {
              const parent = v.def.parent ? byId.get(v.def.parent) : undefined;
              if (!parent) return null;
              const a = pos(parent.def), b = pos(v.def);
              return <Line key={`l${v.def.id}`} x0={sx + a.x + 16} y0={sy + a.y + 13} x1={sx + b.x + 16} y1={sy + b.y + 13} />;
            })}
            {list.map((v) => {
              const p = pos(v.def);
              return (
                <div key={v.def.id} data-adv={v.def.id} onMouseEnter={() => setHover(v.def.id)} onMouseLeave={() => setHover((h) => (h === v.def.id ? null : h))} style={abs(sx + p.x + 3, sy + p.y, 26, 26, { backgroundImage: `url(${frameUrl(v.def.kind, v.done)})` })}>
                  <ItemIcon stack={{ item: v.def.icon, count: 1 }} x={5} y={5} count={false} />
                </div>
              );
            })}
            {hovered && <div style={abs(0, 0, IW, IH, { background: "rgba(0,0,0,0.3)", pointerEvents: "none" })} />}
          </div>
        )}
        {hovered && <Tooltip v={hovered} x={sx + pos(hovered.def).x + 3} y={sy + pos(hovered.def).y} />}
      </div>
      <Button x={Math.floor(width / 2 - 100)} y={wy + H + 8} width={200} label="Done" onClick={onDone} />
    </Screen>
  );
}
