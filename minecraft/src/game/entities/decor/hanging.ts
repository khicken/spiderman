import * as THREE from "three";
import type { Entity, GameCtx, ItemStack, MobDef, MobModel } from "../../contracts";
import { Face, idOf } from "../../contracts";
import { SOLID } from "../../blocks/registry";
import { paintBlockTexture } from "../../textures/index";
import { brightnessAt, forgetModel } from "../render";
import { blockCube, blockStateOfItem, isCubeItem, itemSpriteView } from "../block-cube";
import { PAINTINGS, paintingTexture, paintingVariant, type PaintingVariant } from "./painting-art";
import { mapDecorTexture, mapTexture } from "../../systems/features/map-render";
import { noiseTile, pixBoxes, repeatTexture } from "./pix-box";
import { frameChanged, syncFrameMarker } from "../item-frame";

const N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const PX = 1 / 16;
const FRAME_SIZE = 12 / 16;
const HANGING = new Set(["item_frame", "glow_item_frame", "painting"]);
const near: Entity[] = [];
let cur: GameCtx | null = null;

export const isHanging = (type: string) => HANGING.has(type);
const isFrame = (e: Entity) => e.type !== "painting";
const faceOf = (e: Entity) => (e.data.face as Face) ?? Face.North;
const horizontal = (f: Face) => f !== Face.Up && f !== Face.Down;
// Counterclockwise of the facing (vanilla getCounterClockWise): the direction even-width paintings grow toward.
const ccw = (f: Face): [number, number] => [N[f][2], -N[f][0]];
const k0 = (s: number) => -Math.floor((s - 1) / 2);

function sizeOf(e: Entity): [number, number] {
  if (isFrame(e)) return [1, 1];
  const v = paintingVariant(e.data.variant);
  return [v.w, v.h];
}

function forCells(e: Entity, w: number, h: number, fn: (x: number, y: number, z: number) => boolean): boolean {
  const f = faceOf(e);
  const cx = e.data.x as number, cy = e.data.y as number, cz = e.data.z as number;
  if (!horizontal(f)) return fn(cx, cy, cz);
  const [tx, tz] = ccw(f);
  for (let i = 0; i < w; i++)
    for (let j = 0; j < h; j++) {
      const o = i + k0(w);
      if (!fn(cx + tx * o, cy + j + k0(h), cz + tz * o)) return false;
    }
  return true;
}

function fits(ctx: GameCtx, e: Entity, w: number, h: number): boolean {
  const n = N[faceOf(e)];
  return forCells(e, w, h, (x, y, z) => !SOLID[idOf(ctx.world.getBlock(x, y, z))] && !!SOLID[idOf(ctx.world.getBlock(x - n[0], y - n[1], z - n[2]))]);
}

function cellSet(e: Entity, w: number, h: number, out: Set<number>) {
  out.clear();
  forCells(e, w, h, (x, y, z) => {
    out.add(((x & 0x3ff) << 20) | (((y + 64) & 0x3ff) << 10) | (z & 0x3ff));
    return true;
  });
}

const mine = new Set<number>();
const theirs = new Set<number>();
function overlaps(ctx: GameCtx, e: Entity, w: number, h: number): boolean {
  cellSet(e, w, h, mine);
  ctx.entities.near(e.data.x as number, e.data.y as number, e.data.z as number, 6, near);
  for (const o of near) {
    if (o === e || o.dead || !isHanging(o.type) || !o.data.placed || o.data.face !== e.data.face) continue;
    const [ow, oh] = sizeOf(o);
    cellSet(o, ow, oh, theirs);
    for (const k of mine) if (theirs.has(k)) return true;
  }
  return false;
}

function anchor(e: Entity, out: THREE.Vector3): THREE.Vector3 {
  const f = faceOf(e);
  const n = N[f];
  const [w, h] = sizeOf(e);
  out.set((e.data.x as number) + 0.5 - n[0] * 0.5, (e.data.y as number) + 0.5 - n[1] * 0.5, (e.data.z as number) + 0.5 - n[2] * 0.5);
  if (horizontal(f)) {
    const [tx, tz] = ccw(f);
    const o = k0(w) + (w - 1) / 2;
    out.x += tx * o;
    out.z += tz * o;
    out.y += k0(h) + (h - 1) / 2;
  }
  return out;
}

const tmp = new THREE.Vector3();
// The body box sinks into the wall so only 1 px sticks out: raycasts then pick the art, and light is read from the cell.
function snapBody(e: Entity) {
  const f = faceOf(e);
  const b = e.body;
  const frame = isFrame(e);
  const [w, h] = sizeOf(e);
  anchor(e, tmp);
  if (horizontal(f)) {
    const W = frame ? FRAME_SIZE : w;
    const H = frame ? FRAME_SIZE : h;
    const n = N[f];
    b.width = W;
    b.height = H;
    b.pos.set(tmp.x + n[0] * (PX - W / 2), tmp.y - H / 2, tmp.z + n[2] * (PX - W / 2));
  } else {
    b.width = FRAME_SIZE;
    b.height = PX;
    b.pos.set(tmp.x, f === Face.Up ? tmp.y : tmp.y - PX, tmp.z);
  }
  b.noClip = true;
  b.vel.set(0, 0, 0);
  e.data._px = b.pos.x;
  e.data._py = b.pos.y;
  e.data._pz = b.pos.z;
}

function choosePainting(ctx: GameCtx, e: Entity): PaintingVariant | null {
  let best: PaintingVariant[] = [];
  let area = 0;
  for (const v of PAINTINGS) {
    const a = v.w * v.h;
    if (a < area) continue;
    e.data.variant = v.name;
    if (!fits(ctx, e, v.w, v.h) || overlaps(ctx, e, v.w, v.h)) continue;
    if (a > area) best = [];
    area = a;
    best.push(v);
  }
  if (!best.length) return null;
  return best[Math.floor(ctx.random() * best.length)];
}

function frontPoint(e: Entity, out: THREE.Vector3) {
  const n = N[faceOf(e)];
  anchor(e, out);
  out.x += n[0] * 0.15;
  out.y += n[1] * 0.15 - 0.1;
  out.z += n[2] * 0.15;
  return out;
}

function sound(ctx: GameCtx, e: Entity, name: string) {
  anchor(e, tmp);
  ctx.emit({ type: "sound", name, x: tmp.x, y: tmp.y, z: tmp.z });
}

export function breakHanging(ctx: GameCtx, e: Entity, drop: boolean) {
  if (e.data._remove) return;
  e.dead = true;
  e.data._remove = true;
  if (isFrame(e)) frameChanged(ctx, e, undefined);
  sound(ctx, e, isFrame(e) ? (e.type === "glow_item_frame" ? "entity.glow_item_frame.break" : "entity.item_frame.break") : "entity.painting.break");
  if (!drop) return;
  frontPoint(e, tmp);
  const item = e.data.item as ItemStack | undefined;
  if (item) ctx.entities.dropItem({ ...item }, tmp.x, tmp.y, tmp.z);
  ctx.entities.dropItem({ item: e.type, count: 1 }, tmp.x, tmp.y, tmp.z);
}

// Vanilla only checks survival while ticking; a support cell in a chunk that is not loaded yet reads as air.
function survives(ctx: GameCtx, e: Entity) {
  const [w, h] = sizeOf(e);
  const n = N[faceOf(e)];
  if (!forCells(e, w, h, (x, _y, z) => ctx.world.isLoaded(x, z) && ctx.world.isLoaded(x - n[0], z - n[2]))) return true;
  return fits(ctx, e, w, h);
}

export function checkHanging(ctx: GameCtx, x: number, y: number, z: number) {
  ctx.entities.near(x + 0.5, y + 0.5, z + 0.5, 5, near);
  const list = near.slice();
  for (const e of list) {
    if (e.dead || !isHanging(e.type) || !e.data.placed) continue;
    if (!survives(ctx, e)) breakHanging(ctx, e, ctx.player.gameMode !== "creative");
  }
}

function place(ctx: GameCtx, e: Entity): boolean {
  const f = faceOf(e);
  if (typeof e.data.x !== "number") return false;
  if (isFrame(e)) {
    if (!fits(ctx, e, 1, 1) || overlaps(ctx, e, 1, 1)) return false;
    e.data.rot = 0;
  } else {
    if (!horizontal(f)) return false;
    const v = choosePainting(ctx, e);
    if (!v) return false;
    e.data.variant = v.name;
  }
  e.data.placed = true;
  snapBody(e);
  sound(ctx, e, isFrame(e) ? (e.type === "glow_item_frame" ? "entity.glow_item_frame.place" : "entity.item_frame.place") : "entity.painting.place");
  return true;
}

function tick(e: Entity, ctx: GameCtx) {
  cur = ctx;
  e.data._pa = e.age;
  e.data.persistent = true;
  e.hurtTicks = 0;
  if (!e.data.placed) {
    if (!place(ctx, e)) {
      e.dead = true;
      e.data._remove = true;
      if (ctx.player.gameMode !== "creative") ctx.inventory.add({ item: e.type, count: 1 });
    }
    return;
  }
  snapBody(e);
  if (isFrame(e) && e.age % 20 === 0) syncFrameMarker(e, e.data.item as ItemStack | undefined);
  if (e.age % 100 === 0 && !survives(ctx, e)) breakHanging(ctx, e, true);
}

function revive(e: Entity) {
  e.dead = false;
  e.health = e.maxHealth;
  e.hurtTicks = 0;
  delete e.data._death;
}

function onDeath(e: Entity, ctx: GameCtx) {
  const creative = ctx.player.gameMode === "creative";
  const item = e.data.item as ItemStack | undefined;
  if (isFrame(e) && item) {
    revive(e);
    if (!creative) {
      frontPoint(e, tmp);
      ctx.entities.dropItem({ ...item }, tmp.x, tmp.y, tmp.z);
    }
    e.data.item = null;
    e.data.rot = 0;
    frameChanged(ctx, e, undefined);
    sound(ctx, e, e.type === "glow_item_frame" ? "entity.glow_item_frame.remove_item" : "entity.item_frame.remove_item");
    return;
  }
  breakHanging(ctx, e, !creative);
}

function onInteract(e: Entity, ctx: GameCtx, held: ItemStack | null): boolean {
  if (!isFrame(e) || !e.data.placed) return false;
  const glow = e.type === "glow_item_frame";
  if (!e.data.item) {
    if (!held) return false;
    e.data.item = { ...held, count: 1 };
    e.data.rot = 0;
    if (ctx.player.gameMode !== "creative") {
      const inv = ctx.inventory;
      const slot = inv.held() === held ? inv.selected : 40;
      inv.setSlot(slot, held.count > 1 ? { ...held, count: held.count - 1 } : null);
    }
    frameChanged(ctx, e, e.data.item as ItemStack);
    sound(ctx, e, glow ? "entity.glow_item_frame.add_item" : "entity.item_frame.add_item");
    return true;
  }
  e.data.rot = (((e.data.rot as number) ?? 0) + 1) & 7;
  frameChanged(ctx, e, e.data.item as ItemStack);
  sound(ctx, e, glow ? "entity.glow_item_frame.rotate_item" : "entity.item_frame.rotate_item");
  return true;
}

let shared: { border: THREE.BufferGeometry; back: THREE.BufferGeometry; mapBorder: THREE.BufferGeometry; mapBack: THREE.BufferGeometry; birch: THREE.Texture; frame: THREE.Texture; glow: THREE.Texture } | null = null;
function art() {
  if (!shared) {
    shared = {
      border: pixBoxes([[-6, -6, 0, -5, 6, 1], [5, -6, 0, 6, 6, 1], [-5, 5, 0, 5, 6, 1], [-5, -6, 0, 5, -5, 1]]),
      back: pixBoxes([[-5, -5, 0, 5, 5, 0.5]]),
      mapBorder: pixBoxes([[-8, -8, 0, -7, 8, 1], [7, -8, 0, 8, 8, 1], [-7, 7, 0, 7, 8, 1], [-7, -8, 0, 7, -7, 1]]),
      mapBack: pixBoxes([[-7, -7, 0, 7, 7, 0.5]]),
      birch: repeatTexture(paintBlockTexture("birch_planks")),
      frame: repeatTexture(noiseTile(7, [138, 84, 52], 0.35)),
      glow: repeatTexture(noiseTile(9, [58, 176, 160], 0.35)),
    };
  }
  return shared;
}

function lit(map: THREE.Texture, alphaTest = 0): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest });
  m.userData.glow = true;
  m.userData.base = new THREE.Color(1, 1, 1);
  return m;
}

function cloneLit(src: THREE.Material): THREE.MeshLambertMaterial {
  const m = src.clone() as THREE.MeshLambertMaterial;
  m.userData = { glow: true, base: new THREE.Color(1, 1, 1) };
  return m;
}

function setBright(mats: THREE.Material[], br: number) {
  for (const m of mats) (m.userData.base as THREE.Color).setScalar(br);
}

function orient(e: Entity, root: THREE.Object3D) {
  root.parent?.rotation.set(0, 0, 0);
  const f = faceOf(e);
  anchor(e, tmp);
  root.position.set(tmp.x - e.body.pos.x, tmp.y - e.body.pos.y, tmp.z - e.body.pos.z);
  const n = N[f];
  if (f === Face.Up) root.rotation.set(-Math.PI / 2, 0, 0);
  else if (f === Face.Down) root.rotation.set(Math.PI / 2, 0, 0);
  else root.rotation.set(0, Math.atan2(n[0], n[2]), 0);
}

function lightOf(e: Entity) {
  if (!cur) return 1;
  const n = N[faceOf(e)];
  return brightnessAt(cur, (e.data.x as number) + 0.5 - n[0] * 0.3, (e.data.y as number) + 0.5 - n[1] * 0.3, (e.data.z as number) + 0.5 - n[2] * 0.3);
}

function frameModel(glow: boolean): () => MobModel {
  return () => {
    const a = art();
    const root = new THREE.Group();
    const frameMats = [lit(a.birch), lit(glow ? a.glow : a.frame)];
    const plain = [new THREE.Mesh(a.border, frameMats[0]), new THREE.Mesh(a.back, frameMats[1])];
    // Vanilla swaps to the full-block map frame model while it holds a map.
    const forMap = [new THREE.Mesh(a.mapBorder, frameMats[0]), new THREE.Mesh(a.mapBack, frameMats[1])];
    for (const m of forMap) m.visible = false;
    root.add(...plain, ...forMap);
    const holder = new THREE.Group();
    root.add(holder);
    let key = "";
    let itemMats: THREE.Material[] = [];
    const clearItem = () => {
      forgetModel(root);
      for (const c of holder.children) if (c.userData.ownGeometry) (c as THREE.Mesh).geometry.dispose();
      holder.clear();
      for (const m of itemMats) m.dispose();
      itemMats = [];
    };
    const build = (s: ItemStack) => {
      const mapTex = mapTexture(s, true);
      if (mapTex) {
        const deco = lit(mapTex);
        deco.transparent = true;
        itemMats = [lit(mapTex, 0.5), deco];
        for (let i = 0; i < 2; i++) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), itemMats[i]);
          m.position.z = PX + 0.002 + i * 0.001;
          m.userData.ownGeometry = true;
          holder.add(m);
        }
      } else if (isCubeItem(s.item)) {
        const cube = blockCube(blockStateOfItem(s.item));
        itemMats = cube.materials.map(cloneLit);
        const m = new THREE.Mesh(cube.geometry, itemMats);
        // Vanilla block "fixed" display scale 0.5 times the frame's 0.5: a quarter-size cube.
        m.scale.setScalar(0.25);
        m.position.set(0, -0.125, 0.5 * PX + 0.125);
        holder.add(m);
      } else {
        const v = itemSpriteView(s.item);
        itemMats = [cloneLit(v.material)];
        const m = new THREE.Mesh(v.geometry, itemMats[0]);
        m.scale.setScalar(0.5);
        m.position.z = 0.5 * PX + 1 / 64 + 0.002;
        holder.add(m);
      }
    };
    return {
      root,
      animate(e) {
        orient(e, root);
        const s = e.data.item as ItemStack | undefined;
        const k = s ? `${s.item}:${s.data?.map ?? ""}` : "";
        if (k !== key) {
          key = k;
          clearItem();
          if (s) build(s);
          for (const m of plain) m.visible = s?.item !== "filled_map";
          for (const m of forMap) m.visible = s?.item === "filled_map";
        }
        if (s?.item === "filled_map") {
          // Map textures are replaced after they sit unused, so rebind them.
          const texs = [mapTexture(s, true), mapDecorTexture(s, true)];
          itemMats.forEach((mat, i) => {
            const t = texs[i], lm = mat as THREE.MeshLambertMaterial;
            lm.visible = !!t;
            if (t && lm.map !== t) {
              lm.map = t;
              lm.needsUpdate = true;
            }
          });
        }
        const rot = (e.data.rot as number) ?? 0;
        holder.rotation.z = s?.item === "filled_map" ? -(rot % 4) * (Math.PI / 2) : -rot * (Math.PI / 4);
        const br = lightOf(e);
        setBright(frameMats, br);
        setBright(itemMats, glow ? 1 : br);
      },
      dispose() {
        clearItem();
        for (const m of frameMats) m.dispose();
      },
    };
  };
}

function paintingModel(): MobModel {
  const a = art();
  const root = new THREE.Group();
  const backMat = lit(a.birch);
  let front: THREE.MeshLambertMaterial | null = null;
  let geo: THREE.BufferGeometry | null = null;
  let plane: THREE.PlaneGeometry | null = null;
  let key = "";
  const clear = () => {
    root.clear();
    front?.dispose();
    geo?.dispose();
    plane?.dispose();
  };
  return {
    root,
    animate(e) {
      orient(e, root);
      const v = paintingVariant(e.data.variant);
      if (v.name !== key) {
        key = v.name;
        clear();
        geo = pixBoxes([[-8 * v.w, -8 * v.h, 0, 8 * v.w, 8 * v.h, 1]]);
        plane = new THREE.PlaneGeometry(v.w, v.h);
        plane.translate(0, 0, PX + 0.001);
        front = lit(paintingTexture(v));
        root.add(new THREE.Mesh(geo, backMat), new THREE.Mesh(plane, front));
      }
      const br = lightOf(e);
      backMat.userData.base.setScalar(br);
      front?.userData.base.setScalar(br);
    },
    dispose() {
      clear();
      backMat.dispose();
    },
  };
}

const base = { category: "misc" as const, width: 0.5, height: 0.5, maxHealth: 1, speed: 0, sounds: { hurt: "", death: "" }, tick, onDeath, onInteract };

export const HANGING_MOBS: MobDef[] = [
  { ...base, type: "item_frame", displayName: "Item Frame", createModel: frameModel(false) },
  { ...base, type: "glow_item_frame", displayName: "Glow Item Frame", createModel: frameModel(true) },
  { ...base, type: "painting", displayName: "Painting", createModel: paintingModel },
];
