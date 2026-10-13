import * as THREE from "three";
import type { Entity, GameCtx, ItemStack, MobDef, MobModel } from "../../contracts";
import { itemDef } from "../../items/registry";
import { paintBlockTexture } from "../../textures/index";
import { pixelTexture } from "../../entities/block-cube";
import { createArmorLayer, type ArmorSlot, type Equipment } from "../../entities/armor-layer";

const PX = 1 / 16;
const SLOTS: ArmorSlot[] = ["head", "chest", "legs", "feet"];
let woodTex: THREE.Texture | null = null;
let stoneTex: THREE.Texture | null = null;

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * PX, h * PX, d * PX), mat);
  m.position.set(x * PX, y * PX, z * PX);
  return m;
}

// Joint at a pivot (px, y up from the feet) with an invisible first child at the biped part center, so armor fits like on a player.
function joint(root: THREE.Object3D, px: number, py: number, cx: number, cy: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(px * PX, py * PX, 0);
  const anchor = new THREE.Mesh();
  anchor.visible = false;
  anchor.position.set(cx * PX, cy * PX, 0);
  g.add(anchor);
  root.add(g);
  return g;
}

// Vanilla ArmorStandModel sticks: base plate, two legs, hip bar, side sticks, shoulder bar and head stick.
function standModel(): MobModel {
  if (!woodTex) woodTex = pixelTexture(paintBlockTexture("oak_planks"));
  if (!stoneTex) stoneTex = pixelTexture(paintBlockTexture("smooth_stone"));
  const wood = new THREE.MeshLambertMaterial({ map: woodTex });
  const stone = new THREE.MeshLambertMaterial({ map: stoneTex });
  wood.userData.base = new THREE.Color(1, 1, 1);
  stone.userData.base = new THREE.Color(1, 1, 1);
  const root = new THREE.Group();
  root.add(box(stone, 12, 1, 12, 0, 0.5, 0));
  const head = joint(root, 0, 24, 0, 4);
  head.add(box(wood, 2, 7, 2, 0, 3.5, 0));
  const body = joint(root, 0, 24, 0, -6);
  body.add(box(wood, 12, 3, 3, 0, -1.5, 0), box(wood, 2, 7, 2, -2, -6.5, 0), box(wood, 2, 7, 2, 2, -6.5, 0), box(wood, 8, 2, 2, 0, -11, 0));
  const parts: Record<string, THREE.Object3D> = { head, body };
  parts.right_arm = joint(root, -5, 22, -1, -4);
  parts.left_arm = joint(root, 5, 22, 1, -4);
  for (const [name, x] of [["right_leg", -1.9], ["left_leg", 1.9]] as const) {
    const leg = joint(root, x, 12, 0, -6);
    leg.add(box(wood, 2, 11, 2, 0, -5.5, 0));
    parts[name] = leg;
  }
  const armor = createArmorLayer(parts, false);
  return {
    root,
    animate(e) {
      armor.set((e.data.equipment as Equipment | undefined) ?? {});
      const hurt = e.age - Number(e.data._hitAt ?? -99) < 5;
      root.rotation.y = hurt ? Math.sin((e.age - Number(e.data._hitAt)) * 2) * 0.1 : 0;
    },
    dispose() {
      armor.dispose();
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      wood.dispose();
      stone.dispose();
    },
  };
}

function slotFor(item: string): ArmorSlot | null {
  const a = itemDef(item)?.armor;
  if (a) return a.slot;
  if (item === "carved_pumpkin" || item.endsWith("_head") || item.endsWith("_skull")) return "head";
  return null;
}

function sound(ctx: GameCtx, e: Entity, name: string) {
  ctx.emit({ type: "sound", name, x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z });
}

function hitSlot(ctx: GameCtx, e: Entity): ArmorSlot {
  const y = (ctx.player.targetEntity?.point.y ?? e.body.pos.y + 1) - e.body.pos.y;
  return y >= 1.6 ? "head" : y >= 0.9 ? "chest" : y >= 0.4 ? "legs" : "feet";
}

export const ARMOR_STAND: MobDef = {
  type: "armor_stand",
  displayName: "Armor Stand",
  category: "misc",
  width: 0.5,
  height: 1.975,
  maxHealth: 20,
  speed: 0,
  createModel: standModel,
  tick(e, ctx) {
    e.data.persistent = true;
    e.body.vel.x = 0;
    e.body.vel.z = 0;
    const last = Number(e.data._hp ?? e.maxHealth);
    if (e.health < last) {
      if (e.age - Number(e.data._hitAt ?? -99) <= 5) {
        ctx.entities.damage(e.id, e.maxHealth, "generic");
        return;
      }
      e.data._hitAt = e.age;
      e.health = e.maxHealth;
      sound(ctx, e, "entity.armor_stand.hit");
    }
    e.data._hp = e.health;
  },
  onDeath(e, ctx) {
    e.data._remove = true;
    sound(ctx, e, "entity.armor_stand.break");
    const p = e.body.pos;
    if (ctx.player.gameMode !== "creative") ctx.entities.dropItem({ item: "armor_stand", count: 1 }, p.x, p.y + 0.5, p.z);
    const eq = (e.data.equipment as Equipment | undefined) ?? {};
    for (const s of SLOTS) if (eq[s]) ctx.entities.dropItem(eq[s]!, p.x, p.y + 0.8, p.z);
  },
  onInteract(e, ctx, held) {
    const eq: Equipment = { ...((e.data.equipment as Equipment | undefined) ?? {}) };
    const slot = held ? slotFor(held.item) : hitSlot(ctx, e);
    if (!slot) return false;
    const cur = eq[slot] ?? null;
    if (!held && !cur) return false;
    const creative = ctx.player.gameMode === "creative";
    if (held) {
      eq[slot] = { ...held, count: 1 } as ItemStack;
      if (!creative) {
        ctx.inventory.removeHeld(1);
        if (cur) {
          const rest = ctx.inventory.add(cur);
          if (rest) ctx.entities.dropItem(rest, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
        }
      }
    } else {
      eq[slot] = null;
      const rest = ctx.inventory.add(cur!);
      if (rest) ctx.entities.dropItem(rest, e.body.pos.x, e.body.pos.y + 1, e.body.pos.z);
    }
    e.data.equipment = eq;
    sound(ctx, e, "item.armor.equip_generic");
    return true;
  },
};
