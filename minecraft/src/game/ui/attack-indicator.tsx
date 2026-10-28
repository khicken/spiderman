"use client";

import type { HudState } from "../contracts";
import { activeSettings } from "./settings";
import { pixelUrl } from "./sprites";

const SWORD = new Set<string>();
for (let x = 6; x <= 15; x++) for (const s of [17, 18]) if (s - x >= 2) SWORD.add(`${x},${s - x}`);
for (const [x, y] of [[3, 11], [4, 12], [5, 13], [6, 14], [2, 15], [3, 15], [2, 14], [4, 13], [5, 12]]) SWORD.add(`${x},${y}`);

const swordUrl = (on: boolean) =>
  pixelUrl(`attack_indicator_${on ? "progress" : "background"}`, 18, 18, (x, y) => {
    if (SWORD.has(`${x},${y}`)) return on ? 0xffe0e0e0 : 0xff4a4a4a;
    return x === 0 || y === 0 || x === 17 || y === 17 ? 0xc0101010 : 0x80303030;
  });

// Vanilla Gui attack indicator: a 16x4 bar under the crosshair, or an 18x18 icon right of the hotbar.
export function AttackIndicator({ state, width, height }: { state: HudState; width: number; height: number }) {
  const mode = activeSettings().attackIndicator;
  const f = state.attack ?? 1;
  if (mode === "off" || f >= 1 || state.gameMode === "spectator" || state.dead) return null;
  const cx = Math.floor(width / 2);
  if (mode === "crosshair") {
    if (state.thirdPerson) return null;
    const x = cx - 8, y = Math.floor(height / 2) - 7 + 16;
    return (
      <>
        <div style={{ position: "absolute", left: x, top: y, width: 16, height: 4, background: "rgba(150,150,150,0.65)" }} />
        <div style={{ position: "absolute", left: x, top: y, width: Math.min(16, Math.floor(f * 17)), height: 4, background: "#ffffff" }} />
      </>
    );
  }
  const x = cx + 91 + 6, y = height - 20;
  const p = Math.floor(f * 19);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 18, height: 18 }}>
      <img alt="" src={swordUrl(false)} width={18} height={18} style={{ position: "absolute", inset: 0, imageRendering: "pixelated" }} />
      <div style={{ position: "absolute", left: 0, top: 18 - p, width: 18, height: p, overflow: "hidden" }}>
        <img alt="" src={swordUrl(true)} width={18} height={18} style={{ position: "absolute", left: 0, top: p - 18, imageRendering: "pixelated" }} />
      </div>
    </div>
  );
}
