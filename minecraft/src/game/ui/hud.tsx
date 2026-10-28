"use client";

import type { CSSProperties } from "react";
import type { HudState } from "../contracts";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { ItemIcon } from "./item-icon";
import { StatusBars } from "./hud-status";
import { HudOverlays } from "./hud-overlays";
import { EFFECTS } from "./data";
import { barUrl, hotbarUrl, offhandUrl, panelUrl, pixelUrl, selectionUrl } from "./sprites";

export interface TimedText {
  text: string;
  at: number; // performance.now() when it was set; a new value restarts the animation
}

export interface HudProps {
  state: HudState;
  title?: TimedText & { subtitle?: string };
  actionBar?: TimedText;
  hurtAt?: number; // performance.now() of the last hurt, for the red flash
  pumpkin?: boolean;
  vignette?: boolean; // fancy graphics
}

const HUD_CSS = `
@keyframes mc-held{0%,75%{opacity:1}100%{opacity:0}}
@keyframes mc-title{0%{opacity:0}10%,80%{opacity:1}100%{opacity:0}}
@keyframes mc-action{0%,66%{opacity:1}100%{opacity:0}}
@keyframes mc-hurt{0%{opacity:0.6}100%{opacity:0}}
@keyframes mc-blink{0%,49%{opacity:1}50%,100%{opacity:0.3}}
`;

export const BOSS: Record<string, [number, number]> = {
  pink: [0xec00b8, 0x56003c],
  blue: [0x00b7ec, 0x003c56],
  red: [0xec3500, 0x561300],
  green: [0x1dec00, 0x0b5600],
  yellow: [0xe9ec00, 0x545600],
  purple: [0x7b00ec, 0x2c0056],
  white: [0xececec, 0x565656],
};

export const lighten = (c: number) => (Math.min(255, ((c >> 16) & 255) + 50) << 16) | (Math.min(255, ((c >> 8) & 255) + 50) << 8) | Math.min(255, (c & 255) + 50);

export const effectIcon = (id: string) => {
  const c = EFFECTS[id]?.color ?? 0x808080;
  return pixelUrl(`effect:${id}`, 18, 18, (x, y) => {
    const dx = x - 8.5;
    const dy = y - 8.5;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 7.5) return 0;
    if (d > 6.5) return 0xff000000;
    const k = 1.15 - (dx + dy) / 20;
    const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    if (dx < -2 && dy < -2 && d < 5 && d > 3) return 0xffffffff;
    return (0xff000000 | (f((c >> 16) & 255) << 16) | (f((c >> 8) & 255) << 8) | f(c & 255)) >>> 0;
  });
};

const abs = (x: number, y: number, w: number, h: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h, ...extra });

export function Hud({ state, title, actionBar, hurtAt, pumpkin, vignette }: HudProps) {
  const { width, height } = useGui();
  const cx = Math.floor(width / 2);
  const survival = state.gameMode === "survival" || state.gameMode === "adventure";
  const spectator = state.gameMode === "spectator";
  const hx = cx - 91;
  const hy = height - 22;

  return (
    <div style={abs(0, 0, width, height, { pointerEvents: "none" })}>
      <style>{HUD_CSS}</style>
      <HudOverlays state={pumpkin ? { ...state, pumpkin } : state} width={width} height={height} vignette={vignette} />
      {hurtAt !== undefined && (
        <div key={hurtAt} style={abs(0, 0, width, height, { background: "radial-gradient(ellipse at center, transparent 45%, rgba(255,0,0,0.55) 100%)", animation: "mc-hurt 0.5s ease-out forwards" })} />
      )}

      {!spectator && (
        <>
          <img alt="" src={hotbarUrl()} width={182} height={22} style={abs(hx, hy, 182, 22, { imageRendering: "pixelated" })} />
          <img alt="" src={selectionUrl()} width={24} height={23} style={abs(hx - 1 + state.selected * 20, hy - 1, 24, 23, { imageRendering: "pixelated" })} />
          {state.hotbar.map((s, i) => s && <ItemIcon key={i} stack={s} x={hx + 3 + i * 20} y={height - 19} />)}
          {state.offhand && (
            <>
              <img alt="" src={offhandUrl()} width={29} height={24} style={abs(hx - 29, height - 23, 29, 24, { imageRendering: "pixelated" })} />
              <ItemIcon stack={state.offhand} x={hx - 26} y={height - 19} />
            </>
          )}
        </>
      )}

      {!spectator && (
        <>
          {state.mountJump !== undefined ? (
            <>
              <img alt="" src={barUrl("jump_bg", 182, 0x3a3a52, 0x2c2c40, 0x1c1c2a, 0)} width={182} height={5} style={abs(hx, height - 29, 182, 5, { imageRendering: "pixelated" })} />
              <div style={abs(hx, height - 29, Math.floor(state.mountJump * 183), 5, { overflow: "hidden" })}>
                <img alt="" src={barUrl("jump_fill", 182, 0x9ab4ff, 0x6a8cf0, 0x3a50a0, 0)} width={182} height={5} style={{ imageRendering: "pixelated", display: "block", maxWidth: "none" }} />
              </div>
            </>
          ) : (
            survival && (
              <>
                <img alt="" src={barUrl("xp_bg", 182, 0x2a2a2a, 0x202020, 0x181818, 20)} width={182} height={5} style={abs(hx, height - 29, 182, 5, { imageRendering: "pixelated" })} />
                <div style={abs(hx, height - 29, Math.floor(state.xpProgress * 183), 5, { overflow: "hidden" })}>
                  <img alt="" src={barUrl("xp_fill", 182, 0xa0ff60, 0x80ff20, 0x4c9a12, 20)} width={182} height={5} style={{ imageRendering: "pixelated", display: "block", maxWidth: "none" }} />
                </div>
              </>
            )
          )}
          {survival && state.xpLevel > 0 && state.mountJump === undefined && <XpLevel level={state.xpLevel} width={width} y={height - 35} />}
          <StatusBars state={state} width={width} height={height} />
        </>
      )}

      {state.heldName && !spectator && (
        <div key={state.heldName + state.selected} style={{ animation: "mc-held 2s linear forwards" }}>
          <Text text={state.heldName} x={cx} y={height - 59 + (survival ? 0 : 14)} align="center" />
        </div>
      )}

      {actionBar && (
        <div key={actionBar.at} style={{ animation: "mc-action 3s linear forwards" }}>
          <Text text={actionBar.text} x={cx} y={height - 72} align="center" />
        </div>
      )}

      {title && (
        <div key={title.at} style={{ animation: "mc-title 5s linear forwards" }}>
          <Text text={title.text} scale={4} x={cx} y={Math.floor(height / 2) - 40} align="center" />
          {title.subtitle && <Text text={title.subtitle} scale={2} x={cx} y={Math.floor(height / 2) + 10} align="center" />}
        </div>
      )}

      {state.bossBars.map((b, i) => {
        const [fg, bg] = BOSS[b.color] ?? BOSS.pink;
        const y = 12 + i * 19;
        if (i > 0 && y >= height / 3) return null; // vanilla stops once a bar reaches a third of the screen
        return (
          <div key={b.id}>
            <Text text={b.name} x={cx} y={y - 9} align="center" />
            <img alt="" src={barUrl(`boss_bg_${b.color}`, 182, lighten(bg), bg, bg)} width={182} height={5} style={abs(hx, y, 182, 5, { imageRendering: "pixelated" })} />
            <div style={abs(hx, y, Math.floor(Math.max(0, Math.min(1, b.progress)) * 183), 5, { overflow: "hidden" })}>
              <img alt="" src={barUrl(`boss_fg_${b.color}`, 182, lighten(fg), fg, fg)} width={182} height={5} style={{ imageRendering: "pixelated", display: "block", maxWidth: "none" }} />
            </div>
          </div>
        );
      })}

      <Effects state={state} width={width} />
      <div style={abs(0, 0, width, height, { background: "rgb(16,16,32)", opacity: state.sleeping > 0 ? 0.86 * Math.min(1, state.sleeping) : 0, transition: state.sleeping > 0 ? "opacity 5s linear" : "opacity 0.5s linear" })} />
    </div>
  );
}

function XpLevel({ level, width, y }: { level: number; width: number; y: number }) {
  const s = String(level);
  const lx = Math.floor((width - textWidth(s)) / 2);
  return (
    <>
      {[
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([dx, dy]) => (
        <Text key={`${dx},${dy}`} text={s} color={0x000000} shadow={false} x={lx + dx} y={y + dy} />
      ))}
      <Text text={s} color={0x80ff20} shadow={false} x={lx} y={y} />
    </>
  );
}

function Effects({ state, width }: { state: HudState; width: number }) {
  let good = 0;
  let bad = 0;
  return (
    <>
      {state.effects.map((e) => {
        const info = EFFECTS[e.id];
        if (info?.instant) return null;
        const harmful = info?.kind === "bad";
        const n = harmful ? ++bad : ++good;
        const x = width - 25 * n;
        const y = harmful ? 36 : 1;
        const ending = e.ticks <= 200;
        const sec = Math.floor(e.ticks / 20);
        const time = e.ticks >= 2147483647 / 2 ? "**:**" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
        return (
          <div key={e.id} style={abs(x, y, 24, 24, { animation: ending ? "mc-blink 0.5s steps(1) infinite" : undefined })}>
            <img alt="" src={panelUrl(24, 24, 0x8b8b8b)} width={24} height={24} style={abs(0, 0, 24, 24, { imageRendering: "pixelated" })} />
            <img alt="" src={effectIcon(e.id)} width={18} height={18} style={abs(3, 3, 18, 18, { imageRendering: "pixelated" })} />
            <Text text={time} color={0xffffff} x={12 - Math.floor(textWidth(time) / 2)} y={25} />
          </div>
        );
      })}
    </>
  );
}

// Keys "r:..." go to the right column, "l:..." to the left; other keys print as "key: value".
export function DebugOverlay({ lines, width }: { lines: Record<string, string>; width: number }) {
  const left: string[] = [];
  const right: string[] = [];
  const extra: string[] = [];
  for (const [k, v] of Object.entries(lines)) {
    const side = k.startsWith("r:") ? right : k.startsWith("l:") ? left : null;
    const n = side ? Number(k.slice(2)) : NaN;
    if (side && Number.isInteger(n) && n >= 0 && n < 64) side[n] = v;
    else extra.push(v ? `${k}: ${v}` : "");
  }
  left.push(...extra);
  for (const list of [left, right]) for (let i = 0; i < list.length; i++) list[i] ??= "";
  // Narrow windows: cut a right line short where it would run into the left line on the same row.
  for (let i = 0; i < right.length; i++) {
    const room = width - 4 - (left[i] ? textWidth(left[i]) + 8 : 0);
    if (right[i] && textWidth(right[i]) > room) right[i] = fitText(right[i], room);
  }
  const col = (list: string[], side: "l" | "r") =>
    list.map((t, i) => {
      if (!t) return null;
      const w = textWidth(t);
      const x = side === "l" ? 2 : width - 2 - w;
      const y = 2 + i * 9;
      return (
        <div key={`${side}${i}`}>
          <div style={abs(x - 1, y - 1, w + 2, 9, { background: "rgba(80,80,80,0.565)" })} />
          <Text text={t} color={0xe0e0e0} shadow={false} x={x} y={y} />
        </div>
      );
    });
  return (
    <>
      {col(left, "l")}
      {col(right, "r")}
    </>
  );
}

function fitText(t: string, room: number): string {
  let s = t;
  while (s && textWidth(s + "...") > room) s = s.slice(0, -1).replace(/§$/, "");
  return s ? s + "..." : "";
}

// Rendered outside GuiRoot: a fixed or transformed ancestor isolates blending, and difference needs the game canvas as backdrop.
export function Crosshair({ scale }: { scale: number }) {
  const s = scale;
  return (
    <div style={{ position: "fixed", left: "50%", top: "50%", width: 0, height: 0, mixBlendMode: "difference", pointerEvents: "none", zIndex: 1 }}>
      <div style={{ position: "absolute", left: -4.5 * s, top: -0.5 * s, width: 9 * s, height: s, background: "#fff" }} />
      <div style={{ position: "absolute", left: -0.5 * s, top: -4.5 * s, width: s, height: 4 * s, background: "#fff" }} />
      <div style={{ position: "absolute", left: -0.5 * s, top: 0.5 * s, width: s, height: 4 * s, background: "#fff" }} />
    </div>
  );
}

export const useGuiScale = () => useGui().scale;
