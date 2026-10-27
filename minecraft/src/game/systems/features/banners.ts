import * as THREE from "three";
import type { BlockBehavior, BlockEntityData, Entity, GameCtx, ItemStack } from "../../contracts";
import { CHUNK, metaOf } from "../../contracts";
import { BLOCKS, blockDef } from "../../blocks/registry";
import { BH, BW, bannerPixels, type Layer } from "./banner-art";
import { brightnessAt } from "../../entities/render";

interface View {
  group: THREE.Group;
  mats: THREE.MeshBasicMaterial[];
  tex: THREE.DataTexture;
  key: string;
}

const tracked = new Map<string, BlockEntityData>();
const views = new Map<string, View>();
const near: Entity[] = [];
let pending: { x: number; y: number; z: number; item: string; patterns: Layer[]; at: number }[] = [];
let scene: THREE.Scene | null = null;

const keyOf = (x: number, y: number, z: number) => `${x},${y},${z}`;
const layersOf = (be: BlockEntityData) => (Array.isArray(be.data?.patterns) ? (be.data!.patterns as Layer[]) : []);
const colorOf = (name: string) => name.replace(/_wall_banner$|_banner$/, "");

const BANNER_BEHAVIOR: BlockBehavior = {
  onPlaced(ctx, x, y, z) {
    const held = ctx.inventory.held() as ItemStack | null;
    const patterns = held?.item.endsWith("_banner") && Array.isArray(held.data?.patterns) ? (held.data!.patterns as Layer[]) : null;
    if (!patterns?.length) return;
    const be: BlockEntityData = { x, y, z, type: "banner", data: { patterns } };
    ctx.world.setBlockEntity(be, x, y, z);
    tracked.set(keyOf(x, y, z), be);
  },
  onRemoved(ctx, x, y, z, s) {
    const k = keyOf(x, y, z);
    const be = tracked.get(k);
    tracked.delete(k);
    if (be && layersOf(be).length) pending.push({ x, y, z, item: `${colorOf(blockDef(s).name)}_banner`, patterns: layersOf(be), at: ctx.time.tick });
  },
};

export const BANNER_BEHAVIORS: Record<string, BlockBehavior> = Object.fromEntries(BLOCKS.filter((b) => b.name.endsWith("_banner")).map((b) => [b.name, BANNER_BEHAVIOR]));

function attachDrops(ctx: GameCtx) {
  if (!pending.length) return;
  pending = pending.filter((p) => {
    if (ctx.time.tick - p.at > 5) return false;
    ctx.entities.near(p.x + 0.5, p.y + 0.5, p.z + 0.5, 2, near);
    const e = near.find((o) => o.type === "item" && (o.data.stack as ItemStack | undefined)?.item === p.item && !(o.data.stack as ItemStack).data?.patterns);
    near.length = 0;
    if (!e) return true;
    const st = e.data.stack as ItemStack;
    st.data = { ...st.data, patterns: p.patterns };
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
      if (list) for (const be of list) if (be.type === "banner") tracked.set(keyOf(be.x, be.y, be.z), be);
    }
}

export function tickBanners(ctx: GameCtx) {
  attachDrops(ctx);
  if (ctx.time.tick % 40 === 0) scan(ctx);
}

const quad = new THREE.PlaneGeometry(1, 1);

function build(be: BlockEntityData, name: string, meta: number): View {
  const px = bannerPixels(colorOf(name), layersOf(be));
  const flipped = new Uint8ClampedArray(px.length);
  for (let y = 0; y < BH; y++) flipped.set(px.subarray((BH - 1 - y) * BW * 4, (BH - y) * BW * 4), y * BW * 4);
  const tex = new THREE.DataTexture(flipped, BW, BH, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const group = new THREE.Group();
  group.position.set(be.x + 0.5, be.y, be.z + 0.5);
  const wall = name.endsWith("_wall_banner");
  const mats: THREE.MeshBasicMaterial[] = [];
  const add = (z: number, y0: number, y1: number, back: boolean, mirror: boolean) => {
    const m = new THREE.MeshBasicMaterial({ map: tex });
    mats.push(m);
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.set((mirror ? -14 : 14) / 16, (y1 - y0) / 16, 1);
    mesh.position.set(0, (y0 + y1) / 32, z / 16 - 0.5);
    if (back) mesh.rotation.y = Math.PI;
    group.add(mesh);
  };
  if (wall) {
    group.rotation.y = -((((meta & 3) - 2) & 3) * Math.PI) / 2;
    add(13.75 - 0.03, -12, 13, true, false);
    add(14.5 + 0.03, -12, 13, false, true);
  } else {
    group.rotation.y = (-meta * 22.5 * Math.PI) / 180;
    add(9.5 + 0.03, 1.5, 26.5, false, false);
    add(8.75 - 0.03, 1.5, 26.5, true, true);
  }
  return { group, mats, tex, key: "" };
}

function dropView(k: string) {
  const v = views.get(k);
  if (!v) return;
  v.group.removeFromParent();
  for (const m of v.mats) m.dispose();
  v.tex.dispose();
  views.delete(k);
}

export function frameBanners(ctx: GameCtx) {
  const sc = ctx.renderer?.scene;
  if (!sc) return;
  if (sc !== scene) {
    for (const k of [...views.keys()]) dropView(k);
    scene = sc;
  }
  const p = ctx.player.body.pos;
  for (const [k, be] of tracked) {
    const s = ctx.world.getBlock(be.x, be.y, be.z);
    const name = blockDef(s).name;
    const far = (be.x - p.x) ** 2 + (be.z - p.z) ** 2 > 96 * 96;
    if (!name.endsWith("_banner") || ctx.world.getBlockEntity(be.x, be.y, be.z) !== be || far) {
      dropView(k);
      if (!name.endsWith("_banner")) tracked.delete(k);
      continue;
    }
    const vk = `${s}:${JSON.stringify(be.data?.patterns ?? [])}`;
    let v = views.get(k);
    if (v && v.key !== vk) {
      dropView(k);
      v = undefined;
    }
    if (!v) {
      v = build(be, name, metaOf(s));
      v.key = vk;
      sc.add(v.group);
      views.set(k, v);
    }
    const br = brightnessAt(ctx, be.x + 0.5, be.y + 0.5, be.z + 0.5);
    for (const m of v.mats) m.color.setScalar(br);
  }
}

export function clearBanners() {
  for (const k of [...views.keys()]) dropView(k);
  tracked.clear();
  pending = [];
  scene = null;
}
