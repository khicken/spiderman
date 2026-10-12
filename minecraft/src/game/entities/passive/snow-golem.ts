import type { Entity, GameCtx, MobDef } from "../../contracts";
import { AIR, idOf, stateOf } from "../../contracts";
import { OPAQUE, SOLID, blockId } from "../../blocks/registry";
import { canSee, canSeeSky, clearPath, idleLook, lookAt, moveTo, wander, yawTo } from "../ai";
import { mobDef } from "../registry";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { shootVel } from "../hostile/brain";
import { skin, shade, type Pix } from "./paint";
import { num, sound } from "./common";

const near: Entity[] = [];

function paintGolem(p: Pix, pumpkin: boolean) {
  const S = [0xf4fbfb, 0xe6f0f2, 0xfafefe, 0xdce8ec];
  const head = p.fillCuboid(0, 0, 8, 8, 8, S);
  const f = head.front;
  p.rect([f[0] + 2, f[1] + 2, 1, 1], 0x202020);
  p.rect([f[0] + 5, f[1] + 2, 1, 1], 0x202020);
  for (const x of [1, 2, 3, 4, 5, 6]) p.px(f[0] + x, f[1] + (x === 1 || x === 6 ? 4 : 5), 0x202020);
  p.fillCuboid(0, 20, 10, 10, 10, S);
  p.fillCuboid(0, 40, 12, 12, 12, S);
  p.fillCuboid(80, 0, 12, 2, 2, [0x6b4a2b, 0x5a3e24, 0x7a5634]);
  if (!pumpkin) {
    p.rect([32, 0, 40, 20], 0, 0);
    return;
  }
  const O = [0xe38a1d, 0xd67c14, 0xec9a2c];
  const pk = p.fillCuboid(32, 0, 10, 10, 10, O);
  for (const r of [pk.right, pk.front, pk.left, pk.back]) for (let x = 1; x < r[2]; x += 3) p.rect([r[0] + x, r[1], 1, r[3]], shade(O[0], 0.85));
  p.noise(pk.top, [0xc8781a, 0xb86c14]);
  p.rect([pk.top[0] + 4, pk.top[1] + 4, 2, 2], 0x6a7a2a);
  const pf = pk.front;
  p.map(pf[0], pf[1], [
    "..........",
    "..........",
    ".kkk..kkk.",
    ".kkk..kkk.",
    "..........",
    "....kk....",
    ".kkkkkkkk.",
    ".kk.kk.kk.",
    "..........",
    "..........",
  ], { k: 0x3a2008 });
}

function golemModel() {
  const arm = (name: string, x: number, z: number, rot: [number, number, number]): VPart => ({ name, parent: "upper_body", pivot: [x, -7, z], box: [-1, 0, -1, 12, 2, 2], uv: [80, 0], inflate: -0.5, rot });
  const parts: VPart[] = [
    { name: "head", pivot: [0, 4, 0], box: [-4, -8, -4, 8, 8, 8], uv: [0, 0], inflate: -0.5 },
    { name: "pumpkin", parent: "head", pivot: [0, 0, 0], box: [-5, -9.25, -5, 10, 10, 10], uv: [32, 0] },
    { name: "upper_body", pivot: [0, 13, 0], box: [-5, -10, -5, 10, 10, 10], uv: [0, 20], inflate: -0.5 },
    { name: "lower_body", pivot: [0, 24, 0], box: [-6, -12, -6, 12, 12, 12], uv: [0, 40], inflate: -0.5 },
    arm("left_arm", 5, 1, [0, 0, -1]),
    arm("right_arm", -5, -1, [0, Math.PI, 1]),
  ];
  const r = rig(skin("snow_golem", 128, 64, (p) => paintGolem(p, true)), parts);
  return wrap(
    r,
    (a) => {
      look(r.p.head, a);
      r.p.pumpkin.visible = !a.e.data.noPumpkin;
      const y = a.yaw * 0.25;
      setRot(r.p.upper_body, 0, y, 0);
      setRot(r.p.left_arm, 0, 0, -1 - Math.cos(a.phase * 0.6662) * 0.1 * a.walk);
      setRot(r.p.right_arm, 0, Math.PI, 1 + Math.cos(a.phase * 0.6662) * 0.1 * a.walk);
    },
    { head: [] },
  );
}

function hostile(o: Entity) {
  return !o.dead && mobDef(o.type)?.category === "hostile";
}

function snowTrail(e: Entity, ctx: GameCtx) {
  if (!ctx.rules.mobGriefing) return;
  const snow = blockId("snow");
  for (let l = 0; l < 4; l++) {
    const x = Math.floor(e.body.pos.x + ((l % 2) * 2 - 1) * 0.25);
    const y = Math.floor(e.body.pos.y);
    const z = Math.floor(e.body.pos.z + ((Math.floor(l / 2) % 2) * 2 - 1) * 0.25);
    if (ctx.world.getBlock(x, y, z) !== AIR) continue;
    if (ctx.world.getBiome(x, z).temperature >= 0.8) continue;
    const below = idOf(ctx.world.getBlock(x, y - 1, z));
    if (!SOLID[below] || !OPAQUE[below]) continue;
    ctx.world.setBlock(x, y, z, stateOf(snow, 0));
  }
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.persistent = true;
  const p = e.body.pos;
  const biome = ctx.world.getBiome(Math.floor(p.x), Math.floor(p.z));
  if (biome.temperature > 1) ctx.entities.damage(e.id, 1, "fire");
  const raining = ctx.time.rain > 0.5 && biome.precipitation === "rain" && canSeeSky(ctx, p.x, p.y + 1, p.z);
  if (e.body.inWater || raining) ctx.entities.damage(e.id, 1, "drown");
  if (e.dead) return;
  snowTrail(e, ctx);
  let t = e.data._target as number | undefined;
  let o = typeof t === "number" ? ctx.entities.get(t) : undefined;
  if (!o || !hostile(o) || o.body.pos.distanceToSquared(p) > 256) {
    o = undefined;
    t = undefined;
  }
  if (!o && (e.age + e.id) % 10 === 0) {
    ctx.entities.near(p.x, p.y, p.z, 16, near);
    let best = Infinity;
    for (const c of near) {
      if (!hostile(c)) continue;
      const d = c.body.pos.distanceToSquared(p);
      if (d < best && canSee(ctx, e, c.body.pos.x, c.body.pos.y + c.body.height * 0.5, c.body.pos.z)) {
        best = d;
        o = c;
      }
    }
    near.length = 0;
    t = o?.id;
  }
  e.data._target = t;
  if (o) {
    const tp = o.body.pos;
    lookAt(e, tp.x, tp.y + o.body.height * 0.5, tp.z);
    const d2 = tp.distanceToSquared(p);
    const seen = canSee(ctx, e, tp.x, tp.y + o.body.height * 0.5, tp.z);
    if (d2 > 100 || !seen) moveTo(e, ctx, tp.x, tp.y, tp.z, num(e, "_speed", 0.2) * 1.25);
    else clearPath(e);
    if (d2 <= 100 && seen && e.age >= num(e, "_atk")) {
      e.data._atk = e.age + 20;
      e.yaw = yawTo(tp.x - p.x, tp.z - p.z);
      const sy = p.y + e.body.height - 0.3;
      const s = ctx.entities.spawn("snowball", p.x, sy, p.z, { owner: e.id });
      if (s) {
        const dx = tp.x - p.x, dz = tp.z - p.z;
        const dy = tp.y + o.body.height - 1.1 - sy;
        shootVel(ctx, s.body.vel, dx, dy + Math.hypot(dx, dz) * 0.2, dz, 1.6, 12);
      }
      sound(ctx, e, "entity.snow_golem.shoot", 1, 0.4 / (ctx.random() * 0.4 + 0.8));
    }
    return;
  }
  if (!wander(e, ctx, num(e, "_speed", 0.2))) idleLook(e, ctx);
}

export const SNOW_GOLEM: MobDef = {
  type: "snow_golem",
  displayName: "Snow Golem",
  category: "misc",
  width: 0.7,
  height: 1.9,
  maxHealth: 4,
  speed: 0.2,
  drops: [{ item: "snowball", count: [0, 15] }],
  sounds: { ambient: "entity.snow_golem.ambient", hurt: "entity.snow_golem.hurt", death: "entity.snow_golem.death" },
  createModel: golemModel,
  tick,
  onInteract(e, ctx, held) {
    if (held?.item !== "shears" || e.data.noPumpkin) return false;
    e.data.noPumpkin = true;
    ctx.entities.dropItem({ item: "carved_pumpkin", count: 1 }, e.body.pos.x, e.body.pos.y + 1.7, e.body.pos.z);
    sound(ctx, e, "entity.snow_golem.shear");
    if (ctx.player.gameMode !== "creative") ctx.inventory.damageHeld(1);
    return true;
  },
};
