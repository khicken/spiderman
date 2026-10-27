import * as THREE from "three";
import type { ChunkUniforms, DamageSource, Effect, Entity, GameCtx, GameMode, PlayerApi } from "../contracts";
import { blockDef } from "../blocks/registry";
import { lerp, lightAt, updateCamera } from "./camera";
import { createHand, type HandFrame } from "./hand";
import type { InputAction, InputApi } from "./input";
import { createInteraction } from "./interact";
import { createItemMeshes } from "./item-mesh";
import { createPlayerModel } from "./model";
import { applyVanillaMotion, createMotionState, type MotionInput } from "./motion";
import { blockOn, fluidAt, makeBody, noCollision, bodyBox, type MoveOpts } from "./physics";
import { EYE_STAND, FLY_SPEED, HEIGHT_STAND, MAX_AIR, SNEAK_MULT, SPRINT_MULT, WALK_SPEED, WIDTH, attackStats, attackStrength, ench } from "./stats";
import { effectLevel, type PlayerState } from "./state";
import { addEffect, addExhaustion, addXp, damage, heal, onLand, respawnState, tickSurvival } from "./survival";
import { tickUse } from "./use";
import { tickGlide, tryStartGlide } from "./elytra";
import { createPlayerExtras } from "./model-extras";
import { createScreenFx } from "./screen-fx";
import { effectView, tickEffectParticles } from "./effects-fx";
import { tickSpin } from "./ranged";
import { bubbleAmbient } from "../mechanics/bubble";
import { bedStandSpot } from "../mechanics/interact";
import { DIAL_STATE } from "../textures/dials";
import { GLINT_TIME } from "../entities/armor-layer";
import { movingSlowly, updatePose as updatePoseOf, updateSwimming } from "./pose";
import { createRiding } from "./riding";

export type { InputApi } from "./input";
export { createInput } from "./input";
export { moveBody } from "./physics";

export type PlayerHandle = PlayerApi & {
  tick(ctx: GameCtx): void;
  frame(dt: number, partialTick: number): void;
  dispose(): void;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  viewBobbing: boolean;
  fovEffects: number;
  selectHotbar(i: number): void;
  mountJump(): number | undefined;
  mountHealth(): number | undefined;
  addEffect(id: string, amplifier: number, ticks: number): void;
  save(): unknown;
  load(data: unknown): void;
};

interface PlayerSave {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  saturation: number;
  exhaustion: number;
  air: number;
  xpLevel: number;
  xpProgress: number;
  xpTotal: number;
  gameMode: GameMode;
  flying: boolean;
  spawn: { x: number; y: number; z: number };
  effects: Effect[];
  fireTicks: number;
  absorption: number;
  dead: boolean;
  lastDeath?: PlayerState["lastDeath"];
}

const eyeOut = new THREE.Vector3();
const lookOut = new THREE.Vector3();
const mouse = { dx: 0, dy: 0 };
const bob = new THREE.Matrix4();
const modelPos = new THREE.Vector3();
const dropVel = new THREE.Vector3();
const D = Math.PI / 180;
const box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

function writeDials(p: PlayerState, ctx: GameCtx) {
  const d = DIAL_STATE;
  d.dayTime = ctx.time.dayTime;
  d.dim = ctx.world.dim;
  d.yaw = p.yaw;
  d.x = p.body.pos.x;
  d.z = p.body.pos.z;
  d.spawnX = p.spawn.x;
  d.spawnZ = p.spawn.z;
  d.spin += 0.02 + ctx.random() * 0.03;
  if (p.lastDeath && p.lastDeath.dim === ctx.world.dim) {
    d.deathX = p.lastDeath.x;
    d.deathZ = p.lastDeath.z;
  } else d.deathX = d.deathZ = NaN;
}

export function createPlayer(getCtx: () => GameCtx, input: InputApi): PlayerHandle {
  const body = makeBody(WIDTH, HEIGHT_STAND);
  const motion = createMotionState();
  const moveOpts: MoveOpts = { living: true, entity: null };
  const inp: MotionInput = {
    forward: 0, strafe: 0, yaw: 0, jumping: false, sneaking: false, sprinting: false, speed: WALK_SPEED, airSpeed: 0.02,
    flying: false, gravity: 0.08, levitation: 0, jumpBoost: 0, edgeGuard: true, living: true, weaving: false,
  };
  let sprintTap = false;
  let viewBobbing = true;
  let fovEffects = 1;
  let showHand = true;
  let handHeight = 1;
  let prevHandHeight = 1;
  let shownItem: string | null = null;
  let offHeight = 1;
  let prevOffHeight = 1;
  let shownOff: string | null = null;
  let walkSpeed = 0;
  let walkPos = 0;
  let prevWalkSpeed = 0;
  const hf: HandFrame = { camera: new THREE.PerspectiveCamera(), bob, stack: null, equip: 0, swing: 0, use: null, useTicks: 0, light: 1, visible: true };

  const p: PlayerState = {
    ctx: getCtx,
    motion,
    body,
    yaw: 0,
    pitch: 0,
    prevYaw: 0,
    prevPitch: 0,
    bodyYaw: 0,
    prevBodyYaw: 0,
    health: 20,
    maxHealth: 20,
    food: 20,
    saturation: 5,
    exhaustion: 0,
    air: MAX_AIR,
    xpLevel: 0,
    xpProgress: 0,
    xpTotal: 0,
    gameMode: "survival" as GameMode,
    flying: false,
    sprinting: false,
    sneaking: false,
    sleeping: false,
    spawn: { x: 0, y: 80, z: 0 },
    effects: [] as Effect[],
    dead: false,
    thirdPerson: 0 as 0 | 1 | 2,
    target: null,
    targetEntity: null,
    breakProgress: 0,
    prevPos: new THREE.Vector3(),
    absorption: 0,
    fireTicks: 0,
    frozenTicks: 0,
    invulnerable: 0,
    lastHurt: 0,
    hurtTime: 0,
    hurtDir: 0,
    foodTimer: 0,
    lastFall: 0,
    lastSource: "generic" as DamageSource,
    lastAttacker: undefined,
    deathMessage: "",
    swingTime: 0,
    swinging: false,
    swingOff: false,
    attackAnim: 0,
    prevAttackAnim: 0,
    attackTicker: 0,
    using: null,
    blocking: false,
    crossbowLoaded: false,
    itemCooldowns: {},
    walkDist: 0,
    prevWalkDist: 0,
    bob: 0,
    prevBob: 0,
    moveDist: 0,
    nextStep: 1,
    eyeHeight: EYE_STAND,
    prevEyeHeight: EYE_STAND,
    fovMod: 1,
    prevFovMod: 1,
    sprintCooldown: 0,
    ticks: 0,
    deathTime: 0,
    lastLevelUp: -1000,
    wasInWater: false,
    sensitivity: 0.5,
    invertY: false,
    fov: 70,
    attackedBy: undefined,
    swimming: false,
    fallFlying: false,
    fallFlyTicks: 0,
    spinTicks: 0,
    shieldCooldown: 0,
    totemTicks: 0,
    prevJump: false,
    lastDeath: null,
    vehicle: null,
    eye() {
      return eyeOut.set(body.pos.x, body.pos.y + p.eyeHeight, body.pos.z);
    },
    lookDir() {
      const c = Math.cos(p.pitch);
      return lookOut.set(-Math.sin(p.yaw) * c, Math.sin(p.pitch), -Math.cos(p.yaw) * c);
    },
    damage: (amount: number, source: DamageSource, attacker?: Entity) => damage(p, amount, source, attacker),
    heal: (amount: number) => heal(p, amount),
    addXp: (points: number) => addXp(p, points),
    addExhaustion: (v: number) => addExhaustion(p, v),
    addEffect: (id: string, amp: number, ticks: number) => addEffect(p, id, amp, ticks),
    hasEffect: (id: string) => effectLevel(p, id),
    removeEffect(id: string) {
      const i = p.effects.findIndex((e) => e.id === id);
      if (i >= 0) p.effects.splice(i, 1);
      if (id === "absorption") p.absorption = 0;
    },
    swing() {
      if (!p.swinging || p.swingTime >= 3 || p.swingTime < 0) {
        p.swingTime = -1;
        p.swinging = true;
      }
      p.swingOff = false;
    },
    teleport(x: number, y: number, z: number) {
      body.pos.set(x, y, z);
      p.prevPos.copy(body.pos);
      body.vel.set(0, 0, 0);
      body.fallDistance = 0;
    },
    respawn() {
      const ctx = getCtx();
      respawnState(p);
      p.deathTime = 0;
      p.sleeping = false;
      const spot = bedStandSpot(ctx, Math.floor(p.spawn.x), Math.floor(p.spawn.y), Math.floor(p.spawn.z));
      let y = spot ? spot[1] : p.spawn.y;
      const x = spot ? spot[0] : p.spawn.x + 0.5, z = spot ? spot[2] : p.spawn.z + 0.5;
      p.teleport(x, y, z);
      for (let i = 0; i < 64 && !noCollision(ctx.world, bodyBox(body, box)); i++) p.teleport(x, ++y, z);
      interaction.reset();
    },
  };

  const model = createPlayerModel();
  const items = createItemMeshes(() => getCtx().renderer?.scene.userData.chunkUniforms as ChunkUniforms | undefined);
  const hand = createHand(model, items);
  const extras = createPlayerExtras(model, items);
  const screen = createScreenFx(items);
  hand.root.add(screen.root);
  const interaction = createInteraction(p, input);
  const riding = createRiding();

  function onAction(a: InputAction) {
    const ctx = getCtx();
    const inv = ctx.inventory;
    if (a.startsWith("hotbar:")) return api.selectHotbar(Number(a.slice(7)));
    switch (a) {
      case "perspective":
        p.thirdPerson = ((p.thirdPerson + 1) % 3) as 0 | 1 | 2;
        return;
      case "hide_gui":
        showHand = !showHand;
        return;
      case "toggle_fly":
        if (p.gameMode === "creative" && !p.dead) {
          p.flying = !p.flying;
          if (p.flying) body.vel.y = 0;
        }
        return;
      case "sprint_tap":
        sprintTap = true;
        return;
      case "pick_block":
        if (!p.dead) interaction.pickBlock(ctx);
        return;
      case "swap_offhand": {
        if (p.dead || p.gameMode === "spectator") return;
        const main = inv.slots[inv.selected];
        inv.setSlot(inv.selected, inv.slots[40] ?? null);
        inv.setSlot(40, main ?? null);
        return;
      }
      case "drop":
      case "drop_stack": {
        if (p.dead || p.gameMode === "spectator") return;
        const s = inv.held();
        if (!s) return;
        const n = a === "drop_stack" ? s.count : 1;
        const one = { ...s, count: n };
        inv.removeHeld(n);
        const e = p.eye();
        const r = ctx.random() * Math.PI * 2, f = 0.02 * ctx.random();
        const c = Math.cos(p.pitch);
        dropVel.set(-Math.sin(p.yaw) * c * 0.3 + Math.cos(r) * f, Math.sin(p.pitch) * 0.3 + 0.1 + (ctx.random() - ctx.random()) * 0.1, -Math.cos(p.yaw) * c * 0.3 + Math.sin(r) * f);
        ctx.entities.dropItem(one, e.x, e.y - 0.3, e.z, dropVel);
        p.swing();
        return;
      }
    }
  }
  const offAction = input.onAction(onAction);

  function speedAttr(): number {
    let s = WALK_SPEED * (1 + 0.2 * p.hasEffect("speed")) * Math.max(0, 1 - 0.15 * p.hasEffect("slowness"));
    if (p.sprinting) s *= SPRINT_MULT;
    return s;
  }

  function updatePose(ctx: GameCtx, wantCrouch: boolean) {
    updateSwimming(p, ctx);
    updatePoseOf(p, ctx, wantCrouch);
    return movingSlowly(p);
  }

  function stepSounds(ctx: GameCtx, dx: number, dy: number, dz: number, crouched: boolean) {
    const h = Math.hypot(dx, dz);
    p.walkDist += h * 0.6;
    p.moveDist += Math.sqrt(dx * dx + (body.onClimbable ? dy * dy : 0) + dz * dz) * 0.6;
    if (p.moveDist <= p.nextStep || crouched || p.gameMode === "spectator") return;
    const on = blockOn(ctx.world, body);
    if (!body.onGround && !body.onClimbable && !body.inWater) return;
    p.nextStep = p.moveDist + 1;
    const { x, y, z } = body.pos;
    if (body.inWater) {
      const v = Math.min(1, Math.hypot(body.vel.x * 0.2, body.vel.y, body.vel.z * 0.2) * 0.35);
      ctx.emit({ type: "sound", name: "entity.player.swim", x, y, z, volume: v, pitch: 1 + (ctx.random() - ctx.random()) * 0.4 });
    } else if (on) {
      const g = body.onClimbable ? blockDef(ctx.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))).sound : blockDef(on).sound;
      ctx.emit({ type: "sound", name: `block.${g}.step`, x, y, z, volume: 0.15, pitch: 1 });
    }
  }

  function tickMovement(ctx: GameCtx) {
    const w = ctx.world;
    const on = input.enabled && !p.dead && !p.sleeping;
    const spectator = p.gameMode === "spectator";
    if (spectator) p.flying = true;
    else if (p.gameMode !== "creative") p.flying = false;
    body.noClip = spectator;
    const sneakKey = on && input.sneak;
    const crouched = updatePose(ctx, sneakKey && !p.flying && !spectator);
    p.sneaking = sneakKey;
    let fwd = on ? input.forward : 0;
    let str = on ? input.strafe : 0;
    if (crouched && !p.flying) {
      fwd *= SNEAK_MULT;
      str *= SNEAK_MULT;
    }
    if (p.using) {
      fwd *= 0.2;
      str *= 0.2;
    }
    const eye = p.eye();
    const eyeWater = fluidAt(w, eye.x, eye.y - 0.11111111, eye.z) === "water";
    const enoughFood = p.food > 6 || p.gameMode === "creative" || spectator;
    const canStart = enoughFood && !p.using && fwd >= 0.8 && !p.hasEffect("blindness") && !crouched && (!body.inWater || eyeWater);
    if (!p.sprinting && canStart && on && (input.sprint || sprintTap)) p.sprinting = true;
    sprintTap = false;
    if (p.sprinting && (!on || fwd < 0.8 || !enoughFood || (body.horizontalCollision && !p.flying) || (body.inWater && !eyeWater && !p.swimming) || (p.swimming && !body.inWater) || p.using)) p.sprinting = false;
    if (p.flying && on) {
      if (input.sneak) body.vel.y -= FLY_SPEED * 3;
      if (input.jump) body.vel.y += FLY_SPEED * 3;
    }
    const slowFall = p.hasEffect("slow_falling") > 0 && body.vel.y <= 0;
    if (slowFall) body.fallDistance = 0;
    inp.forward = fwd;
    inp.strafe = str;
    inp.yaw = p.yaw;
    inp.jumping = on && input.jump && !p.flying;
    const jumpNow = on && input.jump;
    if (jumpNow && !p.prevJump && !body.onGround && !body.onClimbable && body.vel.y < 0) tryStartGlide(p, ctx);
    p.prevJump = jumpNow;
    inp.swimming = p.swimming;
    inp.lookY = Math.sin(p.pitch);
    inp.pitch = p.pitch;
    inp.gliding = p.fallFlying;
    inp.depthStrider = ench(ctx.inventory.slots[39], "depth_strider");
    inp.dolphin = p.hasEffect("dolphins_grace") > 0;
    inp.sneaking = crouched || sneakKey;
    inp.sprinting = p.sprinting;
    inp.speed = speedAttr();
    inp.airSpeed = p.flying ? (p.sprinting ? FLY_SPEED * 2 : FLY_SPEED) : p.sprinting ? 0.026 : 0.02;
    inp.flying = p.flying;
    inp.gravity = slowFall ? 0.01 : 0.08;
    inp.levitation = p.hasEffect("levitation");
    inp.jumpBoost = p.hasEffect("jump_boost");
    inp.edgeGuard = !p.flying;
    inp.weaving = p.hasEffect("weaving") > 0;
    inp.boots = ctx.inventory.slots[39]?.item === "leather_boots";
    moveOpts.ctx = ctx;
    const vy = body.vel.y;
    const x0 = body.pos.x, y0 = body.pos.y, z0 = body.pos.z;
    const landed = applyVanillaMotion(w, body, inp, motion, moveOpts);
    tickGlide(p, ctx, motion.wallSpeed);
    if (p.flying) body.vel.y = vy * 0.6;
    if (p.flying) body.fallDistance = 0;
    if (p.flying && body.onGround && p.gameMode === "creative") p.flying = false;
    const dx = body.pos.x - x0, dy = body.pos.y - y0, dz = body.pos.z - z0;
    if (motion.jumped) addExhaustion(p, p.sprinting ? 0.2 : 0.05);
    const h = Math.hypot(dx, dz);
    if (p.sprinting && body.onGround) addExhaustion(p, 0.1 * h);
    else if (body.inWater) addExhaustion(p, 0.01 * Math.hypot(dx, dy, dz));
    stepSounds(ctx, dx, dy, dz, crouched);
    if (body.inWater && !p.wasInWater && !spectator) {
      const f = Math.min(1, Math.hypot(body.vel.x * 0.2, vy, body.vel.z * 0.2) * 0.35);
      ctx.emit({ type: "sound", name: f < 0.25 ? "entity.player.splash" : "entity.player.splash.high_speed", x: body.pos.x, y: body.pos.y, z: body.pos.z, volume: f, pitch: 1 + (ctx.random() - ctx.random()) * 0.4 });
      ctx.emit({ type: "particles", kind: "splash", x: body.pos.x, y: Math.floor(body.pos.y) + 1, z: body.pos.z, count: 12 });
    }
    p.wasInWater = body.inWater;
    if (landed > 0) onLand(p, ctx, landed);
    const hv = Math.hypot(body.vel.x, body.vel.z);
    p.bob += ((body.onGround && !p.dead ? Math.min(0.1, hv) : 0) - p.bob) * 0.4;
    prevWalkSpeed = walkSpeed;
    walkSpeed += (Math.min(h * 4, 1) - walkSpeed) * 0.4;
    walkPos += walkSpeed;
    if (h > 0.0025) {
      const moveYaw = Math.atan2(-dx, -dz);
      let d = moveYaw - p.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.bodyYaw += d * 0.3;
    }
    let d = p.yaw - p.bodyYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 50 * D) p.bodyYaw = p.yaw - Math.sign(d) * 50 * D;
  }

  function tickAnimation(ctx: GameCtx) {
    p.prevAttackAnim = p.attackAnim;
    if (p.swinging) {
      if (++p.swingTime >= 6) {
        p.swingTime = 0;
        p.swinging = false;
      }
    } else p.swingTime = 0;
    p.attackAnim = p.swingTime / 6;
    prevHandHeight = handHeight;
    const held = ctx.inventory.held();
    const name = held?.item ?? null;
    const f = attackStrength(p.attackTicker, attackStats(held).speed, 1);
    handHeight += Math.max(-0.4, Math.min(0.4, (name === shownItem ? f * f * f : 0) - handHeight));
    if (handHeight < 0.1) shownItem = name;
    prevOffHeight = offHeight;
    const off = ctx.inventory.slots[40]?.item ?? null;
    offHeight += Math.max(-0.4, Math.min(0.4, (off === shownOff ? 1 : 0) - offHeight));
    if (offHeight < 0.1) shownOff = off;
    let fovT = p.flying ? 1.1 : 1;
    fovT *= (speedAttr() / WALK_SPEED + 1) / 2;
    if (p.using?.kind === "bow") {
      const t = Math.min(1, p.using.ticks / 20);
      fovT *= 1 - t * t * 0.15;
    }
    fovT = 1 + (fovT - 1) * fovEffects;
    if (p.using?.kind === "spyglass" && p.thirdPerson === 0) fovT = 0.1;
    p.prevFovMod = p.fovMod;
    p.fovMod += (Math.max(0.1, Math.min(1.5, fovT)) - p.fovMod) * 0.5;
  }

  const api: PlayerHandle = Object.assign(p, {
    get viewBobbing() {
      return viewBobbing;
    },
    set viewBobbing(v: boolean) {
      viewBobbing = v;
    },
    get fovEffects() {
      return fovEffects;
    },
    set fovEffects(v: number) {
      fovEffects = v;
    },
    mountJump: () => riding.jumpBar(p, getCtx()),
    mountHealth: () => riding.mountHealth(p, getCtx()),
    selectHotbar(i: number) {
      const inv = getCtx().inventory;
      if (i >= 0 && i < 9) inv.selected = i;
    },
    tick(ctx: GameCtx) {
      p.ticks++;
      p.prevPos.copy(body.pos);
      p.prevYaw = p.yaw;
      p.prevPitch = p.pitch;
      p.prevBodyYaw = p.bodyYaw;
      p.prevEyeHeight = p.eyeHeight;
      p.prevWalkDist = p.walkDist;
      p.prevBob = p.bob;
      if (p.dead) p.deathTime++;
      if (!p.sleeping && !riding.tick(p, ctx, input)) tickMovement(ctx);
      tickSurvival(p, ctx);
      interaction.tick(ctx);
      tickUse(p, ctx, input);
      tickSpin(p, ctx);
      tickEffectParticles(p, ctx);
      if (p.totemTicks > 0) p.totemTicks--;
      bubbleAmbient(ctx, body.pos.x, body.pos.y, body.pos.z);
      writeDials(p, ctx);
      tickAnimation(ctx);
    },
    frame(_dt: number, pt: number) {
      const ctx = getCtx();
      if (model.model.root.parent !== ctx.renderer.scene) {
        ctx.renderer.scene.add(model.model.root);
        ctx.renderer.scene.userData.hand = hand.root;
      }
      input.consumeMouse(mouse);
      if (input.enabled && !p.dead && !p.sleeping) {
        const f = p.sensitivity * 0.6 + 0.2;
        let k = f * f * f * 8 * 0.15 * D;
        if (p.using?.kind === "spyglass" && p.thirdPerson === 0) k *= 0.125;
        p.yaw -= mouse.dx * k;
        p.pitch -= mouse.dy * k * (p.invertY ? -1 : 1);
        p.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p.pitch));
        const wheel = input.consumeWheel();
        if (wheel !== 0) ctx.inventory.selected = (((ctx.inventory.selected + wheel) % 9) + 9) % 9;
      } else input.consumeWheel();
      interaction.updateTarget(ctx);
      updateCamera(p, ctx, pt, bob, viewBobbing, effectView(p, pt).nausea);
      const light = lightAt(ctx, body.pos.x, body.pos.y + p.eyeHeight, body.pos.z, p.hasEffect("night_vision") > 0);
      const third = p.thirdPerson !== 0 && p.gameMode !== "spectator";
      const root = model.model.root;
      root.visible = third;
      root.userData.shadowRadius = p.dead || p.hasEffect("invisibility") > 0 ? 0 : 0.5;
      if (third) {
        modelPos.set(lerp(p.prevPos.x, body.pos.x, pt), lerp(p.prevPos.y, body.pos.y, pt) - (p.pose === "crouching" ? 0.125 : 0), lerp(p.prevPos.z, body.pos.z, pt));
        root.position.copy(modelPos);
        model.pose({
          bodyYaw: lerp(p.prevBodyYaw, p.bodyYaw, pt),
          headYaw: p.yaw,
          pitch: p.pitch,
          limbSwing: walkPos - walkSpeed * (1 - pt),
          limbAmount: lerp(prevWalkSpeed, walkSpeed, pt),
          attack: lerp(p.prevAttackAnim, p.attackAnim, pt),
          sneaking: p.pose === "crouching",
          usingRight: p.using?.kind === "bow" || p.using?.kind === "crossbow",
          flying: p.flying,
          riding: p.vehicle != null,
          holdRight: !!ctx.inventory.held(),
          holdLeft: !!ctx.inventory.slots[40],
          swingLeft: p.swingOff,
        });
        model.setLight(light, p.hurtTime > 0 || p.dead);
        extras.update(p, ctx, pt, light, p.hurtTime > 0 || p.dead);
        hand.setThirdPerson(model.model.parts.right_arm, getCtx().inventory.held(), p.using?.hand === "main" ? p.using : null, p.using ? p.using.ticks + pt : 0);
      }
      const u = p.using;
      const held = ctx.inventory.held();
      let swing = p.attackAnim - p.prevAttackAnim;
      if (swing < 0) swing += 1;
      hf.camera = ctx.renderer.camera;
      hf.stack = shownItem ? (held?.item === shownItem ? held : { item: shownItem, count: 1 }) : null;
      hf.equip = 1 - lerp(prevHandHeight, handHeight, pt);
      hf.swing = p.prevAttackAnim + swing * pt;
      hf.use = u;
      hf.useTicks = u ? u.ticks + pt : 0;
      hf.light = light;
      const lx = Math.floor(body.pos.x), ly = Math.floor(body.pos.y + p.eyeHeight), lz = Math.floor(body.pos.z);
      items.setLevels(ctx.world.getSkyLight(lx, ly, lz), ctx.world.getBlockLight(lx, ly, lz));
      hf.visible = showHand && !third && !p.dead && !p.sleeping && p.gameMode !== "spectator";
      const offStack = ctx.inventory.slots[40] ?? null;
      hf.off = shownOff ? (offStack?.item === shownOff ? offStack : { item: shownOff, count: 1 }) : null;
      hf.offEquip = 1 - lerp(prevOffHeight, offHeight, pt);
      hf.swingOff = p.swingOff;
      const scoping = p.using?.kind === "spyglass" && p.thirdPerson === 0;
      if (scoping) hf.visible = false;
      screen.update(ctx.renderer.camera, scoping && !p.dead, p.totemTicks, pt);
      const fxv = effectView(p, pt);
      ctx.renderer.setEffects?.(fxv);
      GLINT_TIME.value += _dt;
      hand.update(hf);
    },
    save(): unknown {
      const s: PlayerSave = {
        pos: [body.pos.x, body.pos.y, body.pos.z],
        yaw: p.yaw,
        pitch: p.pitch,
        health: p.health,
        food: p.food,
        saturation: p.saturation,
        exhaustion: p.exhaustion,
        air: p.air,
        xpLevel: p.xpLevel,
        xpProgress: p.xpProgress,
        xpTotal: p.xpTotal,
        gameMode: p.gameMode,
        flying: p.flying,
        spawn: { ...p.spawn },
        effects: p.effects.map((e) => ({ ...e })),
        fireTicks: p.fireTicks,
        absorption: p.absorption,
        dead: p.dead,
        lastDeath: p.lastDeath,
      };
      return s;
    },
    load(data: unknown) {
      if (!data || typeof data !== "object") return;
      const s = data as Partial<PlayerSave>;
      const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
      if (Array.isArray(s.pos) && s.pos.length === 3) p.teleport(num(s.pos[0], 0), num(s.pos[1], 80), num(s.pos[2], 0));
      p.yaw = num(s.yaw, 0);
      p.pitch = num(s.pitch, 0);
      p.bodyYaw = p.prevBodyYaw = p.yaw;
      p.health = num(s.health, 20);
      p.food = num(s.food, 20);
      p.saturation = num(s.saturation, 5);
      p.exhaustion = num(s.exhaustion, 0);
      p.air = num(s.air, MAX_AIR);
      p.xpLevel = num(s.xpLevel, 0);
      p.xpProgress = num(s.xpProgress, 0);
      p.xpTotal = num(s.xpTotal, 0);
      if (s.gameMode === "survival" || s.gameMode === "creative" || s.gameMode === "adventure" || s.gameMode === "spectator") p.gameMode = s.gameMode;
      p.flying = !!s.flying && p.gameMode !== "survival" && p.gameMode !== "adventure";
      if (s.spawn && typeof s.spawn === "object") p.spawn = { x: num(s.spawn.x, 0), y: num(s.spawn.y, 80), z: num(s.spawn.z, 0), ...((s.spawn as { bed?: boolean }).bed ? { bed: true } : {}) };
      p.effects.length = 0;
      if (Array.isArray(s.effects)) for (const e of s.effects) if (e && typeof e.id === "string") p.effects.push({ id: e.id, amplifier: num(e.amplifier, 0), ticks: num(e.ticks, 0) });
      p.maxHealth = 20 + 4 * p.hasEffect("health_boost");
      p.fireTicks = num(s.fireTicks, 0);
      p.absorption = num(s.absorption, 0);
      p.dead = !!s.dead || p.health <= 0;
      p.lastDeath = s.lastDeath && typeof s.lastDeath.x === "number" ? s.lastDeath : null;
    },
    dispose() {
      offAction();
      const ctx = getCtx();
      model.model.root.removeFromParent();
      if (ctx?.renderer?.scene.userData.hand === hand.root) delete ctx.renderer.scene.userData.hand;
      hand.dispose();
      extras.dispose();
      screen.dispose();
      model.dispose();
      items.dispose();
    },
  });
  return api;
}
