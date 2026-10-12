import { chest, faceOf, fill, fillFn, frame, put, rnd, S, wx, wz, type Frame } from "./build";
import { B } from "./ids";
import { createRng, type Writer } from "./rng";
import type { Start } from "./structure-grid";

const MOBS = ["zombie", "husk", "skeleton", "stray", "bogged", "spider", "cave_spider", "slime", "silverfish", "breeze"];
const TB = B.tuff_bricks, PT = B.polished_tuff, CT = B.chiseled_tuff, CTB = B.chiseled_tuff_bricks, GRATE = B.waxed_copper_grate;
const CUT = B.waxed_cut_copper, OXCUT = B.waxed_oxidized_cut_copper, BULB = B.waxed_copper_bulb, CHC = B.waxed_chiseled_copper;

function shell(f: Frame, floorY: number, ceilY: number) {
  return (_a: number, y: number, _b: number, x: number, wy: number, z: number) => {
    const v = rnd(f, x, wy, z);
    if (y === floorY) return S((x + z) % 6 === 0 ? CT : v < 0.15 ? CHC : PT);
    if (y === ceilY) return S((x + z * 3) % 4 === 0 ? GRATE : v < 0.3 ? OXCUT : TB);
    if (y === floorY + 3) return S(CTB);
    if (y === floorY + 1) return S(v < 0.5 ? CUT : TB);
    return S(TB);
  };
}

function box(f: Frame, a0: number, y0: number, b0: number, a1: number, y1: number, b1: number) {
  const sh = shell(f, y0, y1);
  fillFn(f, a0, y0, b0, a1, y1, b1, (a, y, b, x, wy, z) => (a === a0 || a === a1 || b === b0 || b === b1 || y === y0 || y === y1 ? sh(a, y, b, x, wy, z) : 0));
}

function trialSpawner(f: Frame, a: number, y: number, b: number, mob: string) {
  put(f, a, y - 1, b, S(PT));
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  f.w.set(x, f.y + y, z, S(B.trial_spawner));
  f.w.blockEntities.push({ x, y: f.y + y, z, type: "trial_spawner", data: { mob, state: "waiting", ominous: false } });
}

function vault(f: Frame, a: number, y: number, b: number, h: number) {
  const x = wx(f, a, b), z = wz(f, a, b);
  if (!f.w.inside(x, z)) return;
  f.w.set(x, f.y + y, z, S(B.vault, faceOf(f, h)));
  f.w.blockEntities.push({ x, y: f.y + y, z, type: "vault", data: { key: "trial_key", lootTable: "trial_chambers_reward" } });
}

export function trialChamber(w: Writer, s: Start) {
  const r = createRng(s.seed);
  const f = frame(w, s.x, s.y, s.z, r.int(4), s.seed);
  const R = 11, H = 11;
  box(f, -R, 0, -R, R, H, R);
  for (const [pa, pb] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
    fillFn(f, pa, 1, pb, pa, H - 1, pb, (_a, y) => S(y === H - 1 ? BULB : y % 3 === 0 ? CTB : TB));
    put(f, pa, 5, pb + (pb > 0 ? -1 : 1), S(BULB));
  }
  fill(f, -3, 0, -3, 3, 0, 3, S(CHC));
  fill(f, -2, 0, -2, 2, 0, 2, S(PT));
  trialSpawner(f, -7, 2, 0, "breeze");
  trialSpawner(f, 7, 2, 0, MOBS[r.int(MOBS.length - 1)]);
  vault(f, -1, 1, 0, 1);
  vault(f, 1, 1, 0, 3);
  chest(f, 0, 1, 3, 0, "trial_chambers_intersection", B.barrel, "barrel");
  for (let k = 0; k < 8; k++) {
    const side = r.int(4), t = r.int(2 * R - 3) - R + 2;
    const pa = side < 2 ? (side === 0 ? -R + 1 : R - 1) : t, pb = side >= 2 ? (side === 2 ? -R + 1 : R - 1) : t;
    if (Math.abs(pa) <= 1 || Math.abs(pb) <= 1) continue;
    put(f, pa, 1, pb, S(B.decorated_pot));
  }
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [da, db] of dirs) {
    const len = 12 + r.int(10);
    const sa = da * R, sb = db * R;
    const ea = sa + da * len, eb = sb + db * len;
    box(f, Math.min(sa, ea) - (db ? 2 : 0), 0, Math.min(sb, eb) - (da ? 2 : 0), Math.max(sa, ea) + (db ? 2 : 0), 5, Math.max(sb, eb) + (da ? 2 : 0));
    for (let t = 3; t < len; t += 5) put(f, sa + da * t, 4, sb + db * t, S(BULB));
    const ma = sa + da * (len >> 1) + db * 1, mb = sb + db * (len >> 1) + da * 1;
    chest(f, ma, 1, mb, 0, "trial_chambers_corridor", B.chest);
    put(f, ma - db * 2, 1, mb - da * 2, S(B.decorated_pot));
    const ca = ea + da * 6, cb = eb + db * 6;
    box(f, ca - 6, 0, cb - 6, ca + 6, 7, cb + 6);
    fill(f, ea - (db ? 1 : 0), 1, eb - (da ? 1 : 0), ea + da + (db ? 1 : 0), 3, eb + db + (da ? 1 : 0), 0);
    trialSpawner(f, ca, 1, cb, MOBS[r.int(MOBS.length)]);
    chest(f, ca + (db ? 4 : 0), 1, cb + (da ? 4 : 0), 0, "trial_chambers_supply", B.barrel, "barrel");
    chest(f, ca - (db ? 4 : 0), 1, cb - (da ? 4 : 0), 0, "trial_chambers_entrance", B.chest);
    vault(f, ca + da * 5, 1, cb + db * 5, da > 0 ? 1 : da < 0 ? 3 : db > 0 ? 2 : 0);
    put(f, ca, 6, cb, S(BULB));
    for (const [qa, qb] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) put(f, ca + qa, 1, cb + qb, S(B.decorated_pot));
  }
  for (let a = -1; a <= 1; a++) {
    for (let k = 1; k <= 3; k++) {
      put(f, R, k, a, 0);
      put(f, -R, k, a, 0);
      put(f, a, k, R, 0);
      put(f, a, k, -R, 0);
    }
  }
}
