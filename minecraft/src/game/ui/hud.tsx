"use client";

import type { CSSProperties } from "react";
import type { Effect, HudState } from "../contracts";
import { textWidth } from "./font";
import { Text, useGui } from "./gui";
import { ItemIcon } from "./item-icon";
import { StatusBars } from "./hud-status";
import { AttackIndicator } from "./attack-indicator";
import { HudOverlays } from "./hud-overlays";
import { EFFECTS, roman } from "./data";
import { barUrl, containerSprite, hotbarUrl, offhandUrl, packUrl, panelUrl, pixelUrl, selectionUrl } from "./sprites";

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
  hideEffects?: boolean; // the open screen lists the effects itself
}

const HUD_CSS = `
@keyframes mc-held{0%,75%{opacity:1}100%{opacity:0}}
@keyframes mc-title{0%{opacity:0}10%,80%{opacity:1}100%{opacity:0}}
@keyframes mc-action{0%,66%{opacity:1}100%{opacity:0}}
@keyframes mc-hurt{0%{opacity:0.6}100%{opacity:0}}
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
  return packUrl(`mob_effect/${id}`, 18, 18) || pixelUrl(`effect:${id}`, 18, 18, (x, y) => {
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

// Vanilla notched_N_background/progress: N segments split by 1px ticks, drawn over the plain bar.
const notchUrl = (n: number, progress: boolean) =>
  packUrl(`gui/sprites/boss_bar/notched_${n}_${progress ? "progress" : "background"}`, 182, 5) ||
  pixelUrl(`notch:${n}:${progress}`, 182, 5, (x, y) => {
    if (y === 0 || y === 4) return 0;
    for (let i = 1; i < n; i++) if (x === Math.round((i * 182) / n)) return progress ? 0xa0ffffff : 0x80000000;
    return 0;
  });

const abs = (x: number, y: number, w: number, h: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h, ...extra });

export function Hud({ state, title, actionBar, hurtAt, pumpkin, vignette, hideEffects }: HudProps) {
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
      <AttackIndicator state={state} width={width} height={height} />
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
              {state.mountJumpCooldown ? (
                <img alt="" src={barUrl("jump_cooldown", 182, 0x8a5a5a, 0x6e4444, 0x4a2c2c, 0)} width={182} height={5} style={abs(hx, height - 29, 182, 5, { imageRendering: "pixelated" })} />
              ) : (
                <div style={abs(hx, height - 29, Math.floor(state.mountJump * 183), 5, { overflow: "hidden" })}>
                  <img alt="" src={barUrl("jump_fill", 182, 0x9ab4ff, 0x6a8cf0, 0x3a50a0, 0)} width={182} height={5} style={{ imageRendering: "pixelated", display: "block", maxWidth: "none" }} />
                </div>
              )}
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
        const px = { imageRendering: "pixelated", display: "block", maxWidth: "none" } as const;
        return (
          <div key={b.id}>
            <Text text={b.name} x={cx} y={y - 9} align="center" />
            <img alt="" src={barUrl(`boss_bg_${b.color}`, 182, lighten(bg), bg, bg)} width={182} height={5} style={abs(hx, y, 182, 5, { imageRendering: "pixelated" })} />
            {b.notches && <img alt="" src={notchUrl(b.notches, false)} width={182} height={5} style={abs(hx, y, 182, 5, { imageRendering: "pixelated" })} />}
            <div style={abs(hx, y, Math.floor(Math.max(0, Math.min(1, b.progress)) * 183), 5, { overflow: "hidden" })}>
              <img alt="" src={barUrl(`boss_fg_${b.color}`, 182, lighten(fg), fg, fg)} width={182} height={5} style={px} />
              {b.notches && <img alt="" src={notchUrl(b.notches, true)} width={182} height={5} style={{ ...px, position: "absolute", left: 0, top: 0 }} />}
            </div>
          </div>
        );
      })}

      {!hideEffects && <Effects state={state} width={width} />}
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

const INFINITE = 2147483647 / 2;

// Vanilla MobEffectInstance.compareTo: ambient last, infinite last, then shorter first, then by color.
export function effectOrder(a: Effect, b: Effect): number {
  const inf = (e: Effect) => (e.ticks >= INFINITE ? 1 : 0);
  const amb = (e: Effect) => (e.ambient ? 1 : 0);
  const color = (e: Effect) => EFFECTS[e.id]?.color ?? 0;
  const byTime = (a.ticks <= 32147 && b.ticks <= 32147) || (a.ambient && b.ambient);
  return amb(a) - amb(b) || inf(a) - inf(b) || (byTime ? a.ticks - b.ticks : 0) || color(a) - color(b);
}

export const effectLabel = (e: Effect) => {
  const name = EFFECTS[e.id]?.name ?? e.id;
  return e.amplifier >= 1 && e.amplifier <= 9 ? `${name} ${roman(e.amplifier + 1)}` : name;
};

// Vanilla MobEffectUtil.formatDuration / StringUtil.formatTickDuration.
export function effectTime(e: Effect): string {
  if (e.ticks >= INFINITE) return "\u221e";
  const s = Math.floor(e.ticks / 20);
  const p = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  return h > 0 ? `${p(h)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}` : `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}

const hudFrame = (ambient: boolean) =>
  packUrl(`gui/sprites/hud/effect_background${ambient ? "_ambient" : ""}`, 24, 24) ||
  pixelUrl(`effect_frame:${ambient}`, 24, 24, (x, y) => {
    const e = Math.min(x, y, 23 - x, 23 - y);
    if (e === 0) return (x === 0 || x === 23) && (y === 0 || y === 23) ? 0 : 0xff000000;
    if (ambient && e === 1) return 0xff4fb5c9;
    if (e <= 2) return x + y < 23 ? 0xffffffff : 0xff555555;
    return 0xffc6c6c6;
  });

// Vanilla Gui.renderEffects: icons only, beneficial row at y 1, harmful row at y 27, blinking over the last 10 seconds.
function Effects({ state, width }: { state: HudState; width: number }) {
  let good = 0;
  let bad = 0;
  return (
    <>
      {state.effects
        .slice()
        .sort((a, b) => effectOrder(b, a))
        .map((e) => {
          const info = EFFECTS[e.id];
          if (info?.instant) return null;
          const harmful = info?.kind === "bad";
          const n = harmful ? ++bad : ++good;
          const x = width - 25 * n;
          const y = harmful ? 27 : 1;
          let alpha = 1;
          if (!e.ambient && e.ticks <= 200) {
            const m = e.ticks;
            alpha = Math.max(0, Math.min(0.5, m / 10 / 5 * 0.5)) + Math.cos((m * Math.PI) / 5) * Math.max(0, Math.min(0.25, ((10 - Math.floor(m / 20)) / 10) * 0.25));
          }
          return (
            <div key={e.id} style={abs(x, y, 24, 24)}>
              <img alt="" src={hudFrame(!!e.ambient)} width={24} height={24} style={abs(0, 0, 24, 24, { imageRendering: "pixelated" })} />
              <img alt="" src={effectIcon(e.id)} width={18} height={18} style={abs(3, 3, 18, 18, { imageRendering: "pixelated", opacity: alpha })} />
            </div>
          );
        })}
    </>
  );
}

// Vanilla EffectRenderingInventoryScreen.renderEffects: large boxes with name and time, or icon boxes when under 120 px fit.
export function EffectList({ effects, x, top, width, setTip }: { effects: Effect[]; x: number; top: number; width: number; setTip: (lines: string[]) => void }) {
  const list = effects.slice().sort(effectOrder);
  if (!list.length || width - x < 32) return null;
  const wide = width - x >= 120;
  const step = list.length > 5 ? Math.trunc(132 / (list.length - 1)) : 33;
  const bg = wide ? containerSprite("inventory/effect_background_large", 120, 32) || panelUrl(120, 32) : containerSprite("inventory/effect_background_small", 32, 32) || panelUrl(32, 32);
  const px = { imageRendering: "pixelated", pointerEvents: "none" } as const;
  // Vanilla draws every background, then every icon, then the labels, so a later box never hides an earlier label.
  return (
    <>
      {list.map((e, i) => <img key={`b${e.id}`} alt="" src={bg} width={wide ? 120 : 32} height={32} style={abs(x, top + i * step, wide ? 120 : 32, 32, px)} />)}
      {list.map((e, i) => <img key={`i${e.id}`} alt="" src={effectIcon(e.id)} width={18} height={18} style={abs(x + (wide ? 6 : 7), top + i * step + 7, 18, 18, px)} />)}
      {list.map((e, i) =>
        wide ? (
          <div key={`t${e.id}`}>
            <Text text={effectLabel(e)} color={0xffffff} x={x + 28} y={top + i * step + 6} />
            <Text text={effectTime(e)} color={0x7f7f7f} x={x + 28} y={top + i * step + 16} />
          </div>
        ) : (
          <div key={`t${e.id}`} style={abs(x, top + i * step, 34, step + 1)} onMouseEnter={() => setTip([effectLabel(e), effectTime(e)])} onMouseLeave={() => setTip([])} />
        ),
      )}
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
