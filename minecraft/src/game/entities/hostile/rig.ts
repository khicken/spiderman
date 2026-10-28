import type * as THREE from "three";
import type { Entity, MobModel } from "../../contracts";
import { boxModel, type BoxModel, type PartSpec } from "../model";
import type { Pix } from "./pix";
import { ridingPose } from "../ride-pose";

// A part in vanilla model space: y points down and the feet sit at y = 24.
export interface VPart {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  box: [number, number, number, number, number, number];
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
  rot?: [number, number, number];
  extra?: { box: [number, number, number, number, number, number]; uv: [number, number]; inflate?: number; mirror?: boolean }[];
}

// Vanilla model space is world space turned 180 degrees about z, so x and y flip.
export function toSpecs(parts: VPart[], base = 24): PartSpec[] {
  const out: PartSpec[] = [];
  const flip = (b: VPart["box"]): PartSpec["box"] => [-(b[0] + b[3]), -(b[1] + b[4]), b[2], b[3], b[4], b[5]];
  for (const p of parts) {
    const py = p.parent ? -p.pivot[1] : base - p.pivot[1];
    out.push({ name: p.name, parent: p.parent, pivot: [-p.pivot[0], py, p.pivot[2]], box: flip(p.box), uv: p.uv, inflate: p.inflate, mirror: p.mirror });
    p.extra?.forEach((x, i) =>
      out.push({ name: `${p.name}$${i}`, parent: p.name, pivot: [0, 0, 0], box: flip(x.box), uv: x.uv, inflate: x.inflate, mirror: x.mirror }),
    );
  }
  return out;
}

export interface Rig {
  m: BoxModel;
  p: Record<string, THREE.Object3D>;
  rest: Record<string, [number, number, number]>;
}

export function rig(skin: Pix, parts: VPart[], base = 24): Rig {
  const m = boxModel(skin.toCanvas(), toSpecs(parts, base));
  const rest: Rig["rest"] = {};
  for (const part of parts) {
    const o = m.parts[part.name];
    o.rotation.order = "ZYX";
    rest[part.name] = part.rot ?? [0, 0, 0];
    setRot(o, ...rest[part.name]);
  }
  return { m, p: m.parts, rest };
}

// Takes vanilla angles (radians) and writes them in three.js space.
export function setRot(o: THREE.Object3D, x: number, y: number, z: number): void {
  o.rotation.set(-x, -y, z, "ZYX");
}

export function resetPose(r: Rig): void {
  for (const k in r.rest) setRot(r.p[k], ...r.rest[k]);
}

export function setPivot(o: THREE.Object3D, base: [number, number, number], dx: number, dy: number, dz: number, root = true, yBase = 24): void {
  o.position.set(-(base[0] + dx) / 16, ((root ? yBase : 0) - (base[1] + dy)) / 16, (base[2] + dz) / 16);
}

export interface AnimArgs {
  e: Entity;
  pt: number;
  walk: number;
  phase: number;
  age: number;
  yaw: number; // head yaw relative to body, radians
  pitch: number;
}

const DEG = Math.PI / 180;
export { DEG };

export function headLook(o: THREE.Object3D, a: AnimArgs, extraX = 0): void {
  setRot(o, a.pitch + extraX, a.yaw, 0);
}

export function humanoidLimbs(r: Rig, a: AnimArgs, arms = true): void {
  const { walk, phase } = a;
  if (arms) {
    if (r.p.right_arm) setRot(r.p.right_arm, Math.cos(phase * 0.6662 + Math.PI) * walk, 0, 0);
    if (r.p.left_arm) setRot(r.p.left_arm, Math.cos(phase * 0.6662) * walk, 0, 0);
  }
  if (r.p.right_leg) setRot(r.p.right_leg, Math.cos(phase * 0.6662) * 1.4 * walk, 0, 0);
  if (r.p.left_leg) setRot(r.p.left_leg, Math.cos(phase * 0.6662 + Math.PI) * 1.4 * walk, 0, 0);
}

export function bobArms(r: Rig, age: number): void {
  const ra = r.p.right_arm.rotation;
  const la = r.p.left_arm.rotation;
  ra.z += Math.cos(age * 0.09) * 0.05 + 0.05;
  la.z -= Math.cos(age * 0.09) * 0.05 + 0.05;
  ra.x -= Math.sin(age * 0.067) * 0.05;
  la.x += Math.sin(age * 0.067) * 0.05;
}

export function zombieArms(r: Rig, a: AnimArgs, aggressive: boolean): void {
  const at = attackTime(a.e, a.pt);
  const f = Math.sin(at * Math.PI);
  const f1 = Math.sin((1 - (1 - at) * (1 - at)) * Math.PI);
  const x = -Math.PI / (aggressive ? 1.5 : 2.25) + f * 1.2 - f1 * 0.4;
  setRot(r.p.right_arm, x, -(0.1 - f * 0.6), 0);
  setRot(r.p.left_arm, x, 0.1 - f * 0.6, 0);
  bobArms(r, a.age);
}

export function attackTime(e: Entity, pt: number): number {
  const s = (e.data._swing as number) ?? 0;
  return s > 0 ? Math.min(1, (10 - s + pt) / 10) : 0;
}

export function wrap(r: Rig, anim: (a: AnimArgs) => void, opts: { scale?: number; glow?: boolean } = {}): MobModel {
  const a: AnimArgs = { e: null as unknown as Entity, pt: 0, walk: 0, phase: 0, age: 0, yaw: 0, pitch: 0 };
  if (opts.glow) r.m.material.userData.glow = true;
  if (opts.scale) r.m.root.scale.setScalar(opts.scale);
  return {
    root: r.m.root,
    animate(e, pt, walk, phase) {
      a.e = e;
      a.pt = pt;
      a.walk = walk;
      a.phase = phase;
      a.age = e.age + pt;
      let dy = e.headYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw = dy;
      a.pitch = e.pitch;
      resetPose(r);
      anim(a);
      if (typeof e.data.mount === "number") ridingPose(r.p);
    },
    dispose() {
      r.m.dispose();
    },
  };
}
