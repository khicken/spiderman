import type { PlayerData } from "./data/types";
import { IN } from "./contracts";

// Skeleton layout and body proportions for the procedural athletes. Owner: players builder.
// MODEL SPACE: feet on y = 0, facing +z, the athlete's LEFT side is +x (so the right hand is at -x).
// Every bone's rest orientation is identity in model space (bones are only translated in the bind pose), so a local
// rotation is always "relative to the bind pose" and model-space rest directions are plain vectors.

export const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  clavL: 5, armL: 6, foreL: 7, handL: 8,
  clavR: 9, armR: 10, foreR: 11, handR: 12,
  thighL: 13, shinL: 14, footL: 15,
  thighR: 16, shinR: 17, footR: 18,
} as const;
export const BONES = 19;
export const PARENT: readonly number[] = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17];
/** Bone indices of one side's limbs. side 0 = left (+x), 1 = right (-x). */
export const ARM = [
  { clav: B.clavL, arm: B.armL, fore: B.foreL, hand: B.handL },
  { clav: B.clavR, arm: B.armR, fore: B.foreR, hand: B.handR },
] as const;
export const LEG = [
  { thigh: B.thighL, shin: B.shinL, foot: B.footL },
  { thigh: B.thighR, shin: B.shinR, foot: B.footR },
] as const;
/** Model-space x sign of a side: left +1, right -1. */
export const SX = [1, -1] as const;

export interface Body {
  H: number; // standing height (m)
  g: number; // girth factor from BMI (~0.9 slim .. 1.18 heavy)
  rest: Float32Array; // BONES * 3 model-space bind positions
  upper: number; // shoulder->elbow
  fore: number; // elbow->wrist
  hand: number; // wrist->fingertip
  thigh: number; // hip->knee
  shin: number; // knee->ankle
  ankleH: number; // ankle joint height when standing
  footLen: number;
  heelBack: number; // heel behind the ankle
  hipX: number; // |x| of the hip joints
  shX: number; // |x| of the shoulder joints
  shY: number; // shoulder top line
  chinY: number;
  headC: [number, number, number]; // head center (model)
  headR: [number, number, number]; // head half extents (x, y, z)
  armTilt: number; // A-pose: arm rest direction tilt outward (x per unit down)
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function bodyOf(heightIn: number, weightLb: number): Body {
  const H = heightIn * IN;
  const bmi = (weightLb / (heightIn * heightIn)) * 703;
  const g = clamp(Math.sqrt(bmi / 24.5), 0.9, 1.2);
  const gs = Math.sqrt(g);
  const headR: [number, number, number] = [0.083, 0.12, 0.104];
  const chinY = H - 0.236;
  const shY = H - 0.322;
  const headC: [number, number, number] = [0, H - 0.118, 0.012];
  const armF = 1.035; // pros have long arms (wingspan ~1.06 x height)
  const upper = 0.172 * H * armF;
  const fore = 0.148 * H * armF;
  const hand = 0.106 * H;
  const hipX = (0.044 * H + 0.008) * gs;
  const shX = (0.083 * H + 0.03) * gs;
  const ankleH = 0.044 * H;
  const kneeY = 0.284 * H;
  const hipY = 0.525 * H;
  const footLen = 0.152 * H + 0.012;
  const armTilt = 0.1;
  const rest = new Float32Array(BONES * 3);
  const set = (b: number, x: number, y: number, z: number) => {
    rest[b * 3] = x;
    rest[b * 3 + 1] = y;
    rest[b * 3 + 2] = z;
  };
  set(B.hips, 0, 0.552 * H, 0);
  set(B.spine, 0, 0.615 * H, -0.008);
  set(B.chest, 0, 0.7 * H, -0.006);
  set(B.neck, 0, shY + 0.012, -0.014);
  set(B.head, 0, chinY + 0.035, -0.004);
  const inv = 1 / Math.sqrt(1 + armTilt * armTilt);
  for (let s = 0; s < 2; s++) {
    const sx = SX[s];
    const a = ARM[s];
    set(a.clav, sx * 0.03, shY - 0.03, -0.012);
    const shx = sx * shX;
    const shy = shY - 0.048;
    set(a.arm, shx, shy, -0.016);
    const ex = shx + sx * armTilt * inv * upper;
    const ey = shy - inv * upper;
    set(a.fore, ex, ey, -0.02);
    set(a.hand, ex + sx * armTilt * inv * fore, ey - inv * fore, -0.006);
    const l = LEG[s];
    set(l.thigh, sx * hipX, hipY, 0);
    set(l.shin, sx * (hipX - 0.002), kneeY, 0.012);
    set(l.foot, sx * (hipX - 0.002), ankleH, -0.012);
  }
  const d = (b: number, p: number) =>
    Math.hypot(rest[b * 3] - rest[p * 3], rest[b * 3 + 1] - rest[p * 3 + 1], rest[b * 3 + 2] - rest[p * 3 + 2]);
  return {
    H, g, rest,
    upper: d(B.foreL, B.armL), fore: d(B.handL, B.foreL), hand,
    thigh: d(B.shinL, B.thighL), shin: d(B.footL, B.shinL),
    ankleH, footLen, heelBack: footLen * 0.24, hipX, shX, shY, chinY, headC, headR, armTilt,
  };
}

export function bodyFor(p: PlayerData): Body {
  return bodyOf(p.heightIn, p.weightLb);
}

/** Small deterministic hash of a string into [0, 1). Used for per-player looks (shoes, sleeves, hair color). */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
