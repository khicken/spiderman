import * as THREE from "three";
import type { Aabb, BlockState, Entity, GameCtx, RaycastHit } from "../contracts";
import { AIR, idOf, stateOf } from "../contracts";
import { blockDef, blockId, hasTag } from "../blocks/registry";
import { computeDrops } from "../items/drops";
import { itemDef } from "../items/registry";
import { defaultBoxes, outlineBoxes } from "../mechanics/index";
import type { InputApi } from "./input";
import { fluidAt } from "./physics";
import { BLOCK_REACH, CREATIVE_ENTITY_BONUS, CREATIVE_REACH_BONUS, ENTITY_REACH, attackStats, attackStrength, canHarvest, destroyProgress, ench, enchantDamageBonus, maceBonus, toolOf } from "./stats";
import { addExhaustion, damageSlot } from "./survival";
import type { PlayerState } from "./state";
import { useItem } from "./use";

const outline: Aabb[] = [];
const pool: Aabb[] = [];
const nearby: Entity[] = [];
const eyeV = new THREE.Vector3();
const dirV = new THREE.Vector3();
const kb = new THREE.Vector3();

// Vanilla MaceItem: dust of the block under the target bursts in a ring that grows with the fall.
function smashParticles(ctx: GameCtx, e: Entity, fall: number): void {
  const x = e.body.pos.x, z = e.body.pos.z;
  const y = Math.floor(e.body.pos.y - 0.2);
  const ground = ctx.world.getBlock(Math.floor(x), y, Math.floor(z));
  if (ground === AIR) return;
  const rings = Math.min(3, 1 + Math.floor(fall / 5));
  for (let r = 1; r <= rings; r++)
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * Math.PI * 2;
      ctx.emit({ type: "particles", kind: "block", x: x + Math.cos(a) * r * 0.9, y: y + 1.05, z: z + Math.sin(a) * r * 0.9, count: 2, state: ground });
    }
}

export function blockBoxes(ctx: GameCtx, s: BlockState, x: number, y: number, z: number): Aabb[] {
  const beh = ctx.behaviors[blockDef(s).name];
  return beh?.boxes ? beh.boxes(s, ctx.world, x, y, z) : defaultBoxes(s);
}

export interface Interaction {
  updateTarget(ctx: GameCtx): void;
  tick(ctx: GameCtx): void;
  pickBlock(ctx: GameCtx): void;
  reset(): void;
}

const SOUND_VOL = 1;

export function createInteraction(p: PlayerState, input: InputApi): Interaction {
  let mining: { x: number; y: number; z: number; state: BlockState } | null = null;
  let progress = 0;
  let destroyTicks = 0;
  let destroyDelay = 0;
  let rightDelay = 0;
  let lastTarget: RaycastHit | null = null;

  const reach = () => BLOCK_REACH + (p.gameMode === "creative" ? CREATIVE_REACH_BONUS : 0);
  const entityReach = () => ENTITY_REACH + (p.gameMode === "creative" ? CREATIVE_ENTITY_BONUS : 0);

  function setOutline(ctx: GameCtx, hit: RaycastHit | null) {
    if (!hit || p.gameMode === "spectator") {
      if (lastTarget) ctx.renderer.setOutline(null, null);
      lastTarget = null;
      return;
    }
    const src = outlineBoxes(hit.state, ctx.world, hit.x, hit.y, hit.z);
    outline.length = 0;
    for (let i = 0; i < src.length; i++) {
      const b = (pool[i] ??= { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });
      const s = src[i];
      b.minX = s.minX; b.maxX = s.maxX;
      b.minY = s.minY; b.maxY = s.maxY;
      b.minZ = s.minZ; b.maxZ = s.maxZ;
      outline.push(b);
    }
    ctx.renderer.setOutline(hit, outline.length ? outline : null);
    lastTarget = hit;
  }

  function updateTarget(ctx: GameCtx) {
    if (p.dead) {
      p.target = null;
      p.targetEntity = null;
      setOutline(ctx, null);
      return;
    }
    eyeV.copy(p.eye());
    dirV.copy(p.lookDir());
    const hit = p.gameMode === "spectator" ? null : ctx.world.raycast(eyeV, dirV, reach());
    const max = Math.min(entityReach(), hit ? hit.dist : Infinity);
    const ent = ctx.entities.raycast(eyeV, dirV, max);
    p.targetEntity = ent && (!hit || ent.dist < hit.dist) ? ent : null;
    p.target = p.targetEntity ? null : hit;
    setOutline(ctx, p.target);
  }

  function mineFactors(ctx: GameCtx) {
    const helmet = ctx.inventory.slots[36];
    const e = p.eye();
    return {
      onGround: p.body.onGround || p.flying,
      eyeInWater: fluidAt(ctx.world, e.x, e.y, e.z) === "water",
      aquaAffinity: ench(helmet, "aqua_affinity") > 0,
      haste: Math.max(p.hasEffect("haste"), p.hasEffect("conduit_power")),
      fatigue: p.hasEffect("mining_fatigue"),
    };
  }

  function stopMining(ctx: GameCtx) {
    if (mining) ctx.renderer.setBreak(null, 0);
    mining = null;
    progress = 0;
    destroyTicks = 0;
    p.breakProgress = 0;
  }

  function destroyBlock(ctx: GameCtx, x: number, y: number, z: number): void {
    const w = ctx.world;
    const s = w.getBlock(x, y, z);
    if (s === AIR) return;
    const def = blockDef(s);
    const held = ctx.inventory.held();
    const tool = toolOf(held);
    const creative = p.gameMode === "creative";
    if (creative && (tool?.kind === "sword" || held?.item === "trident" || held?.item === "mace")) return;
    const silk = ench(held, "silk_touch") > 0;
    let replace: BlockState = AIR;
    if (!creative && hasTag(s, "ice") && def.name === "ice" && !silk) {
      const below = w.getBlock(x, y - 1, z);
      if (below !== AIR && (blockDef(below).solid || idOf(below) === blockId("water"))) replace = stateOf(blockId("water"));
    }
    if (!w.setBlock(x, y, z, replace)) return;
    ctx.emit({ type: "sound", name: `block.${def.sound}.break`, x: x + 0.5, y: y + 0.5, z: z + 0.5, volume: SOUND_VOL, pitch: 0.8 });
    ctx.emit({ type: "particles", kind: "block", x: x + 0.5, y: y + 0.5, z: z + 0.5, count: 32, state: s });
    if (!creative) {
      if (canHarvest(def, held)) {
        for (const d of computeDrops(s, held, ctx.random)) {
          ctx.entities.dropItem(d, x + 0.5 + (ctx.random() - 0.5) * 0.5, y + 0.5 + (ctx.random() - 0.5) * 0.5 - 0.125, z + 0.5 + (ctx.random() - 0.5) * 0.5);
        }
        if (def.xp && !silk) {
          const [a, b] = def.xp;
          const n = a + Math.floor(ctx.random() * (b - a + 1));
          if (n > 0) ctx.entities.dropXp(n, x + 0.5, y + 0.5, z + 0.5);
        }
      }
      if (def.name.startsWith("infested_") && !silk) ctx.entities.spawn("silverfish", x + 0.5, y, z + 0.5);
      if (tool && def.hardness !== 0) damageSlot(ctx, ctx.inventory.selected, tool.kind === "sword" ? 2 : 1);
      addExhaustion(p, 0.005);
    }
  }

  function startDestroy(ctx: GameCtx, hit: RaycastHit) {
    if (p.gameMode === "adventure" || p.gameMode === "spectator") return;
    if (p.gameMode === "creative") {
      destroyBlock(ctx, hit.x, hit.y, hit.z);
      destroyDelay = 5;
      return;
    }
    const s = ctx.world.getBlock(hit.x, hit.y, hit.z);
    const step = destroyProgress(s, ctx.inventory.held(), mineFactors(ctx));
    if (step >= 1) {
      destroyBlock(ctx, hit.x, hit.y, hit.z);
      stopMining(ctx);
      return;
    }
    mining = { x: hit.x, y: hit.y, z: hit.z, state: s };
    progress = 0;
    destroyTicks = 0;
  }

  function continueDestroy(ctx: GameCtx, hit: RaycastHit) {
    if (destroyDelay > 0) {
      destroyDelay--;
      return;
    }
    if (p.gameMode === "creative") {
      destroyBlock(ctx, hit.x, hit.y, hit.z);
      destroyDelay = 5;
      return;
    }
    if (!mining || mining.x !== hit.x || mining.y !== hit.y || mining.z !== hit.z || ctx.world.getBlock(hit.x, hit.y, hit.z) !== mining.state) {
      stopMining(ctx);
      startDestroy(ctx, hit);
      return;
    }
    const s = mining.state;
    progress += destroyProgress(s, ctx.inventory.held(), mineFactors(ctx));
    if (destroyTicks % 4 === 0) {
      const g = blockDef(s).sound;
      ctx.emit({ type: "sound", name: `block.${g}.hit`, x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5, volume: 0.25, pitch: 0.5 });
      ctx.emit({ type: "particles", kind: "block", x: hit.point.x, y: hit.point.y, z: hit.point.z, count: 1, state: s });
    }
    destroyTicks++;
    if (progress >= 1) {
      destroyBlock(ctx, hit.x, hit.y, hit.z);
      stopMining(ctx);
      destroyDelay = 5;
      return;
    }
    p.breakProgress = progress;
    ctx.renderer.setBreak(hit, progress);
  }

  function attackEntity(ctx: GameCtx, id: number) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || p.gameMode === "spectator") return;
    if (e.type === "item" || e.type === "xp_orb" || e.type === "arrow") return;
    const held = ctx.inventory.held();
    const st = attackStats(held);
    let dmg = st.damage + p.hasEffect("strength") * 3 - p.hasEffect("weakness") * 4;
    let bonus = enchantDamageBonus(held, e.type);
    const s = attackStrength(p.attackTicker, st.speed);
    dmg *= 0.2 + s * s * 0.8;
    bonus *= s;
    p.attackTicker = 0;
    if (dmg <= 0 && bonus <= 0) return;
    const b = p.body;
    const charged = s > 0.9;
    let knock = ench(held, "knockback");
    let sprintHit = false;
    if (p.sprinting && charged) {
      ctx.emit({ type: "sound", name: "entity.player.attack.knockback", x: b.pos.x, y: b.pos.y, z: b.pos.z });
      knock++;
      sprintHit = true;
    }
    const crit = charged && b.fallDistance > 0 && !b.onGround && !b.onClimbable && !b.inWater && !p.hasEffect("blindness") && !p.sprinting;
    if (crit) dmg *= 1.5;
    const smash = held?.item === "mace" && b.fallDistance > 1.5 && !p.flying && !p.fallFlying;
    if (smash) dmg += maceBonus(b.fallDistance, ench(held, "density"));
    const total = dmg + bonus;
    const walked = Math.hypot(b.pos.x - p.prevPos.x, b.pos.z - p.prevPos.z);
    const sweep = charged && !crit && !sprintHit && b.onGround && walked < 0.13 && toolOf(held)?.kind === "sword";
    if (held?.item === "mace") e.data._breach = ench(held, "breach");
    ctx.entities.damage(id, total, smash ? "mace" : "player", "player");
    e.data._breach = undefined;
    if (smash && total >= 100) ctx.emit({ type: "advancement", title: "Over-Overkill" });
    const fire = ench(held, "fire_aspect");
    if (fire > 0) e.data.fireTicks = Math.max(Number(e.data.fireTicks ?? 0), fire * 80);
    if (knock > 0) ctx.entities.knockback(id, -Math.sin(p.yaw), -Math.cos(p.yaw), knock * 0.5);
    if (sprintHit) {
      b.vel.x *= 0.6;
      b.vel.z *= 0.6;
      p.sprinting = false;
    }
    if (sweep) {
      const ratio = ench(held, "sweeping_edge");
      const sd = 1 + dmg * (ratio / (ratio + 1));
      ctx.entities.near(e.body.pos.x, e.body.pos.y, e.body.pos.z, 2, nearby);
      for (const o of nearby) {
        if (o.id === id || o.dead || o.type === "item" || o.type === "xp_orb" || o.type === "armor_stand") continue;
        if (Math.abs(o.body.pos.x - e.body.pos.x) > 1 + o.body.width / 2 || Math.abs(o.body.pos.z - e.body.pos.z) > 1 + o.body.width / 2) continue;
        if (o.body.pos.distanceToSquared(b.pos) >= 9) continue;
        ctx.entities.knockback(o.id, -Math.sin(p.yaw), -Math.cos(p.yaw), 0.4);
        ctx.entities.damage(o.id, sd, "player", "player");
      }
      ctx.emit({ type: "sound", name: "entity.player.attack.sweep", x: b.pos.x, y: b.pos.y, z: b.pos.z });
    }
    if (smash) {
      const heavy = b.fallDistance > 5;
      ctx.emit({ type: "sound", name: heavy ? "item.mace.smash_ground_heavy" : "item.mace.smash_ground", x: e.body.pos.x, y: e.body.pos.y, z: e.body.pos.z });
      smashParticles(ctx, e, b.fallDistance);
      ctx.entities.near(e.body.pos.x, e.body.pos.y, e.body.pos.z, 3.5, nearby);
      for (const o of nearby) {
        if (o.id === id || o.dead || o.type === "item" || o.type === "xp_orb") continue;
        kb.subVectors(o.body.pos, e.body.pos);
        const d = kb.length();
        if (d > 3.5 || d < 1e-4) continue;
        ctx.entities.knockback(o.id, kb.x, kb.z, (3.5 - d) * 0.7 * (heavy ? 2 : 1) * 0.25);
      }
      b.vel.y = 0.01;
      b.fallDistance = 0;
      const wind = ench(held, "wind_burst");
      if (wind > 0) b.vel.y = 0.7 + 0.35 * (wind - 1);
    }
    const snd = crit ? "entity.player.attack.crit" : sweep || sprintHit ? null : charged ? "entity.player.attack.strong" : "entity.player.attack.weak";
    if (snd) ctx.emit({ type: "sound", name: snd, x: b.pos.x, y: b.pos.y, z: b.pos.z });
    if (crit) ctx.emit({ type: "particles", kind: "crit", x: e.body.pos.x, y: e.body.pos.y + e.body.height * 0.5, z: e.body.pos.z, count: 12 });
    addExhaustion(p, 0.1);
    const kind = toolOf(held)?.kind;
    if (kind || held?.item === "trident" || held?.item === "mace") damageSlot(ctx, ctx.inventory.selected, kind && kind !== "sword" ? 2 : 1);
  }

  function leftClick(ctx: GameCtx) {
    p.swing();
    if (p.targetEntity) attackEntity(ctx, p.targetEntity.id);
    else if (p.target) startDestroy(ctx, p.target);
    else if (p.gameMode !== "spectator") p.attackTicker = 0;
  }

  function rightClick(ctx: GameCtx) {
    rightDelay = 4;
    if (p.gameMode === "spectator") return;
    if (useItem(p, ctx, "main") || useItem(p, ctx, "off")) return;
  }

  function pickBlock(ctx: GameCtx) {
    const inv = ctx.inventory;
    let item: string | null = null;
    if (p.targetEntity) {
      const e = ctx.entities.get(p.targetEntity.id);
      if (e && p.gameMode === "creative") {
        const w = (e.data.wood as string) ?? "oak";
        item = e.type.endsWith("minecart") ? e.type : e.type === "boat" || e.type === "chest_boat" ? (w === "bamboo" ? (e.type === "boat" ? "bamboo_raft" : "bamboo_chest_raft") : e.type === "boat" ? `${w}_boat` : `${w}_chest_boat`) : itemDef(`${e.type}_spawn_egg`) ? `${e.type}_spawn_egg` : null;
      }
    } else if (p.target) {
      const d = blockDef(p.target.state);
      item = d.item === null ? null : d.item ?? d.name;
    }
    if (!item) return;
    for (let i = 0; i < 9; i++)
      if (inv.slots[i]?.item === item) {
        inv.selected = i;
        return;
      }
    if (p.gameMode === "creative") {
      let slot = inv.selected;
      if (inv.slots[slot]) for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; }
      inv.selected = slot;
      inv.setSlot(slot, { item, count: 1 });
      return;
    }
    for (let i = 9; i < 36; i++)
      if (inv.slots[i]?.item === item) {
        const cur = inv.slots[inv.selected];
        inv.setSlot(inv.selected, inv.slots[i]);
        inv.setSlot(i, cur);
        return;
      }
  }

  return {
    updateTarget,
    pickBlock,
    reset() {
      mining = null;
      progress = 0;
      destroyDelay = 0;
      rightDelay = 0;
    },
    tick(ctx) {
      p.attackTicker++;
      if (rightDelay > 0) rightDelay--;
      if (p.dead || !input.enabled) {
        stopMining(ctx);
        input.consumeClicks();
        return;
      }
      updateTarget(ctx);
      const usingNow = !!p.using;
      if (input.leftClicks > 0 && !usingNow) leftClick(ctx);
      else if (input.left && !usingNow && p.target) {
        p.swing();
        continueDestroy(ctx, p.target);
      }
      if (!input.left || !p.target || usingNow) {
        if (mining) stopMining(ctx);
        if (!input.left) destroyDelay = 0;
      }
      if (!usingNow && (input.rightClicks > 0 || (input.right && rightDelay === 0))) rightClick(ctx);
      input.consumeClicks();
    },
  };
}
