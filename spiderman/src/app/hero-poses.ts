import type { HeroPose } from "./contracts";
import { TAU, clamp01, sstep } from "./hero-body";

export const JOINTS = ["hips", "spine", "head", "shL", "elL", "waL", "shR", "elR", "waR", "hipL", "knL", "ftL", "hipR", "knR", "ftR"] as const;
type J = (typeof JOINTS)[number];
type A3 = [number, number, number];

const NJ = JOINTS.length;
const JI = Object.fromEntries(JOINTS.map((j, i) => [j, i * 3])) as Record<J, number>;

// Non-joint channels after the joint rotations
export const CH = {
  lift: NJ * 3, // pivot height in root space, added after ground fit
  pitch: NJ * 3 + 1, // pivot rotation, wrapped angles
  yaw: NJ * 3 + 2,
  roll: NJ * 3 + 3,
  fistL: NJ * 3 + 4,
  fistR: NJ * 3 + 5,
  thwipL: NJ * 3 + 6, // index and pinky out
  thwipR: NJ * 3 + 7,
  peaceL: NJ * 3 + 8, // index and middle out
  peaceR: NJ * 3 + 9,
  wing: NJ * 3 + 10,
  ground: NJ * 3 + 11, // weight of the foot-to-floor fit
} as const;
export const NCH = NJ * 3 + 12;
export const ANGLES = [CH.pitch, CH.yaw, CH.roll];

export type Pose = Float32Array;
export type Ctx = { phase: number; hand: "L" | "R"; t: number; swing: number; speed: number; vy: number; turn: number };

type Def = Partial<Record<J, A3>> & {
  lift?: number;
  pitch?: number;
  yaw?: number;
  roll?: number;
  fistL?: number;
  fistR?: number;
  thwipL?: number;
  thwipR?: number;
  peaceL?: number;
  peaceR?: number;
  wing?: number;
  ground?: number;
};

const BASE: Def = {
  shL: [0, 0, 0.1],
  elL: [-0.15, 0, 0],
  shR: [0, 0, -0.1],
  elR: [-0.15, 0, 0],
  hipL: [0, 0, 0.04],
  knL: [0.05, 0, 0],
  hipR: [0, 0, -0.04],
  knR: [0.05, 0, 0],
  fistL: 0.2,
  fistR: 0.2,
};

const CH_KEYS = Object.keys(CH) as (keyof typeof CH)[];

function P(d: Def): Pose {
  const p = new Float32Array(NCH);
  const all = { ...BASE, ...d };
  for (const j of JOINTS) {
    const v = all[j];
    if (v) p.set(v, JI[j]);
  }
  for (const k of CH_KEYS) {
    const v = all[k];
    if (typeof v === "number") p[CH[k]] = v;
  }
  if (p[CH.ground] > 0) {
    const base = p[JI.hips] + p[CH.pitch];
    p[JI.ftL] -= base + p[JI.hipL] + p[JI.knL];
    p[JI.ftR] -= base + p[JI.hipR] + p[JI.knR];
  }
  return p;
}

const SWAP: [number, number][] = [];
for (const j of JOINTS)
  if (j.endsWith("L")) SWAP.push([JI[j], JI[(j.slice(0, -1) + "R") as J]]);

function mirror(p: Pose): Pose {
  const m = new Float32Array(p);
  for (const [a, b] of SWAP)
    for (let c = 0; c < 3; c++) {
      m[a + c] = p[b + c];
      m[b + c] = p[a + c];
    }
  for (let j = 0; j < NJ; j++) {
    m[j * 3 + 1] *= -1;
    m[j * 3 + 2] *= -1;
  }
  m[CH.yaw] *= -1;
  m[CH.roll] *= -1;
  for (const [a, b] of [
    [CH.fistL, CH.fistR],
    [CH.thwipL, CH.thwipR],
    [CH.peaceL, CH.peaceR],
  ]) {
    m[a] = p[b];
    m[b] = p[a];
  }
  return m;
}

const cr = (p0: number, p1: number, p2: number, p3: number, u: number) =>
  p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));

function curve(out: Pose, k: Pose[], u: number, cyclic: boolean) {
  const n = k.length;
  let i: number;
  let f: number;
  if (cyclic) {
    const w = ((u % n) + n) % n;
    i = Math.floor(w);
    f = w - i;
  } else {
    const c = Math.min(Math.max(u, 0), n - 1);
    i = Math.min(Math.floor(c), n - 2);
    f = c - i;
  }
  const at = (x: number) => k[cyclic ? (x + n) % n : Math.min(Math.max(x, 0), n - 1)];
  const a = at(i - 1);
  const b = at(i);
  const c = at(i + 1);
  const d = at(i + 2);
  for (let q = 0; q < NCH; q++) out[q] = cr(a[q], b[q], c[q], d[q], f);
  return out;
}

function seq(out: Pose, k: Pose[], times: number[], p: number) {
  const x = clamp01(p);
  let i = 0;
  while (i < times.length - 2 && x > times[i + 1]) i++;
  return curve(out, k, i + clamp01((x - times[i]) / (times[i + 1] - times[i])), false);
}

function mix(out: Pose, a: Pose, b: Pose, k: number) {
  for (let q = 0; q < NCH; q++) out[q] = a[q] + (b[q] - a[q]) * k;
  return out;
}

const add = (p: Pose, j: J, x: number, y = 0, z = 0) => {
  p[JI[j]] += x;
  p[JI[j] + 1] += y;
  p[JI[j] + 2] += z;
};

const easeIO = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const bell = (x: number, a: number, b: number, fade = 0.12) => sstep(a - fade, a, x) * (1 - sstep(b, b + fade, x));

const LOOKS = [0, 0.55, 0.1, -0.45, -0.05, 0.3, -0.6, 0.15];
function look(t: number) {
  const s = t / 3.1;
  const i = Math.floor(s);
  const a = LOOKS[((i % LOOKS.length) + LOOKS.length) % LOOKS.length];
  const b = LOOKS[(((i + 1) % LOOKS.length) + LOOKS.length) % LOOKS.length];
  return a + (b - a) * sstep(0.78, 0.97, s - i);
}

const idleBase = P({
  ground: 1,
  spine: [0.05, 0, 0],
  head: [-0.05, 0, 0],
  shL: [0.05, 0, 0.2],
  shR: [0.05, 0, -0.2],
  elL: [-0.35, 0, 0],
  elR: [-0.35, 0, 0],
  hipL: [-0.05, 0.12, 0.11],
  hipR: [0.05, -0.12, -0.1],
  knL: [0.14, 0, 0],
  knR: [0.1, 0, 0],
  fistL: 0.4,
  fistR: 0.4,
});

const guard = P({
  ground: 1,
  hips: [0.08, -0.4, 0],
  spine: [0.22, 0.32, 0],
  head: [-0.18, 0.08, 0],
  shL: [-0.95, 0, 0.3],
  elL: [-2.0, 0, 0],
  waL: [0, 0.4, 0],
  shR: [-0.55, 0, -0.42],
  elR: [-2.15, 0, 0],
  waR: [0, -0.4, 0],
  hipL: [-0.5, 0.25, 0.2],
  knL: [0.7, 0, 0],
  hipR: [0.12, 0.25, -0.16],
  knR: [0.6, 0, 0],
  fistL: 1,
  fistR: 1,
});

const runHalf = [
  // contact
  P({
    ground: 1,
    hips: [0, -0.14, 0],
    spine: [0.28, 0.22, 0],
    head: [-0.28, -0.12, 0],
    hipL: [-0.8, 0, 0.04],
    knL: [0.3, 0, 0],
    ftL: [-0.15, 0, 0],
    hipR: [0.45, 0, -0.04],
    knR: [1.0, 0, 0],
    ftR: [0.45, 0, 0],
    shR: [-0.75, 0, -0.12],
    elR: [-1.65, 0, 0],
    shL: [0.6, 0, 0.14],
    elL: [-1.1, 0, 0],
    fistL: 0.8,
    fistR: 0.8,
  }),
  // down
  P({
    ground: 1,
    hips: [0, -0.06, 0],
    spine: [0.34, 0.1, 0],
    head: [-0.34, -0.05, 0],
    hipL: [-0.4, 0, 0.04],
    knL: [0.75, 0, 0],
    hipR: [0.15, 0, -0.04],
    knR: [1.7, 0, 0],
    ftR: [0.55, 0, 0],
    shR: [-0.35, 0, -0.12],
    elR: [-1.55, 0, 0],
    shL: [0.3, 0, 0.14],
    elL: [-1.25, 0, 0],
    fistL: 0.8,
    fistR: 0.8,
    lift: -0.05,
  }),
  // passing
  P({
    ground: 1,
    hips: [0, 0.04, 0],
    spine: [0.3, -0.04, 0],
    head: [-0.3, 0.02, 0],
    hipL: [0.1, 0, 0.04],
    knL: [0.4, 0, 0],
    hipR: [-0.6, 0, -0.04],
    knR: [1.95, 0, 0],
    ftR: [0.35, 0, 0],
    shR: [0.05, 0, -0.12],
    elR: [-1.4, 0, 0],
    shL: [-0.1, 0, 0.14],
    elL: [-1.4, 0, 0],
    fistL: 0.8,
    fistR: 0.8,
  }),
  // push off
  P({
    ground: 1,
    hips: [0, 0.12, 0],
    spine: [0.26, -0.18, 0],
    head: [-0.26, 0.1, 0],
    hipL: [0.55, 0, 0.04],
    knL: [0.25, 0, 0],
    ftL: [0.7, 0, 0],
    hipR: [-1.05, 0, -0.04],
    knR: [1.45, 0, 0],
    ftR: [0.2, 0, 0],
    shR: [0.55, 0, -0.12],
    elR: [-1.15, 0, 0],
    shL: [-0.7, 0, 0.14],
    elL: [-1.65, 0, 0],
    fistL: 0.8,
    fistR: 0.8,
    lift: 0.06,
  }),
];
const runKeys = [...runHalf, ...runHalf.map(mirror)];

const sprintKeys = runKeys.map((k) => {
  const s = new Float32Array(k);
  for (const j of ["hipL", "hipR", "shL", "shR"] as J[]) s[JI[j]] = (k[JI[j]] + 0.2) * 1.3 - 0.2;
  for (const j of ["knL", "knR"] as J[]) s[JI[j]] = k[JI[j]] * 1.15;
  s[JI.spine] += 0.22;
  s[JI.head] -= 0.22;
  s[JI.hips] += 0.06;
  s[JI.ftL] -= 0.06;
  s[JI.ftR] -= 0.06;
  s[CH.lift] *= 1.5;
  return s;
});

const wallHalf = [
  P({
    ground: 1,
    hips: [0.2, -0.12, 0],
    spine: [1.0, 0.15, 0],
    head: [-1.1, -0.1, 0],
    hipL: [-1.45, 0, 0.3],
    knL: [1.4, 0, 0],
    hipR: [-0.3, 0, -0.3],
    knR: [1.9, 0, 0],
    shR: [-1.9, 0, -0.35],
    elR: [-0.3, 0, 0],
    shL: [-0.6, 0, 0.4],
    elL: [-0.9, 0, 0],
    waL: [0.8, 0, 0],
    waR: [0.8, 0, 0],
    fistL: 0,
    fistR: 0,
  }),
  P({
    ground: 1,
    hips: [0.2, 0, 0],
    spine: [1.05, 0, 0],
    head: [-1.15, 0, 0],
    hipL: [-0.9, 0, 0.3],
    knL: [1.7, 0, 0],
    hipR: [-1.0, 0, -0.3],
    knR: [2.1, 0, 0],
    shR: [-1.3, 0, -0.35],
    elR: [-0.6, 0, 0],
    shL: [-1.2, 0, 0.4],
    elL: [-0.7, 0, 0],
    waL: [0.8, 0, 0],
    waR: [0.8, 0, 0],
    fistL: 0,
    fistR: 0,
    lift: 0.05,
  }),
];
const wallKeys = [...wallHalf, ...wallHalf.map(mirror)];

const crouch = P({
  ground: 1,
  spine: [0.75, 0, 0],
  head: [-0.7, 0, 0],
  shL: [-0.65, 0, 0.45],
  shR: [-0.65, 0, -0.45],
  elL: [-1.0, 0, 0],
  elR: [-1.0, 0, 0],
  hipL: [-1.75, 0.3, 0.45],
  hipR: [-1.75, -0.3, -0.45],
  knL: [2.35, 0, 0],
  knR: [2.35, 0, 0],
  fistL: 0.5,
  fistR: 0.5,
});

const perch = P({
  ground: 1,
  hips: [0.35, 0, 0],
  spine: [0.62, 0, 0],
  head: [-0.95, 0.1, 0],
  hipL: [-2.05, 0.45, 0.62],
  knL: [2.6, 0, 0],
  hipR: [-2.05, -0.45, -0.62],
  knR: [2.6, 0, 0],
  shR: [-0.75, 0, 0.05],
  elR: [-0.15, 0, 0],
  waR: [0.2, 0, -0.9],
  shL: [-0.85, 0.1, 0.7],
  elL: [-1.45, 0, 0],
  fistL: 0.55,
  fistR: 0,
});

const landKeys = [
  // impact: three-point landing
  P({
    ground: 1,
    hips: [0.35, 0, 0],
    spine: [0.65, 0.15, 0],
    head: [-0.95, -0.1, 0],
    hipL: [-1.65, 0.2, 0.38],
    knL: [2.45, 0, 0],
    hipR: [0.05, 0, -0.42],
    knR: [2.2, 0, 0],
    ftR: [1.2, 0, 0],
    shR: [-1.05, 0, 0.12],
    elR: [-0.15, 0, 0],
    waR: [0, 0, -1.0],
    shL: [0.9, 0, 1.1],
    elL: [-0.3, 0, 0],
    fistR: 0,
    fistL: 0.3,
  }),
  P({
    ground: 1,
    hips: [0.45, 0, 0],
    spine: [0.75, 0.15, 0],
    head: [-1.05, -0.1, 0],
    hipL: [-1.85, 0.2, 0.42],
    knL: [2.6, 0, 0],
    hipR: [0.0, 0, -0.45],
    knR: [2.4, 0, 0],
    ftR: [1.25, 0, 0],
    shR: [-0.95, 0, 0.12],
    elR: [-0.3, 0, 0],
    waR: [0, 0, -1.1],
    shL: [1.1, 0, 1.2],
    elL: [-0.25, 0, 0],
    fistR: 0,
    fistL: 0.3,
  }),
  idleBase,
];

const rise = P({
  spine: [0.12, 0, 0],
  head: [-0.25, 0, 0],
  shL: [-1.4, 0, 0.55],
  elL: [-0.9, 0, 0],
  shR: [-0.4, 0, -0.95],
  elR: [-0.7, 0, 0],
  hipL: [-1.55, 0, 0.1],
  knL: [2.1, 0, 0],
  hipR: [-0.35, 0, -0.08],
  knR: [1.1, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.7, 0, 0],
  fistL: 0.6,
  fistR: 0.6,
});

const fall = P({
  spine: [-0.15, 0, 0],
  head: [-0.25, 0, 0],
  shL: [-0.4, 0, 1.45],
  shR: [-0.4, 0, -1.45],
  elL: [-0.5, 0, 0],
  elR: [-0.5, 0, 0],
  hipL: [-1.0, 0, 0.15],
  knL: [1.7, 0, 0],
  hipR: [0.05, 0, -0.1],
  knR: [0.6, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.6, 0, 0],
  fistL: 0.1,
  fistR: 0.1,
});

const tuck = P({
  spine: [0.6, 0, 0],
  head: [0.35, 0, 0],
  shL: [-1.3, 0, 0.3],
  shR: [-1.3, 0, -0.3],
  elL: [-1.7, 0, 0],
  elR: [-1.7, 0, 0],
  hipL: [-2.1, 0, 0.12],
  hipR: [-2.1, 0, -0.12],
  knL: [2.5, 0, 0],
  knR: [2.5, 0, 0],
  ftL: [0.4, 0, 0],
  ftR: [0.4, 0, 0],
  fistL: 1,
  fistR: 1,
});

const dive = P({
  spine: [-0.12, 0, 0],
  head: [-0.75, 0, 0],
  shL: [0.3, 0, 0.3],
  shR: [0.3, 0, -0.3],
  elL: [0, 0, 0],
  elR: [0, 0, 0],
  waL: [0.3, 0, 0],
  waR: [0.3, 0, 0],
  hipL: [0.12, 0, 0.04],
  hipR: [0.12, 0, -0.04],
  knL: [0.25, 0, 0],
  knR: [0.4, 0, 0],
  ftL: [0.8, 0, 0],
  ftR: [0.8, 0, 0],
  fistL: 0.1,
  fistR: 0.1,
});

const zip = P({
  spine: [0.15, 0, 0],
  head: [-0.35, 0, 0],
  shL: [-2.75, 0, -0.1],
  shR: [-2.75, 0, 0.1],
  elL: [0, 0, 0],
  elR: [0, 0, 0],
  hipL: [0.3, 0, 0.06],
  hipR: [0.45, 0, -0.06],
  knL: [0.9, 0, 0],
  knR: [0.7, 0, 0],
  ftL: [0.6, 0, 0],
  ftR: [0.6, 0, 0],
  fistL: 1,
  fistR: 1,
});

// Swing keys for the right web hand, from downswing to the top of the arc
const webR: Def = { shR: [-3.0, 0, 0.14], elR: [0, 0, 0], fistR: 1 };
const swingR = [
  P({
    ...webR,
    spine: [-0.15, 0.2, 0],
    head: [-0.2, -0.2, 0],
    shL: [0.5, 0, 0.95],
    elL: [-0.6, 0, 0],
    hipL: [-0.8, 0, 0.08],
    knL: [0.35, 0, 0],
    hipR: [-0.95, 0, -0.06],
    knR: [0.2, 0, 0],
    ftL: [0.6, 0, 0],
    ftR: [0.65, 0, 0],
    fistL: 0.3,
  }),
  P({
    ...webR,
    spine: [0.08, 0.2, 0],
    head: [-0.3, -0.2, 0],
    shL: [0.25, 0, 0.75],
    elL: [-1.0, 0, 0],
    hipL: [-1.35, 0, 0.1],
    knL: [1.0, 0, 0],
    hipR: [-1.2, 0, -0.08],
    knR: [0.65, 0, 0],
    ftL: [0.55, 0, 0],
    ftR: [0.6, 0, 0],
    fistL: 0.5,
  }),
  P({
    ...webR,
    spine: [0.38, 0.15, 0],
    head: [-0.5, -0.15, 0],
    shL: [-0.6, 0, 0.45],
    elL: [-1.7, 0, 0],
    hipL: [-2.05, 0, 0.14],
    knL: [2.35, 0, 0],
    hipR: [-1.65, 0, -0.12],
    knR: [2.0, 0, 0],
    ftL: [0.5, 0, 0],
    ftR: [0.5, 0, 0],
    fistL: 1,
  }),
  P({
    ...webR,
    spine: [0.0, 0.1, 0],
    head: [-0.35, -0.1, 0],
    shL: [-1.3, 0, 0.55],
    elL: [-0.65, 0, 0],
    hipL: [-0.9, 0, 0.1],
    knL: [1.35, 0, 0],
    hipR: [-0.3, 0, -0.08],
    knR: [0.75, 0, 0],
    ftL: [0.6, 0, 0],
    ftR: [0.6, 0, 0],
    fistL: 0.6,
  }),
  P({
    ...webR,
    spine: [-0.35, -0.1, 0],
    head: [-0.4, 0.05, 0],
    shL: [-2.65, 0, 0.3],
    elL: [-0.12, 0, 0],
    hipL: [0.15, 0, 0.1],
    knL: [0.95, 0, 0],
    hipR: [0.35, 0, -0.1],
    knR: [0.3, 0, 0],
    ftL: [0.75, 0, 0],
    ftR: [0.75, 0, 0],
    fistL: 0.2,
  }),
];
const swingL = swingR.map(mirror);

const wings = P({
  wing: 1,
  spine: [-0.18, 0, 0],
  head: [-1.0, 0, 0],
  shL: [-0.25, 0, 1.45],
  shR: [-0.25, 0, -1.45],
  elL: [-0.12, 0, 0],
  elR: [-0.12, 0, 0],
  waL: [0, 0, 0.15],
  waR: [0, 0, -0.15],
  hipL: [0.08, 0, 0.24],
  hipR: [0.08, 0, -0.24],
  knL: [0.12, 0, 0],
  knR: [0.18, 0, 0],
  ftL: [0.85, 0, 0],
  ftR: [0.85, 0, 0],
  fistL: 0,
  fistR: 0,
});

const spinPose = P({
  spine: [0.1, 0, 0],
  head: [-0.1, 0, 0],
  shL: [-1.1, 0, -0.35],
  shR: [-1.2, 0, 0.35],
  elL: [-2.0, 0, 0],
  elR: [-2.0, 0, 0],
  hipL: [-0.15, 0, 0.04],
  knL: [0.25, 0, 0],
  hipR: [-0.7, 0, -0.04],
  knR: [1.7, 0, 0],
  ftL: [0.8, 0, 0],
  ftR: [0.7, 0, 0],
  fistL: 1,
  fistR: 1,
});

const kickWind = P({
  spine: [0.45, 0, 0],
  head: [-0.2, 0, 0],
  shL: [-1.0, 0, 0.6],
  shR: [-1.0, 0, -0.6],
  elL: [-1.4, 0, 0],
  elR: [-1.4, 0, 0],
  hipL: [-1.7, 0, 0.1],
  hipR: [-1.7, 0, -0.1],
  knL: [2.3, 0, 0],
  knR: [2.3, 0, 0],
  ftL: [0.4, 0, 0],
  ftR: [0.4, 0, 0],
  fistL: 1,
  fistR: 1,
});
const kickStrike = P({
  pitch: -0.55,
  spine: [0.3, -0.25, 0],
  head: [-0.15, 0.2, 0],
  shL: [-0.5, 0, 1.3],
  shR: [0.7, 0, -1.0],
  elL: [-0.7, 0, 0],
  elR: [-0.4, 0, 0],
  hipL: [-1.9, 0, 0.18],
  knL: [2.3, 0, 0],
  hipR: [-1.55, 0, -0.04],
  knR: [0.04, 0, 0],
  ftL: [0.4, 0, 0],
  ftR: [-0.25, 0, 0],
  fistL: 1,
  fistR: 1,
});

const launchKeys = [
  crouch,
  P({
    ground: 1,
    hips: [0.3, 0, 0],
    spine: [0.9, 0, 0],
    head: [-0.9, 0, 0],
    shL: [0.9, 0, 0.35],
    shR: [0.9, 0, -0.35],
    elL: [-0.4, 0, 0],
    elR: [-0.4, 0, 0],
    hipL: [-1.95, 0.25, 0.4],
    hipR: [-1.95, -0.25, -0.4],
    knL: [2.55, 0, 0],
    knR: [2.55, 0, 0],
    fistL: 1,
    fistR: 1,
  }),
  P({
    spine: [-0.2, 0, 0],
    head: [-0.45, 0, 0],
    shL: [-2.9, 0, 0.25],
    shR: [-2.9, 0, -0.25],
    elL: [-0.1, 0, 0],
    elR: [-0.1, 0, 0],
    hipL: [0.15, 0, 0.04],
    hipR: [0.15, 0, -0.04],
    knL: [0.1, 0, 0],
    knR: [0.1, 0, 0],
    ftL: [0.9, 0, 0],
    ftR: [0.9, 0, 0],
    fistL: 1,
    fistR: 1,
  }),
  tuck,
  tuck,
  P({
    spine: [-0.3, 0, 0],
    head: [-0.35, 0, 0],
    shL: [-0.6, 0, 1.9],
    shR: [-0.6, 0, -1.9],
    elL: [-0.2, 0, 0],
    elR: [-0.2, 0, 0],
    hipL: [-0.7, 0, 0.3],
    knL: [1.4, 0, 0],
    hipR: [0.25, 0, -0.2],
    knR: [0.35, 0, 0],
    ftL: [0.6, 0, 0],
    ftR: [0.8, 0, 0],
    fistL: 0,
    fistR: 0,
  }),
  fall,
];
const launchTimes = [0, 0.15, 0.3, 0.45, 0.62, 0.82, 1];

const fists: Def = { fistL: 1, fistR: 1, ground: 1 };

const jab = P({
  ...fists,
  hips: [0.12, -0.55, 0],
  spine: [0.25, -0.15, 0],
  head: [-0.2, 0.5, 0],
  shL: [-1.55, 0.2, 0.08],
  elL: [-0.06, 0, 0],
  waL: [0, 1.4, 0],
  shR: [-0.5, 0, -0.4],
  elR: [-2.2, 0, 0],
  hipL: [-0.75, 0.3, 0.2],
  knL: [0.55, 0, 0],
  hipR: [0.35, 0.3, -0.15],
  knR: [0.35, 0, 0],
});
const jabLoad = P({
  ...fists,
  hips: [0.1, -0.3, 0],
  spine: [0.25, 0.45, 0],
  head: [-0.2, -0.05, 0],
  shL: [-0.7, 0, 0.45],
  elL: [-2.2, 0, 0],
  shR: [-0.55, 0, -0.45],
  elR: [-2.15, 0, 0],
  hipL: [-0.45, 0.25, 0.2],
  knL: [0.8, 0, 0],
  hipR: [0.12, 0.25, -0.16],
  knR: [0.75, 0, 0],
});
const cross = P({
  ...fists,
  hips: [0.15, 0.35, 0],
  spine: [0.3, 0.55, 0],
  head: [-0.25, -0.75, 0],
  shR: [-1.6, -0.15, -0.05],
  elR: [-0.05, 0, 0],
  waR: [0, -1.4, 0],
  shL: [-0.8, 0, 0.3],
  elL: [-2.2, 0, 0],
  hipL: [-0.65, -0.3, 0.2],
  knL: [0.6, 0, 0],
  hipR: [0.45, -0.3, -0.12],
  knR: [0.45, 0, 0],
  ftR: [0.5, 0, 0],
});
const crossLoad = P({
  ...fists,
  hips: [0.1, -0.5, 0],
  spine: [0.25, -0.2, 0],
  head: [-0.2, 0.55, 0],
  shR: [-0.2, 0, -0.5],
  elR: [-2.3, 0, 0],
  shL: [-1.1, 0, 0.3],
  elL: [-1.6, 0, 0],
  hipL: [-0.5, 0.25, 0.2],
  knL: [0.75, 0, 0],
  hipR: [0.2, 0.25, -0.16],
  knR: [0.7, 0, 0],
});
const roundhouse = P({
  ...fists,
  spine: [0.05, 0, -0.45],
  head: [-0.1, 0, 0.3],
  shL: [-0.3, 0, 1.2],
  elL: [-0.8, 0, 0],
  shR: [0.4, 0, -0.9],
  elR: [-1.0, 0, 0],
  hipL: [0, 0, 0.12],
  knL: [0.45, 0, 0],
  hipR: [-0.6, 0, -1.35],
  knR: [0.12, 0, 0],
  ftR: [0.6, 0, 0],
});
const palmsLoad = P({
  ...fists,
  hips: [0.25, -0.3, 0],
  spine: [0.4, 0.3, 0],
  head: [-0.4, -0.2, 0],
  shL: [0.55, 0, 0.3],
  elL: [-1.9, 0, 0],
  shR: [0.55, 0, -0.3],
  elR: [-1.9, 0, 0],
  hipL: [-0.9, 0.2, 0.3],
  knL: [1.4, 0, 0],
  hipR: [-0.1, 0.2, -0.25],
  knR: [1.3, 0, 0],
});
const palms = P({
  ground: 1,
  hips: [0.3, 0, 0],
  spine: [0.25, 0, 0],
  head: [-0.4, 0, 0],
  shL: [-1.45, 0, -0.18],
  elL: [-0.05, 0, 0],
  waL: [0, -1.55, 1.2],
  shR: [-1.45, 0, 0.18],
  elR: [-0.05, 0, 0],
  waR: [0, 1.55, -1.2],
  hipL: [-1.3, 0, 0.18],
  knL: [1.25, 0, 0],
  hipR: [0.55, 0, -0.12],
  knR: [0.3, 0, 0],
  fistL: 0,
  fistR: 0,
});

const upperLoad = P({
  ...fists,
  hips: [0.35, -0.25, 0],
  spine: [0.6, 0.35, 0],
  head: [-0.7, -0.2, 0],
  shR: [0.6, 0, -0.35],
  elR: [-1.2, 0, 0],
  shL: [-0.9, 0, 0.4],
  elL: [-1.7, 0, 0],
  hipL: [-1.6, 0.25, 0.3],
  knL: [2.2, 0, 0],
  hipR: [-1.0, 0.25, -0.3],
  knR: [2.2, 0, 0],
});
const upperHit = P({
  fistL: 1,
  fistR: 1,
  lift: 0.3,
  spine: [-0.25, -0.3, 0],
  head: [-0.45, 0.2, 0],
  shR: [-2.85, 0, -0.15],
  elR: [-0.55, 0, 0],
  shL: [0.5, 0, 0.5],
  elL: [-1.0, 0, 0],
  hipL: [-1.3, 0, 0.1],
  knL: [1.8, 0, 0],
  hipR: [0.2, 0, -0.06],
  knR: [0.2, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.8, 0, 0],
});

const airReady = P({
  fistL: 1,
  fistR: 1,
  spine: [0.25, 0, 0],
  head: [-0.3, 0, 0],
  shL: [-0.9, 0, 0.45],
  elL: [-1.9, 0, 0],
  shR: [-0.6, 0, -0.45],
  elR: [-2.0, 0, 0],
  hipL: [-1.4, 0, 0.12],
  knL: [2.0, 0, 0],
  hipR: [-0.7, 0, -0.1],
  knR: [1.6, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.5, 0, 0],
});
const airLoad = P({
  ...{ fistL: 1, fistR: 1 },
  pitch: -0.15,
  spine: [0.0, -0.5, 0],
  head: [-0.3, 0.45, 0],
  shR: [0.5, 0, -0.5],
  elR: [-2.0, 0, 0],
  shL: [-1.1, 0, 0.3],
  elL: [-1.2, 0, 0],
  hipL: [-1.5, 0, 0.12],
  knL: [2.2, 0, 0],
  hipR: [-0.9, 0, -0.1],
  knR: [2.0, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.5, 0, 0],
});
const airHit = P({
  fistL: 1,
  fistR: 1,
  pitch: 0.4,
  spine: [0.3, 0.5, 0],
  head: [-0.6, -0.4, 0],
  shR: [-1.35, -0.2, 0.05],
  elR: [-0.05, 0, 0],
  waR: [0, -1.4, 0],
  shL: [0.7, 0, 0.45],
  elL: [-1.5, 0, 0],
  hipL: [-1.6, 0, 0.12],
  knL: [2.3, 0, 0],
  hipR: [-0.4, 0, -0.1],
  knR: [1.5, 0, 0],
  ftL: [0.6, 0, 0],
  ftR: [0.6, 0, 0],
});

const shootR = [
  guard,
  P({
    ground: 1,
    fistL: 1,
    fistR: 1,
    hips: [0.08, 0.15, 0],
    spine: [0.2, 0.15, 0],
    head: [-0.15, -0.25, 0],
    shR: [-1.0, 0, -0.5],
    elR: [-2.1, 0, 0],
    shL: [-0.4, 0, 0.5],
    elL: [-1.2, 0, 0],
    hipL: [-0.4, 0.15, 0.2],
    knL: [0.6, 0, 0],
    hipR: [0.15, 0.15, -0.2],
    knR: [0.55, 0, 0],
  }),
  P({
    ground: 1,
    fistL: 1,
    fistR: 1,
    thwipR: 1,
    hips: [0.05, 0.35, 0],
    spine: [0.1, 0.4, 0],
    head: [-0.1, -0.7, 0],
    shR: [-1.6, -0.1, 0.12],
    elR: [-0.03, 0, 0],
    waR: [0, 1.5, -1.15],
    shL: [0.35, 0, 0.6],
    elL: [-0.7, 0, 0],
    hipL: [-0.45, -0.3, 0.25],
    knL: [0.5, 0, 0],
    hipR: [0.2, -0.3, -0.25],
    knR: [0.4, 0, 0],
  }),
  P({
    ground: 1,
    fistL: 1,
    fistR: 1,
    thwipR: 1,
    hips: [0.02, 0.38, 0],
    spine: [0.02, 0.42, 0],
    head: [-0.15, -0.72, 0],
    shR: [-1.75, -0.1, 0.12],
    elR: [-0.3, 0, 0],
    waR: [0, 1.5, -1.3],
    shL: [0.4, 0, 0.65],
    elL: [-0.75, 0, 0],
    hipL: [-0.45, -0.3, 0.25],
    knL: [0.55, 0, 0],
    hipR: [0.22, -0.3, -0.25],
    knR: [0.45, 0, 0],
  }),
];
const shootL = shootR.map(mirror);

const yankReach = P({
  ...fists,
  hips: [0.15, 0, 0],
  spine: [0.35, 0, 0],
  head: [-0.4, 0, 0],
  shL: [-1.5, 0, -0.08],
  shR: [-1.5, 0, 0.08],
  elL: [-0.05, 0, 0],
  elR: [-0.05, 0, 0],
  hipL: [-0.9, 0, 0.18],
  knL: [0.8, 0, 0],
  hipR: [0.3, 0, -0.15],
  knR: [0.6, 0, 0],
});
const yankPull = P({
  ...fists,
  hips: [-0.2, 0.15, 0],
  spine: [-0.3, 0.2, 0],
  head: [0.1, -0.1, 0],
  shL: [0.65, 0, 0.25],
  shR: [0.75, 0, -0.25],
  elL: [-2.1, 0, 0],
  elR: [-2.0, 0, 0],
  hipL: [-0.7, -0.15, 0.2],
  knL: [0.15, 0, 0],
  hipR: [0.15, -0.15, -0.2],
  knR: [1.1, 0, 0],
});

const throwWind = P({
  ...fists,
  hips: [0.15, 0.5, 0],
  spine: [0.3, 0.6, 0],
  head: [-0.3, -0.5, 0],
  shL: [-1.2, 0, -0.4],
  elL: [-0.4, 0, 0],
  shR: [-0.2, 0, -1.2],
  elR: [-0.2, 0, 0],
  hipL: [-0.6, -0.4, 0.25],
  knL: [1.0, 0, 0],
  hipR: [0.0, -0.4, -0.25],
  knR: [1.0, 0, 0],
});
const throwSpin = P({
  ...fists,
  spine: [-0.1, 0, 0.25],
  head: [-0.2, 0, -0.15],
  shL: [-0.1, 0, 1.5],
  elL: [0, 0, 0],
  shR: [-0.6, 0, -1.4],
  elR: [-0.1, 0, 0],
  hipL: [-0.3, 0, 0.3],
  knL: [0.5, 0, 0],
  hipR: [0.15, 0, -0.3],
  knR: [0.6, 0, 0],
});
const throwRelease = P({
  ...fists,
  hips: [0.2, -0.3, 0],
  spine: [0.4, -0.45, 0],
  head: [-0.45, 0.4, 0],
  shL: [0.4, 0, 0.6],
  elL: [-0.6, 0, 0],
  shR: [-1.7, 0, 0.3],
  elR: [-0.1, 0, 0],
  hipL: [-0.9, 0.3, 0.2],
  knL: [0.9, 0, 0],
  hipR: [0.4, 0.3, -0.2],
  knR: [0.6, 0, 0],
  fistR: 0,
});

const finCoil = P({
  ...fists,
  hips: [0.3, 0, 0],
  spine: [0.75, 0, 0],
  head: [-0.8, 0, 0],
  shL: [1.0, 0, 0.45],
  shR: [1.0, 0, -0.45],
  elL: [-0.6, 0, 0],
  elR: [-0.6, 0, 0],
  hipL: [-1.9, 0.2, 0.35],
  hipR: [-1.9, -0.2, -0.35],
  knL: [2.5, 0, 0],
  knR: [2.5, 0, 0],
});
const finKick = P({
  fistL: 1,
  fistR: 1,
  lift: 0.45,
  pitch: -0.5,
  spine: [0.2, 0, 0],
  head: [-0.1, 0, 0],
  shL: [0.9, 0, 0.6],
  shR: [0.9, 0, -0.6],
  elL: [-0.6, 0, 0],
  elR: [-0.6, 0, 0],
  hipL: [-1.0, 0, 0.12],
  knL: [2.3, 0, 0],
  hipR: [-1.75, 0, -0.04],
  knR: [0.0, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [-0.35, 0, 0],
});

const hurtHit = P({
  ground: 1,
  fistL: 0.2,
  fistR: 0.2,
  hips: [-0.15, 0.15, 0],
  spine: [-0.4, 0.25, 0.12],
  head: [-0.5, 0.3, 0.15],
  shL: [-1.0, 0, 0.9],
  elL: [-0.7, 0, 0],
  shR: [-0.6, 0, -1.15],
  elR: [-0.5, 0, 0],
  hipL: [-0.5, 0, 0.18],
  knL: [0.3, 0, 0],
  hipR: [0.2, 0, -0.2],
  knR: [0.65, 0, 0],
});
const hurtSag = P({
  ground: 1,
  fistL: 0.6,
  fistR: 0.6,
  hips: [0.15, 0.1, 0],
  spine: [0.5, 0.1, -0.08],
  head: [0.1, 0.1, 0],
  shL: [-0.5, 0, 0.35],
  elL: [-1.3, 0, 0],
  shR: [-0.2, 0, -0.35],
  elR: [-1.0, 0, 0],
  hipL: [-0.6, 0.2, 0.2],
  knL: [0.9, 0, 0],
  hipR: [0.1, 0.2, -0.2],
  knR: [0.9, 0, 0],
});

const downKeys = [
  hurtHit,
  P({
    lift: -0.3,
    pitch: -0.9,
    spine: [-0.2, 0.1, 0],
    head: [0.4, 0, 0],
    shL: [-1.4, 0, 0.9],
    elL: [-0.6, 0, 0],
    shR: [-1.2, 0, -0.9],
    elR: [-0.7, 0, 0],
    hipL: [-0.9, 0, 0.15],
    knL: [1.0, 0, 0],
    hipR: [-0.6, 0, -0.15],
    knR: [0.7, 0, 0],
    ftL: [0.4, 0, 0],
    ftR: [0.4, 0, 0],
    fistL: 0.3,
    fistR: 0.3,
  }),
  P({
    lift: -0.82,
    pitch: -1.57,
    spine: [0.12, 0.15, 0],
    head: [0.35, -0.3, 0],
    shL: [-0.4, 0, 1.25],
    elL: [-0.5, 0, 0],
    shR: [-0.2, 0, -0.75],
    elR: [-0.9, 0, 0],
    hipL: [-0.75, 0.2, 0.2],
    knL: [1.35, 0, 0],
    hipR: [-0.05, 0, -0.15],
    knR: [0.2, 0, 0],
    ftL: [0.2, 0, 0],
    ftR: [0.6, 0, 0],
    fistL: 0.3,
    fistR: 0.3,
  }),
];

const relaxed = idleBase;
const waveUp = P({
  ground: 1,
  spine: [0.0, -0.15, -0.05],
  head: [-0.08, 0.1, 0.08],
  shR: [-0.15, 0, -1.4],
  elR: [-1.75, -1.57, 0],
  waR: [0, 0, 0],
  shL: [0.05, 0, 0.2],
  elL: [-0.35, 0, 0],
  hipL: [-0.05, 0.12, 0.11],
  hipR: [0.05, -0.12, -0.1],
  knL: [0.14, 0, 0],
  knR: [0.1, 0, 0],
  fistR: 0,
  fistL: 0.4,
});

const bumpOut = P({
  ground: 1,
  hips: [0.05, -0.1, 0],
  spine: [0.15, -0.2, 0],
  head: [-0.15, 0.15, 0],
  shR: [-1.3, 0, 0.0],
  elR: [-0.35, 0, 0],
  waR: [0, -1.4, 0],
  shL: [0.05, 0, 0.25],
  elL: [-0.4, 0, 0],
  hipL: [-0.3, 0.12, 0.12],
  knL: [0.3, 0, 0],
  hipR: [0.15, -0.12, -0.1],
  knR: [0.2, 0, 0],
  fistR: 1,
  fistL: 0.4,
});
const bumpBlow = P({
  ground: 1,
  hips: [0, -0.1, 0],
  spine: [-0.05, -0.15, 0],
  head: [-0.2, 0.1, 0],
  shR: [-1.0, 0, -0.5],
  elR: [-1.5, 0, 0],
  waR: [0, -0.6, -0.4],
  shL: [0.05, 0, 0.25],
  elL: [-0.4, 0, 0],
  hipL: [-0.15, 0.12, 0.12],
  knL: [0.2, 0, 0],
  hipR: [0.1, -0.12, -0.1],
  knR: [0.15, 0, 0],
  fistR: 0,
  fistL: 0.4,
});

const selfie = P({
  ground: 1,
  hips: [0, 0.15, 0.04],
  spine: [-0.05, -0.15, -0.06],
  head: [-0.2, 0.35, 0.2],
  shR: [-2.3, 0.1, -0.35],
  elR: [-0.25, 0, 0],
  waR: [0, 1.4, -0.6],
  shL: [-0.35, 0, 1.15],
  elL: [-2.2, 1.45, 0],
  waL: [0, 0, 0],
  hipL: [-0.25, 0.25, 0.12],
  knL: [0.45, 0, 0],
  hipR: [0.05, 0, -0.12],
  knR: [0.05, 0, 0],
  fistR: 0.7,
  fistL: 1,
  peaceL: 1,
});

const shakeReach = P({
  ground: 1,
  hips: [0.02, -0.08, 0],
  spine: [0.14, -0.12, 0],
  head: [-0.12, 0.08, 0],
  shR: [-0.6, 0, -0.05],
  elR: [-1.0, 0.25, 0],
  waR: [0, -1.3, 0],
  shL: [0.05, 0, 0.2],
  elL: [-0.35, 0, 0],
  hipL: [-0.25, 0.12, 0.11],
  knL: [0.25, 0, 0],
  hipR: [0.08, -0.12, -0.1],
  knR: [0.12, 0, 0],
  fistR: 0.35,
  fistL: 0.4,
});

const hugOpen = P({
  ground: 1,
  spine: [0.0, 0, 0],
  head: [-0.15, 0, 0],
  shL: [-1.1, 0, 0.95],
  elL: [-0.45, -1.57, 0],
  shR: [-1.1, 0, -0.95],
  elR: [-0.45, 1.57, 0],
  hipL: [-0.15, 0.12, 0.11],
  knL: [0.2, 0, 0],
  hipR: [0.05, -0.12, -0.1],
  knR: [0.12, 0, 0],
  fistL: 0,
  fistR: 0,
});
const hugHold = P({
  ground: 1,
  hips: [0.06, 0, 0],
  spine: [0.2, 0, 0.04],
  head: [0.05, 0.45, 0.12],
  shL: [-1.35, 0, 0.5],
  elL: [-1.15, -1.57, 0],
  waL: [0, 0, -0.3],
  shR: [-1.2, 0, -0.42],
  elR: [-1.1, 1.57, 0],
  waR: [0, 0, 0.3],
  hipL: [-0.3, 0.12, 0.11],
  knL: [0.35, 0, 0],
  hipR: [0.1, -0.12, -0.1],
  knR: [0.25, 0, 0],
  fistL: 0.2,
  fistR: 0.2,
});

const swimBase = P({
  pitch: -0.15,
  spine: [-0.15, 0, 0],
  head: [-0.6, 0, 0],
  hipL: [0, 0, 0.05],
  hipR: [0, 0, -0.05],
  ftL: [0.9, 0, 0],
  ftR: [0.9, 0, 0],
  fistL: 0.15,
  fistR: 0.15,
});

const arch = P({
  spine: [-0.45, 0, 0],
  head: [-0.55, 0, 0],
  shL: [-2.9, 0, 0.35],
  shR: [-2.9, 0, -0.35],
  elL: [-0.2, 0, 0],
  elR: [-0.2, 0, 0],
  hipL: [0.2, 0, 0.06],
  hipR: [0.2, 0, -0.06],
  knL: [0.5, 0, 0],
  knR: [0.5, 0, 0],
  ftL: [0.6, 0, 0],
  ftR: [0.6, 0, 0],
  fistL: 0.3,
  fistR: 0.3,
});

const pencil = P({
  spine: [0.05, 0, 0],
  head: [-0.2, 0, 0],
  shL: [-0.7, 0, -0.35],
  elL: [-2.1, 0, 0],
  shR: [-0.6, 0, 0.35],
  elR: [-2.2, 0, 0],
  hipL: [-0.1, 0, -0.03],
  hipR: [-0.05, 0, 0.03],
  knL: [0.1, 0, 0],
  knR: [0.25, 0, 0],
  ftL: [0.8, 0, 0],
  ftR: [0.8, 0, 0],
  fistL: 1,
  fistR: 1,
});

const splitPose = P({
  pitch: -0.15,
  spine: [0.1, 0, 0],
  head: [-0.3, 0, 0],
  shL: [-0.2, 0, 1.75],
  elL: [-0.15, 0, 0],
  shR: [-0.2, 0, -1.75],
  elR: [-0.15, 0, 0],
  hipL: [-0.35, 0, 1.45],
  knL: [0.02, 0, 0],
  hipR: [-0.35, 0, -1.45],
  knR: [0.02, 0, 0],
  ftL: [0.75, 0, 0],
  ftR: [0.75, 0, 0],
  fistL: 0,
  fistR: 0,
  thwipL: 1,
  thwipR: 1,
});

const tdShoot = P({
  ground: 1,
  hips: [0.4, 0, 0],
  spine: [0.45, 0, 0],
  head: [-0.5, 0, 0],
  hipL: [-2.0, 0.4, 0.55],
  knL: [2.5, 0, 0],
  hipR: [-2.0, -0.4, -0.55],
  knR: [2.5, 0, 0],
  shL: [-1.15, 0, 0.15],
  elL: [-0.05, 0, 0],
  waL: [0, -1.5, 1.2],
  shR: [-1.15, 0, -0.15],
  elR: [-0.05, 0, 0],
  waR: [0, 1.5, -1.2],
  fistL: 1,
  fistR: 1,
  thwipL: 1,
  thwipR: 1,
});
const tdPull = P({
  ground: 1,
  hips: [0.1, 0, 0],
  spine: [-0.15, 0, 0],
  head: [-0.25, 0, 0],
  hipL: [-1.7, 0.35, 0.5],
  knL: [2.2, 0, 0],
  hipR: [-1.7, -0.35, -0.5],
  knR: [2.2, 0, 0],
  shL: [0.2, 0, 0.45],
  elL: [-1.9, 0, 0],
  shR: [0.2, 0, -0.45],
  elR: [-1.9, 0, 0],
  fistL: 1,
  fistR: 1,
});
const tdStrike = P({
  ground: 1,
  hips: [0.35, 0.3, 0],
  spine: [0.5, 0.35, 0],
  head: [-0.55, -0.3, 0],
  hipL: [-1.6, 0.3, 0.4],
  knL: [2.0, 0, 0],
  hipR: [-2.1, -0.3, -0.5],
  knR: [2.55, 0, 0],
  shR: [-1.45, 0, 0.05],
  elR: [-0.05, 0, 0],
  waR: [0, -1.4, 0],
  shL: [0.5, 0, 0.5],
  elL: [-1.5, 0, 0],
  fistL: 1,
  fistR: 1,
});

const counterLoad = P({
  ...fists,
  hips: [0.25, 0.5, 0],
  spine: [0.45, 0.45, 0.1],
  head: [-0.45, -0.6, 0],
  shL: [-0.8, 0, 0.8],
  elL: [-1.8, 0, 0],
  shR: [-1.2, 0, -0.2],
  elR: [-2.1, 0, 0],
  hipL: [-1.3, 0.3, 0.35],
  knL: [1.8, 0, 0],
  hipR: [-0.9, -0.3, -0.35],
  knR: [1.5, 0, 0],
});
const counterHit = P({
  ...fists,
  ground: 0.6,
  hips: [0, 0, 0],
  spine: [-0.05, 0, -0.55],
  head: [-0.1, 0, 0.4],
  shL: [-0.4, 0, 1.4],
  elL: [-0.9, 0, 0],
  shR: [0.6, 0, -1.2],
  elR: [-0.6, 0, 0],
  hipL: [-0.15, 0, 0.2],
  knL: [0.35, 0, 0],
  hipR: [-0.95, 0, -1.4],
  knR: [0.05, 0, 0],
  ftR: [0.7, 0, 0],
});

const grabbedBase = P({
  spine: [-0.3, 0, 0],
  head: [-0.55, 0, 0],
  shL: [-0.6, 0, 0.45],
  elL: [-1.6, -1.2, 0],
  waL: [0.3, 0, 0],
  shR: [-0.6, 0, -0.45],
  elR: [-1.6, 1.2, 0],
  waR: [0.3, 0, 0],
  hipL: [-0.35, 0, 0.12],
  knL: [0.7, 0, 0],
  hipR: [-0.1, 0, -0.12],
  knR: [0.5, 0, 0],
  ftL: [0.5, 0, 0],
  ftR: [0.5, 0, 0],
  fistL: 1,
  fistR: 1,
});

export const SWIM_WRAP = [JI.shL, JI.shR];

// Front crawl. Shoulder x turns a full circle, so hero.ts wraps those channels while swimming.
function swim(out: Pose, t: number, speed: number) {
  out.set(swimBase);
  const a = t * TAU * (0.55 + 0.25 * sstep(0, 6, speed));
  for (let s = 0; s < 2; s++) {
    const ph = a + s * Math.PI;
    const u = ph / TAU - Math.floor(ph / TAU);
    const pull = u < 0.55;
    const k = pull ? u / 0.55 : (u - 0.55) / 0.45;
    const side = s === 0 ? 1 : -1;
    const sh = s === 0 ? "shL" : "shR";
    const el = s === 0 ? "elL" : "elR";
    if (pull) {
      add(out, sh, -Math.PI + Math.PI * easeIO(k), 0, side * 0.12);
      add(out, el, -0.75 * Math.sin(Math.PI * k));
    } else {
      add(out, sh, Math.PI * k, 0, side * 0.45 * Math.sin(Math.PI * k));
      add(out, el, -1.5 * Math.sin(Math.PI * k));
    }
  }
  const r = Math.sin(a);
  add(out, "hips", 0, 0.32 * r, 0);
  add(out, "spine", 0, 0.18 * r, 0);
  add(out, "head", 0, -0.5 * r - 0.6 * Math.max(0, Math.sin(a * 0.5 - 0.6)) * Math.max(0, r), 0);
  const kick = Math.sin(a * 3);
  add(out, "hipL", 0.28 * kick);
  add(out, "hipR", -0.28 * kick);
  add(out, "knL", 0.22 + 0.2 * Math.max(0, -kick));
  add(out, "knR", 0.22 + 0.2 * Math.max(0, kick));
  return out;
}

function grabbed(out: Pose, t: number) {
  out.set(grabbedBase);
  const k = Math.sin(t * 9);
  const k2 = Math.sin(t * 9 + 1.9);
  add(out, "hipL", -0.45 * k);
  add(out, "knL", 0.45 * Math.max(0, k));
  add(out, "hipR", -0.45 * k2);
  add(out, "knR", 0.45 * Math.max(0, k2));
  const w = Math.sin(t * 3.3);
  add(out, "spine", 0.08 * Math.sin(t * 6.1), 0.2 * w, 0.1 * Math.sin(t * 2.3));
  add(out, "head", 0.1 * Math.sin(t * 5.3), -0.3 * w, 0);
  add(out, "shL", 0.15 * Math.sin(t * 7.1), 0, 0);
  add(out, "shR", 0.15 * Math.sin(t * 7.1 + 2), 0, 0);
  add(out, "elL", 0.2 * Math.sin(t * 7.1 + 1), 0, 0);
  add(out, "elR", 0.2 * Math.sin(t * 7.1 + 3), 0, 0);
  out[CH.roll] = 0.12 * w;
  return out;
}

const tmpA = new Float32Array(NCH);

function idle(out: Pose, t: number) {
  out.set(idleBase);
  const b = Math.sin(t * 1.7);
  const l = look(t);
  const w = Math.sin(t * 0.45);
  add(out, "spine", 0.016 * b, 0.22 * l, 0);
  add(out, "head", -0.012 * b - 0.04 * Math.abs(l), 0.75 * l, 0);
  add(out, "shL", 0, 0, 0.02 * b);
  add(out, "shR", 0, 0, -0.02 * b);
  add(out, "hips", 0, 0, 0.025 * w);
  add(out, "hipL", 0, 0, -0.025 * w);
  add(out, "hipR", 0, 0, -0.025 * w);
  return out;
}

export function poseTarget(out: Pose, state: HeroPose, c: Ctx): number {
  const p = c.phase;
  const R = c.hand === "R";
  switch (state) {
    case "idle":
      idle(out, c.t);
      return 0.8;
    case "run":
    case "sprint": {
      curve(out, state === "run" ? runKeys : sprintKeys, (p / TAU) * 8, true);
      out[CH.roll] = Math.max(-0.35, Math.min(0.35, -c.turn * 0.09));
      add(out, "head", 0, c.turn * 0.06, 0);
      return state === "run" ? 1.7 : 2.1;
    }
    case "wall":
      curve(out, wallKeys, (p / TAU) * 4, true);
      return 1.6;
    case "crouch":
      out.set(crouch);
      add(out, "spine", 0.015 * Math.sin(c.t * 1.7));
      return 1;
    case "perch": {
      out.set(perch);
      const b = Math.sin(c.t * 1.5);
      add(out, "spine", 0.02 * b, 0.15 * look(c.t), 0);
      add(out, "head", -0.015 * b, 0.45 * look(c.t + 7), 0);
      return 0.9;
    }
    case "land":
      seq(out, landKeys, [0, 0.18, 1], p);
      return 2;
    case "air": {
      mix(out, rise, fall, sstep(3, -7, c.vy));
      const f = Math.sin(c.t * 5);
      add(out, "shL", 0, 0, 0.07 * f);
      add(out, "shR", 0, 0, -0.07 * f);
      add(out, "hipL", 0.05 * f);
      add(out, "hipR", -0.05 * f);
      return 1;
    }
    case "dive": {
      out.set(dive);
      const f = Math.sin(c.t * 11);
      add(out, "shL", 0, 0, 0.04 * f);
      add(out, "shR", 0, 0, -0.04 * f);
      add(out, "knL", 0.06 * f);
      add(out, "knR", -0.06 * f);
      return 1.2;
    }
    case "zip":
      out.set(zip);
      return 1.6;
    case "swing": {
      const a = Math.max(-1.1, Math.min(1.1, c.swing));
      const stretch = sstep(18, 40, c.speed);
      curve(out, R ? swingR : swingL, ((a + 1.1) / 2.2) * 4, false);
      const f = Math.sin(p * 2.3);
      add(out, "hipL", 0.06 * f - 0.15 * stretch);
      add(out, "hipR", -0.06 * f - 0.1 * stretch);
      add(out, "knL", -0.25 * stretch);
      add(out, "knR", -0.25 * stretch);
      out[CH.roll] = Math.max(-0.5, Math.min(0.5, -c.turn * 0.12));
      return 1.3;
    }
    case "wings": {
      out.set(wings);
      const f = Math.sin(c.t * 1.7);
      add(out, "shL", 0.05 * f, 0, 0.04 * Math.sin(c.t * 3.1));
      add(out, "shR", 0.05 * f, 0, -0.04 * Math.sin(c.t * 3.1 + 1));
      add(out, "hipL", 0.06 * f);
      add(out, "hipR", -0.06 * f);
      out[CH.yaw] = Math.max(-0.7, Math.min(0.7, -c.turn * 0.2));
      return 1;
    }
    case "flip": {
      mix(out, fall, tuck, bell(p, 0.12, 0.72, 0.12));
      out[CH.pitch] = TAU * easeIO(sstep(0.04, 0.86, p));
      return 2;
    }
    case "spin": {
      mix(out, fall, spinPose, bell(p, 0.1, 0.8, 0.1));
      out[CH.yaw] = TAU * easeIO(sstep(0.02, 0.9, p));
      out[CH.pitch] = -0.5 * bell(p, 0.15, 0.75, 0.15);
      return 2;
    }
    case "kick": {
      mix(tmpA, kickWind, kickStrike, sstep(0.08, 0.3, p));
      mix(out, tmpA, fall, sstep(0.75, 1, p));
      return 1.8;
    }
    case "launch": {
      seq(out, launchKeys, launchTimes, p);
      out[CH.ground] = 1 - sstep(0.18, 0.3, p);
      out[CH.pitch] = TAU * easeIO(sstep(0.36, 0.8, p));
      return 2;
    }
    case "punch1":
      seq(out, [guard, jabLoad, jab, jab, guard], [0, 0.12, 0.28, 0.55, 1], p);
      return 2;
    case "punch2":
      seq(out, [guard, crossLoad, cross, cross, guard], [0, 0.12, 0.28, 0.55, 1], p);
      return 2;
    case "punch3": {
      seq(out, [guard, crossLoad, roundhouse, roundhouse, guard], [0, 0.12, 0.3, 0.6, 1], p);
      out[CH.yaw] = -TAU * easeIO(sstep(0.06, 0.55, p));
      return 2.2;
    }
    case "punch4":
      seq(out, [guard, palmsLoad, palms, palms, guard], [0, 0.24, 0.38, 0.66, 1], p);
      return 2.1;
    case "uppercut":
      seq(out, [guard, upperLoad, upperHit, upperHit, airReady], [0, 0.26, 0.4, 0.7, 1], p);
      out[CH.ground] = 1 - bell(p, 0.42, 1.2, 0.08);
      return 2.1;
    case "airPunch":
      seq(out, [airReady, airLoad, airHit, airHit, airReady], [0, 0.14, 0.28, 0.55, 1], p);
      return 2.1;
    case "dodge": {
      seq(out, [guard, crouch, tuck, tuck, crouch, guard], [0, 0.12, 0.3, 0.62, 0.82, 1], p);
      out[CH.ground] = 1 - bell(p, 0.2, 0.72, 0.1);
      out[CH.lift] = 0.4 * bell(p, 0.22, 0.6, 0.15);
      out[CH.roll] = (R ? TAU : -TAU) * easeIO(sstep(0.14, 0.78, p));
      return 2.2;
    }
    case "webShoot":
      seq(out, R ? shootR : shootL, [0, 0.14, 0.3, 1], p);
      return 2;
    case "yank":
      seq(out, [guard, yankReach, yankReach, yankPull, yankPull, guard], [0, 0.18, 0.3, 0.45, 0.75, 1], p);
      return 2;
    case "throw": {
      seq(out, [guard, throwWind, throwSpin, throwSpin, throwRelease, throwRelease, guard], [0, 0.18, 0.35, 0.62, 0.74, 0.86, 1], p);
      out[CH.yaw] = TAU * easeIO(sstep(0.2, 0.74, p));
      return 2.1;
    }
    case "finisher": {
      seq(out, [guard, finCoil, finKick, finKick, finCoil, guard], [0, 0.2, 0.38, 0.62, 0.82, 1], p);
      out[CH.ground] = 1 - bell(p, 0.3, 0.7, 0.1);
      return 1.9;
    }
    case "hurt":
      seq(out, [guard, hurtHit, hurtSag, guard], [0, 0.1, 0.45, 1], p);
      return 2.2;
    case "down": {
      seq(out, downKeys, [0, 0.22, 0.45], p);
      out[CH.ground] = 1 - sstep(0.05, 0.25, p);
      const b = Math.sin(c.t * 2.2) * sstep(0.5, 0.7, p);
      add(out, "spine", 0.03 * b);
      return 1.6;
    }
    case "wave": {
      mix(out, relaxed, waveUp, bell(p, 0.15, 0.85, 0.15));
      const k = bell(p, 0.18, 0.82, 0.08);
      add(out, "elR", 0.4 * Math.sin(c.t * 10) * k);
      return 1.6;
    }
    case "fistBump":
      seq(out, [relaxed, bumpOut, bumpOut, bumpBlow, bumpBlow, relaxed], [0, 0.25, 0.45, 0.58, 0.75, 1], p);
      return 1.8;
    case "selfie": {
      mix(out, relaxed, selfie, bell(p, 0.2, 0.85, 0.18));
      add(out, "hips", 0, 0, 0.03 * Math.sin(c.t * 6) * bell(p, 0.25, 0.8, 0.1));
      return 1.5;
    }
    case "handshake": {
      seq(out, [relaxed, shakeReach, shakeReach, shakeReach, relaxed], [0, 0.22, 0.5, 0.78, 1], p);
      const k = bell(p, 0.3, 0.72, 0.06);
      add(out, "shR", 0.13 * Math.sin(c.t * 15) * k);
      add(out, "elR", -0.08 * Math.sin(c.t * 15) * k);
      return 1.6;
    }
    case "hug": {
      seq(out, [relaxed, hugOpen, hugHold, hugHold, relaxed], [0, 0.2, 0.36, 0.8, 1], p);
      const k = bell(p, 0.4, 0.78, 0.06);
      add(out, "hips", 0, 0, 0.06 * Math.sin(c.t * 3) * k);
      add(out, "waL", 0, 0, 0.25 * Math.max(0, Math.sin(c.t * 9)) * k);
      return 1.4;
    }
    case "swim":
      swim(out, c.t, c.speed);
      return 1.4;
    case "backflip": {
      seq(out, [fall, arch, tuck, tuck, fall], [0, 0.14, 0.34, 0.7, 1], p);
      out[CH.pitch] = -TAU * easeIO(sstep(0.06, 0.86, p));
      return 2.1;
    }
    case "corkscrew": {
      mix(out, fall, pencil, bell(p, 0.1, 0.8, 0.1));
      out[CH.pitch] = 1.15 * bell(p, 0.12, 0.78, 0.14);
      out[CH.yaw] = 2 * TAU * easeIO(sstep(0.05, 0.88, p));
      return 2.2;
    }
    case "split": {
      mix(out, fall, splitPose, bell(p, 0.12, 0.72, 0.12));
      out[CH.pitch] = -0.25 * bell(p, 0.15, 0.7, 0.1);
      return 2.2;
    }
    case "takedown":
      seq(out, [perch, tdShoot, tdShoot, tdPull, tdStrike, tdStrike, perch], [0, 0.12, 0.26, 0.42, 0.56, 0.8, 1], p);
      return 2.2;
    case "counter": {
      seq(out, [guard, counterLoad, counterHit, counterHit, guard], [0, 0.2, 0.48, 0.7, 1], p);
      out[CH.yaw] = TAU * easeIO(sstep(0.12, 0.62, p));
      out[CH.lift] = 0.25 * bell(p, 0.3, 0.6, 0.12);
      return 2.3;
    }
    case "grabbed":
      grabbed(out, c.t);
      return 1.8;
    default: {
      const never: never = state;
      void never;
    }
  }
  idle(out, c.t);
  return 1;
}
