import { EMBER_PATHS, PROLOGUE, VIEW_CUTS, WAYSTONES } from "./contracts";

// Pure data and math for the world layout: waystone positions, ember path sampling, view cuts and the secret table.
// No three.js here, so scripts/world/world-check.ts can import it without a DOM.

/** The contract waystone list with fixes for spots that were underwater, too far from a pedestal or next to a camp. */
const WAYSTONE_AT: Record<string, { x: number; z: number }> = {
  "ws-sunken": { x: 246, z: -346 }, // flat south shore of the lake beacon island (the contract spot is underwater)
  "ws-whisperwood": { x: -320, z: -150 }, // end of ember path 1; the contract spot was 125 m from the Thornring pedestal
  "ws-cinder": { x: 75, z: 110 }, // beside ember path 2; the contract spot is 10 m from the cinder-path camp
  "ws-ashen": { x: 350, z: 158 }, // end of ember path 0, 70 m from the Cliffwatch pedestal
};
export const WAYSTONE_LIST: readonly { id: string; name: string; x: number; z: number }[] = WAYSTONES.map((w) => ({ ...w, ...(WAYSTONE_AT[w.id] ?? {}) }));
export function waystoneDef(id: string) { return WAYSTONE_LIST.find((w) => w.id === id); }

export type SecretKind = "trail" | "knots" | "critter" | "chime" | "blight" | "lore";
export type SecretReward = "shard" | "glimmer" | "wick" | "none";
export interface SecretDef { id: string; kind: SecretKind; x: number; z: number; reward: SecretReward; path: number }

/** Secrets the v2 world track adds. Positions were picked once by scripts/world/gen-secrets.mts (dry, gentle ground,
 *  clear of camps, waystones and arenas) and baked in. path = ember path index it sits beside, -1 for off-path. */
export const SECRETS: readonly SecretDef[] = [
  { id: "sec-chime-1", kind: "chime", x: 33, z: 259, reward: "shard", path: 0 },
  { id: "sec-knots-1", kind: "knots", x: 138, z: 250, reward: "glimmer", path: 0 },
  { id: "sec-critter-1", kind: "critter", x: 217, z: 216, reward: "wick", path: 0 },
  { id: "sec-lore-1", kind: "lore", x: 273, z: 154, reward: "none", path: 0 },
  { id: "sec-trail-1", kind: "trail", x: -108, z: 216, reward: "shard", path: 1 },
  { id: "sec-critter-2", kind: "critter", x: -187, z: 197, reward: "shard", path: 1 },
  { id: "sec-blight-1", kind: "blight", x: -299, z: 123, reward: "shard", path: 1 },
  { id: "sec-chime-2", kind: "chime", x: -284, z: -5, reward: "shard", path: 1 },
  { id: "sec-knots-2", kind: "knots", x: -308, z: -87, reward: "glimmer", path: 1 },
  { id: "sec-lore-2", kind: "lore", x: -323, z: -135, reward: "none", path: 1 },
  { id: "sec-lore-3", kind: "lore", x: 12, z: 208, reward: "none", path: 2 },
  { id: "sec-trail-2", kind: "trail", x: 99, z: 144, reward: "glimmer", path: 2 },
  { id: "sec-chime-3", kind: "chime", x: 157, z: 90, reward: "wick", path: 2 },
  { id: "sec-knots-3", kind: "knots", x: 205, z: -13, reward: "glimmer", path: 2 },
  { id: "sec-blight-2", kind: "blight", x: 201, z: -128, reward: "shard", path: 2 },
  { id: "sec-critter-3", kind: "critter", x: 187, z: -190, reward: "glimmer", path: 2 },
  { id: "sec-lore-4", kind: "lore", x: 141, z: -226, reward: "none", path: 2 },
  { id: "sec-lore-5", kind: "lore", x: -280, z: 99, reward: "none", path: 3 },
  { id: "sec-critter-4", kind: "critter", x: -254, z: -5, reward: "shard", path: 3 },
  { id: "sec-chime-4", kind: "chime", x: -289, z: -109, reward: "glimmer", path: 3 },
  { id: "sec-blight-3", kind: "blight", x: -228, z: -177, reward: "glimmer", path: 3 },
  { id: "sec-knots-4", kind: "knots", x: -183, z: -254, reward: "glimmer", path: 3 },
  { id: "sec-trail-3", kind: "trail", x: -166, z: -359, reward: "shard", path: 3 },
  { id: "sec-trail-4", kind: "trail", x: 85, z: 186, reward: "glimmer", path: -1 },
  { id: "sec-critter-5", kind: "critter", x: -102, z: 110, reward: "glimmer", path: -1 },
  { id: "sec-lore-6", kind: "lore", x: -162, z: 40, reward: "none", path: -1 },
  { id: "sec-knots-5", kind: "knots", x: 50, z: -68, reward: "glimmer", path: -1 },
  { id: "sec-chime-5", kind: "chime", x: 215, z: 95, reward: "shard", path: -1 },
  { id: "sec-trail-5", kind: "trail", x: -227, z: -244, reward: "glimmer", path: -1 },
  { id: "sec-lore-7", kind: "lore", x: -89, z: -258, reward: "none", path: -1 },
  { id: "sec-critter-6", kind: "critter", x: 68, z: -250, reward: "glimmer", path: -1 },
  { id: "sec-blight-4", kind: "blight", x: -420, z: 120, reward: "shard", path: -1 },
  { id: "sec-knots-6", kind: "knots", x: -440, z: -240, reward: "glimmer", path: -1 },
  { id: "sec-trail-6", kind: "trail", x: 334, z: -340, reward: "glimmer", path: -1 },
];

/** Secrets that already existed in v1, by collectible id. They count toward the total and emit the same event. */
export const V1_SECRETS: readonly { item: string; id: string; kind: SecretKind }[] = [
  { item: "shard-oak", id: "sec-v1-oak", kind: "lore" },
  { item: "shard-ledge", id: "sec-v1-ledge", kind: "knots" },
  { item: "shard-seastack", id: "sec-v1-seastack", kind: "trail" },
  { item: "shard-ruin", id: "sec-v1-ruin", kind: "lore" },
  { item: "shard-waterfall", id: "sec-v1-waterfall", kind: "trail" },
  { item: "shard-mill", id: "sec-v1-mill", kind: "critter" },
  { item: "shard-lake", id: "sec-v1-lake", kind: "chime" },
];

// ---------------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------------
export interface PathPoint { x: number; z: number; tx: number; tz: number; s: number }

const lens: number[][] = EMBER_PATHS.map((p) => {
  const acc = [0];
  for (let i = 1; i < p.length; i++) acc.push(acc[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
  return acc;
});

export function pathLength(i: number) { return lens[i][lens[i].length - 1]; }

/** Point at arc length s along ember path i (clamped), with the unit tangent. */
export function pathAt(i: number, s: number, out: PathPoint = { x: 0, z: 0, tx: 0, tz: 0, s: 0 }): PathPoint {
  const p = EMBER_PATHS[i], L = lens[i];
  const ss = Math.max(0, Math.min(L[L.length - 1], s));
  let k = 0;
  while (k < p.length - 2 && L[k + 1] < ss) k++;
  const seg = L[k + 1] - L[k] || 1;
  const t = (ss - L[k]) / seg;
  out.tx = (p[k + 1].x - p[k].x) / seg;
  out.tz = (p[k + 1].z - p[k].z) / seg;
  out.x = p[k].x + (p[k + 1].x - p[k].x) * t;
  out.z = p[k].z + (p[k + 1].z - p[k].z) * t;
  out.s = ss;
  return out;
}

/** Nearest point of ember path i to (x, z): arc length `s` and lateral distance `d`. */
export function nearestOnPath(i: number, x: number, z: number): { s: number; d: number } {
  const p = EMBER_PATHS[i], L = lens[i];
  let best = 1e9, bs = 0;
  for (let k = 0; k < p.length - 1; k++) {
    const ax = p[k].x, az = p[k].z, bx = p[k + 1].x - ax, bz = p[k + 1].z - az;
    const l2 = bx * bx + bz * bz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
    const d = Math.hypot(x - (ax + bx * t), z - (az + bz * t));
    if (d < best) { best = d; bs = L[k] + t * Math.sqrt(l2); }
  }
  return { s: bs, d: best };
}

/** Distance from (x, z) to the nearest ember path of any index, or the prologue line. */
export function distToAnyPath(x: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < EMBER_PATHS.length; i++) d = Math.min(d, nearestOnPath(i, x, z).d);
  return d;
}

/** True when (x, z) lies within `pad` meters beyond the half width of a view cut. Nature uses VIEW_CUTS directly;
 *  this is for offline checks and for keeping secrets out of the cut. */
export function inViewCut(x: number, z: number, pad = 0): boolean {
  for (const c of VIEW_CUTS) {
    const dx = c.x1 - c.x0, dz = c.z1 - c.z0, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - c.x0) * dx + (z - c.z0) * dz) / l2));
    if (Math.hypot(x - (c.x0 + dx * t), z - (c.z0 + dz * t)) < c.w + pad) return true;
  }
  return false;
}

/** The prologue walk: gate brazier, stepping stones, ledge, climb rock, knot B, Glade beacon. */
export const PROLOGUE_LINE: readonly { x: number; z: number }[] = [
  PROLOGUE.gateBrazier, PROLOGUE.stones, PROLOGUE.ledge, PROLOGUE.climbRock, PROLOGUE.knotB, PROLOGUE.glade,
];
