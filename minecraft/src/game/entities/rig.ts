import * as THREE from "three";
import type { Entity, MobModel } from "../contracts";
import { boxModel, type BoxModel, type PartSpec } from "./model";
import type { Pix } from "./skin";

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
}

// Vanilla model space is world space turned 180 degrees about z, so x and y flip.
export function toSpecs(parts: VPart[], base = 24): PartSpec[] {
  return parts.map((p) => ({
    name: p.name,
    parent: p.parent,
    pivot: [-p.pivot[0], p.parent ? -p.pivot[1] : base - p.pivot[1], p.pivot[2]] as [number, number, number],
    box: [-(p.box[0] + p.box[3]), -(p.box[1] + p.box[4]), p.box[2], p.box[3], p.box[4], p.box[5]] as PartSpec["box"],
    uv: p.uv,
    inflate: p.inflate,
    mirror: p.mirror,
  }));
}

export function setRot(o: THREE.Object3D, x: number, y: number, z: number) {
  o.rotation.set(-x, -y, z, "ZYX");
}

export interface Rig {
  models: BoxModel[];
  root: THREE.Group;
  p: Record<string, THREE.Object3D>;
  rest: Record<string, [number, number, number]>;
}

export function rig(skin: Pix, parts: VPart[], base = 24): Rig {
  const m = boxModel(skin.toCanvas(), toSpecs(parts, base));
  const r: Rig = { models: [m], root: m.root, p: {}, rest: {} };
  addParts(r, m, parts);
  return r;
}

// A second skin layer (sheep wool, mooshroom) whose parts follow the base parts with the same names.
export function overlay(r: Rig, skin: Pix, parts: VPart[], base = 24): BoxModel {
  const m = boxModel(skin.toCanvas(), toSpecs(parts, base));
  r.root.add(m.root);
  r.models.push(m);
  for (const part of parts) {
    const o = m.parts[part.name];
    o.rotation.order = "ZYX";
    r.p[`${part.name}#2`] = o;
    r.rest[`${part.name}#2`] = part.rot ?? [0, 0, 0];
  }
  return m;
}

function addParts(r: Rig, m: BoxModel, parts: VPart[]) {
  for (const part of parts) {
    const o = m.parts[part.name];
    o.rotation.order = "ZYX";
    r.p[part.name] = o;
    r.rest[part.name] = part.rot ?? [0, 0, 0];
    setRot(o, ...r.rest[part.name]);
  }
}

export function resetPose(r: Rig) {
  for (const k in r.rest) setRot(r.p[k], ...r.rest[k]);
}

export interface Pose {
  e: Entity;
  pt: number;
  walk: number;
  phase: number;
  age: number;
  yaw: number; // head yaw relative to the body
  pitch: number;
  baby: boolean;
}

// Copies a base part's rotation onto its overlay twin.
export function syncOverlay(r: Rig) {
  for (const k in r.p) {
    if (!k.endsWith("#2")) continue;
    const src = r.p[k.slice(0, -2)];
    if (src) r.p[k].rotation.copy(src.rotation);
  }
}

export function quadLegs(r: Rig, a: Pose, amp = 1.4) {
  const s = Math.cos(a.phase * 0.6662) * amp * a.walk;
  if (r.p.right_hind_leg) setRot(r.p.right_hind_leg, s, 0, 0);
  if (r.p.left_hind_leg) setRot(r.p.left_hind_leg, -s, 0, 0);
  if (r.p.right_front_leg) setRot(r.p.right_front_leg, -s, 0, 0);
  if (r.p.left_front_leg) setRot(r.p.left_front_leg, s, 0, 0);
}

export function look(o: THREE.Object3D | undefined, a: Pose, extraX = 0) {
  if (o) setRot(o, a.pitch + extraX, a.yaw, 0);
}

const shared = new Map<string, THREE.Texture>();

export function skinTexture(key: string, paint: () => Pix) {
  let t = shared.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(paint().toCanvas() as HTMLCanvasElement);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    shared.set(key, t);
  }
  return t;
}

export function retexture(m: THREE.MeshLambertMaterial, tex: THREE.Texture) {
  if (m.map === tex) return;
  m.map = tex;
  if (m.emissiveMap) m.emissiveMap = tex;
}

export interface WrapOpts {
  scale?: number;
  babyHead?: number;
  head?: string[];
  variant?: (e: Entity) => string;
  variantSkin?: (key: string) => Pix;
}

export function wrap(r: Rig, anim: (a: Pose) => void, opts: WrapOpts = {}): MobModel {
  let current = "";
  const a: Pose = { e: null as unknown as Entity, pt: 0, walk: 0, phase: 0, age: 0, yaw: 0, pitch: 0, baby: false };
  const holder = new THREE.Group();
  holder.add(r.root);
  if (opts.scale) r.root.scale.setScalar(opts.scale);
  const heads = (opts.head ?? ["head"]).map((n) => r.p[n]).filter(Boolean);
  const headPos = heads.map((h) => h.position.clone());
  return {
    root: holder,
    animate(e, pt, walk, phase) {
      a.e = e;
      a.pt = pt;
      a.walk = walk;
      a.phase = phase;
      a.age = e.age + pt;
      let dy = e.headYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw = Math.max(-1.3, Math.min(1.3, dy));
      a.pitch = e.pitch;
      a.baby = ((e.data.grow as number) ?? 0) < 0;
      if (opts.variant && opts.variantSkin) {
        const k = opts.variant(e);
        if (k !== current) {
          current = k;
          const paint = opts.variantSkin;
          retexture(r.models[0].material, skinTexture(k, () => paint(k)));
        }
      }
      resetPose(r);
      for (let i = 0; i < heads.length; i++) heads[i].position.copy(headPos[i]);
      anim(a);
      syncOverlay(r);
      const hs = a.baby ? opts.babyHead ?? 1.5 : 1;
      for (let i = 0; i < heads.length; i++) {
        heads[i].scale.setScalar(hs);
        if (a.baby) heads[i].position.y += 1 / 16;
      }
    },
    dispose() {
      for (const m of r.models) m.dispose();
    },
  };
}

export function swingTime(e: Entity, pt: number, len = 6) {
  const s = (e.data.swing as number) ?? 0;
  return s > 0 ? Math.min(1, (len - s + pt) / len) : 0;
}
