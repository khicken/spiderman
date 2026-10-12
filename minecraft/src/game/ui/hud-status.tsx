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

export function StatusBars({ state, width, height }: StatusProps) {
  const left = Math.floor(width / 2 - 91);
  const right = Math.floor(width / 2 + 91);
  const top = height - 39;
  const absorbEffect = state.effects.find((e) => e.id === "absorption");
  const absorb = absorbEffect ? (absorbEffect.amplifier + 1) * 4 : 0;
  const regen = state.effects.some((e) => e.id === "regeneration");
  const hungerFx = state.effects.some((e) => e.id === "hunger");
  const health = Math.ceil(state.health);
  const low = health + absorb <= 4;

  const prev = useRef(health);
  const [blinkUntil, setBlinkUntil] = useState(0);
  useEffect(() => {
    if (health < prev.current) setBlinkUntil(performance.now() + 1000);
    prev.current = health;
  }, [health]);
  const blinking = blinkUntil > 0 && performance.now() < blinkUntil;
  const tick = useTicks(low || regen || blinking || state.saturation <= 0);

  const maxHp = Math.max(state.maxHealth, health);
  const maxHearts = Math.ceil(maxHp / 2);
  const absorbHearts = Math.ceil(absorb / 2);
  const rows = Math.ceil((maxHp + absorb) / 2 / 10);
  const rowH = Math.max(10 - (rows - 2), 3);
  const regenIdx = regen ? tick % Math.ceil(maxHp + 5) : -1;
  const kind: HeartKind = state.poisoned ? "poisoned" : state.withered ? "withered" : state.frozen ? "frozen" : "normal";
  const blinkOn = blinking && Math.floor(tick / 3) % 2 === 0;

  const out: React.ReactNode[] = [];
  for (let i = maxHearts + absorbHearts - 1; i >= 0; i--) {
    const x = left + (i % 10) * 8;
    let y = top - Math.floor(i / 10) * rowH;
    if (low) y += Math.floor(rand(tick * 312871 + i) * 2);
    if (i < maxHearts && i === regenIdx) y -= 2;
    out.push(<Icon key={`c${i}`} url={heartUrl("normal", "empty", state.hardcore, blinkOn)} x={x} y={y} />);
    if (i >= maxHearts) {
      const a = (i - maxHearts) * 2;
      out.push(<Icon key={`h${i}`} url={heartUrl("absorbing", a + 1 < absorb ? "full" : "half", state.hardcore)} x={x} y={y} />);
    } else if (i * 2 < health) {
      out.push(<Icon key={`h${i}`} url={heartUrl(kind, i * 2 + 1 < health ? "full" : "half", state.hardcore)} x={x} y={y} />);
    }
  }

  const armor = state.armor;
  if (armor > 0) {
    const ay = top - (rows - 1) * rowH - 10;
    for (let i = 0; i < 10; i++) out.push(<Icon key={`a${i}`} url={armorUrl(i * 2 + 1 < armor ? "full" : i * 2 + 1 === armor ? "half" : "empty")} x={left + i * 8} y={ay} />);
  }

  let rightRows = 1;
  if (state.mountHealth !== undefined) {
    const mh = Math.ceil(state.mountHealth);
    const mHearts = Math.min(Math.ceil(mh / 2), 30);
    rightRows = Math.ceil(mHearts / 10);
    for (let i = 0; i < Math.max(mHearts, 1); i++) {
      const x = right - (i % 10) * 8 - 9;
      const y = top - Math.floor(i / 10) * 10;
      out.push(<Icon key={`mc${i}`} url={heartUrl("normal", "empty")} x={x} y={y} />);
      if (i * 2 < mh) out.push(<Icon key={`m${i}`} url={heartUrl("normal", i * 2 + 1 < mh ? "full" : "half")} x={x} y={y} />);
    }
  } else {
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

  if (state.underwater || state.air < 300) {
    const air = Math.max(0, state.air);
    const full = Math.ceil(((air - 2) * 10) / 300);
    const popping = Math.ceil((air * 10) / 300) - full;
    const by = top - rightRows * 10;
    for (let i = 0; i < full + popping; i++) out.push(<Icon key={`b${i}`} url={bubbleUrl(i >= full)} x={right - i * 8 - 9} y={by} />);
  }

  return <>{out}</>;
}
