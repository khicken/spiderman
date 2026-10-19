import * as THREE from "three";
import type { GameCtx, ItemStack } from "../contracts";
import { createArmorLayer, glintMaterial } from "../entities/armor-layer";
import { createHeldSlot } from "./hand";
import type { ItemMeshes } from "./item-mesh";
import type { PlayerModel } from "./model";
import type { PlayerState } from "./state";

const PX = 1 / 16;
const D = Math.PI / 180;

function elytraTexture(): THREE.DataTexture {
  const w = 64, h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4;
      const rib = x % 4 === 0 || y % 6 === 0;
      const n = ((x * 7 + y * 13) % 5) * 4;
      const c = rib ? 0x5a5a6e : 0x8e8ea6;
      data[i] = ((c >> 16) & 255) - n;
      data[i + 1] = ((c >> 8) & 255) - n;
      data[i + 2] = (c & 255) - n;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function createWings(body: THREE.Object3D) {
  const tex = elytraTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const glint = glintMaterial(tex);
  const geo = new THREE.BoxGeometry(12 * PX, 22 * PX, 4 * PX);
  geo.translate(-5 * PX, -10 * PX, 1 * PX);
  geo.clearGroups();
  geo.addGroup(0, Infinity, 0);
  geo.addGroup(0, Infinity, 1);
  const left = new THREE.Group();
  const right = new THREE.Group();
  const lm = new THREE.Mesh(geo, [mat, glint]);
  const rm = new THREE.Mesh(geo, [mat, glint]);
  rm.scale.x = -1;
  left.add(lm);
  right.add(rm);
  left.rotation.order = right.rotation.order = "ZYX";
  const root = new THREE.Group();
  root.add(left, right);
  root.position.set(0, 0, 2 * PX);
  body.add(root);
  let rx = 0.2617994, rz = -0.2617994, ry = 0, py = 0;
  return {
    root,
    mat,
    update(p: PlayerState, enchanted: boolean) {
      let fx = 0.2617994, fz = -0.2617994, fy = 0, oy = 0;
      if (p.fallFlying) {
        let k = 1;
        const v = p.body.vel;
        if (v.y < 0) k = 1 - Math.pow(-v.y / Math.max(1e-6, v.length()), 1.5);
        fx = k * 0.34906584 + (1 - k) * fx;
        fz = k * (-Math.PI / 2) + (1 - k) * fz;
      } else if (p.pose === "crouching") {
        fx = 0.6981317;
        fz = -Math.PI / 4;
        oy = 3;
        fy = 0.08726646;
      }
      rx += (fx - rx) * 0.3;
      rz += (fz - rz) * 0.3;
      ry += (fy - ry) * 0.3;
      py += (oy - py) * 0.3;
      left.position.set(-5 * PX, -py * PX, 0);
      right.position.set(5 * PX, -py * PX, 0);
      left.rotation.set(-rx, ry, -rz);
      right.rotation.set(-rx, -ry, rz);
      glint.visible = enchanted;
    },
    dispose() {
      root.removeFromParent();
      geo.dispose();
      mat.dispose();
      glint.dispose();
      tex.dispose();
    },
  };
}

export interface PlayerExtras {
  update(p: PlayerState, ctx: GameCtx, pt: number, light: number, hurt: boolean): void;
  dispose(): void;
}

const enchanted = (s: ItemStack | null | undefined) => !!s?.ench && Object.keys(s.ench).length > 0;

export function createPlayerExtras(model: PlayerModel, items: ItemMeshes): PlayerExtras {
  const P = model.model.parts;
  const armor = createArmorLayer(P, true);
  const wings = createWings(P.body);
  const off = createHeldSlot(items, -1);
  let glideTilt = 0;
  const root = model.model.root;

  return {
    update(p, ctx, pt, light, hurt) {
      const inv = ctx.inventory.slots;
      armor.set({ head: inv[36], chest: inv[37]?.item === "elytra" ? null : inv[37], legs: inv[38], feet: inv[39] });
      armor.setLight(light, hurt);
      const elytra = inv[37]?.item === "elytra";
      wings.root.visible = elytra;
      if (elytra) {
        wings.update(p, enchanted(inv[37]));
        wings.mat.color.setScalar(light);
      }
      off.set(P.left_arm, inv[40] ?? null, p.using?.hand === "off" ? p.using : null, p.using ? p.using.ticks + pt : 0);
      const u = p.using;
      const mainShield = u?.kind === "shield" && u.hand === "main";
      const offShield = u?.kind === "shield" && u.hand === "off";
      if (p.blocking && mainShield) P.right_arm.rotation.set(0.9424779 + p.pitch * 0.5, Math.PI / 6, 0);
      if (p.blocking && offShield) P.left_arm.rotation.set(0.9424779 + p.pitch * 0.5, -Math.PI / 6, 0);
      if (u?.kind === "trident") P[u.hand === "main" ? "right_arm" : "left_arm"].rotation.set(Math.PI + p.pitch * 0.5, 0, 0);
      if (u?.kind === "spyglass") P[u.hand === "main" ? "right_arm" : "left_arm"].rotation.set(1.9198622 + p.pitch, u.hand === "main" ? -0.26 : 0.26, 0);
      const held = ctx.inventory.held();
      if (!u && held?.item === "crossbow" && held.data?.charged) {
        P.right_arm.rotation.set(Math.PI / 2 + p.pitch, -0.3, 0);
        P.left_arm.rotation.set(Math.PI / 2 + p.pitch - 0.2, 0.6, 0);
      }
      let tilt = 0;
      if (p.fallFlying) {
        for (const n of ["right_leg", "left_leg", "right_arm", "left_arm"]) P[n].rotation.x *= 0.1;
        const k = Math.min(1, ((p.fallFlyTicks + pt) ** 2) / 100);
        tilt = k * (Math.PI / 2 - p.pitch);
      } else if (p.pose === "swimming" || p.pose === "spin_attack") {
        tilt = p.body.inWater ? Math.PI / 2 - p.pitch : Math.PI / 2;
        if (!p.body.inWater) {
          P.head.rotation.x = Math.max(-0.2, Math.min(1.2, p.pitch + 0.8));
        }
      }
      glideTilt += (tilt - glideTilt) * 0.5;
      root.rotation.order = "YXZ";
      root.rotation.x = glideTilt;
      root.rotation.z = 0;
      if (Math.abs(glideTilt) > 0.01) {
        root.position.y += 0.3 * Math.sin(Math.min(Math.PI / 2, glideTilt));
        P.head.rotation.x += glideTilt * 0.8;
      }
      if (p.pose === "spin_attack") root.rotateY(((p.ticks + pt) * -72 * D) % (Math.PI * 2));
      const invis = p.hasEffect("invisibility") > 0;
      model.material.transparent = invis;
      model.material.opacity = invis ? 0.15 : 1;
      model.material.depthWrite = !invis;
    },
    dispose() {
      armor.dispose();
      wings.dispose();
      off.dispose();
    },
  };
}
