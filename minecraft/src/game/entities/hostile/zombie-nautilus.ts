import type { Entity, GameCtx, MobDef } from "../../contracts";
import { clearPath, lookAt, meleeAttack, yawTo } from "../ai";
import { hasRoom, mobPassengers, mountPlayer, openMount, rider } from "../riding";
import { useItem } from "../passive/common";
import { swim } from "../passive/water";
import {
  armorInteract, syncNautilusArmor, dashCooldown, dashForward, dropArmor, nautilusModel, NAUTILUS_SEAT, registerNautilusMount, rideNautilus, swimToward,
  type NautilusPalette,
} from "../passive/nautilus";
import { hurtAmount, naturalSpawn, num, sound, targetInfo, updateTarget } from "./brain";
import { OCEANS } from "./spawns";

const ZOMBIE_NAUTILUS_COLORS: NautilusPalette = {
  shell: [0x9aa77e, 0x8f9c74, 0xa4b088],
  stripe: [0x4f6b44, 0x46603c, 0x58744c],
  rim: 0x2e3a26,
  inner: 0x1e241a,
  flesh: [0x5d7f5a, 0x527350, 0x668a62],
  spot: 0x8fae84,
  tentacle: [0x6f8f62, 0x648558, 0x7a9a6c],
  eye: 0x0e1a16,
  eyeGlint: 0x7ef2e0,
  rot: { hole: 0x23281e, bone: 0xcfd3b0, moss: [0x3d5236, 0x45603c, 0x36482f] },
};

// Vanilla coral zombie nautilus: the warm ocean look, overgrown with brain, tube, fire and horn coral.
const CORAL_COLORS: NautilusPalette = {
  shell: [0xc9b2a4, 0xbfa697, 0xd3bcae],
  stripe: [0x8a4a6a, 0x7c4160, 0x985476],
  rim: 0x4a2238,
  inner: 0x24141c,
  flesh: [0x7a8a6a, 0x6e7e60, 0x869676],
  spot: 0xe86ca8,
  tentacle: [0x8a9a78, 0x7e8e6c, 0x96a684],
  eye: 0x101418,
  eyeGlint: 0x7ef2e0,
  rot: { hole: 0x2a1e24, bone: 0xe6dcc4, moss: [0xd65a96, 0x3a5ad6, 0xc8382c, 0xd8c43a] },
};

const ATTACK = 5;
const RAM_CD = 60;
const crew: Entity[] = [];

// Vanilla zombie nautilus jockey: a drowned rider holding a trident.
function spawnRider(e: Entity, ctx: GameCtx) {
  const p = e.body.pos;
  // No natural flag: the drowned's natural-spawn check would discard it if the seat pokes above the water.
  const m = ctx.entities.spawn("drowned", p.x, p.y + NAUTILUS_SEAT, p.z, { mount: e.id, held: "trident" });
  if (m) m.yaw = e.yaw;
}

export const ZOMBIE_NAUTILUS_DEF: MobDef = {
  type: "zombie_nautilus",
  displayName: "Zombie Nautilus",
  category: "hostile",
  width: 0.875,
  height: 0.95,
  maxHealth: 15,
  speed: 0.6,
  attackDamage: ATTACK,
  xp: [5, 5],
  drops: [{ item: "rotten_flesh", count: [0, 1] }],
  sounds: { ambient: "entity.zombie_nautilus.ambient", hurt: "entity.zombie_nautilus.hurt", death: "entity.zombie_nautilus.death" },
  spawn: { dims: ["overworld"], biomes: OCEANS.filter((b) => !b.includes("frozen")), light: "dark", group: [1, 1], weight: 5 },
  seat: NAUTILUS_SEAT,
  createModel: () => nautilusModel("zombie_nautilus", ZOMBIE_NAUTILUS_COLORS, { coral: CORAL_COLORS }),
  tick(e, ctx) {
    const b = e.body;
    e.data.amphibious = true;
    syncNautilusArmor(e);
    if (naturalSpawn(e)) {
      const p = b.pos;
      const biome = (ctx.world.getBiomeAt?.(p.x, p.y, p.z) ?? ctx.world.getBiome(p.x, p.z)).name;
      if (biome === "warm_ocean") e.data.variant = "coral";
      spawnRider(e, ctx);
    }
    const ctl = rider(ctx, e);
    if (ctl) {
      clearPath(e);
      e.data._target = undefined;
      if (e.data.saddle) rideNautilus(e, ctx, ctl, "zombie_nautilus");
      else e.data.noGravity = b.inWater;
      return;
    }
    const cd = dashCooldown(e, ctx, "zombie_nautilus", false);
    e.data.ambientInterval = 120;
    const t = updateTarget(e, ctx, { range: 16 }, hurtAmount(e));
    const i = t !== undefined && b.inWater ? targetInfo(ctx, t) : null;
    if (i) {
      const tx = i.pos.x, ty = i.pos.y + i.height * 0.4, tz = i.pos.z;
      lookAt(e, tx, ty, tz);
      const ram = num(e, "_ram");
      if (ram > 0) {
        e.data._ram = ram - 1;
        meleeAttack(e, ctx, ATTACK, 20, 0.5);
        return;
      }
      const dx = tx - b.pos.x, dy = ty - b.pos.y, dz = tz - b.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (cd === 0 && d2 > 4 && d2 < 64 && ctx.random() < 1 / 10) {
        e.yaw = e.headYaw = yawTo(dx, dz);
        dashForward(e, ctx, Math.atan2(dy, Math.hypot(dx, dz)), 0.8, "zombie_nautilus");
        e.data._ram = 12;
        e.data.dashCd = RAM_CD;
        return;
      }
      swimToward(e, tx, ty, tz, 0.025);
      meleeAttack(e, ctx, ATTACK);
      return;
    }
    swim(e, ctx, b.inWater ? 0.012 : 0, 1 / 60, "entity.zombie_nautilus.flop", false);
  },
  // The saddle drops from kill() in entities/index.ts.
  onDeath(e, ctx) {
    dropArmor(e, ctx);
  },
  onInteract(e, ctx, held) {
    if (mobPassengers(ctx, e, crew).length > 0) {
      crew.length = 0;
      return false;
    }
    if (ctx.player.sneaking && ctx.player.vehicle !== e.id && openMount(ctx, e)) return true;
    if (armorInteract(e, ctx, held, "zombie_nautilus")) {
      e.data.persistent = true;
      return true;
    }
    if (held?.item === "saddle" && !e.data.saddle) {
      e.data.saddle = true;
      e.data.persistent = true;
      useItem(ctx);
      sound(ctx, e, "entity.zombie_nautilus.saddle");
      return true;
    }
    if (ctx.player.sneaking || !hasRoom(ctx, e)) return false;
    return mountPlayer(ctx, e);
  },
};

registerNautilusMount("zombie_nautilus", () => true);
