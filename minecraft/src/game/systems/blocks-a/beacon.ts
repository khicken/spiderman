import * as THREE from "three";
import type { BlockBehavior, BlockEntityData, Dim, GameCtx, GameEvent } from "../../contracts";
import { MAX_Y, idOf } from "../../contracts";
import { BLOCKS, LIGHT_FILTER, blockDef } from "../../blocks/registry";
import { sound } from "../../mechanics/util";

export const BASE_BLOCKS = new Set(["iron_block", "gold_block", "emerald_block", "diamond_block", "netherite_block"]);
export const PAYMENT = new Set(["iron_ingot", "gold_ingot", "emerald", "diamond", "netherite_ingot"]);
export const TIER_EFFECTS: string[][] = [["speed", "haste"], ["resistance", "jump_boost"], ["strength"]];
const ALL_PRIMARY = new Set(TIER_EFFECTS.flat());

const DYE: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
  light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa, brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};
const GLASS_COLOR = new Map<number, number>();
for (const b of BLOCKS) {
  const m = /^(.+)_stained_glass(_pane)?$/.exec(b.name);
  if (m && DYE[m[1]] !== undefined) GLASS_COLOR.set(b.id, DYE[m[1]]);
}
const BEDROCK = BLOCKS.find((b) => b.name === "bedrock")?.id ?? -1;

export interface BeaconData {
  primary?: string;
  secondary?: string;
  levels?: number;
}

interface Segment {
  y0: number;
  y1: number;
  color: number;
}

interface Live {
  x: number;
  y: number;
  z: number;
  levels: number;
  segments: Segment[];
  sig: string;
  group: THREE.Group | null;
}

const known: Record<Dim, Set<string>> = { overworld: new Set(), nether: new Set(), end: new Set() };
const live = new Map<string, Live>();
let root: THREE.Group | null = null;
let beamTex: THREE.DataTexture | null = null;
const k = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function beaconLevels(ctx: GameCtx, x: number, y: number, z: number): number {
  const w = ctx.world;
  let levels = 0;
  for (let i = 1; i <= 4; i++) {
    const yy = y - i;
    for (let dx = -i; dx <= i; dx++)
      for (let dz = -i; dz <= i; dz++) if (!BASE_BLOCKS.has(blockDef(w.getBlock(x + dx, yy, z + dz)).name)) return levels;
    levels = i;
  }
  return levels;
}

function beamSegments(ctx: GameCtx, x: number, y: number, z: number): Segment[] | null {
  const out: Segment[] = [];
  let color = 0xffffff;
  let first = true;
  let cur: Segment = { y0: y + 1, y1: y + 1, color };
  const top = Math.max(MAX_Y, ctx.world.topY(x, z));
  for (let yy = y + 1; yy <= top; yy++) {
    const id = idOf(ctx.world.getBlock(x, yy, z));
    const g = GLASS_COLOR.get(id);
    if (g !== undefined) {
      const next = first ? g : mix(color, g);
      first = false;
      if (next !== color) {
        cur.y1 = yy;
        if (cur.y1 > cur.y0) out.push(cur);
        color = next;
        cur = { y0: yy, y1: yy, color };
      }
      continue;
    }
    if (id !== 0 && LIGHT_FILTER[id] >= 15 && id !== BEDROCK) return null;
  }
  cur.y1 = y + 1024;
  out.push(cur);
  return out;
}

function mix(a: number, b: number): number {
  const c = (s: number) => Math.round((((a >> s) & 255) + ((b >> s) & 255)) / 2);
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

export function beaconData(be: BlockEntityData | undefined): BeaconData {
  return (be?.data ?? {}) as BeaconData;
}

export const BEACON_BEHAVIOR: BlockBehavior = {
  use(ctx, x, y, z) {
    ctx.inventory.open("beacon", { x, y, z });
    return true;
  },
  onPlaced(ctx, x, y, z) {
    known[ctx.world.dim].add(k(x, y, z));
    if (!ctx.world.getBlockEntity(x, y, z)) ctx.world.setBlockEntity({ x, y, z, type: "beacon", data: { levels: 0 } }, x, y, z);
    refresh(ctx, x, y, z);
  },
};

function ensureRoot(ctx: GameCtx): THREE.Group | null {
  const scene = ctx.renderer?.scene;
  if (!scene) return null;
  if (!root) {
    root = new THREE.Group();
    root.name = "beacon-beams";
  }
  if (root.parent !== scene) scene.add(root);
  return root;
}

function texture(): THREE.DataTexture {
  if (beamTex) return beamTex;
  const d = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = 200 + ((x * 37 + y * 11) % 7) * 8 - (x % 5 === 0 ? 40 : 0);
      const i = (y * 16 + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, v);
      d[i + 3] = 255;
    }
  beamTex = new THREE.DataTexture(d, 16, 16);
  beamTex.magFilter = beamTex.minFilter = THREE.NearestFilter;
  beamTex.wrapS = beamTex.wrapT = THREE.RepeatWrapping;
  beamTex.colorSpace = THREE.SRGBColorSpace;
  beamTex.needsUpdate = true;
  return beamTex;
}

function disposeGroup(g: THREE.Group) {
  g.removeFromParent();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
}

function buildBeam(l: Live): THREE.Group {
  const g = new THREE.Group();
  g.position.set(l.x + 0.5, 0, l.z + 0.5);
  const tex = texture();
  for (const s of l.segments) {
    const h = s.y1 - s.y0;
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, h, 0.4),
      new THREE.MeshBasicMaterial({ map: tex, color: s.color, fog: false, toneMapped: false }),
    );
    scaleUv(inner.geometry, h);
    inner.position.y = s.y0 + h / 2;
    inner.name = "inner";
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, h, 0.5),
      new THREE.MeshBasicMaterial({ map: tex, color: s.color, transparent: true, opacity: 0.18, depthWrite: false, fog: false, toneMapped: false }),
    );
    scaleUv(outer.geometry, h);
    outer.position.y = s.y0 + h / 2;
    g.add(inner, outer);
  }
  return g;
}

function scaleUv(geo: THREE.BufferGeometry, h: number) {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) if (Math.abs(n.getY(i)) < 0.5) uv.setY(i, uv.getY(i) * h);
  uv.needsUpdate = true;
}

export function refresh(ctx: GameCtx, x: number, y: number, z: number) {
  const key = k(x, y, z);
  const s = ctx.world.getBlock(x, y, z);
  if (blockDef(s).name !== "beacon") {
    known[ctx.world.dim].delete(key);
    drop(key);
    return;
  }
  const be = ctx.world.getBlockEntity(x, y, z) ?? { x, y, z, type: "beacon", data: {} };
  const data = (be.data ??= {}) as BeaconData;
  const segs = beamSegments(ctx, x, y, z);
  const levels = segs ? beaconLevels(ctx, x, y, z) : 0;
  const was = data.levels ?? 0;
  if (was !== levels) {
    data.levels = levels;
    ctx.world.setBlockEntity(be, x, y, z);
    if (levels > 0 && was === 0) sound(ctx, "block.beacon.activate", x, y, z);
    if (levels === 0 && was > 0) sound(ctx, "block.beacon.deactivate", x, y, z);
  }
  const sig = levels > 0 && segs ? segs.map((g) => `${g.y0}:${g.color}`).join("|") : "";
  let l = live.get(key);
  if (!l) {
    l = { x, y, z, levels, segments: [], sig: "", group: null };
    live.set(key, l);
  }
  l.levels = levels;
  if (sig !== l.sig) {
    l.sig = sig;
    l.segments = segs ?? [];
    if (l.group) disposeGroup(l.group);
    l.group = null;
    const r = sig ? ensureRoot(ctx) : null;
    if (r) {
      l.group = buildBeam(l);
      r.add(l.group);
    }
  }
}

function drop(key: string) {
  const l = live.get(key);
  if (!l) return;
  if (l.group) disposeGroup(l.group);
  live.delete(key);
}

function applyEffects(ctx: GameCtx, l: Live) {
  if (l.levels <= 0) return;
  const data = beaconData(ctx.world.getBlockEntity(l.x, l.y, l.z));
  if (!data.primary || !ALL_PRIMARY.has(data.primary)) return;
  const range = l.levels * 10 + 10;
  const p = ctx.player;
  const pos = p.body.pos;
  if (p.dead || Math.abs(pos.x - (l.x + 0.5)) > range + 0.5 || Math.abs(pos.z - (l.z + 0.5)) > range + 0.5) return;
  if (pos.y < l.y - range || pos.y > MAX_Y + range) return;
  const ticks = (9 + l.levels * 2) * 20;
  const add = (p as unknown as { addEffect?: (id: string, a: number, t: number) => void }).addEffect;
  if (!add) return;
  const amp = l.levels >= 4 && data.secondary === data.primary ? 1 : 0;
  add(data.primary, amp, ticks);
  if (l.levels >= 4 && data.secondary && data.secondary !== data.primary) add(data.secondary, 0, ticks);
}

export const beacons = {
  tick(ctx: GameCtx) {
    const t = ctx.time.tick;
    if (t % 80 !== 0) return;
    for (const key of [...known[ctx.world.dim]]) {
      const [x, y, z] = key.split(",").map(Number);
      if (!ctx.world.isLoaded(x, z)) continue;
      refresh(ctx, x, y, z);
      const l = live.get(key);
      if (l && l.levels > 0) {
        applyEffects(ctx, l);
        sound(ctx, "block.beacon.ambient", x, y, z, 0.6);
      }
    }
  },
  frame(dt: number) {
    if (!beamTex || !root) return;
    beamTex.offset.y -= dt * 0.8;
    for (const c of root.children) for (const m of c.children) if (m.name === "inner") m.rotation.y += dt * 1.2;
  },
  onEvent(ctx: GameCtx, e: GameEvent) {
    if (e.type !== "block_changed") return;
    const set = known[ctx.world.dim];
    if (!set.size) return;
    if (blockDef(e.from).name === "beacon" && blockDef(e.to).name !== "beacon") {
      const key = k(e.x, e.y, e.z);
      set.delete(key);
      drop(key);
      return;
    }
    for (const key of set) {
      const [x, y, z] = key.split(",").map(Number);
      if (Math.abs(e.x - x) <= 4 && Math.abs(e.z - z) <= 4 && e.y < y && e.y >= y - 4) refresh(ctx, x, y, z);
      else if (e.x === x && e.z === z && e.y > y) refresh(ctx, x, y, z);
    }
  },
  stage(ctx: GameCtx) {
    ensureRoot(ctx);
    for (const key of known[ctx.world.dim]) {
      const [x, y, z] = key.split(",").map(Number);
      if (ctx.world.isLoaded(x, z)) refresh(ctx, x, y, z);
    }
  },
  unstage() {
    for (const key of [...live.keys()]) drop(key);
    root?.removeFromParent();
  },
  save(): Record<string, string[]> {
    return { overworld: [...known.overworld], nether: [...known.nether], end: [...known.end] };
  },
  load(d: unknown) {
    const v = (d ?? {}) as Record<string, string[]>;
    for (const dim of ["overworld", "nether", "end"] as Dim[]) known[dim] = new Set(Array.isArray(v[dim]) ? v[dim] : []);
  },
  dispose() {
    this.unstage();
    beamTex?.dispose();
    beamTex = null;
    root = null;
  },
};
