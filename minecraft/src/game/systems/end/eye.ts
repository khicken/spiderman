import * as THREE from "three";
import type { Entity, GameCtx, MobDef, MobModel } from "../../contracts";
import { itemSprite } from "../../textures/icons";
import { strongholds } from "../../worldgen/structure-grid";

function nearestStronghold(ctx: GameCtx, x: number, z: number): { x: number; y: number; z: number } | null {
  if (ctx.world.dim !== "overworld") return null;
  let best: { x: number; y: number; z: number } | null = null;
  let bd = Infinity;
  for (const s of strongholds(ctx.world.seed)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// Vanilla EyeOfEnder.signalTo and tick: 12 blocks toward the stronghold and 8 up, 80 ticks, 80% drop back as an item.
function eyeTick(e: Entity, ctx: GameCtx): void {
  e.data._pa = e.age;
  e.data.noGravity = true;
  e.data.invulnerable = true;
  const b = e.body;
  if (e.data.tx === undefined) {
    const s = nearestStronghold(ctx, b.pos.x, b.pos.z);
    if (!s) {
      ctx.entities.dropItem({ item: "ender_eye", count: 1 }, b.pos.x, b.pos.y, b.pos.z);
      e.data._remove = true;
      return;
    }
    const dx = s.x - b.pos.x, dz = s.z - b.pos.z, d = Math.hypot(dx, dz);
    if (d > 12) {
      e.data.tx = b.pos.x + (dx / d) * 12;
      e.data.tz = b.pos.z + (dz / d) * 12;
      e.data.ty = b.pos.y + 8;
    } else {
      e.data.tx = s.x;
      e.data.tz = s.z;
      e.data.ty = s.y;
    }
    e.data.survive = ctx.random() * 5 >= 1;
    b.vel.set(0, 0, 0);
  }
  const tx = e.data.tx as number, ty = e.data.ty as number, tz = e.data.tz as number;
  const v = b.vel;
  const horiz = Math.hypot(v.x, v.z);
  const dx = tx - b.pos.x, dz = tz - b.pos.z;
  const dist = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  let speed = horiz + (dist - horiz) * 0.0025;
  let vy = v.y;
  if (dist < 1) {
    speed *= 0.8;
    vy *= 0.8;
  }
  const sign = b.pos.y < ty ? 1 : -1;
  vy += (sign - vy) * 0.015;
  v.set(Math.cos(ang) * speed, vy, Math.sin(ang) * speed);
  b.pos.add(v);
  if (e.age % 2 === 0) ctx.emit({ type: "particles", kind: "portal", x: b.pos.x - v.x * 0.25, y: b.pos.y - v.y * 0.25 - 0.5, z: b.pos.z - v.z * 0.25, count: 2 });
  if (e.age >= 80) {
    ctx.emit({ type: "sound", name: "entity.ender_eye.death", x: b.pos.x, y: b.pos.y, z: b.pos.z, volume: 1 });
    if (e.data.survive) ctx.entities.dropItem({ item: "ender_eye", count: 1 }, b.pos.x, b.pos.y, b.pos.z);
    else ctx.emit({ type: "particles", kind: "portal", x: b.pos.x, y: b.pos.y, z: b.pos.z, count: 20, color: 0x30a080 });
    e.data._remove = true;
  }
}

function eyeModel(): MobModel {
  const root = new THREE.Group();
  const tex = typeof document === "undefined" ? null : new THREE.CanvasTexture(itemSprite("ender_eye"));
  if (tex) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
  }
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 });
  mat.userData.glow = true;
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(0.5);
  sprite.position.y = 0.125;
  root.add(sprite);
  return {
    root,
    animate() {},
    dispose() {
      mat.dispose();
      tex?.dispose();
    },
  };
}

export const EYE_OF_ENDER: MobDef = {
  type: "eye_of_ender",
  displayName: "Eye of Ender",
  category: "misc",
  width: 0.25,
  height: 0.25,
  maxHealth: 1,
  speed: 0,
  createModel: eyeModel,
  tick: eyeTick,
};
