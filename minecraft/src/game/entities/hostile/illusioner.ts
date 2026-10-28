import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { applyPhysics, clearPath, idleLook, lookAt, rotlerp } from "../ai";
import { addEffect, hasEffect, hurtAmount, idle, num, particles, regionalDifficulty, sound, targetInfo, updateTarget } from "./brain";
import { attachHeld } from "./held";
import { ILLAGER } from "./humanoid";
import { paintIllager } from "./looks-nether";
import { skinOf } from "./looks-undead";
import type { Pix } from "./pix";
import { headLook, humanoidLimbs, rig, setRot, wrap } from "./rig";
import { bowAttack } from "./skeleton";

const BOW = { type: "illusioner", sound: "entity.skeleton", interval: [20, 20] as [number, number] };

function paintIllusioner(p: Pix): void {
  paintIllager(p, [0x2c4f8c, 0x264478, 0x345a9c], false);
  const jf = p.cuboid(0, 38, 8, 18, 6);
  for (const r of [jf.right, jf.front, jf.left, jf.back]) p.noise([r[0], r[1] + 16, r[2], 2], [0x1a2a4a, 0x22345a]);
}

type Vec = [number, number, number];
const ZERO: Vec[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

function illusionerModel(): MobModel {
  const r = rig(skinOf("illusioner", 64, 64, paintIllusioner), ILLAGER);
  const held = attachHeld(r, "bow");
  const inner = wrap(r, (a) => {
    headLook(r.p.head, a);
    humanoidLimbs(r, a, true);
    const casting = !!a.e.data.casting;
    const aggressive = !!a.e.data.aggressive;
    const crossed = !casting && !aggressive;
    r.p.arms.visible = crossed;
    r.p.right_arm.visible = !crossed;
    r.p.left_arm.visible = !crossed;
    if (casting) {
      const s = Math.cos(a.age * 0.6662) * 0.25;
      setRot(r.p.right_arm, s, 0, 2.3561945);
      setRot(r.p.left_arm, s, 0, -2.3561945);
    } else if (aggressive) {
      setRot(r.p.right_arm, -Math.PI / 2 + a.pitch, -0.1 + a.yaw, 0);
      setRot(r.p.left_arm, -Math.PI / 2 + a.pitch, 0.5 + a.yaw, 0);
    }
    held?.update(a.e);
  });
  // Mirror images share the real model's geometry and material, so a pack skin reaches them too.
  const root = new THREE.Group();
  root.add(inner.root);
  const clones = ZERO.map(() => inner.root.clone(true));
  const src: THREE.Object3D[] = [];
  inner.root.traverse((o) => src.push(o));
  const dst = clones.map((c) => {
    const list: THREE.Object3D[] = [];
    c.traverse((o) => list.push(o));
    return list;
  });
  for (const c of clones) root.add(c);
  return {
    root,
    animate(e, pt, walk, phase) {
      inner.animate(e, pt, walk, phase);
      const inv = hasEffect(e.effects, "invisibility");
      inner.root.visible = !inv;
      const t = num(e, "_illT");
      const f = t > 0 ? (t - pt) / 3 : 0;
      const old = (e.data._illO as Vec[] | undefined) ?? ZERO, now = (e.data._illN as Vec[] | undefined) ?? ZERO;
      const yaw = e.yaw + Math.PI, c = Math.cos(yaw), s = Math.sin(yaw), bob = e.age + pt;
      clones.forEach((cl, i) => {
        cl.visible = inv;
        if (!inv) return;
        for (let k = 0; k < src.length; k++) {
          const a = src[k], b = dst[i][k];
          if (k > 0) b.position.copy(a.position);
          b.quaternion.copy(a.quaternion);
          b.scale.copy(a.scale);
          b.visible = a.visible || k === 0;
        }
        const x = now[i][0] + (old[i][0] - now[i][0]) * f + Math.cos(i + bob * 0.5) * 0.025;
        const y = now[i][1] + (old[i][1] - now[i][1]) * f + Math.cos(i + bob * 0.75) * 0.0125;
        const z = now[i][2] + (old[i][2] - now[i][2]) * f + Math.cos(i + bob * 0.7) * 0.025;
        cl.position.set(x * c - z * s, y, x * s + z * c);
      });
    },
    dispose() {
      inner.dispose();
    },
  };
}

function illusions(e: Entity, ctx: GameCtx): void {
  if (!hasEffect(e.effects, "invisibility")) return;
  e.data._illT = Math.max(0, num(e, "_illT") - 1);
  if (e.hurtTicks !== 1 && e.age % 1200 !== 0) return;
  e.data._illT = 3;
  e.data._illO = (e.data._illN as Vec[] | undefined) ?? ZERO;
  const r = () => Math.floor(ctx.random() * 13);
  e.data._illN = ZERO.map((): Vec => [(-6 + r()) * 0.5, Math.max(0, Math.floor(ctx.random() * 6) - 4), (-6 + r()) * 0.5]);
  const p = e.body.pos;
  particles(ctx, "smoke", p.x, p.y + 1, p.z, 16);
  sound(ctx, e, "entity.illusioner.mirror_move");
}

// Vanilla SpellcasterIllager goals: mirror (warmup 20, every 340 ticks) outranks blindness (warmup 20, every 180 ticks).
function startSpell(e: Entity, ctx: GameCtx, t: "player" | number): boolean {
  if (e.age < num(e, "_nextSpell")) return false;
  if (!hasEffect(e.effects, "invisibility")) {
    e.data.spell = "mirror";
    e.data._nextSpell = e.age + 340;
    sound(ctx, e, "entity.illusioner.prepare_mirror");
  } else if (t !== e.data._blindTarget && regionalDifficulty(ctx) > 2) {
    e.data.spell = "blindness";
    e.data._nextSpell = e.age + 180;
    sound(ctx, e, "entity.illusioner.prepare_blindness");
  } else return false;
  e.data._cast = 20;
  e.data._draw = 0;
  return true;
}

function castSpell(e: Entity, ctx: GameCtx, t: "player" | number): void {
  if (e.data.spell === "mirror") addEffect(e.effects, "invisibility", 1200);
  else {
    const target = t === "player" ? ctx.player : ctx.entities.get(t);
    if (target) addEffect(target.effects, "blindness", 400);
    e.data._blindTarget = t;
  }
  sound(ctx, e, "entity.illusioner.cast_spell");
  e.data.spell = undefined;
}

function illusionerTick(e: Entity, ctx: GameCtx): void {
  const hurt = hurtAmount(e);
  const t = updateTarget(e, ctx, { range: 18 }, hurt);
  const info = t !== undefined ? targetInfo(ctx, t) : null;
  let cast = num(e, "_cast");
  if (cast > 0 && t !== undefined && info) {
    clearPath(e);
    lookAt(e, info.pos.x, info.pos.y + info.height * 0.85, info.pos.z);
    e.yaw = rotlerp(e.yaw, e.headYaw, 0.5);
    if (e.age % 2 === 0) particles(ctx, "dust", e.body.pos.x, e.body.pos.y + 1.8, e.body.pos.z, 2, e.data.spell === "mirror" ? 0x4d66b3 : 0x1a1a4d);
    if (--cast <= 0) castSpell(e, ctx, t);
  } else cast = 0;
  if (cast <= 0 && t !== undefined && info && startSpell(e, ctx, t)) cast = num(e, "_cast");
  e.data._cast = cast;
  e.data.casting = cast > 0;
  if (cast <= 0) {
    if (t !== undefined && info) {
      bowAttack(e, ctx, BOW, 0.25);
      e.data.aggressive = true;
    } else {
      e.data.aggressive = false;
      e.data._draw = 0;
      idle(e, ctx, 0.5 * 0.6);
      idleLook(e, ctx);
    }
  }
  e.data.held = e.data.casting || e.data.aggressive ? undefined : "";
  illusions(e, ctx);
  if (ctx.random() < 0.004) sound(ctx, e, "entity.illusioner.ambient");
  applyPhysics(e, ctx);
}

// Java never spawns illusioners naturally or in raids; only commands and spawners place them.
export const ILLUSIONER: MobDef = {
  type: "illusioner",
  displayName: "Illusioner",
  category: "hostile",
  width: 0.6,
  height: 1.95,
  maxHealth: 32,
  speed: 0.5,
  xp: [5, 5],
  sounds: { hurt: "entity.illusioner.hurt", death: "entity.illusioner.death" },
  createModel: illusionerModel,
  tick: illusionerTick,
  onDeath(e, ctx) {
    if (ctx.random() < 0.085) ctx.entities.dropItem({ item: "bow", count: 1, damage: Math.floor(ctx.random() * 300) }, e.body.pos.x, e.body.pos.y + 0.5, e.body.pos.z);
  },
};
