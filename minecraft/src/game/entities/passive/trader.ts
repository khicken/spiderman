import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { clearPath, idleLook, lookAt, panic, playerDistSq, wander } from "../ai";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, eyes, type Pix } from "./paint";
import { num, sound } from "./common";

interface Trade {
  buy: ItemStack;
  buyB?: ItemStack;
  sell: ItemStack;
  uses: number;
  maxUses: number;
  xp: number;
}

const T = (cost: number, item: string, n: number, max = 12): Trade => ({ buy: { item: "emerald", count: cost }, sell: { item, count: n }, uses: 0, maxUses: max, xp: 1 });

const COMMON: Trade[] = [
  T(1, "sea_pickle", 1, 5), T(4, "slime_ball", 1, 5), T(1, "glowstone", 1, 5), T(5, "nautilus_shell", 1, 5), T(1, "fern", 1), T(1, "sugar_cane", 1, 8),
  T(1, "pumpkin", 1, 4), T(3, "kelp", 1), T(3, "cactus", 1, 8), T(1, "dandelion", 1), T(1, "poppy", 1), T(1, "blue_orchid", 1, 8), T(1, "allium", 1),
  T(1, "azure_bluet", 1), T(1, "red_tulip", 1), T(1, "orange_tulip", 1), T(1, "white_tulip", 1), T(1, "pink_tulip", 1), T(1, "oxeye_daisy", 1),
  T(1, "cornflower", 1), T(1, "lily_of_the_valley", 1, 7), T(1, "wheat_seeds", 1), T(1, "beetroot_seeds", 1), T(1, "pumpkin_seeds", 1),
  T(1, "melon_seeds", 1), T(5, "acacia_sapling", 1, 8), T(5, "birch_sapling", 1, 8), T(5, "dark_oak_sapling", 1, 8), T(5, "jungle_sapling", 1, 8),
  T(5, "oak_sapling", 1, 8), T(5, "spruce_sapling", 1, 8), T(5, "cherry_sapling", 1, 8), T(5, "mangrove_propagule", 1, 8), T(1, "red_dye", 3),
  T(1, "white_dye", 3), T(1, "blue_dye", 3), T(1, "pink_dye", 3), T(1, "black_dye", 3), T(1, "green_dye", 3), T(1, "light_gray_dye", 3),
  T(1, "magenta_dye", 3), T(1, "yellow_dye", 3), T(1, "gray_dye", 3), T(1, "purple_dye", 3), T(1, "light_blue_dye", 3), T(1, "lime_dye", 3),
  T(1, "orange_dye", 3), T(1, "brown_dye", 3), T(1, "cyan_dye", 3), T(3, "brain_coral_block", 1, 8), T(3, "bubble_coral_block", 1, 8),
  T(3, "fire_coral_block", 1, 8), T(3, "horn_coral_block", 1, 8), T(3, "tube_coral_block", 1, 8), T(1, "vine", 1, 4), T(1, "brown_mushroom", 1, 4),
  T(1, "red_mushroom", 1, 4), T(1, "lily_pad", 2, 5), T(1, "small_dripleaf", 2, 5), T(1, "sand", 8, 8), T(1, "red_sand", 4, 6),
  T(1, "pointed_dripstone", 2, 5), T(1, "rooted_dirt", 2, 5), T(1, "moss_block", 2, 5),
];
const RARE: Trade[] = [T(5, "tropical_fish_bucket", 1, 4), T(5, "pufferfish_bucket", 1, 4), T(3, "packed_ice", 1, 6), T(6, "blue_ice", 1, 6), T(1, "gunpowder", 1, 8), T(3, "podzol", 3, 6)];

export function traderTrades(r: () => number): Trade[] {
  const pool = COMMON.slice();
  const out: Trade[] = [];
  for (let i = 0; i < 5 && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  out.push(RARE[Math.floor(r() * RARE.length)]);
  return out.map((t) => ({ ...t, buy: { ...t.buy }, sell: { ...t.sell } }));
}

function paintTrader(p: Pix) {
  const SKIN = [0xbd8b72, 0xb48068, 0xc4937a];
  const R = [0x3d5aa6, 0x34509a, 0x4666b4];
  const L = [0x4ab0c8, 0x40a0b8];
  const head = p.fillCuboid(0, 0, 8, 10, 8, SKIN);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 3, 6, 1], 0x4d3424);
  eyes(p, f[0] + 1, f[1] + 4, 4, 0xffffff, 0x3a4a9a, false);
  p.rect([f[0] + 2, f[1] + 8, 4, 1], 0x8a5a48);
  p.fillCuboid(24, 0, 2, 4, 2, [0xa8775f, 0x9e6e57]);
  p.rect([32, 0, 32, 18], 0, 0);
  const hood = p.cuboid(32, 0, 8, 10, 8);
  p.noise(hood.top, R);
  for (const r of [hood.right, hood.left, hood.back]) p.noise(r, R);
  p.noise([hood.front[0], hood.front[1], 8, 2], R);
  p.noise([hood.front[0], hood.front[1], 1, 10], R);
  p.noise([hood.front[0] + 7, hood.front[1], 1, 10], R);
  p.fillCuboid(16, 20, 8, 12, 6, R);
  const jacket = p.fillCuboid(0, 38, 8, 18, 6, R);
  p.noise([jacket.front[0] + 3, jacket.front[1], 2, 18], L);
  p.rect([jacket.front[0], jacket.front[1] + 9, 8, 1], 0x5a3a20);
  p.rect([jacket.front[0] + 3, jacket.front[1] + 9, 2, 1], 0xe8c040);
  const arm = p.fillCuboid(44, 22, 4, 8, 4, R);
  p.noise([arm.right[0], arm.right[1] + 6, 16, 2], SKIN);
  p.fillCuboid(40, 38, 8, 4, 4, SKIN);
  const leg = p.fillCuboid(0, 22, 4, 12, 4, [shade(R[0], 0.7), shade(R[0], 0.62)]);
  p.rect([0, leg.front[1] + 11, 16, 1], 0x3a2a1a);
}

function traderModel() {
  const parts: VPart[] = [
    { name: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [0, 0] },
    { name: "hat", parent: "head", pivot: [0, 0, 0], box: [-4, -10, -4, 8, 10, 8], uv: [32, 0], inflate: 0.51 },
    { name: "nose", parent: "head", pivot: [0, -2, 0], box: [-1, -1, -6, 2, 4, 2], uv: [24, 0] },
    { name: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 12, 6], uv: [16, 20] },
    { name: "jacket", parent: "body", pivot: [0, 0, 0], box: [-4, 0, -3, 8, 18, 6], uv: [0, 38], inflate: 0.5 },
    { name: "arms", pivot: [0, 3, -1], box: [-4, 2, -2, 8, 4, 4], uv: [40, 38], rot: [-0.75, 0, 0] },
    { name: "right_arm_x", parent: "arms", pivot: [0, 0, 0], box: [-8, -2, -2, 4, 8, 4], uv: [44, 22] },
    { name: "left_arm_x", parent: "arms", pivot: [0, 0, 0], box: [4, -2, -2, 4, 8, 4], uv: [44, 22], mirror: true },
    { name: "right_leg", pivot: [-2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22] },
    { name: "left_leg", pivot: [2, 12, 0], box: [-2, 0, -2, 4, 12, 4], uv: [0, 22], mirror: true },
  ];
  const r = rig(skin("wandering_trader", 64, 64, paintTrader), parts);
  return wrap(
    r,
    (a) => {
      const shake = num(a.e, "_shake");
      if (shake > 0) setRot(r.p.head, a.pitch, a.yaw, 0.3 * Math.sin((shake - a.pt) * 0.45));
      else look(r.p.head, a);
      const s = Math.cos(a.phase * 0.6662) * 1.4 * a.walk * 0.5;
      setRot(r.p.right_leg, s, 0, 0);
      setRot(r.p.left_leg, -s, 0, 0);
    },
    { scale: 0.9375 },
  );
}

const SCARY = new Set(["zombie", "husk", "drowned", "zombie_villager", "pillager", "vindicator", "evoker", "vex", "ravager", "illusioner", "zoglin"]);
const near: Entity[] = [];

function spawnLlamas(e: Entity, ctx: GameCtx) {
  for (let i = 0; i < 2; i++) {
    const a = ctx.random() * Math.PI * 2;
    ctx.entities.spawn("trader_llama", e.body.pos.x + Math.cos(a) * 2, e.body.pos.y, e.body.pos.z + Math.sin(a) * 2, { leash: { entity: e.id } });
  }
}

export const WANDERING_TRADER: MobDef = {
  type: "wandering_trader",
  displayName: "Wandering Trader",
  category: "passive",
  width: 0.6,
  height: 1.95,
  maxHealth: 20,
  speed: 0.5,
  sounds: { ambient: "entity.wandering_trader.ambient", hurt: "entity.wandering_trader.hurt", death: "entity.wandering_trader.death" },
  createModel: traderModel,
  tick(e, ctx) {
    e.data.noDespawn = true;
    if (!e.data.trades) {
      e.data.trades = traderTrades(ctx.random);
      if (e.data.natural) {
        e.data.despawnDelay = 48000;
        spawnLlamas(e, ctx);
      }
    }
    const last = num(e, "_hp", e.health);
    e.data._hp = e.health;
    if (e.health < last && e.data._hurtBy === "player") e.data._defend = 200;
    if (num(e, "_defend") > 0) e.data._defend = num(e, "_defend") - 1;
    if (e.data.despawnDelay !== undefined && !e.data.name) {
      const d = num(e, "despawnDelay") - 1;
      e.data.despawnDelay = d;
      if (d <= 0 && !e.data._trading) {
        sound(ctx, e, "entity.wandering_trader.disappeared");
        e.data._remove = true;
        return;
      }
    }
    const night = ctx.time.dayTime > 12500 && ctx.time.dayTime < 23500;
    const inv = e.effects.some((f) => f.id === "invisibility");
    if (night && !inv && !e.data._trading && ctx.random() < 0.002) {
      e.effects.push({ id: "invisibility", amplifier: 0, ticks: Math.max(20, 23500 - ctx.time.dayTime) });
      sound(ctx, e, "entity.wandering_trader.drink_potion");
    } else if (!night && inv && e.age % 20 === 0) {
      e.effects = e.effects.filter((f) => f.id !== "invisibility");
      sound(ctx, e, "entity.wandering_trader.drink_milk");
    }
    e.data.invisible = e.effects.some((f) => f.id === "invisibility");
    const shake = num(e, "_shake");
    if (shake > 0) e.data._shake = shake - 1;
    if (panic(e, ctx, 1)) return;
    if (e.age % 10 === 0) {
      const p = e.body.pos;
      ctx.entities.near(p.x, p.y, p.z, 8, near);
      const threat = near.find((o) => SCARY.has(o.type) && !o.dead);
      near.length = 0;
      if (threat) {
        e.data._panic = 40;
        e.data._fromX = threat.body.pos.x;
        e.data._fromZ = threat.body.pos.z;
        clearPath(e);
      }
    }
    if (e.data._trading) {
      if (playerDistSq(ctx, e) > 64) e.data._trading = false;
      clearPath(e);
      const pp = ctx.player.body.pos;
      lookAt(e, pp.x, pp.y + 1.62, pp.z);
      return;
    }
    if (!wander(e, ctx, num(e, "_speed", 0.5) * 0.7)) idleLook(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (held?.item === "wandering_trader_spawn_egg" || held?.item === "name_tag") return false;
    const trades = e.data.trades as Trade[] | undefined;
    if (!trades?.length) {
      e.data._shake = 40;
      sound(ctx, e, "entity.wandering_trader.no");
      return true;
    }
    e.data._trading = true;
    sound(ctx, e, "entity.wandering_trader.trade");
    ctx.inventory.open("villager", { x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z, entityId: e.id });
    return true;
  },
};
