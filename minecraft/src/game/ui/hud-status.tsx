"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState } from "../contracts";
import { armorUrl, bubbleUrl, foodUrl, heartUrl, type HeartKind } from "./sprites";

const Icon = ({ url, x, y }: { url: string; x: number; y: number }) => (
  <img alt="" src={url} width={9} height={9} draggable={false} style={{ position: "absolute", left: x, top: y, imageRendering: "pixelated" }} />
);

const rand = (seed: number) => {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function useTicks(active: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

export interface StatusProps {
  state: HudState;
  width: number;
  height: number;
}

// Vanilla Gui.renderPlayerHealth: hearts blink for 20 ticks after damage (10 after healing while invulnerable),
// and the health lost in the last second stays drawn as lighter hearts.
export function StatusBars({ state, width, height }: StatusProps) {
  const left = Math.floor(width / 2 - 91);
  const right = Math.floor(width / 2 + 91);
  const top = height - 39;
  const survival = state.gameMode === "survival" || state.gameMode === "adventure";
  const absorb = Math.ceil(state.absorption ?? 0);
  const regen = state.effects.some((e) => e.id === "regeneration");
  const hungerFx = state.effects.some((e) => e.id === "hunger");
  const health = Math.ceil(state.health);
  const low = health + absorb <= 4;

  const now = performance.now();
  const hp = useRef({ last: health, blinkUntil: 0, changedAt: 0, hurtAt: -Infinity, display: health });
  const h = hp.current;
  if (health !== h.last) {
    if (health < h.last) {
      h.blinkUntil = now + 1000;
      h.hurtAt = now;
    } else if (now - h.hurtAt < 1000) h.blinkUntil = now + 500;
    h.changedAt = now;
    h.last = health;
  }
  if (now - h.changedAt > 1000) {
    h.display = health;
    h.changedAt = now;
  }
  const blinkLeft = h.blinkUntil - now;
  const tick = useTicks(survival && (low || regen || blinkLeft > 0 || state.saturation <= 0 || h.display !== health));
  const blinking = blinkLeft > 0 && Math.floor(blinkLeft / 150) % 2 === 1;
  const display = h.display;

  const out: React.ReactNode[] = [];
  let rows = 1;
  let rowH = 10;
  if (survival) {
    const maxHp = Math.max(state.maxHealth, display, health);
    const maxHearts = Math.ceil(maxHp / 2);
    const absorbHearts = Math.ceil(absorb / 2);
    rows = Math.ceil((maxHp + absorb) / 2 / 10);
    rowH = Math.max(10 - (rows - 2), 3);
    const regenIdx = regen ? tick % Math.ceil(maxHp + 5) : -1;
    const kind: HeartKind = state.poisoned ? "poisoned" : state.withered ? "withered" : state.frozen ? "frozen" : "normal";
    for (let i = maxHearts + absorbHearts - 1; i >= 0; i--) {
      const x = left + (i % 10) * 8;
      let y = top - Math.floor(i / 10) * rowH;
      if (low) y += Math.floor(rand(tick * 312871 + i) * 2);
      if (i < maxHearts && i === regenIdx) y -= 2;
      const hp2 = i * 2;
      out.push(<Icon key={`c${i}`} url={heartUrl("normal", "empty", state.hardcore, blinking)} x={x} y={y} />);
      if (i >= maxHearts) {
        const a = hp2 - maxHearts * 2;
        if (a < absorb) out.push(<Icon key={`a${i}`} url={heartUrl(kind === "withered" ? kind : "absorbing", a + 1 === absorb ? "half" : "full", state.hardcore)} x={x} y={y} />);
      }
      if (blinking && hp2 < display) out.push(<Icon key={`b${i}`} url={heartUrl(kind, hp2 + 1 === display ? "half" : "full", state.hardcore, true)} x={x} y={y} />);
      if (hp2 < health) out.push(<Icon key={`h${i}`} url={heartUrl(kind, hp2 + 1 === health ? "half" : "full", state.hardcore)} x={x} y={y} />);
    }
  }

  const armor = state.armor;
  if (survival && armor > 0) {
    const ay = top - (rows - 1) * rowH - 10;
    for (let i = 0; i < 10; i++) out.push(<Icon key={`r${i}`} url={armorUrl(i * 2 + 1 < armor ? "full" : i * 2 + 1 === armor ? "half" : "empty")} x={left + i * 8} y={ay} />);
  }

  // Vanilla renderVehicleHealth: heart count follows the mount's max health (capped at 30), shown in every game mode.
  let rightRows = 1;
  const mountMax = state.mountMaxHealth ?? state.mountHealth;
  if (state.mountHealth !== undefined && mountMax !== undefined) {
    const mh = Math.ceil(state.mountHealth);
    const mHearts = Math.min(Math.floor((mountMax + 0.5) / 2), 30);
    rightRows = Math.ceil(mHearts / 10);
    for (let i = 0; i < mHearts; i++) {
      const x = right - (i % 10) * 8 - 9;
      const y = top - Math.floor(i / 10) * 10;
      out.push(<Icon key={`mc${i}`} url={heartUrl("vehicle", "empty")} x={x} y={y} />);
      if (i * 2 + 1 < mh) out.push(<Icon key={`m${i}`} url={heartUrl("vehicle", "full")} x={x} y={y} />);
      else if (i * 2 + 1 === mh) out.push(<Icon key={`m${i}`} url={heartUrl("vehicle", "half")} x={x} y={y} />);
    }
  } else if (survival) {
    const food = state.food;
    for (let i = 0; i < 10; i++) {
      const x = right - i * 8 - 9;
      let y = top;
      if (state.saturation <= 0 && tick % (food * 3 + 1) === 0) y += Math.floor(rand(tick * 7 + i) * 3) - 1;
      out.push(<Icon key={`fc${i}`} url={foodUrl("empty", hungerFx)} x={x} y={y} />);
      if (i * 2 + 1 < food) out.push(<Icon key={`f${i}`} url={foodUrl("full", hungerFx)} x={x} y={y} />);
      else if (i * 2 + 1 === food) out.push(<Icon key={`f${i}`} url={foodUrl("half", hungerFx)} x={x} y={y} />);
    }
  }

  if (survival && (state.underwater || state.air < 300)) {
    const air = Math.max(0, Math.min(300, state.air));
    const full = Math.ceil(((air - 2) * 10) / 300);
    const popping = Math.ceil((air * 10) / 300) - full;
    const by = top - rightRows * 10;
    for (let i = 0; i < full + popping; i++) out.push(<Icon key={`o${i}`} url={bubbleUrl(i >= full)} x={right - i * 8 - 9} y={by} />);
  }

  return <>{out}</>;
}
