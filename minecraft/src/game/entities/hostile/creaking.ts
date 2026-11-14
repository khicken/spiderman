import * as THREE from "three";
import type { DamageSource, Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { blockId, hasBlock } from "../../blocks/registry";
import { crumble, heartHurt, linkHolds, type HeartPos } from "../../systems/creaking-heart";
import { applyPhysics, canSee, clearPath, idleLook, meleeAttack, playerTargetable } from "../ai";
import { chase, hurtAmount, idle, num, sound, updateTarget } from "./brain";
import { skinOf } from "./looks-undead";
import { type Pix, shade } from "./pix";
import { attackTime, headLook, rig, setRot, wrap, type VPart } from "./rig";

const SPEED = 0.4;

const PARTS: VPart[] = [
  { name: "right_leg", pivot: [-2, 8, 0], box: [-1.5, 0, -1.5, 3, 16, 3], uv: [0, 20] },
  { name: "left_leg", pivot: [2, 8, 0], box: [-1.5, 0, -1.5, 3, 16, 3], uv: [12, 20] },
  { name: "body", pivot: [0, 8, 0], box: [-3, -14, -2, 6, 14, 4], uv: [24, 0] },
  {
    name: "head", pivot: [0, -6, 0], box: [-3, -13, -3, 6, 13, 6], uv: [0, 0],
    extra: [
      { box: [-5, -12, -0.5, 2, 1, 1], uv: [44, 0] },
      { box: [3, -10, -0.5, 2, 1, 1], uv: [44, 4] },
      { box: [-1, -16, -0.5, 1, 3, 1], uv: [52, 0] },
    ],
  },
  { name: "right_arm", pivot: [-4, -5, 0], box: [-2, -1, -1, 2, 21, 2], uv: [40, 20] },
  { name: "left_arm", pivot: [4, -5, 0], box: [0, -1, -1, 2, 21, 2], uv: [48, 20] },
];

const BARK = [0x4a4039, 0x3d342e, 0x564a40, 0x332b26];
const PALE = 0x9b9188;

function bark(p: Pix, u: number, v: number, w: number, h: number, d: number): void {
  const f = p.cuboid(u, v, w, h, d);
  for (const r of [f.top, f.bottom]) p.noise(r, [0x5c5048, 0x4f443c, 0x6a5d52]);
  for (const r of [f.right, f.front, f.left, f.back]) {
    for (let x = r[0]; x < r[0] + r[2]; x++) {
      const col = BARK[Math.floor(p.rand() * BARK.length)];
      const streak = p.rand() < 0.18;
      for (let y = r[1]; y < r[1] + r[3]; y++) {
        const j = 0.88 + p.rand() * 0.2;
        p.px(x, y, streak && p.rand() < 0.8 ? shade(PALE, j) : shade(col, j));
      }
    }
  }
}

function paintCreaking(p: Pix): void {
  bark(p, 0, 0, 6, 13, 6);
  bark(p, 24, 0, 6, 14, 4);
  bark(p, 0, 20, 3, 16, 3);
  bark(p, 12, 20, 3, 16, 3);
  bark(p, 40, 20, 2, 21, 2);
  bark(p, 48, 20, 2, 21, 2);
  bark(p, 44, 0, 2, 1, 1);
  bark(p, 44, 4, 2, 1, 1);
  bark(p, 52, 0, 1, 3, 1);
  const face = p.cuboid(0, 0, 6, 13, 6).front;
  p.map(face[0], face[1] + 4, [".s..s.", "......", "......", ".ssss.", "..ss.."], { s: 0x1e1916 });
}

function addEyes(head: THREE.Object3D): { dispose(): void } {
  const geo = new THREE.BoxGeometry(1 / 16, 1 / 16, 0.1 / 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8a1c });
  mat.userData.glow = true;
  for (const x of [-1.5, 1.5]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x / 16, 8.5 / 16, -3.05 / 16);
    head.add(m);
  }
  return {
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

function creakingModel(): MobModel {
  const r = rig(skinOf("creaking", 64, 64, paintCreaking), PARTS);
  const eyes = addEyes(r.p.head);
  // A watched creaking holds whatever pose it was caught in, so the last unfrozen limb state is replayed.
  let held = { walk: 0, phase: 0, yaw: 0, pitch: 0, age: 0 };
  const m = wrap(r, (a) => {
    if (a.e.data.frozen) Object.assign(a, held);
    else held = { walk: a.walk, phase: a.phase, yaw: a.yaw, pitch: a.pitch, age: a.age };
    headLook(r.p.head, a);
    const s = Math.cos(a.phase * 0.6662);
    setRot(r.p.right_leg, s * 1.2 * a.walk, 0, 0);
    setRot(r.p.left_leg, -s * 1.2 * a.walk, 0, 0);
    const at = attackTime(a.e, a.pt);
    const lift = at > 0 ? -Math.sin(at * Math.PI) * 1.6 : 0;
    const sway = Math.sin(a.age * 0.05) * 0.04;
    setRot(r.p.right_arm, -s * 0.8 * a.walk + lift, 0, 0.08 + sway);
    setRot(r.p.left_arm, s * 0.8 * a.walk + lift, 0, -0.08 - sway);
    setRot(r.p.body, 0.04 * a.walk, 0, 0);
  });
  const base = m.dispose;
  m.dispose = () => {
    base();
    eyes.dispose();
  };
  return m;
}

const look = new THREE.Vector3();
const to = new THREE.Vector3();

// Vanilla isLookingAtMe(tolerance 0.5): a 60 degree half-angle cone to the eye, mid-body or feet, with line of sight.
function watched(e: Entity, ctx: GameCtx): boolean {
  if (!playerTargetable(ctx) || ctx.inventory.slots[36]?.item === "carved_pumpkin") return false;
  const eye = ctx.player.eye();
  const b = e.body;
  if ((b.pos.x - eye.x) ** 2 + (b.pos.z - eye.z) ** 2 > 32 * 32) return false;
  look.copy(ctx.player.lookDir()).normalize();
  for (const y of [b.pos.y + 2.3, b.pos.y + 0.5, b.pos.y + 1.4]) {
    to.set(b.pos.x - eye.x, y - eye.y, b.pos.z - eye.z);
    const d = to.length();
    if (d < 1e-3) return true;
    if (look.dot(to) / d > 0.5 && canSee(ctx, e, eye.x, eye.y, eye.z)) return true;
  }
  return false;
}

function tick(e: Entity, ctx: GameCtx): void {
  if (!linkHolds(ctx, e)) {
    crumble(ctx, e);
    return;
  }
  if (num(e, "_blockCd") > 0) e.data._blockCd = num(e, "_blockCd") - 1;
  const hurt = hurtAmount(e);
  const frozen = watched(e, ctx);
  if (frozen !== !!e.data.frozen) {
    e.data.frozen = frozen;
    sound(ctx, e, frozen ? "entity.creaking.freeze" : "entity.creaking.unfreeze");
    if (frozen) clearPath(e);
  }
  const t = updateTarget(e, ctx, { range: 32 }, hurt);
  if (frozen) {
    e.body.vel.x = 0;
    e.body.vel.z = 0;
  } else if (t !== undefined) {
    chase(e, ctx, t, SPEED);
    if (meleeAttack(e, ctx, 3)) sound(ctx, e, "entity.creaking.attack");
  } else {
    idle(e, ctx, SPEED);
    idleLook(e, ctx);
  }
  applyPhysics(e, ctx);
  if (num(e, "_swing") > 0) e.data._swing = num(e, "_swing") - 1;
}

// Vanilla Creaking.hurtServer: a heart-bound creaking never loses health; a player's hit makes the heart bleed resin.
function blockHurt(e: Entity, ctx: GameCtx, _amount: number, source: DamageSource, attacker?: Entity | "player"): boolean {
  const h = e.data.heart as HeartPos | undefined;
  if (!h || source === "void") return false;
  if (!attacker || num(e, "_blockCd") > 0) return true;
  e.data._blockCd = 8;
  const p = e.body.pos;
  if (hasBlock("pale_oak_wood")) ctx.emit({ type: "particles", kind: "block", x: p.x, y: p.y + 1.3, z: p.z, count: 10, state: blockId("pale_oak_wood") });
  sound(ctx, e, "entity.creaking.sway");
  if (attacker === "player") heartHurt(ctx, h, e);
  return true;
}

export const CREAKING_DEF: MobDef = {
  type: "creaking",
  displayName: "Creaking",
  category: "hostile",
  width: 0.9,
  height: 2.7,
  maxHealth: 1,
  speed: SPEED,
  attackDamage: 3,
  xp: [5, 5],
  drops: [],
  sounds: { ambient: "entity.creaking.ambient", hurt: "entity.creaking.hurt", death: "entity.creaking.death", step: "entity.creaking.step" },
  createModel: creakingModel,
  tick,
  blockHurt,
};
