import * as THREE from "three";
import type { Entity, GameCtx, ItemStack, MobDef } from "../../contracts";
import { lookAt } from "../ai";
import { rig, wrap, setRot, look, type VPart } from "../rig";
import { skin, shade, type Pix } from "./paint";
import { num, sound, useItem } from "./common";
import { flyDrag, flyToward, flyWander } from "./fly";
import { advTrigger } from "../../systems/advancements/bus";

const BLUE = 0x5fd0f8;
const near: Entity[] = [];
const vel = new THREE.Vector3();

function paintAllay(p: Pix) {
  const B = [BLUE, shade(BLUE, 0.93), shade(BLUE, 1.06)];
  const head = p.fillCuboid(0, 0, 5, 5, 5, [0x8ee4ff, 0x80dcfc, 0x9aeaff]);
  const f = head.front;
  p.rect([f[0] + 1, f[1] + 2, 1, 2], 0x1c3c8c);
  p.rect([f[0] + 3, f[1] + 2, 1, 2], 0x1c3c8c);
  p.px(f[0] + 1, f[1] + 2, 0xe8fbff);
  p.px(f[0] + 3, f[1] + 2, 0xe8fbff);
  p.fillCuboid(0, 10, 3, 4, 2, B);
  p.fillCuboid(0, 16, 3, 5, 2, [shade(BLUE, 0.8), shade(BLUE, 0.75)]);
  p.fillCuboid(20, 0, 1, 4, 2, B);
  p.fillCuboid(20, 6, 1, 4, 2, B);
  p.noise([14, 22, 8, 5], [0xdaf6ff, 0xc6eefc, 0xeefcff]);
  p.noise([22, 22, 8, 5], [0xdaf6ff, 0xc6eefc]);
}

function allayModel() {
  const parts: VPart[] = [
    { name: "root", pivot: [0, 23.5, 0], box: [0, 0, 0, 0, 0, 0], uv: [31, 31] },
    { name: "head", parent: "root", pivot: [0, -3.99, 0], box: [-2.5, -5, -2.5, 5, 5, 5], uv: [0, 0] },
    { name: "body", parent: "root", pivot: [0, -4, 0], box: [-1.5, 0, -1, 3, 4, 2], uv: [0, 10] },
    { name: "cloak", parent: "body", pivot: [0, 0, 0], box: [-1.5, 0, -1, 3, 5, 2], uv: [0, 16], inflate: -0.2 },
    { name: "right_arm", parent: "body", pivot: [-1.75, 0.5, 0], box: [-0.75, -0.5, -1, 1, 4, 2], uv: [20, 0], inflate: -0.01 },
    { name: "left_arm", parent: "body", pivot: [1.75, 0.5, 0], box: [-0.25, -0.5, -1, 1, 4, 2], uv: [20, 6], inflate: -0.01 },
    { name: "right_wing", parent: "body", pivot: [-0.5, 0, 0.6], box: [0, 1, 0, 0, 5, 8], uv: [14, 14] },
    { name: "left_wing", parent: "body", pivot: [0.5, 0, 0.6], box: [0, 1, 0, 0, 5, 8], uv: [14, 14] },
  ];
  const r = rig(skin("allay", 32, 32, paintAllay), parts);
  return wrap(
    r,
    (a) => {
      look(r.p.head, a);
      const flap = Math.cos(a.age * 20 * (Math.PI / 180)) * Math.PI * 0.15;
      setRot(r.p.right_wing, 0.43, -0.61 - flap, 0.47);
      setRot(r.p.left_wing, 0.43, 0.61 + flap, -0.47);
      const holding = !!a.e.data.item;
      const arm = holding ? -1.0 : 0.15 * Math.sin(a.age * 0.09);
      setRot(r.p.right_arm, arm, 0, holding ? 0 : 0.1);
      setRot(r.p.left_arm, arm, 0, holding ? 0 : -0.1);
      setRot(r.p.body, a.walk * 0.4, 0, 0);
      r.p.root.position.y = (24 - 23.5 + Math.sin(a.age * 0.12) * 0.6) / 16;
    },
    { head: [] },
  );
}

function bag(e: Entity) {
  return e.data.bag as ItemStack | undefined;
}

function seekItem(e: Entity, ctx: GameCtx, want: string): Entity | null {
  const p = e.body.pos;
  ctx.entities.near(p.x, p.y, p.z, 32, near);
  let best: Entity | null = null;
  let bd = Infinity;
  for (const o of near) {
    if (o.type !== "item" || o.dead || o.data._remove || o.data._fly !== undefined) continue;
    const s = o.data.stack as ItemStack | undefined;
    if (!s || s.item !== want) continue;
    const d = o.body.pos.distanceToSquared(p);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  near.length = 0;
  return best;
}

function tick(e: Entity, ctx: GameCtx) {
  e.data.noGravity = true;
  e.data.noFall = true;
  e.data.persistent = true;
  const accel = 0.014;
  const held = e.data.item as ItemStack | undefined;
  const pl = ctx.player;
  const pp = pl.body.pos;
  const dist2 = (pp.x - e.body.pos.x) ** 2 + (pp.y - e.body.pos.y) ** 2 + (pp.z - e.body.pos.z) ** 2;
  if (held && e.data.owner === "player" && !pl.dead) {
    const b = bag(e);
    const full = !!b && b.count >= 64;
    const cool = num(e, "_throwCd");
    if (cool > 0) e.data._throwCd = cool - 1;
    const target = !full && cool <= 0 ? seekItem(e, ctx, held.item) : null;
    if (target) {
      const d = flyToward(e, target.body.pos.x, target.body.pos.y + 0.3, target.body.pos.z, accel * 1.4);
      if (d < 1.2) {
        const s = target.data.stack as ItemStack;
        const room = 64 - (b?.count ?? 0);
        const n = Math.min(room, s.count);
        e.data.bag = { ...s, count: (b?.count ?? 0) + n };
        if (n >= s.count) target.data._remove = true;
        else target.data.stack = { ...s, count: s.count - n };
        sound(ctx, e, "entity.item.pickup", 0.2);
      }
      flyDrag(e);
      return;
    }
    const nb = e.data.noteBlock as [number, number, number] | undefined;
    if (b && nb && ctx.time.tick < num(e, "noteUntil") && ctx.world.getBlock(nb[0], nb[1], nb[2]) !== 0) {
      const d = flyToward(e, nb[0] + 0.5, nb[1] + 1.6, nb[2] + 0.5, accel * 1.4);
      if (d < 2 && cool <= 0) {
        vel.set(0, -0.1, 0);
        ctx.entities.dropItem(b, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z, vel);
        advTrigger({ t: "allay_drop", item: b.item, noteBlock: true });
        e.data.bag = undefined;
        e.data._throwCd = 60;
        sound(ctx, e, "entity.allay.item_thrown");
      }
      flyDrag(e);
      return;
    }
    if (b && dist2 < 64 * 64) {
      const d = flyToward(e, pp.x, pp.y + 1.6, pp.z, accel * 1.4);
      if (d < 3 && cool <= 0) {
        vel.set(pp.x - e.body.pos.x, pp.y + 1 - e.body.pos.y, pp.z - e.body.pos.z).normalize().multiplyScalar(0.3);
        ctx.entities.dropItem(b, e.body.pos.x, e.body.pos.y + 0.3, e.body.pos.z, vel);
        advTrigger({ t: "allay_drop", item: b.item, noteBlock: false });
        e.data.bag = undefined;
        e.data._throwCd = 60;
        sound(ctx, e, "entity.allay.item_thrown");
      }
      flyDrag(e);
      return;
    }
    if (dist2 > 36) {
      flyToward(e, pp.x, pp.y + 1.8, pp.z, accel * (dist2 > 256 ? 1.6 : 1));
      flyDrag(e);
      return;
    }
    lookAt(e, pp.x, pp.y + 1.62, pp.z);
    flyWander(e, ctx, accel * 0.6, 3, 1.5, pp.x, pp.y + 1.5, pp.z);
    flyDrag(e);
    return;
  }
  flyWander(e, ctx, accel * 0.7, 8, 3);
  flyDrag(e);
}

export const ALLAY: MobDef = {
  type: "allay",
  displayName: "Allay",
  category: "passive",
  width: 0.35,
  height: 0.6,
  maxHealth: 20,
  speed: 0.1,
  sounds: { ambient: "entity.allay.ambient_without_item", hurt: "entity.allay.hurt", death: "entity.allay.death" },
  createModel: allayModel,
  tick,
  onInteract(e, ctx, held) {
    const cur = e.data.item as ItemStack | undefined;
    if (cur && !held) {
      ctx.inventory.add({ ...cur, count: 1 });
      e.data.item = undefined;
      e.data.owner = undefined;
      const b = bag(e);
      if (b) ctx.entities.dropItem(b, e.body.pos.x, e.body.pos.y, e.body.pos.z);
      e.data.bag = undefined;
      sound(ctx, e, "entity.allay.item_taken");
      return true;
    }
    if (!cur && held && !held.item.endsWith("_spawn_egg") && held.item !== "name_tag") {
      e.data.item = { item: held.item, count: 1 };
      e.data.owner = "player";
      useItem(ctx);
      sound(ctx, e, "entity.allay.item_given");
      return true;
    }
    return false;
  },
  onDeath(e, ctx) {
    const p = e.body.pos;
    const cur = e.data.item as ItemStack | undefined;
    if (cur) ctx.entities.dropItem(cur, p.x, p.y, p.z);
    const b = bag(e);
    if (b) ctx.entities.dropItem(b, p.x, p.y, p.z);
  },
};
