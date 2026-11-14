import * as THREE from "three";
import type { BlockEntityData, Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { metaOf } from "../../contracts";
import { blockDef } from "../../blocks/registry";
import { clearPath, idleLook, lookAt, moveTo, wander } from "../ai";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { num, sound, useItem } from "./common";
import { chestPartnerH } from "../../mechanics/chest";
import { containerAt, containerChanged } from "../../mechanics/redstone/inventory";
import { golemToStatue } from "../../mechanics/copper-statue";
import { HX, HZ } from "../../mechanics/util";
import { itemSpritePixels } from "../../textures/icons";
import { extrudeSprite } from "../../player/item-mesh";
import { maxStack } from "../../items/registry";

// Data: oxidation 0..3 (unaffected, exposed, weathered, oxidized), waxed, statue (frozen fallback), oxTimer (ticks to next stage),
// item (held stack), sort (chest sorting state).
const STAGES = ["unaffected", "exposed", "weathered", "oxidized"] as const;
const PALETTES: number[][] = [
  [0xc66a43, 0xe0804f, 0xa9512f, 0xd4733f],
  [0xa8826a, 0xc0957a, 0x8e6a55, 0x9e7d62],
  [0x6c9e74, 0x63a682, 0x4f8a6a, 0x7aa77c],
  [0x4fa38c, 0x5fbea0, 0x3e8c78, 0x4fae94],
];
// Vanilla CopperGolemOxidationLevels: 504000-552000 ticks per stage, then a 0.58% chance per tick to become a statue.
const STAGE_TICKS: [number, number] = [504000, 552000];
const STATUE_CHANCE = 0.0058;
// Vanilla TransportItemsBetweenContainers: 65x17x65 search box, 3 s at each chest, 16 items per trip, 9 remembered chests.
const RANGE_H = 32;
const RANGE_V = 8;
const EXAMINE = 60;
const TAKE = 16;
const MEMORY = 10;
const GIVE_UP = 140;
const SPEED = 0.2;
const near: Entity[] = [];

function stageOf(e: Entity) {
  return Math.max(0, Math.min(3, num(e, "oxidation")));
}

function paintGolem(p: Pix, stage: number) {
  const C = PALETTES[stage];
  const dark = shade(C[0], 0.6);
  const head = p.fillCuboid(0, 0, 8, 5, 10, C);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 2, 2, 1], 0x1e1410);
  p.rect([f[0] + 5, f[1] + 2, 2, 1], 0x1e1410);
  p.rect([f[0], f[1] + 4, 8, 1], dark);
  p.fillCuboid(40, 0, 2, 3, 2, C.map((c) => shade(c, 0.9)));
  p.fillCuboid(40, 8, 2, 4, 2, C.map((c) => shade(c, 0.8)));
  const knob = p.fillCuboid(48, 0, 4, 4, 4, C.map((c) => shade(c, 1.1)));
  p.rect([knob.top[0] + 1, knob.top[1] + 1, 2, 2], shade(C[1], 1.25));
  const body = p.fillCuboid(0, 16, 8, 6, 6, C);
  p.rect([body.front[0] + 3, body.front[1] + 1, 2, 2], dark);
  p.fillCuboid(32, 16, 3, 8, 4, C.map((c) => shade(c, 0.95)));
  p.fillCuboid(0, 32, 4, 5, 4, C.map((c) => shade(c, 0.85)));
  if (stage >= 2) {
    for (const r of [head.top, head.front, body.front]) {
      p.px(r[0] + 1, r[1] + 1, shade(C[1], 1.2));
      p.px(r[0] + r[2] - 2, r[1] + r[3] - 2, shade(C[1], 1.2));
    }
  }
}

const spriteGeos = new Map<string, THREE.BufferGeometry>();
function spriteGeo(item: string) {
  let g = spriteGeos.get(item);
  if (!g) spriteGeos.set(item, (g = extrudeSprite(itemSpritePixels(item))));
  return g;
}

function golemModel() {
  const leg = (name: string, x: number): VPart => ({ name, pivot: [x, 19, 0], box: [-2, 0, -2, 4, 5, 4], uv: [0, 32] });
  const parts: VPart[] = [
    { name: "body", pivot: [0, 19, 0], box: [-4, -6, -3, 8, 6, 6], uv: [0, 16] },
    { name: "head", pivot: [0, 13, 0], box: [-4, -5, -5, 8, 5, 10], uv: [0, 0] },
    { name: "nose", parent: "head", pivot: [0, 0, 0], box: [-1, -3, -7, 2, 3, 2], uv: [40, 0] },
    { name: "rod", parent: "head", pivot: [0, 0, 0], box: [-1, -9, -1, 2, 4, 2], uv: [40, 8] },
    { name: "knob", parent: "head", pivot: [0, 0, 0], box: [-2, -13, -2, 4, 4, 4], uv: [48, 0] },
    { name: "right_arm", pivot: [-4, 13, 0], box: [-3, 0, -2, 3, 8, 4], uv: [32, 16] },
    { name: "left_arm", pivot: [4, 13, 0], box: [0, 0, -2, 3, 8, 4], uv: [32, 16], mirror: true },
    leg("right_leg", -2),
    leg("left_leg", 2),
  ];
  const key = (s: number) => `copper_golem_${STAGES[s]}`;
  const paint = (s: number) => skin(key(s), 64, 64, (p) => paintGolem(p, s));
  const r = rig(paint(0), parts);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const held = new THREE.Mesh(spriteGeo("stick"), mat);
  held.visible = false;
  held.scale.setScalar(0.5);
  held.position.set(0, 9 / 16, 8 / 16);
  r.root.add(held);
  let shown = "";
  const model = wrap(
    r,
    (a) => {
      if (a.e.data.statue) return;
      const item = (a.e.data.item as ItemStack | undefined)?.item ?? "";
      if (item !== shown) {
        shown = item;
        held.visible = !!item;
        if (item) held.geometry = spriteGeo(item);
      }
      look(r.p.head, a);
      const s = Math.cos(a.phase * 0.6662) * 1.2 * a.walk;
      setRot(r.p.right_leg, s, 0, 0);
      setRot(r.p.left_leg, -s, 0, 0);
      if (item) {
        setRot(r.p.right_arm, -1.3, 0.25, 0);
        setRot(r.p.left_arm, -1.3, -0.25, 0);
      } else {
        setRot(r.p.right_arm, -s * 0.8, 0, 0);
        setRot(r.p.left_arm, s * 0.8, 0, 0);
      }
      const spin = num(a.e, "_spin");
      if (spin > 0) setRot(r.p.head, a.pitch, a.yaw + (spin - a.pt) * 0.6, 0);
    },
    {
      variant: (e) => key(stageOf(e)),
      variantSkin: (k) => paint(Math.max(0, STAGES.indexOf(k.slice("copper_golem_".length) as (typeof STAGES)[number]))),
    },
  );
  const dispose = model.dispose;
  model.dispose = () => {
    dispose();
    mat.dispose();
  };
  return model;
}

function nextTimer(ctx: GameCtx) {
  return STAGE_TICKS[0] + Math.floor(ctx.random() * (STAGE_TICKS[1] - STAGE_TICKS[0]));
}

function setStage(e: Entity, stage: number) {
  e.data.oxidation = stage;
  e.data.statue = false;
  e.data.oxTimer = undefined;
  e.data.statueReady = undefined;
}

function particles(ctx: GameCtx, e: Entity, kind: "happy" | "dust", color?: number) {
  const p = e.body.pos;
  ctx.emit({ type: "particles", kind, x: p.x, y: p.y + e.body.height * 0.6, z: p.z, count: 8, color });
}

function dropHeld(e: Entity, ctx: GameCtx) {
  const it = e.data.item as ItemStack | undefined;
  if (!it) return;
  e.data.item = undefined;
  const p = e.body.pos;
  ctx.entities.dropItem(it, p.x, p.y + 0.5, p.z);
}

// Lightning damages first, so only look for a fresh bolt on ticks where the golem was hurt.
function checkLightning(e: Entity, ctx: GameCtx) {
  if (e.hurtTicks <= 0) return;
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 6, near);
  const bolt = near.find((o) => o.type === "lightning_bolt" && o.id !== e.data._zap);
  near.length = 0;
  if (!bolt) return;
  e.data._zap = bolt.id;
  if (stageOf(e) > 0 || e.data.statue) {
    setStage(e, 0);
    particles(ctx, e, "dust", 0xe0804f);
  }
}

// Vanilla only converts while the golem stands fully in an air block.
function inAir(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  return !e.body.inWater && !e.body.inLava && ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) === 0 && Math.abs(p.y - Math.round(p.y)) < 0.01;
}

function becomeStatue(e: Entity, ctx: GameCtx) {
  dropHeld(e, ctx);
  releaseChest(e);
  if (golemToStatue(ctx, e)) return;
  e.data.statue = true;
  e.data.oxTimer = undefined;
  clearPath(e);
  sound(ctx, e, "entity.copper_golem.statue");
}

// oxTimer counts down to the next stage; set it to 1 to advance on the next tick.
function oxidize(e: Entity, ctx: GameCtx) {
  if (e.data.waxed || e.data.statue) return;
  if (e.data.statueReady) {
    if (ctx.random() < STATUE_CHANCE && inAir(e, ctx)) becomeStatue(e, ctx);
    return;
  }
  let t = e.data.oxTimer as number | undefined;
  if (typeof t !== "number") t = nextTimer(ctx);
  if (--t > 0) {
    e.data.oxTimer = t;
    return;
  }
  const s = stageOf(e);
  if (s < 3) setStage(e, s + 1);
  else {
    e.data.oxTimer = undefined;
    e.data.statueReady = true;
  }
}

type Pos = [number, number, number];
interface SortState {
  target?: Pos;
  timer: number;
  open: boolean;
  visited: string[];
  rest: number;
  scanAt: number;
}

const inUse = new Map<string, number>();
const key = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;

function sortState(e: Entity): SortState {
  let s = e.data.sort as SortState | undefined;
  if (!s) e.data.sort = s = { timer: 0, open: false, visited: [], rest: 0, scanAt: 0 };
  return s;
}

function releaseChest(e: Entity) {
  const s = e.data.sort as SortState | undefined;
  if (s?.target && inUse.get(key(s.target)) === e.id) inUse.delete(key(s.target));
  if (s) {
    s.target = undefined;
    s.open = false;
    s.timer = 0;
  }
}

const isSource = (name: string) => /^(waxed_)?(exposed_|weathered_|oxidized_)?copper_chest$/.test(name);
const isDest = (name: string) => name === "chest" || name === "trapped_chest";

// Both halves of a large chest, left half first, so a pair counts as one chest.
function halves(ctx: GameCtx, x: number, y: number, z: number): Pos[] {
  const s = ctx.world.getBlock(x, y, z);
  const d = chestPartnerH(ctx.world, x, y, z, s);
  if (d < 0) return [[x, y, z]];
  const other: Pos = [x + HX[d], y, z + HZ[d]];
  return metaOf(s) & 8 ? [[x, y, z], other] : [other, [x, y, z]];
}

function findChest(e: Entity, ctx: GameCtx, want: (name: string) => boolean, visited: string[]): Pos | undefined {
  const p = e.body.pos;
  const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
  let best: Pos | undefined;
  let bd = Infinity;
  for (let y = by - RANGE_V; y <= by + RANGE_V; y++)
    for (let x = bx - RANGE_H; x <= bx + RANGE_H; x++)
      for (let z = bz - RANGE_H; z <= bz + RANGE_H; z++) {
        const s = ctx.world.getBlock(x, y, z);
        if (s === 0 || !want(blockDef(s).name)) continue;
        const d = (x + 0.5 - p.x) ** 2 + (y - p.y) ** 2 + (z + 0.5 - p.z) ** 2;
        if (d >= bd) continue;
        const k = halves(ctx, x, y, z)[0];
        const owner = inUse.get(key(k));
        if (visited.includes(key(k)) || (owner !== undefined && owner !== e.id)) continue;
        bd = d;
        best = k;
      }
  return best;
}

function reached(e: Entity, ctx: GameCtx, t: Pos) {
  const p = e.body.pos;
  const dy = t[1] - Math.floor(p.y + 0.01);
  if (dy > 1 || dy < -2) return false;
  return halves(ctx, ...t).some(([x, , z]) => Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) <= 1.5);
}

function inventories(ctx: GameCtx, t: Pos): { be: BlockEntityData; at: Pos }[] {
  const out: { be: BlockEntityData; at: Pos }[] = [];
  for (const at of halves(ctx, ...t)) {
    const be = containerAt(ctx, ...at);
    if (be?.items) out.push({ be, at });
  }
  return out;
}

function take(ctx: GameCtx, t: Pos): ItemStack | undefined {
  for (const { be, at } of inventories(ctx, t)) {
    const items = be.items!;
    for (let i = 0; i < items.length; i++) {
      const st = items[i];
      if (!st || st.count <= 0) continue;
      const n = Math.min(TAKE, st.count);
      const out = { ...st, count: n };
      if (n >= st.count) items[i] = null;
      else items[i] = { ...st, count: st.count - n };
      containerChanged(ctx, ...at);
      return out;
    }
  }
  return undefined;
}

// Vanilla matches by item type only and needs the chest to be empty or already hold that item.
function deposit(ctx: GameCtx, t: Pos, held: ItemStack): ItemStack | undefined {
  const invs = inventories(ctx, t);
  const all = invs.flatMap(({ be }) => be.items!);
  if (all.some((s) => s && s.count > 0) && !all.some((s) => s && s.count > 0 && s.item === held.item)) return held;
  const cap = maxStack(held.item);
  let left = held.count;
  for (const { be, at } of invs) {
    const items = be.items!;
    let changed = false;
    for (let i = 0; i < items.length && left > 0; i++) {
      const st = items[i];
      if (!st || st.count <= 0) {
        const n = Math.min(left, cap);
        items[i] = { ...held, count: n };
        left -= n;
        changed = true;
      } else if (st.item === held.item && JSON.stringify(st) === JSON.stringify({ ...held, count: st.count }) && st.count < cap) {
        const n = Math.min(left, cap - st.count);
        items[i] = { ...st, count: st.count + n };
        left -= n;
        changed = true;
      }
    }
    if (changed) containerChanged(ctx, ...at);
    if (left <= 0) return undefined;
  }
  return left === held.count ? held : { ...held, count: left };
}

function chestSound(ctx: GameCtx, t: Pos, open: boolean) {
  ctx.emit({ type: "sound", name: open ? "block.chest.open" : "block.chest.close", x: t[0] + 0.5, y: t[1] + 0.5, z: t[2] + 0.5, volume: 0.5 });
}

function failed(e: Entity, s: SortState, t: Pos) {
  releaseChest(e);
  s.visited.push(key(t));
  if (s.visited.length >= MEMORY) {
    s.visited.length = 0;
    s.rest = GIVE_UP;
  }
}

// Returns true while the golem is busy with chests (walking, examining), false to let it wander.
export function sortTick(e: Entity, ctx: GameCtx): boolean {
  const s = sortState(e);
  if (s.rest > 0) {
    s.rest--;
    return false;
  }
  const holding = e.data.item as ItemStack | undefined;
  const want = holding ? isDest : isSource;
  if (s.target && !want(blockDef(ctx.world.getBlock(...s.target)).name)) releaseChest(e);
  if (!s.target) {
    if (e.age < s.scanAt) return false;
    s.scanAt = e.age + 20;
    const t = findChest(e, ctx, want, s.visited);
    if (!t) {
      if (s.visited.length) {
        s.visited.length = 0;
        s.rest = GIVE_UP;
      }
      return false;
    }
    s.target = t;
    s.timer = 0;
    s.open = false;
    inUse.set(key(t), e.id);
  }
  const t = s.target;
  if (!s.open) {
    if (reached(e, ctx, t)) {
      clearPath(e);
      s.open = true;
      s.timer = 0;
      chestSound(ctx, t, true);
    } else {
      if (++s.timer > 400 || (!moveTo(e, ctx, t[0] + 0.5, t[1], t[2] + 0.5, num(e, "_speed", SPEED)) && s.timer > 40)) failed(e, s, t);
      return true;
    }
  }
  lookAt(e, t[0] + 0.5, t[1] + 0.5, t[2] + 0.5);
  e.body.vel.x = 0;
  e.body.vel.z = 0;
  if (++s.timer < EXAMINE) return true;
  chestSound(ctx, t, false);
  if (holding) {
    const rest = deposit(ctx, t, holding);
    e.data.item = rest;
    if (!rest) {
      sound(ctx, e, "entity.copper_golem.item_drop", 0.8);
      s.visited.length = 0;
      releaseChest(e);
    } else failed(e, s, t);
  } else {
    const got = take(ctx, t);
    if (got) {
      e.data.item = got;
      sound(ctx, e, "entity.copper_golem.item_get", 0.8);
      s.visited.length = 0;
      releaseChest(e);
    } else failed(e, s, t);
  }
  return true;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.persistent = true;
  checkLightning(e, ctx);
  oxidize(e, ctx);
  const spin = num(e, "_spin");
  if (spin > 0) e.data._spin = spin - 1;
  if (e.data.statue || e.dead) {
    releaseChest(e);
    clearPath(e);
    e.body.vel.x = 0;
    e.body.vel.z = 0;
    return;
  }
  if (sortTick(e, ctx)) return;
  if (spin <= 0 && ctx.random() < 1 / 800) {
    e.data._spin = 20;
    sound(ctx, e, "entity.copper_golem.spin", 0.6);
  }
  if (!wander(e, ctx, num(e, "_speed", SPEED))) idleLook(e, ctx);
}

export const COPPER_GOLEM_DEF: MobDef = {
  type: "copper_golem",
  displayName: "Copper Golem",
  category: "misc",
  width: 0.49,
  height: 0.98,
  maxHealth: 12,
  speed: SPEED,
  drops: [{ item: "lightning_rod", count: [1, 1] }],
  sounds: { ambient: "entity.copper_golem.ambient", hurt: "entity.copper_golem.hurt", death: "entity.copper_golem.death", step: "entity.copper_golem.step" },
  createModel: golemModel,
  tick,
  onDeath(e, ctx) {
    dropHeld(e, ctx);
    releaseChest(e);
  },
  onInteract(e, ctx, held) {
    if (!held) {
      if (!e.data.item) return false;
      dropHeld(e, ctx);
      releaseChest(e);
      return true;
    }
    if (held.item === "honeycomb") {
      if (e.data.waxed) return false;
      e.data.waxed = true;
      useItem(ctx);
      sound(ctx, e, "entity.copper_golem.wax_on");
      particles(ctx, e, "happy");
      return true;
    }
    if (held.item.endsWith("_axe")) {
      if (e.data.waxed) {
        e.data.waxed = false;
        sound(ctx, e, "entity.copper_golem.wax_off");
      } else if (e.data.statue) {
        setStage(e, 3);
        sound(ctx, e, "entity.copper_golem.scrape");
      } else if (stageOf(e) > 0) {
        setStage(e, stageOf(e) - 1);
        // Vanilla adds one tick to a freshly scraped golem's timer.
        e.data.oxTimer = nextTimer(ctx) + 1;
        sound(ctx, e, "entity.copper_golem.scrape");
      } else return false;
      particles(ctx, e, "dust", 0xe0804f);
      if (ctx.player.gameMode !== "creative") ctx.inventory.damageHeld(1);
      return true;
    }
    return false;
  },
};
