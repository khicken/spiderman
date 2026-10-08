import type { Box } from "./city";
import { ACC } from "./crowd-person";

export const WALK = 0, FOLLOW = 1, STAND = 2;
export const CHAT = 0, VENDOR = 1, CUSTOMER = 2;
export const NONE = 0, WATCH = 1, CHEER = 2, FLEE = 3, COWER = 4, STUMBLE = 5, DODGE = 6, GREET = 7;
export const LOOK = 0, POINT = 1, WAVE = 2, PHOTO = 3, JUMP = 4;
export const BUMP = 0, FIVE = 1, SELFIE = 2, SHAKE = 3, HUG = 4;
export const ADULT = 0, KID = 1, ELDER = 2;
export const IDLE_SHIFT = 0, IDLE_CROSS = 1, IDLE_PHONE = 2, IDLE_POCKET = 3;
// Pose channels: 0 lean, 1 head yaw, 2 head pitch, 3 roll, 4-6 left arm (pitch, out, elbow), 7-9 right arm,
// 10-11 thighs, 12-13 knees, 14 body y, 15 chest twist, 16 head tilt, 17 blink, 18 mouth, 19 hip sway, 20 brow.
export const CH = 21;
export const BLINK = 17, MOUTH = 18, SWAY = 19, BROW = 20;

export class Ped {
  on = false;
  kind = WALK;
  sub = CHAT;
  age = ADULT;
  idle = IDLE_SHIFT;
  x = 0;
  z = 0;
  yaw = 0;
  home = 0;
  speed = 1.3;
  moving = 0;
  phase = 0;
  seed = 0;
  bi = 0;
  bj = 0;
  c = 0;
  dir = 1;
  o = 0;
  lat = 0;
  ek = -1;
  wn = 0;
  wi = 0;
  wx = [0, 0, 0];
  wz = [0, 0, 0];
  nbi = 0;
  nbj = 0;
  nc = 0;
  axis = 0;
  g = 0;
  waiting = false;
  delay = 0;
  crossed = false;
  re = NONE;
  reK = 0;
  reT = 0;
  reDur = 0;
  flashT = 0;
  hit = false;
  vx = 0;
  vz = 0;
  gx = 0;
  gz = 0;
  hx = 0;
  hz = 0;
  gyaw = 0;
  lookX = 0;
  lookZ = 0;
  parent = -1;
  child = -1;
  dog = -1;
  cart = -1;
  greeted = false;
  noticed = -99;
  emo = -1;
  emoT = 0;
  emoLife = 0;
  lod = 1;
  w = 1;
  h = 1;
  head = 1;
  mask = 0;
  col = new Array<number>(12).fill(0);
  ang = new Float32Array(CH);
  boxes: Box[] | null = null;
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bell = (a: number, b: number, w: number, x: number) => sstep(a, a + w, x) * (1 - sstep(b - w, b, x));

export function pose(p: Ped, t: number, o: Float32Array) {
  const ph = p.phase;
  const mv = p.moving;
  const sd = p.seed;
  const kid = p.age === KID;
  const old = p.age === ELDER;
  const run = sstep(2.4, 4, mv);
  const amp = Math.min(1, mv / 1.3) * (0.42 + run * 0.4) * (old ? 0.55 : kid ? 1.15 : 1);
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const still = 1 - Math.min(1, mv / 0.6);
  const shift = Math.sin(t * 0.42 + sd) * still;

  o[0] = 0.03 + run * 0.3 + (old ? 0.3 : 0) + Math.min(mv, 1.5) * 0.02;
  o[1] = Math.sin(t * 0.3 + sd) * 0.25 * (mv > 0.2 ? 0.4 : 1) + (Math.sin(t * 0.13 + sd * 3) > 0.85 ? 0.7 * Math.sign(Math.sin(sd * 7)) : 0);
  o[2] = old ? 0.22 : -0.03;
  o[3] = s * 0.04 * amp + shift * 0.045;
  o[4] = -amp * s + 0.05;
  o[5] = 0.1 + (p.w > 1.1 ? 0.06 : 0);
  o[6] = 0.22 + Math.max(0, -s) * amp * 0.5 + run * 1.15;
  o[7] = amp * s + 0.05;
  o[8] = o[5];
  o[9] = 0.22 + Math.max(0, s) * amp * 0.5 + run * 1.15;
  o[10] = amp * s * 0.95 + Math.max(0, shift) * 0.08;
  o[11] = -amp * s * 0.95 + Math.max(0, -shift) * 0.08;
  o[12] = 0.06 + amp * (1.5 + run) * Math.max(0, c) + Math.max(0, shift) * 0.2;
  o[13] = 0.06 + amp * (1.5 + run) * Math.max(0, -c) + Math.max(0, -shift) * 0.2;
  o[14] = -amp * 0.07 * Math.abs(s) + run * 0.05 * Math.abs(c) + (kid ? amp * 0.04 * Math.abs(c) : 0);
  o[15] = amp * s * 0.16;
  o[16] = Math.sin(t * 0.37 + sd * 2) * 0.06;
  o[MOUTH] = 0;
  o[SWAY] = s * 0.022 * amp + shift * 0.035;
  o[BROW] = 0;

  if (p.mask & ACC.bagL) o[5] += 0.12;
  if (p.mask & ACC.bagR) o[8] += 0.12;
  if (p.child >= 0) {
    o[4] = 0.15;
    o[5] = 0.3;
    o[6] = 0.3;
  }
  if (p.kind === FOLLOW) {
    o[7] = 0.35;
    o[8] = 0.55;
    o[9] = 0.2;
  }
  if (p.dog >= 0) {
    o[7] = 0.5 + amp * 0.1 * s;
    o[9] = 0.6;
  }

  let phone = false;
  const talkPose = () => {
    o[7] = 0.45 + 0.22 * Math.sin(t * 2.3 + sd);
    o[8] = -0.05;
    o[9] = 1.25 + 0.4 * Math.sin(t * 3.1 + sd);
    if (Math.sin(t * 0.9 + sd * 2) > 0) {
      o[4] = 0.4 + 0.2 * Math.sin(t * 2.7 + sd);
      o[6] = 1.1 + 0.3 * Math.sin(t * 3.7 + sd);
    }
    o[MOUTH] = Math.max(0, Math.sin(t * 13 + sd)) * 0.7 * (Math.sin(t * 3.1 + sd) > -0.5 ? 1 : 0);
    o[2] += 0.06 * Math.sin(t * 2.2 + sd);
    o[16] += 0.08 * Math.sin(t * 1.1 + sd);
  };
  const phonePose = () => {
    if (p.mask & (ACC.bagR | ACC.cane)) return;
    phone = true;
    o[7] = 0.45;
    o[8] = -0.1;
    o[9] = 1.5;
    o[4] = 0.35;
    o[5] = -0.2;
    o[6] = 1.35;
    o[2] = -0.45;
    o[1] *= 0.2;
  };
  if (p.kind === STAND && p.re === NONE) {
    if (p.sub === VENDOR) {
      const serve = Math.sin(t * 0.7 + sd) > 0.6;
      o[0] = 0.18;
      o[4] = 0.55;
      o[6] = 0.75;
      o[7] = serve ? 1.25 : 0.55;
      o[9] = serve ? 0.4 : 0.75;
      if (!serve) talkPose();
    } else if (p.sub === CHAT) {
      if (Math.sin(t * 0.45 + sd * 5.3) > 0.25) talkPose();
      else if (p.idle === IDLE_CROSS) {
        o[4] = o[7] = 0.5;
        o[5] = o[8] = -0.35;
        o[6] = o[9] = 1.95;
      } else if (p.idle === IDLE_PHONE && Math.sin(t * 0.2 + sd) > 0.3) phonePose();
      else if (p.idle === IDLE_POCKET) {
        o[4] = o[7] = -0.12;
        o[5] = o[8] = 0.16;
        o[6] = o[9] = 0.55;
      }
      if (Math.sin(t * 0.23 + sd * 3) > 0.9) {
        o[0] = -0.1;
        o[MOUTH] = 0.7;
        o[BROW] = 1;
        o[14] = Math.abs(Math.sin(t * 9)) * 0.02;
      } else o[2] += 0.07 * Math.max(0, Math.sin(t * 2 + sd)) * (Math.sin(t * 0.7 + sd) > 0.5 ? 1 : 0);
    } else if (p.idle === IDLE_PHONE) phonePose();
    else if (p.idle === IDLE_CROSS) {
      o[4] = o[7] = 0.5;
      o[5] = o[8] = -0.35;
      o[6] = o[9] = 1.95;
    }
  }
  if (p.kind === WALK && p.re === NONE && (p.idle === IDLE_PHONE ? p.waiting || Math.sin(t * 0.15 + sd) > 0.4 : false) && !(p.mask & ACC.cane) && p.dog < 0 && p.child < 0) phonePose();

  const T = p.reT;
  const w = t * 10 + sd;
  switch (p.re) {
    case WATCH:
      o[BROW] = 1;
      o[MOUTH] = 0.25;
      if (p.reK === POINT) {
        o[7] = 1.5;
        o[8] = 0.05;
        o[9] = 0.05;
        o[MOUTH] = 0.5;
      } else if (p.reK === WAVE) {
        o[7] = 2.4;
        o[8] = 0.45 + 0.35 * Math.sin(t * 11 + sd);
        o[9] = 0.45;
        o[MOUTH] = 0.35;
      } else if (p.reK === PHOTO) {
        phone = true;
        o[4] = 1.3;
        o[5] = -0.3;
        o[6] = 0.75;
        o[7] = 1.35;
        o[8] = -0.25;
        o[9] = 0.6;
        o[MOUTH] = 0;
      } else if (p.reK === JUMP) {
        const j = Math.abs(Math.sin(t * 8 + sd));
        o[14] = j * 0.2;
        o[10] = o[11] = 0.35 * (1 - j);
        o[12] = o[13] = 0.7 * (1 - j);
        o[4] = o[7] = 2.6 + 0.25 * Math.sin(t * 16 + sd);
        o[5] = o[8] = 0.45;
        o[6] = o[9] = 0.3;
        o[MOUTH] = 0.8;
      }
      break;
    case CHEER: {
      o[BROW] = 1;
      o[MOUTH] = 0.6 + 0.3 * Math.sin(t * 7 + sd);
      const v = kid ? 0 : Math.floor(sd * 3) % 3;
      if (v === 0) {
        const j = Math.max(0, Math.sin(w));
        o[4] = o[7] = 2.75 + 0.2 * Math.sin(w);
        o[5] = o[8] = 0.38;
        o[6] = o[9] = 0.25 + 0.3 * Math.sin(w);
        o[14] = j * (kid ? 0.2 : 0.13);
        o[12] = o[13] = 0.5 * (1 - j);
        o[10] = o[11] = 0.25 * (1 - j);
      } else if (v === 1) {
        o[4] = o[7] = 1.15;
        o[5] = o[8] = -0.42 + 0.2 * Math.sin(t * 15 + sd);
        o[6] = o[9] = 0.95;
      } else {
        const pump = Math.max(0, Math.sin(t * 8 + sd));
        o[7] = 2.0 + 0.6 * pump;
        o[8] = 0.15;
        o[9] = 1.4 - pump * 1.1;
        o[4] = -0.2;
        o[5] = 0.55;
        o[6] = 1.6;
        o[14] = pump * 0.05;
      }
      o[2] = 0.25;
      break;
    }
    case COWER:
    case STUMBLE: {
      const u = p.reDur > 0 ? T / p.reDur : 0;
      const k = p.re === COWER ? 1 : Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.75;
      o[14] = -0.42 * k;
      o[10] = o[11] = 1.5 * k;
      o[12] = o[13] = 2.2 * k;
      o[0] = 0.7 * k;
      o[4] = o[7] = 2.65 * k;
      o[5] = o[8] = 0.5 * k;
      o[6] = o[9] = 2.0 * k;
      o[2] = -0.55 * k;
      o[3] = 0.04 * Math.sin(t * 31 + sd) * k;
      o[15] = o[SWAY] = 0;
      o[BROW] = 2;
      o[MOUTH] = 0.35;
      break;
    }
    case DODGE:
      o[0] = -0.15;
      o[4] = o[7] = 0.9;
      o[5] = o[8] = 0.7;
      o[6] = o[9] = 1.3;
      o[BROW] = 2;
      o[MOUTH] = 0.6;
      break;
    case FLEE:
      o[BROW] = 2;
      o[MOUTH] = 0.75 + 0.2 * Math.sin(t * 9 + sd);
      if (sd % 2 < 1) {
        o[4] = o[7] = 2.45 + 0.3 * Math.sin(ph * 2);
        o[5] = o[8] = 0.5 + 0.15 * Math.sin(ph);
        o[6] = o[9] = 1.1;
        o[15] *= 0.3;
      } else {
        o[4] *= 1.4;
        o[7] *= 1.4;
      }
      if (Math.sin(t * 1.7 + sd) > 0.55) {
        const side = Math.sin(sd * 5) > 0 ? 1 : -1;
        o[1] = 1.2 * side;
        o[15] += 0.35 * side;
      }
      break;
    case GREET:
      greetPose(p, T, t, o);
      phone = p.reK === SELFIE && T > 0.1 && T < 1.5;
      break;
  }
  if (p.mask & (ACC.bagR | ACC.cane) && !(p.mask & ACC.bagL) && o[7] > 1 && o[4] < 1) {
    for (let q = 4; q < 7; q++) {
      const v = o[q];
      o[q] = o[q + 3];
      o[q + 3] = v;
    }
  }
  if (p.mask & ACC.cane && p.re !== COWER && p.re !== STUMBLE) {
    o[7] = 0.32 + 0.2 * s * Math.min(1, mv);
    o[8] = 0.06;
    o[9] = -0.05;
  }
  if (p.mask & (ACC.bagR | ACC.cane)) phone = false;
  o[BLINK] = p.re === GREET && p.reK === HUG && T > 0.4 && T < 1.1 ? 1 : (t * 0.31 + sd * 0.37) % 1 < 0.035 ? 1 : 0;
  return phone;
}

function greetPose(p: Ped, T: number, t: number, o: Float32Array) {
  o[BROW] = 1;
  o[MOUTH] = 0.15;
  o[1] = 0;
  const sd = p.seed;
  switch (p.reK) {
    case BUMP: {
      const e = sstep(0.12, 0.38, T) * (1 - sstep(0.7, 0.85, T));
      const x = bell(0.72, 1.45, 0.22, T);
      o[0] += 0.08 * e;
      o[7] = 1.35 * e + 1.2 * x;
      o[8] = -0.22 * e + 0.65 * x;
      o[9] = 0.15 + 0.15 * (1 - e) + 0.9 * x;
      o[MOUTH] = 0.15 + 0.6 * x;
      break;
    }
    case FIVE: {
      const e = sstep(0.15, 0.42, T) * (1 - sstep(0.85, 1.15, T));
      o[7] = 2.25 * e - 0.25 * bell(0.5, 0.75, 0.1, T);
      o[8] = -0.28 * e;
      o[9] = 0.3 * e;
      o[0] += 0.1 * e;
      o[MOUTH] = 0.2 + 0.5 * bell(0.5, 1.0, 0.1, T);
      break;
    }
    case SHAKE: {
      const e = sstep(0.15, 0.4, T) * (1 - sstep(0.95, 1.15, T));
      const pump = 0.13 * Math.sin((T - 0.45) * 20) * bell(0.45, 0.9, 0.08, T);
      o[7] = 1.15 * e + pump;
      o[8] = -0.22 * e;
      o[9] = 0.35 * e;
      const e2 = sstep(0.45, 0.6, T) * (1 - sstep(0.9, 1.05, T));
      o[4] = 0.95 * e2;
      o[5] = -0.5 * e2;
      o[6] = 0.95 * e2;
      o[0] += 0.12 * e;
      o[2] = -0.08 * e;
      o[MOUTH] = 0.3 * e;
      break;
    }
    case SELFIE: {
      const e = sstep(0.15, 0.45, T) * (1 - sstep(1.2, 1.45, T));
      o[7] = 2.2 * e;
      o[8] = 0.25 * e;
      o[9] = 0.5 * e;
      o[4] = 1.05 * e;
      o[5] = 0.35 * e;
      o[6] = 1.95 * e;
      o[3] = -0.12 * e;
      o[16] = -0.18 * e;
      o[2] = 0.1 * e;
      o[MOUTH] = 0.45 * e;
      break;
    }
    case HUG: {
      const e = sstep(0.2, 0.45, T) * (1 - sstep(1.1, 1.35, T));
      o[4] = o[7] = 1.45 * e;
      o[5] = o[8] = -0.32 * e;
      o[6] = o[9] = 0.7 * e;
      o[0] += 0.22 * e;
      o[16] = 0.3 * e;
      o[2] = 0.2 * e;
      o[MOUTH] = 0.1;
      break;
    }
  }
  if (T > 1.4) {
    const k = sstep(1.4, 1.6, T);
    if (p.age === KID) {
      const j = Math.abs(Math.sin(t * 9 + sd));
      o[14] = j * 0.16 * k;
      o[4] = o[7] = 2.5 * k;
      o[5] = o[8] = 0.4;
    } else {
      o[7] = 2.35 * k;
      o[8] = 0.4 + 0.35 * Math.sin(t * 11 + sd);
      o[9] = 0.45;
    }
    o[MOUTH] = 0.45;
  }
}
