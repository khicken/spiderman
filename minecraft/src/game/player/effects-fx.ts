import type { GameCtx } from "../contracts";
import { EFFECTS } from "../ui/data";
import type { PlayerState } from "./state";

export interface EffectView {
  nightVision: number;
  blindness: number;
  darkness: number;
  nausea: number;
  confused: number;
}

const view: EffectView = { nightVision: 0, blindness: 0, darkness: 0, nausea: 0, confused: 0 };
let spin = 0, prevSpin = 0, spinTick = -1;
let portalSpin = 0;

// Vanilla spinningEffectIntensity: standing in a nether portal warps the view like nausea.
export function setPortalSpin(v: number): void {
  portalSpin = v;
}

const ticksOf = (p: PlayerState, id: string) => p.effects.find((e) => e.id === id)?.ticks ?? 0;

// Vanilla LivingEntity.updateSynchronizedMobState: swirl particles in the blended effect color, fewer while invisible.
export function tickEffectParticles(p: PlayerState, ctx: GameCtx): void {
  if (!p.effects.length || p.dead) return;
  const invisible = p.hasEffect("invisibility") > 0;
  if (ctx.random() >= (invisible ? 1 / 15 : 0.5)) return;
  let r = 0, g = 0, b = 0, n = 0;
  for (const e of p.effects) {
    const c = EFFECTS[e.id]?.color;
    if (c === undefined) continue;
    const w = e.amplifier + 1;
    r += ((c >> 16) & 255) * w;
    g += ((c >> 8) & 255) * w;
    b += (c & 255) * w;
    n += w;
  }
  if (!n) return;
  const color = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  const bd = p.body;
  const top = p.thirdPerson === 0 ? Math.max(0.1, p.eyeHeight - 0.7) : bd.height;
  ctx.emit({ type: "particles", kind: "dust", x: bd.pos.x + (ctx.random() - 0.5) * bd.width, y: bd.pos.y + ctx.random() * top, z: bd.pos.z + (ctx.random() - 0.5) * bd.width, count: 1, color });
}

// Strengths for the renderer and camera. Night vision flickers through its last 10 s; blindness fades over 20 ticks; darkness pulses.
// confused is the nausea spin while the effect is active, for the Distortion Effects tint.
export function effectView(p: PlayerState, pt: number): EffectView {
  const nv = ticksOf(p, "night_vision");
  view.nightVision = nv <= 0 ? 0 : nv > 200 ? 1 : 0.7 + Math.sin((nv - pt) * Math.PI * 0.2) * 0.3;
  if (p.hasEffect("conduit_power") > 0 && p.wasInWater) view.nightVision = Math.max(view.nightVision, 1);
  const bl = ticksOf(p, "blindness");
  view.blindness = bl <= 0 ? 0 : Math.min(1, bl / 20);
  const dk = ticksOf(p, "darkness");
  view.darkness = dk <= 0 ? 0 : (0.45 * Math.cos(((p.ticks + pt) / 22) * Math.PI) + 0.55) * Math.min(1, dk / 20);
  // Vanilla LocalPlayer.handleConfusionTransitionEffect, stepped once per player tick.
  if (spinTick < 0 || p.ticks < spinTick || p.ticks - spinTick > 20) spinTick = p.ticks;
  for (; spinTick < p.ticks; spinTick++) {
    prevSpin = spin;
    spin = Math.max(0, Math.min(1, spin + (ticksOf(p, "nausea") > 60 ? 1 / 150 : -0.05)));
  }
  view.nausea = Math.max(prevSpin + (spin - prevSpin) * pt, portalSpin);
  view.confused = p.hasEffect("nausea") > 0 ? view.nausea : 0;
  return view;
}
