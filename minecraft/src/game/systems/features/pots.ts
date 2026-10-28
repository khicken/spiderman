import * as THREE from "three";
import type { BlockBehavior, BlockEntityData, BlockState, Entity, GameCtx, ItemStack } from "../../contracts";
import { CHUNK, idOf, metaOf, stateOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { itemDef, maxStack } from "../../items/registry";
import { BEHAVIORS } from "../../mechanics/index";
import { paintBlockTexture } from "../../textures/index";
import { SHERD_MOTIFS, motifAt } from "../../textures/motifs";
import { brightnessAt } from "../../entities/render";

// Meta bit set on pots drawn here instead of by the chunk mesher, so they can wobble and show sherds.
export const POT_DRAWN = 4;
const POSITIVE = 7, NEGATIVE = 10;
const BREAKS_POT = new Set(["swords", "axes", "pickaxes", "shovels", "hoes"]);

interface View {
  group: THREE.Group;
  mats: THREE.MeshBasicMaterial[];
  texs: THREE.Texture[];
  shades: number[];
  key: string;
}

const tracked = new Map<string, BlockEntityData>();
const wobbles = new Map<string, { at: number; len: number }>();
const views = new Map<string, View>();
const near: Entity[] = [];
let pending: { x: number; y: number; z: number; sherds: string[] | null; shatter: boolean; at: number }[] = [];
let scene: THREE.Scene | null = null;
let seenTick = -1, seenAt = 0;

const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
const sherdsOf = (data: Record<string, unknown> | undefined): string[] | null =>
  Array.isArray(data?.sherds) && data!.sherds.length === 4 ? (data!.sherds as string[]) : null;

export const breaksPot = (tool: ItemStack | null) =>
  !!tool && (tool.item === "trident" || tool.item === "mace" || !!itemDef(tool.item)?.tags?.some((t) => BREAKS_POT.has(t)));

function potEntity(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): BlockEntityData {
  let be = ctx.world.getBlockEntity(x, y, z);
  if (!be || be.type !== "decorated_pot") {
    be = { x, y, z, type: "decorated_pot", items: [null], data: {} };
    ctx.world.setBlockEntity(be, x, y, z);
  }
  be.items ??= [null];
  if (!(metaOf(s) & POT_DRAWN)) ctx.world.setBlock(x, y, z, stateOf(idOf(s), metaOf(s) | POT_DRAWN));
  tracked.set(keyOf(x, y, z), be);
  return be;
}

function wobble(ctx: GameCtx, x: number, y: number, z: number, len: number) {
  wobbles.set(keyOf(x, y, z), { at: ctx.time.tick, len });
}

const basePlace = BEHAVIORS.decorated_pot?.place;

export const POT_BEHAVIOR: BlockBehavior = {
  place(ctx, x, y, z, info, def) {
    const s = basePlace ? basePlace(ctx, x, y, z, info, def) : def;
    return s === null ? null : stateOf(idOf(s), metaOf(s) | POT_DRAWN);
  },
  onPlaced(ctx, x, y, z, s) {
    const held = ctx.inventory.held();
    const be = potEntity(ctx, x, y, z, s);
    const sherds = held?.item === "decorated_pot" ? sherdsOf(held.data) : null;
    if (sherds) be.data = { ...be.data, sherds: [...sherds] };
  },
  use(ctx, x, y, z, s, held) {
    const be = potEntity(ctx, x, y, z, s);
    const cur = be.items![0];
    const sx = x + 0.5, sy = y + 0.5, sz = z + 0.5;
    const fits = !!held && (!cur || (cur.item === held.item && JSON.stringify(cur.data ?? {}) === JSON.stringify(held.data ?? {}) && cur.name === held.name && cur.count < maxStack(cur.item)));
    if (!held || !fits) {
      ctx.emit({ type: "sound", name: "block.decorated_pot.insert_fail", x: sx, y: sy, z: sz });
      wobble(ctx, x, y, z, NEGATIVE);
      return true;
    }
    be.items![0] = cur ? { ...cur, count: cur.count + 1 } : { ...held, count: 1 };
    if (ctx.player.gameMode !== "creative") ctx.inventory.removeHeld(1);
    const full = be.items![0]!.count / maxStack(be.items![0]!.item);
    ctx.emit({ type: "sound", name: "block.decorated_pot.insert", x: sx, y: sy, z: sz, pitch: 0.7 + 0.5 * full });
    wobble(ctx, x, y, z, POSITIVE);
    return true;
  },
  onRemoved(ctx, x, y, z) {
    const k = keyOf(x, y, z);
    const be = tracked.get(k);
    tracked.delete(k);
    wobbles.delete(k);
    const survival = ctx.player.gameMode === "survival" || ctx.player.gameMode === "adventure";
    pending.push({ x, y, z, sherds: be ? sherdsOf(be.data) : null, shatter: survival && breaksPot(ctx.inventory.held()), at: ctx.time.tick });
  },
};

// Loot gives an intact pot the stored sherds; a pot broken by a tool shatters into its four sherds or bricks.
function settleDrops(ctx: GameCtx) {
  if (!pending.length) return;
  pending = pending.filter((p) => {
    ctx.entities.near(p.x + 0.5, p.y + 0.5, p.z + 0.5, 2, near);
    const e = near.find((o) => o.type === "item" && !o.dead && (o.data.stack as ItemStack | undefined)?.item === "decorated_pot" && !(o.data.stack as ItemStack).data?.sherds);
    near.length = 0;
    if (e) {
      if (p.sherds) {
        const st = e.data.stack as ItemStack;
        st.data = { ...st.data, sherds: [...p.sherds] };
      }
      return false;
    }
    if (ctx.time.tick - p.at < 2) return true;
    if (p.shatter) {
      for (const it of p.sherds ?? ["brick", "brick", "brick", "brick"]) ctx.entities.dropItem({ item: it, count: 1 }, p.x + 0.5, p.y + 0.5, p.z + 0.5);
      ctx.emit({ type: "sound", name: "block.decorated_pot.shatter", x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
    }
    return false;
  });
}

function scan(ctx: GameCtx) {
  const w = ctx.world;
  if (!w.blockEntitiesIn) return;
  const pcx = Math.floor(ctx.player.body.pos.x / CHUNK), pcz = Math.floor(ctx.player.body.pos.z / CHUNK);
  for (let cx = pcx - 4; cx <= pcx + 4; cx++)
    for (let cz = pcz - 4; cz <= pcz + 4; cz++) {
      const list = w.blockEntitiesIn(cx, cz);
      if (list) for (const be of list) if (be.type === "decorated_pot") tracked.set(keyOf(be.x, be.y, be.z), be);
    }
}

export function tickPots(ctx: GameCtx) {
  settleDrops(ctx);
  if (ctx.time.tick % 40 === 0) scan(ctx);
}

export function potFacePixels(sherd: string | null): Uint8ClampedArray {
  const px = paintBlockTexture("decorated_pot_side");
  const rows = sherd ? SHERD_MOTIFS[sherd] : undefined;
  if (!rows) return px;
  const put = (x: number, y: number, c: number) => {
    const i = (y * 16 + x) * 4;
    px[i] = (c >> 16) & 255;
    px[i + 1] = (c >> 8) & 255;
    px[i + 2] = c & 255;
  };
  for (let x = 2; x < 14; x++) {
    put(x, 2, 0x5a2c18);
    put(x, 13, 0x5a2c18);
  }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (!motifAt(rows, x, y)) continue;
      put(4 + x, 4 + y, 0x3e1c0e);
      if (y < 7 && !motifAt(rows, x, y + 1)) put(4 + x, 5 + y, 0xc07a52);
    }
  return px;
}

function dataTex(px: Uint8ClampedArray): THREE.DataTexture {
  const flipped = new Uint8ClampedArray(px.length);
  for (let y = 0; y < 16; y++) flipped.set(px.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
  const tex = new THREE.DataTexture(flipped, 16, 16, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const side = new THREE.PlaneGeometry(14 / 16, 1);
{
  const uv = side.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (1 + uv.getX(i) * 14) / 16);
}
const cap = new THREE.PlaneGeometry(14 / 16, 14 / 16);
const neckLow = new THREE.BoxGeometry(6 / 16, 1 / 16, 6 / 16);
const neckTop = new THREE.BoxGeometry(8 / 16, 3 / 16, 8 / 16);
const YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

function build(be: BlockEntityData, meta: number): View {
  const sherds = sherdsOf(be.data) ?? ["brick", "brick", "brick", "brick"];
  const faceOf = (n: string) => (n.endsWith("_pottery_sherd") ? n.slice(0, -14) : null);
  const plainTex = dataTex(potFacePixels(null));
  const baseTex = dataTex(paintBlockTexture("decorated_pot_base"));
  const texs: THREE.Texture[] = [plainTex, baseTex];
  const mats: THREE.MeshBasicMaterial[] = [];
  const shades: number[] = [];
  const mat = (map: THREE.Texture, shade: number) => {
    const m = new THREE.MeshBasicMaterial({ map, transparent: false });
    mats.push(m);
    shades.push(shade);
    return m;
  };
  const body = new THREE.Group();
  // back, left, right, front
  const place: [number, number, number][] = [[0, -1, Math.PI], [-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2], [0, 1, 0]];
  sherds.forEach((n, i) => {
    const f = faceOf(n);
    const tex = f ? dataTex(potFacePixels(f)) : plainTex;
    if (f) texs.push(tex);
    const mesh = new THREE.Mesh(side, mat(tex, place[i][0] ? 0.6 : 0.8));
    const [dx, dz, ry] = place[i];
    mesh.position.set((dx * 7) / 16, 0.5, (dz * 7) / 16);
    mesh.rotation.y = ry;
    body.add(mesh);
  });
  const top = new THREE.Mesh(cap, mat(baseTex, 1));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 1;
  const bottom = new THREE.Mesh(cap, mat(baseTex, 0.5));
  bottom.rotation.x = Math.PI / 2;
  body.add(top, bottom);
  const neckMats = (withTop: boolean) => [0.6, 0.6, 1, 0.5, 0.8, 0.8].map((sh, i) => mat(i === 2 && withTop ? baseTex : plainTex, sh));
  const low = new THREE.Mesh(neckLow, neckMats(false));
  low.position.y = 16.5 / 16;
  const high = new THREE.Mesh(neckTop, neckMats(true));
  high.position.y = 18.5 / 16;
  body.add(low, high);
  body.rotation.y = YAW[meta & 3];
  const group = new THREE.Group();
  group.position.set(be.x + 0.5, be.y, be.z + 0.5);
  group.add(body);
  return { group, mats, texs, shades, key: "" };
}

function dropView(k: string) {
  const v = views.get(k);
  if (!v) return;
  v.group.removeFromParent();
  for (const m of v.mats) m.dispose();
  for (const t of v.texs) t.dispose();
  views.delete(k);
}

// Vanilla DecoratedPotRenderer wobble: a small X/Z rock for a stored item, a Y shake for a refused one.
function applyWobble(v: View, k: string, ctx: GameCtx, partial: number) {
  const w = wobbles.get(k);
  v.group.rotation.set(0, 0, 0);
  if (!w) return;
  const t = (ctx.time.tick - w.at + partial) / w.len;
  if (t < 0 || t > 1) {
    wobbles.delete(k);
    return;
  }
  if (w.len === POSITIVE) {
    const a = t * Math.PI * 2;
    v.group.rotation.x = -1.5 * (Math.cos(a) + 0.5) * Math.sin(a / 2) * 0.015625;
    v.group.rotation.z = Math.sin(a) * 0.015625;
  } else v.group.rotation.y = Math.sin(-t * 3 * Math.PI) * 0.125 * (1 - t);
}

export function framePots(ctx: GameCtx) {
  const sc = ctx.renderer?.scene;
  if (!sc) return;
  const now = performance.now();
  if (ctx.time.tick !== seenTick) {
    seenTick = ctx.time.tick;
    seenAt = now;
  }
  const partial = Math.min(1, (now - seenAt) / 50);
  if (sc !== scene) {
    for (const k of [...views.keys()]) dropView(k);
    scene = sc;
  }
  const p = ctx.player.body.pos;
  for (const [k, be] of tracked) {
    const s = ctx.world.getBlock(be.x, be.y, be.z);
    const isPot = blockDef(s).name === "decorated_pot";
    const far = (be.x - p.x) ** 2 + (be.z - p.z) ** 2 > 96 * 96;
    if (!isPot || ctx.world.getBlockEntity(be.x, be.y, be.z) !== be || far || !(metaOf(s) & POT_DRAWN)) {
      dropView(k);
      if (!isPot) tracked.delete(k);
      continue;
    }
    const vk = `${s}:${JSON.stringify(be.data?.sherds ?? null)}`;
    let v = views.get(k);
    if (v && v.key !== vk) {
      dropView(k);
      v = undefined;
    }
    if (!v) {
      v = build(be, metaOf(s));
      v.key = vk;
      sc.add(v.group);
      views.set(k, v);
    }
    applyWobble(v, k, ctx, partial);
    const br = brightnessAt(ctx, be.x + 0.5, be.y + 0.5, be.z + 0.5);
    v.mats.forEach((m, i) => m.color.setScalar(br * v!.shades[i]));
  }
}

export function clearPots() {
  for (const k of [...views.keys()]) dropView(k);
  tracked.clear();
  wobbles.clear();
  pending = [];
  scene = null;
}
