import type { PrologueStep, ThreadAnchor } from "./contracts";
import { PROLOGUE } from "./contracts";
import type { SiteEnv } from "./landmark-kit";

/** Anchor id the world track gives the gate brazier. The guide also emits `threadFire` with it when Wren lights it. */
export const GATE_ANCHOR = "prologue:gate-brazier";
/** TrackTarget item id for the gate brazier (LandmarksV2.targetPos resolves it to PROLOGUE.gateBrazier). */
export const GATE_ITEM = "gate-brazier";

export const PROLOGUE_ORDER: readonly PrologueStep[] = [
  "wake", "gate", "vista", "stones", "climb", "ride", "glade", "gladePull", "gladeFight", "gladeCarry", "done",
];

/** Seconds and meters for the prologue beats (DESIGN-V2.md section 2). */
export const BEAT = {
  wakeSecs: 4, // wake cine; skippable after wakeSkipAfter
  wakeSkipAfter: 1,
  objectiveDelay: 2, // objective fades in 2 s after control returns (0:06)
  litToVista: 2, // brazier roars, then the vista cine starts (0:18)
  vistaSecs: 3,
  arenaSecs: 2.5,
  useR: 3, // "Light" prompt radius at the gate brazier
  stonesR: 9, // jump chip zone around the stepping stones
  climbR: 7, // climb chip zone at the foot of the climb rock
  rockTopR: 5, // standing on the rock top within this of its center counts as "on top"
  gladeR: 30,
  offPathR: 40, // Tallow says "The beacon is that way." past this
} as const;

/** What the step machine needs to know this frame. Plain numbers, so a script can drive it. */
export interface PrologueFacts {
  stepT: number; // seconds in the current step
  x: number; y: number; z: number; // Wren's feet
  ground: number; // terrain height under Wren
  anyInput: boolean; // a button or the stick this frame (skips the wake cine)
  gateLit: boolean;
  riding: boolean;
  gladeLit: boolean;
  gladeRoom: 0 | 1 | 2 | 3; // glade trial room reached: 1 pull, 2 fight, 3 carry (see guide.ts)
}

const d2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Next prologue step. Steps only move forward; a step can be skipped when the player gets ahead of the script. */
export function stepPrologue(step: PrologueStep, f: PrologueFacts): PrologueStep {
  if (f.gladeLit) return "done";
  const P = PROLOGUE;
  const inGlade = d2(f.x, f.z, P.glade.x, P.glade.z) < BEAT.gladeR;
  switch (step) {
    case "wake":
      return f.stepT >= BEAT.wakeSecs || (f.anyInput && f.stepT >= BEAT.wakeSkipAfter) ? "gate" : step;
    case "gate":
      return f.gateLit ? "vista" : step;
    case "vista":
      return f.stepT >= BEAT.litToVista + BEAT.vistaSecs ? "stones" : step;
    case "stones":
      if (inGlade) return "glade";
      return d2(f.x, f.z, P.climbRock.x, P.climbRock.z) < BEAT.climbR + 4 || f.z < P.ledge.z - 4 ? "climb" : step;
    case "climb": {
      if (inGlade) return "glade";
      const onTop = d2(f.x, f.z, P.climbRock.x, P.climbRock.z) < BEAT.rockTopR && f.y > f.ground + P.climbRock.h - 1.5;
      const past = f.z < P.climbRock.z - 6; // walked round the rock
      return onTop || past ? "ride" : step;
    }
    case "ride":
      return inGlade && !f.riding ? "glade" : step;
    case "glade":
      return f.gladeRoom >= 1 ? "gladePull" : step;
    case "gladePull":
      return f.gladeRoom >= 2 ? "gladeFight" : step;
    case "gladeFight":
      return f.gladeRoom >= 3 ? "gladeCarry" : step;
    default:
      return step;
  }
}

/** The prologue path as a polyline (for "off the path" checks). */
export const PROLOGUE_PATH: readonly { x: number; z: number }[] = [
  { x: -60, z: 380 }, PROLOGUE.gateBrazier, PROLOGUE.stones, PROLOGUE.ledge, PROLOGUE.climbRock, PROLOGUE.knotB, PROLOGUE.glade,
];

/** Distance on xz from (x, z) to the prologue path. */
export function offPath(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PROLOGUE_PATH.length - 1; i++) {
    const a = PROLOGUE_PATH[i], b = PROLOGUE_PATH[i + 1];
    const ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2)) : 0;
    best = Math.min(best, d2(x, z, a.x + ex * t, a.z + ez * t));
  }
  return best;
}

/** Prologue site hooks. The world track builds the gate brazier and its anchor; this adds the "Light" prompt.
 *  Call from landmarks.ts with the gate brazier anchor (id GATE_ANCHOR). Pressing E lights it. */
export function buildPrologue(env: SiteEnv, gate: ThreadAnchor | null): { lit(): boolean } {
  const P = PROLOGUE.gateBrazier;
  let lit = false;
  const isLit = () => lit || (gate !== null && gate.lit);
  env.reg.interact({
    id: "prologue-gate-light",
    x: P.x,
    y: env.world.heightAt(P.x, P.z) + 1,
    z: P.z,
    r: BEAT.useR,
    label: () => (isLit() ? null : "Light"),
    use: () => {
      lit = true;
      if (gate) gate.lit = true;
    },
  });
  return { lit: isLit };
}
