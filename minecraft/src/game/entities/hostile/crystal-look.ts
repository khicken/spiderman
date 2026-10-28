import * as THREE from "three";
import type { MobModel } from "../../contracts";
import { boxModel } from "../model";
import { skinOf } from "./looks-undead";
import type { Pix } from "./pix";

// Vanilla end_crystal.png layout (64x32): glass cube at (0,0), core cube at (32,0), base slab at (0,16).
function paintCrystal(p: Pix): void {
  const glass = p.cuboid(0, 0, 8, 8, 8);
  for (const r of [glass.top, glass.bottom, glass.right, glass.front, glass.left, glass.back]) {
    for (let y = 0; y < r[3]; y++)
      for (let x = 0; x < r[2]; x++) {
        const edge = x === 0 || y === 0 || x === r[2] - 1 || y === r[3] - 1;
        if (edge) p.px(r[0] + x, r[1] + y, p.rand() < 0.3 ? 0xffffff : 0xd8d0f0);
      }
    p.px(r[0] + 2, r[1] + 2, 0xf4f0ff);
    p.px(r[0] + 3, r[1] + 2, 0xe8e0ff);
    p.px(r[0] + 2, r[1] + 3, 0xe8e0ff);
  }
  const core = p.fillCuboid(32, 0, 8, 8, 8, [0xe04ab8, 0xc83aa4, 0xf060c8, 0xa82a8c]);
  for (const r of [core.top, core.bottom, core.right, core.front, core.left, core.back]) {
    p.px(r[0] + 2, r[1] + 3, 0xffa0e8);
    p.px(r[0] + 5, r[1] + 5, 0xffa0e8);
    p.rect([r[0] + 3, r[1] + 3, 2, 2], 0x7a1a68);
  }
  const base = p.fillCuboid(0, 16, 12, 4, 12, [0x3a3a3a, 0x2e2e2e, 0x464646, 0x242424]);
  p.noise(base.top, [0x4a4a4a, 0x3c3c3c, 0x565656]);
}

export function crystalModel(): MobModel {
  const m = boxModel(skinOf("end_crystal", 64, 32, paintCrystal).toCanvas(), [
    { name: "base", pivot: [0, 0, 0], box: [-6, 0, -6, 12, 4, 12], uv: [0, 16] },
    { name: "outer", pivot: [0, 0, 0], box: [-4, -4, -4, 8, 8, 8], uv: [0, 0] },
    { name: "inner", pivot: [0, 0, 0], box: [-4, -4, -4, 8, 8, 8], uv: [0, 0] },
    { name: "heart", pivot: [0, 0, 0], box: [-4, -4, -4, 8, 8, 8], uv: [32, 0] },
  ]);
  m.material.userData.glow = true;
  const { base, outer, inner, heart } = m.parts;
  // Vanilla renders the model at 2x, nesting each inner layer at 0.875 of the previous one.
  base.scale.setScalar(2);
  outer.scale.setScalar(2);
  inner.scale.setScalar(1.75);
  heart.scale.setScalar(1.53125);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xd8a0ff, transparent: true, opacity: 0.8 });
  beamMat.userData.glow = true;
  const beam = new THREE.Mesh(geo, beamMat);
  m.root.add(beam);
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const parts = [outer, inner, heart];
  return {
    root: m.root,
    animate(e, pt) {
      const age = e.age + pt;
      const bob = Math.sin(age * 0.2) / 2 + 0.5;
      const y = 1.2 + (bob * bob + bob) * 0.4;
      for (const o of parts) o.position.y = y;
      outer.rotation.set(age * 0.05, age * 0.06, 0);
      inner.rotation.set(-age * 0.07, age * 0.04, age * 0.05);
      heart.rotation.set(age * 0.03, -age * 0.08, 0);
      base.visible = e.data.showBottom !== false;
      const bp = e.data.beam as number[] | undefined;
      beam.visible = !!bp;
      if (bp) {
        world.set(bp[0], bp[1], bp[2]);
        m.root.updateMatrixWorld();
        local.copy(world);
        m.root.worldToLocal(local);
        local.y -= y;
        beam.position.set(local.x * 0.5, y + local.y * 0.5, local.z * 0.5);
        beam.scale.set(0.1, 0.1, local.length());
        beam.lookAt(world);
      }
    },
    dispose() {
      m.dispose();
      geo.dispose();
      beamMat.dispose();
    },
  };
}
