import * as THREE from "three";
import type {
  Box, FrameCtx, GameEvent, HeroAnimIn, Look, MoveMode, Player, PlayerAction, Quality, RayHit, SaveData, Shot, Strike, Surface, V3,
  World,
} from "./contracts";
import { BOW, GRAVITY, PLAYER, QUALITY, SUBSTEP_MAX, SWORD, THREAD } from "./contracts";
import { newPlayerState } from "./state";
import { arcSlice, createSwordTimer, softLockPick } from "./combat-events";
import { edgeAt } from "./world";
import { createWrenModel, newHeroAnimIn } from "./player-model";


/** Extra hooks the integrator may wire. Everything in the Player contract is unchanged. */
export type PlayerPlus = Player & {
  /** Vertical updraft speed (m/s) at a point, or 0. Landmarks' warm air columns at the cliff top. */
  updraftAt: ((x: number, y: number, z: number) => number) | null;
  /** Draw Wren's own sword ribbon (turn off if render's Fx.trail already draws one). */
  ownTrail: boolean;
  /** Lab/debug: current combo index, mantle progress, wall normal. */
  readonly debug: { combo: number; mantle: number; climbing: boolean; wade: number; groundY: number };
  /** Hero model hooks game.ts drives: ink outline per quality preset, fade when the camera is close. */
  readonly model: { setOutline(on: boolean): void; setCameraDistance(d: number): void };
};

const R = PLAYER.radius;
const H = PLAYER.height;
const CLIMB_NY = 0.643; // normal.y below this is a climbable face (50 deg)
const PUSH_SPEED = 1.5;
const ROLL_K = PLAYER.dodgeDist / (PLAYER.dodgeTime * 0.8);
const SPIN_TIME = 0.55;
const MANTLE_TIME: number = PLAYER.mantleTime;
const ROLL_LAND_TIME = 0.4;
const EPS = 1e-4;
const SHEATHE_AFTER = 5;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const turnToward = (cur: number, target: number, maxStep: number) => {
  const d = wrap(target - cur);
  return cur + clamp(d, -maxStep, maxStep);
};
const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

export function createPlayer(scene: THREE.Scene, world: World, look: Look, quality: Quality): PlayerPlus {
  const state = newPlayerState();
  const model = createWrenModel(look);
  const group = model.group;
  scene.add(group);
  model.setShadows(QUALITY[quality].shadow > 0);

  const events: GameEvent[] = [];
  const pending: GameEvent[] = [];
  const anim: HeroAnimIn = newHeroAnimIn();
  const hit: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };
  const strike: Strike = {
    team: "player", source: -1, origin: { x: 0, y: 0, z: 0 }, yaw: 0, reach: SWORD.reach, arc: SWORD.arc, height: 1.0,
    damage: 10, kind: "sword", knockback: SWORD.knockback,
  };
  const shot: Shot = { team: "player", source: -1, kind: "arrow", pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, damage: 8, gravity: BOW.gravity };
  const nb: Box[] = new Array(96);
  let nbN = 0;
  const addBox = (b: Box) => {
    if (nbN < nb.length) nb[nbN++] = b;
  };
  const n3 = new THREE.Vector3();
  const tv = new THREE.Vector3();
  const tv2 = new THREE.Vector3();
  const wallN = new THREE.Vector3(0, 0, 1);
  const mantleFrom = new THREE.Vector3();
  const mantleTo = new THREE.Vector3();
  const vaultFrom = new THREE.Vector3();
  const vaultTo = new THREE.Vector3();
  state.aimOrigin = new THREE.Vector3();
  state.aimDir = new THREE.Vector3(0, 0, -1);
  state.staminaRings = 1;
  state.softLockId = -1;

  let sinceGround = 0;
  let jumpBuf = 0;
  let jumpRising = false;
  let groundBox: Box | null = null;
  let groundNy = 1;
  const groundN = new THREE.Vector3(0, 1, 0);
  let stepOffset = 0;
  let maxFall = 0;
  let wallPushT = 0;
  let contact = false, contactNx = 0, contactNz = 0;
  let contactBox: Box | null = null;
  let contactTerrain = false;
  let pushT = 0;
  let wade = 0;
  let waterY = -Infinity;
  let safeT = 0;
  let staminaIdle = 0;
  let prevYaw = state.yaw;
  let turnRate = 0;
  let groundBelow = 0;
  let mantleT = -1, mantleDur = MANTLE_TIME;
  let climbJumpT = 0;
  let climbJx = 0, climbJy = 1;
  let climbEvent = false;
  let climbVX = 0, climbVY = 0;
  let combo = 1;
  let struck = false;
  let queued = false;
  const sword = createSwordTimer();
  const slice = { yaw: 0, arc: 0 };
  const edge = { k: 0, nx: 0, nz: 0 };
  let chargeSent = false;
  let riposteT = 0;
  let combatT = 99;
  let rollX = 0, rollZ = 1;
  let hurtBig = false;
  let aimT = 0;
  let lungeV = 0;
  let blockShove = 0;
  let deadT = 0;
  // v2 movement state
  let smax: number = PLAYER.staminaMax; // staminaMax * staminaRings
  let jumpT = 99; // s since the last ground jump
  let jumpCut = false; // jump released before jumpCutT: cut at jumpCutT
  let jumpPressAir = 99; // s since a jump press that did not start a jump (glide guard)
  let airTopY = 0; // highest feet y in this fall (fall damage from height, not from a frame-quantized speed)
  let rollPressT = 99; // s since dodge was pressed in the air (roll-land before touchdown)
  let landPendQ = 0, landPendT = 0; // fall damage waiting for a roll-land press
  let skidT = -1, skidSp = 0, skidX = 0, skidZ = 1, skidVX = 0, skidVZ = 0;
  let vaultT = -1, vaultDur: number = PLAYER.vaultTime, vaultPeak = 0, vaultExit = 0, vaultX = 0, vaultZ = 1;
  let mantleExit = 0, mantleX = 0, mantleZ = 0;
  let hangT = -1; // last-gasp hang at zero stamina on the wall
  let gaspJump = false; // one climb jump allowed during the hang
  let glideT = 0, glideMode: 0 | 1 | 2 = 0, glideBoostT = 0, pullUp = 0;
  let glidePromptSent = false;
  let dodgeCd = 0, dodgeBuf = 0, atkBuf = 0;
  let swimDashT = 0;
  let wasRide = false;
  let lean = 0;
  let hspPre = 0;
  let lastFx: FrameCtx["fx"] | null = null;

  const surfaceHere = (): Surface => {
    if (wade > 0.1) return "water";
    if (groundBox) return groundBox.tag === "tree" ? "wood" : "stone";
    return world.surfaceAt(state.pos.x, state.pos.z);
  };
  const isDead = () => state.mode === "dead";
  const posV3 = (dy = 0) => v3(state.pos.x, state.pos.y + dy, state.pos.z);

  function setMode(m: MoveMode) {
    const old = state.mode;
    if (old === m) return;
    if (old === "climb" && climbEvent) events.push({ type: "climb", on: false });
    if (old === "glide") events.push({ type: "glide", on: false });
    if (old === "swim") events.push({ type: "swim", on: false });
    state.mode = m;
    if (m !== "ground" && m !== "air" && m !== "glide") sword.cancel();
    if (m === "climb" && climbEvent) events.push({ type: "climb", on: true });
    if (m === "glide") events.push({ type: "glide", on: true });
    if (m === "swim") events.push({ type: "swim", on: true });
    if (m !== "climb") mantleT = -1;
  }

  function setAction(a: PlayerAction) {
    if (state.action === a) return;
    state.action = a;
    state.actionT = 0;
  }

  function gather(x: number, z: number, r: number) {
    nbN = 0;
    world.near(x, z, r).forEach(addBox);
  }

  /** Highest support under a disc of radius r*0.7 at (x, z) that is at or below y + allow. Sets groundBox, groundN. */
  function groundHeight(x: number, y: number, z: number, allow: number): number {
    let g = world.heightAt(x, z);
    groundBox = null;
    const rr = R * 0.7;
    for (let i = 0; i < nbN; i++) {
      const b = nb[i];
      if (b.maxY > y + allow || b.maxY <= g) continue;
      if (x + rr < b.minX || x - rr > b.maxX || z + rr < b.minZ || z - rr > b.maxZ) continue;
      g = b.maxY;
      groundBox = b;
    }
    if (groundBox) groundN.set(0, 1, 0);
    else world.normalAt(x, z, groundN);
    groundNy = groundN.y;
    return g;
  }

  /** Push the body cylinder out of boxes. allow = height of a box top that counts as a step. */
  function collideBoxes(allow: number) {
    const p = state.pos, v = state.vel;
    for (let i = 0; i < nbN; i++) {
      const b = nb[i];
      if (b.maxY <= p.y + allow || b.minY >= p.y + H) continue;
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      if (b.minY > p.y + 0.9 && v.y > 0) {
        p.y = b.minY - H;
        v.y = 0;
        jumpRising = false;
        continue;
      }
      let push: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        push = R - d;
      } else {
        const l = p.x - b.minX, r = b.maxX - p.x, bk = p.z - b.minZ, f = b.maxZ - p.z;
        const m = Math.min(l, r, bk, f);
        dx = m === l ? -1 : m === r ? 1 : 0;
        dz = m === bk ? -1 : m === f ? 1 : 0;
        if (dx !== 0) dz = 0;
        push = m + R;
      }
      p.x += dx * push;
      p.z += dz * push;
      const vn = v.x * dx + v.z * dz;
      if (vn < 0) {
        v.x -= dx * vn;
        v.z -= dz * vn;
      }
      contact = true;
      contactNx = dx;
      contactNz = dz;
      contactBox = b;
      contactTerrain = false;
    }
  }

  /** True when terrain in front of the body edge rises into a wall. Writes the wall's horizontal normal into tv2. */
  function terrainWall(dirX: number, dirZ: number, allow: number): boolean {
    const p = state.pos;
    for (let k = -1; k <= 1; k++) {
      const a = k * 0.75;
      const c = Math.cos(a), s = Math.sin(a);
      const sx = p.x + (dirX * c - dirZ * s) * R, sz = p.z + (dirX * s + dirZ * c) * R;
      const h = world.heightAt(sx, sz);
      if (h <= p.y + allow) continue;
      world.normalAt(sx, sz, n3);
      if (n3.y >= PLAYER.slopeWalk && h - p.y < 1.2) continue;
      const l = Math.hypot(n3.x, n3.z);
      if (l > 1e-4) tv2.set(n3.x / l, 0, n3.z / l);
      else tv2.set(-dirX, 0, -dirZ);
      return true;
    }
    return false;
  }

  /** One substep of travel with collisions. allowStep: step height for box tops / terrain lips. */
  function moveStep(mx: number, my: number, mz: number, allowStep: number, wasGrounded: boolean, snapDown: number) {
    const p = state.pos, v = state.vel;
    const x0 = p.x, z0 = p.z;
    const ml = Math.hypot(mx, mz);
    if (ml > 1e-6) {
      p.x += mx;
      p.z += mz;
      const dX = mx / ml, dZ = mz / ml;
      if (terrainWall(dX, dZ, allowStep)) {
        contact = true;
        contactTerrain = true;
        contactBox = null;
        contactNx = tv2.x;
        contactNz = tv2.z;
        const into = mx * tv2.x + mz * tv2.z;
        p.x = x0 + mx - (into < 0 ? tv2.x * into : 0);
        p.z = z0 + mz - (into < 0 ? tv2.z * into : 0);
        if (terrainWall(dX, dZ, allowStep)) {
          p.x = x0;
          p.z = z0;
        }
        const vn = v.x * tv2.x + v.z * tv2.z;
        if (vn < 0) {
          v.x -= tv2.x * vn;
          v.z -= tv2.z * vn;
        }
      }
    }
    collideBoxes(allowStep);
    p.y += my;
    const y0 = p.y;
    const gy = groundHeight(p.x, p.y, p.z, allowStep);
    if (v.y <= 0.001 && p.y <= gy + (wasGrounded ? snapDown : 0.02)) {
      if (wasGrounded) stepOffset += y0 - gy;
      p.y = gy;
      if (v.y < 0) {
        if (!state.grounded) maxFall = Math.max(maxFall, -v.y);
        v.y = 0;
      }
      state.grounded = true;
      return;
    }
    if (p.y < gy) {
      if (wasGrounded) stepOffset += y0 - gy;
      p.y = gy;
      if (v.y < 0) {
        maxFall = Math.max(maxFall, -v.y);
        v.y = 0;
      }
      state.grounded = true;
      return;
    }
    state.grounded = false;
  }

  /** Cast from the chest toward the wall. Returns true on a climbable face and writes hit. */
  function probeWall(px: number, py: number, pz: number, nx: number, nz: number, reach: number): boolean {
    const ok = world.raycast(px + nx * 0.15, py, pz + nz * 0.15, -nx, 0, -nz, reach + 0.15, hit);
    return ok && hit.hit;
  }

  function climbable(): boolean {
    const b = hit.box;
    if (b && b.maxX - b.minX < PLAYER.climbMinWidth && b.maxZ - b.minZ < PLAYER.climbMinWidth) return false;
    return world.isClimbable(hit.normal, hit.box) && hit.normal.y < PLAYER.slopeWalk;
  }

  function startClimb(nx: number, ny: number, nz: number) {
    wallN.set(nx, ny, nz).normalize();
    climbEvent = true;
    state.vel.set(0, 0, 0);
    climbJumpT = 0;
    hangT = -1;
    gaspJump = false;
    setAction("none");
    state.shieldUp = false;
    setMode("climb");
    state.grounded = false;
    state.yaw = Math.atan2(-wallN.x, -wallN.z);
  }

  /** Find a walkable top over a ledge in front (direction -nx,-nz) and start a mantle. */
  function tryMantle(nx: number, nz: number, minUp: number, maxUp: number, dur: number, exitSpeed = 0): boolean {
    const p = state.pos;
    const fx = p.x - nx * (R + 0.45), fz = p.z - nz * (R + 0.45);
    const top = p.y + maxUp + 0.3;
    if (!world.raycast(fx, top, fz, 0, -1, 0, maxUp + 0.3 - minUp + 0.05, hit) || !hit.hit) return false;
    if (hit.normal.y < PLAYER.slopeWalk) return false;
    const ty = hit.point.y;
    if (ty - p.y < minUp || ty - p.y > maxUp) return false;
    if (world.raycast(hit.point.x, ty + 0.05, hit.point.z, 0, 1, 0, H - 0.1, hit) && hit.hit) return false;
    mantleFrom.copy(p);
    mantleTo.set(fx, ty, fz);
    mantleT = 0;
    mantleDur = dur;
    mantleExit = exitSpeed;
    mantleX = -nx;
    mantleZ = -nz;
    state.vel.set(0, 0, 0);
    state.yaw = Math.atan2(-nx, -nz);
    setAction("none");
    setMode("climb");
    return true;
  }

  /** Auto-vault over (thin box) or onto (deep box) a 0.45-1.3 m ledge hit at speed. Scripted arc, keeps 80% speed. */
  function tryVault(box: Box, nx: number, nz: number, speed: number): boolean {
    const p = state.pos;
    const dx = -nx, dz = -nz;
    const top = box.maxY;
    // distance from the body center to the far face along the travel direction
    const far = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? box.maxX - p.x : p.x - box.minX) : (dz > 0 ? box.maxZ - p.z : p.z - box.minZ);
    if (far <= 0) return false;
    if (world.raycast(p.x, top + 0.05, p.z, 0, 1, 0, H - 0.2, hit) && hit.hit) return false; // low ceiling
    let tx: number, tz: number, ty: number;
    if (far < 1.6) {
      tx = p.x + dx * (far + R + 0.15);
      tz = p.z + dz * (far + R + 0.15);
      gather(tx, tz, R + 1);
      ty = groundHeight(tx, top + 0.1, tz, 0);
      if (top - ty > 2.5) { // big drop behind: land on top instead
        tx = p.x + dx * (R + 0.5);
        tz = p.z + dz * (R + 0.5);
        ty = top;
      }
    } else {
      tx = p.x + dx * (R + 0.55);
      tz = p.z + dz * (R + 0.55);
      ty = top;
    }
    if (world.raycast(tx, ty + 0.1, tz, 0, 1, 0, H - 0.2, hit) && hit.hit) return false;
    vaultFrom.copy(p);
    vaultTo.set(tx, ty, tz);
    vaultPeak = top + 0.12;
    vaultT = 0;
    vaultDur = PLAYER.vaultTime;
    vaultExit = speed * PLAYER.vaultSpeedMul;
    vaultX = dx;
    vaultZ = dz;
    state.yaw = Math.atan2(dx, dz);
    state.vel.set(dx * vaultExit, 0, dz * vaultExit);
    setAction("vault");
    return true;
  }

  function hurt(amount: number, big: boolean) {
    if (state.mode === "dead" || amount <= 0) return;
    state.hp = Math.max(0, state.hp - amount);
    state.iFrames = PLAYER.hurtIFrames;
    sword.cancel();
    pending.push({ type: "hurt", amount, hp: state.hp, pos: posV3(1) });
    if (state.hp <= 0) die();
    else {
      hurtBig = big;
      if (state.mode === "climb" || state.mode === "glide") {
        pending.push({ type: state.mode === "climb" ? "climb" : "glide", on: false });
        state.mode = "air";
      }
      state.shieldUp = false;
      setAction("hurt");
      state.charge = 0;
    }
  }

  function die() {
    if (state.mode === "climb" && climbEvent) pending.push({ type: "climb", on: false });
    if (state.mode === "glide") pending.push({ type: "glide", on: false });
    if (state.mode === "swim") pending.push({ type: "swim", on: false });
    state.mode = "dead";
    sword.cancel();
    state.hp = 0;
    state.action = "none";
    state.actionT = 0;
    state.shieldUp = false;
    state.charge = 0;
    state.vel.x *= 0.3;
    state.vel.z *= 0.3;
    state.pushBox = -1;
    deadT = 0;
    pending.push({ type: "died", pos: posV3() });
  }

  function lockTarget(ctx: FrameCtx): { x: number; z: number } | null {
    if (state.lockId < 0) return null;
    for (const e of ctx.enemies) if (e.id === state.lockId && e.alive) return e.pos;
    return null;
  }

  function doStrike(ctx: FrameCtx, kind: Strike["kind"], damage: number, reach: number, arc: number, yaw = state.yaw, kb = -1) {
    const p = state.pos;
    strike.origin.x = p.x;
    strike.origin.y = p.y + 1.0;
    strike.origin.z = p.z;
    strike.yaw = yaw;
    strike.kind = kind;
    strike.damage = damage;
    strike.reach = reach;
    strike.arc = arc;
    strike.knockback = kb >= 0 ? kb : kind === "spin" ? SWORD.knockback * 1.6 : kind === "riposte" ? SWORD.knockback * 1.4 : SWORD.knockback;
    ctx.combat.strike(strike);
  }

  function fireArrow(ctx: FrameCtx) {
    const frac = clamp(aimT / BOW.drawTime, 0, 1);
    const cam = ctx.camera;
    cam.getWorldDirection(tv);
    const far = 160;
    if (world.raycast(cam.position.x, cam.position.y, cam.position.z, tv.x, tv.y, tv.z, far, hit) && hit.hit && hit.dist > 2) tv2.copy(hit.point);
    else tv2.copy(cam.position).addScaledVector(tv, far);
    const o = model.bowHandWorld;
    const ox = o.x, oy = o.y, oz = o.z;
    tv2.set(tv2.x - ox, tv2.y - oy, tv2.z - oz).normalize();
    const sp = BOW.speedMin + (BOW.speedMax - BOW.speedMin) * frac;
    shot.pos.x = ox + tv2.x * 0.4;
    shot.pos.y = oy + tv2.y * 0.4;
    shot.pos.z = oz + tv2.z * 0.4;
    shot.vel.x = tv2.x * sp;
    shot.vel.y = tv2.y * sp;
    shot.vel.z = tv2.z * sp;
    shot.damage = Math.round(BOW.damageMin + (BOW.damageMax - BOW.damageMin) * frac);
    ctx.combat.shoot(shot);
    state.arrows = Math.max(0, state.arrows - 1);
    events.push({ type: "arrowFired", pos: v3(shot.pos.x, shot.pos.y, shot.pos.z), dir: v3(tv2.x, tv2.y, tv2.z) });
  }

  /** A combo step started (sword timer): face the hard lock, else the stick, then soft-lock inside the cone. */
  function startSwing(n: 1 | 2 | 3, ctx: FrameCtx, wx: number, wz: number, mag: number) {
    combo = n;
    struck = false;
    queued = false;
    setAction(n === 1 ? "attack1" : n === 2 ? "attack2" : "attack3");
    combatT = 0;
    const tgt = lockTarget(ctx);
    state.softLockId = -1;
    if (tgt) state.yaw = Math.atan2(tgt.x - state.pos.x, tgt.z - state.pos.z);
    else {
      if (mag > 0.2) state.yaw = Math.atan2(wx, wz);
      const id = softLockPick(state.pos.x, state.pos.z, state.yaw, ctx.enemies, slice, PLAYER.softLockRange, PLAYER.softLockAngle);
      if (id >= 0) {
        state.softLockId = id;
        state.yaw = slice.yaw;
      }
    }
    lungeV = state.grounded ? (n === 3 ? 4.5 : 3.2) : 0;
    events.push({ type: "swing", pos: posV3(1), combo: n });
  }

  const plus: PlayerPlus = {
    state,
    group,
    updraftAt: null,
    ownTrail: true,
    debug: { combo: 1, mantle: -1, climbing: false, wade: 0, groundY: 0 },
    model,

    update(ctx) {
      events.length = 0;
      for (let i = 0; i < pending.length; i++) events.push(pending[i]);
      pending.length = 0;
      lastFx = ctx.fx;
      const dt = ctx.dt;
      const inp = ctx.input;
      const btn = inp.btn;
      const p = state.pos, v = state.vel;

      const cy = ctx.cameraYaw;
      const fx = Math.sin(cy), fz = Math.cos(cy);
      let wx = fx * inp.move.y - fz * inp.move.x;
      let wz = fz * inp.move.y + fx * inp.move.x;
      const mag = clamp(Math.hypot(inp.move.x, inp.move.y), 0, 1);
      const wl = Math.hypot(wx, wz);
      if (wl > 1e-5) {
        wx /= wl;
        wz /= wl;
      } else {
        wx = Math.sin(state.yaw);
        wz = Math.cos(state.yaw);
      }

      state.iFrames = Math.max(0, state.iFrames - dt);
      state.actionT += dt;
      riposteT = Math.max(0, riposteT - dt);
      combatT += dt;
      blockShove = Math.max(0, blockShove - dt);
      if (state.shieldUp) state.parryT += dt;
      jumpBuf = Math.max(0, jumpBuf - dt);
      // half a frame of slack: a press exactly jumpBuffer before touchdown still counts
      if (btn.jump.pressed) jumpBuf = PLAYER.jumpBuffer + dt * 0.5;
      jumpT += dt;
      jumpPressAir += dt;
      rollPressT += dt;
      dodgeCd = Math.max(0, dodgeCd - dt);
      dodgeBuf = Math.max(0, dodgeBuf - dt);
      atkBuf = Math.max(0, atkBuf - dt);
      const prog = ctx.progress;
      const rings = clamp(1 + Math.floor((prog ? prog.seeds : 0) / 3) / 3, 1, 2);
      state.staminaRings = rings;
      smax = PLAYER.staminaMax * rings;

      let staminaUse = 0;
      let regen = true;
      contact = false;
      contactBox = null;
      const wasPush = state.pushBox;
      state.pushBox = -1;

      if (state.mode === "dead") {
        deadT += dt;
        v.x *= Math.max(0, 1 - 4 * dt);
        v.z *= Math.max(0, 1 - 4 * dt);
        v.y -= GRAVITY * dt;
        gather(p.x, p.z, R + 1);
        moveStep(v.x * dt, v.y * dt, v.z * dt, 0.2, state.grounded, 0.3);
        finish(ctx, dt, mag);
        return events;
      }

      // thread ride: the thread module owns position and velocity while on (feet = ride.pos)
      const ride = ctx.threads ? ctx.threads.ride : null;
      if (ride && ride.on) {
        if (!wasRide) {
          if (state.shieldUp) events.push({ type: "shield", on: false });
          state.shieldUp = false;
          state.charge = 0;
          setAction("none");
          if (state.mode === "climb" && climbEvent) events.push({ type: "climb", on: false });
          if (state.mode === "glide") events.push({ type: "glide", on: false });
          if (state.mode === "swim") events.push({ type: "swim", on: false });
          climbEvent = false;
          mantleT = -1;
          vaultT = -1;
          state.mode = "ride";
        }
        wasRide = true;
        p.copy(ride.pos);
        v.copy(ride.vel);
        state.grounded = false;
        state.sprinting = false;
        const hs = Math.hypot(v.x, v.z);
        if (hs > 0.3) state.yaw = turnToward(state.yaw, Math.atan2(v.x, v.z), 8 * dt);
        if (v.y > 0) {
          state.stamina -= THREAD.rideUpCost * dt;
          staminaIdle = 0;
        }
        if (state.stamina <= 0) {
          state.stamina = 0;
          if (!state.exhausted) events.push({ type: "staminaOut" });
          state.exhausted = true;
        }
        jumpBuf = 0; // Thread owns jump while riding
        sinceGround = PLAYER.coyote;
        maxFall = 0;
        airTopY = p.y;
        finish(ctx, dt, mag);
        return events;
      }
      if (wasRide || state.mode === "ride") {
        wasRide = false;
        if (ride) v.copy(ride.vel);
        state.mode = "air";
        sinceGround = PLAYER.coyote;
        jumpBuf = 0;
        maxFall = 0;
        airTopY = p.y;
      }

      // vault: scripted arc over / onto a waist-high ledge
      if (vaultT >= 0) {
        vaultT += dt / vaultDur;
        const k = clamp(vaultT, 0, 1);
        const c = 2 * vaultPeak - 0.5 * (vaultFrom.y + vaultTo.y);
        p.x = vaultFrom.x + (vaultTo.x - vaultFrom.x) * k;
        p.z = vaultFrom.z + (vaultTo.z - vaultFrom.z) * k;
        p.y = (1 - k) * (1 - k) * vaultFrom.y + 2 * k * (1 - k) * Math.max(c, vaultFrom.y) + k * k * vaultTo.y;
        v.set(vaultX * vaultExit, 0, vaultZ * vaultExit);
        if (vaultT >= 1) {
          vaultT = -1;
          p.copy(vaultTo);
          setAction("none");
          gather(p.x, p.z, R + 1);
          const gy = groundHeight(p.x, p.y + 0.05, p.z, 0.1);
          state.grounded = p.y <= gy + 0.06;
          state.mode = state.grounded ? "ground" : "air";
          sinceGround = 0;
          maxFall = 0;
          airTopY = p.y;
        }
        finish(ctx, dt, mag);
        return events;
      }

      const act = state.action;
      const lockT = lockTarget(ctx);
      const free = act === "none" || act === "land" || act === "push" || act === "interact";

      if (state.mode === "climb") {
        regen = false;
        if (mantleT >= 0) {
          mantleT += dt / mantleDur;
          const k = clamp(mantleT, 0, 1);
          const up = 1 - (1 - clamp(k / 0.65, 0, 1)) ** 2;
          const fw = clamp((k - 0.3) / 0.7, 0, 1);
          const fws = fw * fw * (3 - 2 * fw);
          p.x = mantleFrom.x + (mantleTo.x - mantleFrom.x) * fws;
          p.z = mantleFrom.z + (mantleTo.z - mantleFrom.z) * fws;
          p.y = mantleFrom.y + (mantleTo.y - mantleFrom.y) * up;
          if (mantleT >= 1) {
            p.copy(mantleTo);
            mantleT = -1;
            climbEvent && events.push({ type: "climb", on: false });
            climbEvent = false;
            state.mode = "ground";
            state.grounded = true;
            sinceGround = 0;
            v.set(mantleX * mantleExit, 0, mantleZ * mantleExit);
            mantleExit = 0;
            maxFall = 0;
          }
          climbVX = climbVY = 0;
        } else {
          const nh = Math.hypot(wallN.x, wallN.z) || 1;
          const nx = wallN.x / nh, nz = wallN.z / nh;
          state.yaw = turnToward(state.yaw, Math.atan2(-nx, -nz), 10 * dt);
          const rx = -Math.cos(state.yaw), rz = Math.sin(state.yaw);
          let ux = -wallN.x * wallN.y, uy = 1 - wallN.y * wallN.y, uz = -wallN.z * wallN.y;
          const ul = Math.hypot(ux, uy, uz) || 1;
          ux /= ul; uy /= ul; uz /= ul;
          let cx = inp.move.x, cyv = inp.move.y;
          const rainMul = ctx.env.rain > 0.3 ? PLAYER.rainClimbMul : 1;
          let speed: number = PLAYER.climb;
          // last gasp: under 15% the climb slows; at zero Wren hangs hangAtZero s (one climb jump left), then lets go
          if (state.stamina <= PLAYER.lastGasp * smax) speed *= 0.75;
          if (state.exhausted && hangT < 0 && climbJumpT <= 0) {
            hangT = 0;
            gaspJump = true;
          }
          if (hangT >= 0) {
            hangT += dt;
            if (climbJumpT <= 0) speed = 0;
          }
          if (climbJumpT > 0) {
            climbJumpT -= dt;
            cx = climbJx;
            cyv = climbJy;
            speed = (PLAYER.climbJump / 0.34) * (0.6 + 0.8 * Math.max(0, climbJumpT / 0.34));
          }
          const cm = Math.hypot(cx, cyv);
          if (cm > 1) {
            cx /= cm;
            cyv /= cm;
          }
          climbVX = cx * speed;
          climbVY = cyv * speed;
          if (cm > 0.1 && climbJumpT <= 0 && hangT < 0) staminaUse += PLAYER.climbDrain * rainMul * Math.min(1, cm);
          if (btn.dodge.pressed) {
            setMode("air");
            climbEvent = false;
            v.set(nx * 2.5, 0, nz * 2.5);
          } else if (btn.jump.pressed && climbJumpT <= 0) {
            jumpBuf = 0;
            if (inp.move.y < -0.5) {
              setMode("air");
              v.set(nx * 5.5, PLAYER.jumpV * 0.9, nz * 5.5);
              state.yaw = Math.atan2(nx, nz);
              events.push({ type: "jump", pos: posV3() });
            } else if (!state.exhausted || gaspJump) {
              if (gaspJump) {
                gaspJump = false;
                hangT = PLAYER.hangAtZero - 0.05; // let go right after the last jump
              }
              state.stamina -= PLAYER.climbJumpCost * rainMul;
              staminaUse += 0.001;
              climbJumpT = 0.34;
              const l = Math.hypot(inp.move.x, Math.max(0.35, inp.move.y));
              climbJx = inp.move.x / l;
              climbJy = Math.max(0.35, inp.move.y) / l;
              events.push({ type: "jump", pos: posV3() });
            }
          }
          if (state.mode === "climb") {
            const reach = R + 0.75;
            let nxp = p.x, nyp = p.y, nzp = p.z;
            let onWall = false;
            for (let k = 0; k < 3 && !onWall; k++) {
              if (k > 0 && (Math.abs(climbVX) < 0.05 || Math.abs(climbVY) < 0.05)) break;
              const cvx = k === 1 ? 0 : climbVX, cvy = k === 2 ? 0 : climbVY;
              nxp = p.x + (rx * cvx + ux * cvy) * dt;
              nyp = p.y + uy * cvy * dt;
              nzp = p.z + (rz * cvx + uz * cvy) * dt;
              onWall = probeWall(nxp, nyp + 0.95, nzp, nx, nz, reach) && climbable();
              if (onWall && k > 0) {
                climbVX = cvx;
                climbVY = cvy;
              }
            }
            if (!onWall) probeWall(p.x + (rx * climbVX + ux * climbVY) * dt, p.y + uy * climbVY * dt + 0.95, p.z + (rz * climbVX + uz * climbVY) * dt, nx, nz, reach);
            if (onWall) {
              const hd = Math.hypot(hit.normal.x, hit.normal.z) || 1;
              wallN.lerp(hit.normal, Math.min(1, 12 * dt)).normalize();
              p.set(hit.point.x + (hit.normal.x / hd) * (R + 0.04), nyp, hit.point.z + (hit.normal.z / hd) * (R + 0.04));
              if (climbVY > 0.1) {
                const headClear = !(probeWall(p.x, p.y + 1.6, p.z, nx, nz, reach) && hit.normal.y < PLAYER.slopeWalk);
                if (headClear) tryMantle(nx, nz, 0.4, 2.0, MANTLE_TIME);
              }
            } else if (hit.hit && hit.normal.y >= PLAYER.slopeWalk && climbVY > 0.05) {
              if (!tryMantle(nx, nz, -0.2, 2.0, MANTLE_TIME * 0.8)) climbVY = 0;
            } else if (climbVY > 0.1 && tryMantle(nx, nz, 0.2, 2.0, MANTLE_TIME)) {
            } else if (Math.abs(climbVX) > 0.05 || climbVY > 0.05) {
              climbVX = climbVY = 0;
              climbJumpT = 0;
            } else if (climbVY < -0.05) {
              setMode("air");
              climbEvent = false;
              v.set(nx * 1.5, 0, nz * 1.5);
            } else if (!(probeWall(p.x, p.y + 0.95, p.z, nx, nz, reach) && climbable())) {
              setMode("air");
              climbEvent = false;
              v.set(nx, 0, nz);
            }
            if (state.mode === "climb" && mantleT < 0 && climbVY <= 0) {
              gather(p.x, p.z, R + 1);
              const gy = groundHeight(p.x, p.y, p.z, 0.05);
              if (p.y <= gy + 0.06 && groundNy >= PLAYER.slopeWalk) {
                p.y = gy;
                setMode("ground");
                climbEvent = false;
                state.grounded = true;
                v.set(0, 0, 0);
              }
            }
            if (state.mode === "climb" && hangT >= PLAYER.hangAtZero && climbJumpT <= 0 && mantleT < 0) {
              setMode("air");
              climbEvent = false;
              v.set(nx * 1.2, 0, nz * 1.2);
            }
          }
        }
        if (state.mode !== "climb") {
          sinceGround = state.mode === "ground" ? 0 : PLAYER.coyote;
          maxFall = 0;
          airTopY = p.y;
          hangT = -1;
          gaspJump = false;
        }
      }

      const canAct = state.mode === "ground" || state.mode === "air" || state.mode === "glide";
      let speedCap = Infinity;
      if (canAct) {
        if (state.action === "aim") {
          aimT += dt;
          state.charge = clamp(aimT / BOW.drawTime, 0, 1);
          state.yaw = turnToward(state.yaw, cy, 14 * dt);
          speedCap = PLAYER.walk;
          if (!btn.bow.down) {
            if (aimT >= BOW.minDraw && state.arrows > 0) fireArrow(ctx);
            setAction("none");
            state.charge = 0;
          } else if (btn.dodge.pressed && state.mode === "ground") {
            setAction("none");
            state.charge = 0;
          }
        } else if (btn.bow.pressed && state.hasBow && state.arrows > 0 && (free || state.action === "block") && state.mode !== "glide" || (btn.bow.pressed && state.hasBow && state.arrows > 0 && state.mode === "glide")) {
          setAction("aim");
          aimT = 0;
          state.shieldUp = false;
          combatT = 0;
          events.push({ type: "bowDraw" });
        }

        // sword combo clock (combat-events.ts): press on attack, strike every active frame with the blade's arc slice
        const a1 = state.action;
        const swinging = a1 === "attack1" || a1 === "attack2" || a1 === "attack3";
        if (swinging && btn.attack.pressed) sword.press();
        sword.update(dt);
        if (swinging || sword.started > 0) {
          if (sword.started > 0 && sword.step !== combo) startSwing(sword.step as 1 | 2 | 3, ctx, wx, wz, mag);
          if (sword.activeNow) {
            struck = true;
            arcSlice(sword.step, state.yaw, sword.u0, sword.u1, slice);
            doStrike(ctx, "sword", sword.damage(), SWORD.reach, slice.arc, slice.yaw, sword.knockback());
          }
          if (sword.ended) {
            setAction("none");
            combo = 1;
          }
        }
        const a2 = state.action;
        if (a2 === "attack1" || a2 === "attack2" || a2 === "attack3") {
          speedCap = 0;
          combatT = 0;
          struck = sword.phase === "active" || sword.phase === "recovery";
          if (state.mode !== "ground") v.y = Math.max(v.y, -2.5);
          if (a2 === "attack1" && sword.phase === "recovery" && btn.attack.down && btn.attack.held > 0.32 && !sword.queued && state.mode === "ground") {
            sword.cancel();
            setAction("charge");
            chargeSent = false;
            state.charge = 0;
          }
        } else if (a2 === "riposte") {
          const wind = 0.06, rec = 0.4;
          speedCap = 0;
          combatT = 0;
          if (!struck && state.actionT >= wind) {
            struck = true;
            doStrike(ctx, "riposte", SWORD.riposte, SWORD.reach + 0.3, SWORD.arc);
            events.push({ type: "swing", pos: posV3(1), combo: 3 });
          }
          if (state.mode !== "ground") v.y = Math.max(v.y, -2.5);
          if (state.actionT >= wind + rec) {
            setAction("none");
            combo = 1;
          }
        } else if (a2 === "charge") {
          speedCap = PLAYER.walk * 0.6;
          combatT = 0;
          if (btn.attack.down) state.charge = clamp((btn.attack.held - 0.3) / (SWORD.chargeTime - 0.3), 0, 1);
          if (state.charge >= 1 && !chargeSent) {
            chargeSent = true;
            events.push({ type: "chargeReady" });
          }
          if (lockT) state.yaw = turnToward(state.yaw, Math.atan2(lockT.x - p.x, lockT.z - p.z), 10 * dt);
          else if (mag > 0.2) state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), 8 * dt);
          if (!btn.attack.down) {
            if (state.charge >= 1 && !state.exhausted) {
              state.stamina -= PLAYER.spinCost;
              staminaUse += 0.001;
              setAction("spin");
              struck = false;
              events.push({ type: "spin", pos: posV3(1) });
            } else setAction("none");
            state.charge = 0;
          } else if (state.mode !== "ground") {
            setAction("none");
            state.charge = 0;
          }
        } else if (a2 === "spin") {
          speedCap = 1.5;
          combatT = 0;
          if (!struck && state.actionT >= 0.1) {
            struck = true;
            doStrike(ctx, "spin", SWORD.spinDamage, SWORD.spinReach, Math.PI * 2);
          }
          if (state.actionT >= SPIN_TIME) setAction("none");
        } else if ((btn.attack.pressed || atkBuf > 0) && (free || a2 === "block" || a2 === "parry") && state.mode !== "glide") {
          atkBuf = 0;
          state.shieldUp = false;
          if (riposteT > 0) {
            combo = 3;
            struck = false;
            setAction("riposte");
            riposteT = 0;
            if (lockT) state.yaw = Math.atan2(lockT.x - p.x, lockT.z - p.z);
            lungeV = 5;
          } else {
            sword.cancel();
            sword.press();
            sword.update(0);
            combo = 0;
            if (sword.started > 0) startSwing(1, ctx, wx, wz, mag);
          }
        }

        const a3 = state.action;
        const wantBlock = btn.block.down && state.mode === "ground" && (a3 === "none" || a3 === "block" || a3 === "parry" || a3 === "push" || a3 === "land");
        if (wantBlock && !state.shieldUp) {
          sword.cancel();
          state.shieldUp = true;
          state.parryT = 0;
          combatT = 0;
          events.push({ type: "shield", on: true });
        } else if (!wantBlock && state.shieldUp && a3 !== "parry") {
          state.shieldUp = false;
          events.push({ type: "shield", on: false });
        }
        if (state.shieldUp) {
          combatT = 0;
          if (a3 === "parry") {
            if (state.actionT > 0.35) setAction("block");
          } else if (a3 !== "block") setAction("block");
          speedCap = Math.min(speedCap, PLAYER.walk);
        } else if (a3 === "block" || a3 === "parry") setAction("none");

        const a4 = state.action;
        const rolling = a4 === "dodge" || a4 === "backstep" || a4 === "rollLand";
        const rollEnd = a4 === "backstep" ? PLAYER.backstepTime : a4 === "rollLand" ? ROLL_LAND_TIME : PLAYER.dodgeTime;
        // presses in the last 0.15 s of a roll are buffered and fire when it ends
        if (rolling && state.actionT >= rollEnd - 0.15) {
          if (btn.dodge.pressed) dodgeBuf = 0.15 + dt;
          if (btn.attack.pressed) atkBuf = 0.15 + dt;
        }
        if (rolling) {
          // i-frames only in the middle of the roll
          const t0 = PLAYER.dodgeIFrameStart, t1 = Math.min(PLAYER.dodgeIFrameEnd, rollEnd - PLAYER.dodgeRecover);
          if (state.actionT >= t0 && state.actionT < t1) state.iFrames = Math.max(state.iFrames, t1 - state.actionT);
          if (state.actionT >= rollEnd) {
            setAction("none");
            dodgeCd = dodgeBuf > 0 ? 0 : PLAYER.dodgeCooldown;
          }
        }
        const a5 = state.action;
        const wantDodge = btn.dodge.pressed || dodgeBuf > 0;
        if (wantDodge && state.mode === "ground" && dodgeCd <= 0 && !state.exhausted && (a5 === "none" || a5 === "block" || a5 === "land" || a5 === "push" || a5 === "charge" || a5 === "skid" || ((a5 === "attack1" || a5 === "attack2" || a5 === "attack3") && struck))) {
          if (state.shieldUp) {
            state.shieldUp = false;
            events.push({ type: "shield", on: false });
          }
          dodgeBuf = 0;
          state.charge = 0;
          skidT = -1;
          sword.cancel();
          if (mag < 0.2) {
            // no stick: a short backstep, facing kept (toward the lock target when locked)
            if (lockT) state.yaw = Math.atan2(lockT.x - p.x, lockT.z - p.z);
            rollX = -Math.sin(state.yaw);
            rollZ = -Math.cos(state.yaw);
            setAction("backstep");
          } else {
            rollX = wx;
            rollZ = wz;
            state.yaw = Math.atan2(rollX, rollZ);
            setAction("dodge");
          }
          state.stamina -= PLAYER.dodgeCost;
          staminaUse += 0.001;
          events.push({ type: "dodge", pos: posV3() });
          ctx.fx.burst("dust", posV3(0.1), 6, v3(-rollX, 0.4, -rollZ), 2);
        } else if (btn.dodge.pressed && state.mode === "ground" && dodgeCd > 0) dodgeBuf = dodgeCd + dt;
        const a6 = state.action;
        if (sword.phase !== "idle" && a6 !== "attack1" && a6 !== "attack2" && a6 !== "attack3") sword.cancel();
        if (state.action === "hurt" && state.actionT >= (hurtBig ? 1.15 : 0.38)) setAction("none");
        if (state.action === "land" && state.actionT >= 0.28) setAction("none");
        if (state.action === "interact" && state.actionT >= 0.45) setAction("none");
        if (btn.use.pressed && state.action === "none" && state.mode === "ground") setAction("interact");
      }

      if (landPendQ > 0) {
        landPendT += dt;
        if (btn.dodge.pressed && state.mode === "ground") {
          landPendQ = 0;
          if (state.action !== "dodge" && state.action !== "backstep") {
            skidSp = PLAYER.run * 0.6;
            rollX = Math.sin(state.yaw);
            rollZ = Math.cos(state.yaw);
            setAction("rollLand");
            events.push({ type: "dodge", pos: posV3() });
          } else if (state.action === "backstep") {
            rollX = Math.sin(state.yaw);
            rollZ = Math.cos(state.yaw);
            skidSp = PLAYER.run * 0.6;
            setAction("rollLand");
          }
        } else if (landPendT > PLAYER.rollLandWindow + EPS || state.mode !== "ground") {
          events.push({ type: "fallDamage", amount: landPendQ });
          landPendQ = 0;
        }
      }
      if (state.action === "rollLand" && state.actionT >= ROLL_LAND_TIME) setAction("none");

      if (state.mode !== "climb") {
        const act2 = state.action;
        const inWater = (waterY = world.waterAt(p.x, p.z)) > -1e8;
        if (lockT && state.mode === "ground" && (act2 === "none" || act2 === "block" || act2 === "charge" || act2 === "land")) {
          state.yaw = turnToward(state.yaw, Math.atan2(lockT.x - p.x, lockT.z - p.z), PLAYER.turnRate * dt);
        }

        if (state.mode === "ground") {
          sinceGround = 0;
          let target = mag < 0.5 ? PLAYER.walk * (mag / 0.5) : PLAYER.walk + (PLAYER.run - PLAYER.walk) * ((mag - 0.5) / 0.5);
          const canSprint = btn.sprint.down && !state.exhausted && mag > 0.5 && act2 === "none" && wade < 0.6;
          state.sprinting = canSprint;
          if (canSprint) {
            target = PLAYER.sprint;
            staminaUse += PLAYER.sprintCost;
          }
          if (act2 === "land") target *= 0.35;
          if (act2 === "interact") target = 0;
          if (act2 === "hurt") target = 0;
          target = Math.min(target, speedCap) * (1 - 0.45 * wade);
          const nh = Math.hypot(groundN.x, groundN.z);
          let uphill = 0;
          if (nh > 1e-3) uphill = -(wx * groundN.x + wz * groundN.z) / nh;
          if (uphill > 0) target *= 1 - 0.3 * uphill * (1 - groundNy) * 2.5;
          let tx = wx * target, tz = wz * target;
          if (mag < 0.05) tx = tz = 0;
          const vsp0 = Math.hypot(v.x, v.z);
          if (act2 === "none" && mag > 0.5 && vsp0 > PLAYER.skidSpeed && skidT < 0 && !lockT) {
            const c = (v.x * wx + v.z * wz) / vsp0;
            if (Math.acos(clamp(c, -1, 1)) > PLAYER.skidAngle) {
              skidT = 0;
              skidSp = vsp0;
              skidVX = v.x;
              skidVZ = v.z;
              setAction("skid");
              ctx.fx.burst("dust", posV3(0.05), 6, v3(v.x * 0.1, 0.4, v.z * 0.1), 2);
            }
          }
          if (state.action === "skid") {
            skidT += dt;
            skidX = wx;
            skidZ = wz;
            const k = clamp(1 - skidT / PLAYER.skidTime, 0, 1);
            v.x = skidVX * k;
            v.z = skidVZ * k;
            if (skidT >= PLAYER.skidTime) {
              const sp = skidSp * PLAYER.skidRelaunch;
              const dx = mag > 0.2 ? wx : skidX, dz = mag > 0.2 ? wz : skidZ;
              v.x = dx * sp;
              v.z = dz * sp;
              state.yaw = Math.atan2(dx, dz);
              skidT = -1;
              setAction("none");
            }
          } else if (act2 === "dodge" || act2 === "rollLand") {
            const T = act2 === "dodge" ? PLAYER.dodgeTime : ROLL_LAND_TIME;
            const k = state.actionT / T;
            const sp = (act2 === "dodge" ? ROLL_K : Math.max(ROLL_K * 0.7, skidSp)) * (1 - 0.6 * k * k);
            v.x = rollX * sp;
            v.z = rollZ * sp;
          } else if (act2 === "backstep") {
            const k = clamp(state.actionT / PLAYER.backstepTime, 0, 1);
            const sp = ((2 * PLAYER.backstepDist) / PLAYER.backstepTime) * (1 - k);
            v.x = rollX * sp;
            v.z = rollZ * sp;
          } else if (act2 === "hurt") {
            const k = Math.max(0, 1 - 6 * dt);
            v.x *= k;
            v.z *= k;
          } else if (act2 === "attack1" || act2 === "attack2" || act2 === "attack3" || act2 === "riposte") {
            const fxx = Math.sin(state.yaw), fzz = Math.cos(state.yaw);
            const k = Math.max(0, 1 - 14 * dt);
            v.x = v.x * k + fxx * lungeV * (1 - k);
            v.z = v.z * k + fzz * lungeV * (1 - k);
            lungeV = Math.max(0, lungeV - 14 * dt);
          } else {
            const sprintTurn = state.sprinting && !lockT && act2 === "none";
            if (mag > 0.05 && !lockT && act2 !== "charge" && act2 !== "aim") {
              const tr = sprintTurn ? PLAYER.sprintTurn : PLAYER.turnRate * (act2 === "push" ? 0.3 : 1);
              state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), tr * dt);
            }
            if (sprintTurn && mag > 0.05) {
              // sprint carries momentum: velocity follows the body, which turns at sprintTurn
              tx = Math.sin(state.yaw) * target;
              tz = Math.cos(state.yaw) * target;
            }
            const ax = tx - v.x, az = tz - v.z;
            const al = Math.hypot(ax, az);
            if (al > 1e-5) {
              const vsp = Math.hypot(v.x, v.z);
              let rate: number;
              if (mag < 0.05 || target < 0.05) rate = vsp > PLAYER.run + 0.5 ? 30 : PLAYER.accel; // stop
              else {
                const along = v.x * (tx / target) + v.z * (tz / target);
                const rev = vsp > 0.5 ? Math.max(0, -along / vsp) : 0;
                // ease-out start: reaches target in startEase from rest (dv/dt ~ sqrt(1 - v / target))
                const ease = ((2 * target) / PLAYER.startEase) * Math.sqrt(clamp(1 - along / target, 0.04, 1));
                rate = Math.max(ease, PLAYER.accel * (1 + 0.8 * rev));
              }
              const s = Math.min(1, (rate * dt) / al);
              v.x += ax * s;
              v.z += az * s;
            }
          }
          if (groundNy < PLAYER.slopeWalk && !groundBox && nh > 1e-3) {
            const dx = groundN.x / nh, dz = groundN.z / nh;
            const vin = v.x * dx + v.z * dz;
            if (vin < 0) {
              v.x -= dx * vin;
              v.z -= dz * vin;
            }
            const slide = GRAVITY * (1 - groundNy) * 1.4 * dt;
            v.x += dx * slide;
            v.z += dz * slide;
          }
          if (jumpBuf > 0 && (act2 === "none" || act2 === "land" || act2 === "push" || act2 === "block" || act2 === "skid")) {
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
            jumpT = 0;
            jumpCut = false;
            skidT = -1;
            if (act2 === "skid") setAction("none");
            state.grounded = false;
            if (state.shieldUp) {
              state.shieldUp = false;
              events.push({ type: "shield", on: false });
              setAction("none");
            }
            if (act2 === "push" || act2 === "land") setAction("none");
            setMode("air");
            sinceGround = PLAYER.coyote;
            events.push({ type: "jump", pos: posV3() });
            ctx.fx.burst("dust", posV3(0.05), 4, v3(0, 0.5, 0), 1.5);
          }
        } else if (state.mode === "air") {
          state.sprinting = false;
          sinceGround += dt;
          const hsp = Math.hypot(v.x, v.z);
          const ref = Math.max(PLAYER.run, hsp);
          if (act2 !== "dodge" && act2 !== "hurt" && mag > 0.05) {
            const tx = wx * ref * mag, tz = wz * ref * mag;
            const ax = tx - v.x, az = tz - v.z, al = Math.hypot(ax, az);
            if (al > 1e-5) {
              const s = Math.min(1, (PLAYER.airAccel * dt) / al);
              v.x += ax * s;
              v.z += az * s;
            }
            if (act2 !== "aim") state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), PLAYER.turnRate * 0.6 * dt);
          }
          let jumped = false;
          if (jumpBuf > 0 && sinceGround <= PLAYER.coyote + EPS && v.y <= 0.5 && act2 !== "dodge") {
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
            jumpT = 0;
            jumpCut = false;
            jumped = true;
            sinceGround = PLAYER.coyote + 1;
            airTopY = p.y;
            events.push({ type: "jump", pos: posV3() });
          }
          // jump cut: a release inside jumpCutT gives the short hop (applied at jumpCutT); a later release halves vy
          if (jumpRising && !jumpCut && !btn.jump.down && v.y > 0) {
            if (jumpT < PLAYER.jumpCutT) jumpCut = true;
            else {
              v.y *= 0.5;
              jumpRising = false;
            }
          }
          if (jumpRising && jumpCut && jumpT >= PLAYER.jumpCutT - EPS) {
            v.y *= PLAYER.jumpCutMul;
            jumpRising = false;
            jumpCut = false;
          }
          if (v.y <= 0) jumpRising = false;
          if (btn.dodge.pressed) rollPressT = 0;
          // glider: glide button, or a fresh jump press in the air (never the press that started the jump)
          if (btn.jump.pressed && !jumped) jumpPressAir = 0;
          const wantGlide = btn.glide.pressed || (jumpPressAir === 0 && !jumped && jumpT > 0.12 && sinceGround > PLAYER.coyote + EPS);
          if (wantGlide && state.hasGlider && !state.exhausted && act2 !== "hurt") {
            gather(p.x, p.z, R + 1);
            const gb = Math.max(groundHeight(p.x, p.y, p.z, 0), inWater ? waterY : -Infinity);
            if (p.y - gb >= PLAYER.glideMinHeight) {
              jumpBuf = 0;
              glideT = 0;
              glideMode = 0;
              pullUp = 0;
              glideBoostT = 0;
              setMode("glide");
              if (act2 !== "aim") setAction("none");
              maxFall = 0;
              v.y = Math.max(v.y, -1.5);
              ctx.fx.burst("leaf", posV3(2), 5, v3(0, 1, 0), 1.5);
            }
          }
          if (state.mode === "air" && !glidePromptSent && state.hasGlider && -v.y >= PLAYER.glidePromptSpeed) {
            gather(p.x, p.z, R + 1);
            const gb = Math.max(groundHeight(p.x, p.y, p.z, 0), inWater ? waterY : -Infinity);
            if (p.y - gb >= PLAYER.glidePromptDrop) {
              glidePromptSent = true;
              events.push({ type: "hint", id: "glide", btn: "jump", text: "Glide" });
            }
          }
        } else if (state.mode === "glide") {
          state.sprinting = false;
          regen = false;
          staminaUse += PLAYER.glideCost;
          sinceGround += dt;
          glideT += dt;
          const fyaw = Math.sin(state.yaw), fyz = Math.cos(state.yaw);
          // stick along the facing: forward = dive, back = flare; sideways turns at glideTurn
          const along = mag > 0.3 ? wx * fyaw + wz * fyz : 0;
          const prevMode = glideMode;
          glideMode = along > 0.75 && mag > 0.5 ? 2 : along < -0.6 && mag > 0.5 ? 1 : 0;
          const hsp0 = Math.hypot(v.x, v.z);
          if (prevMode === 2 && glideMode !== 2 && hsp0 > PLAYER.glideFwd + 0.5) {
            // pull-up: the dive's extra speed buys back up to glideDiveClimb m of height
            // budget minus the ~0.5 m she coasts up while vy settles back to the sink rate
            pullUp = (PLAYER.glideDiveClimb - 0.5) * clamp((hsp0 - PLAYER.glideFwd) / (PLAYER.glideDiveFwd - PLAYER.glideFwd), 0, 1);
          }
          if (glideMode === 2) pullUp = 0;
          let fwd: number = PLAYER.glideFwd, sink: number = PLAYER.glideSink;
          if (glideMode === 1) {
            fwd = PLAYER.glideFlareFwd;
            sink = PLAYER.glideFlareSink;
            staminaUse += PLAYER.glideCost * (PLAYER.glideFlareCost - 1);
          } else if (glideMode === 2) {
            fwd = PLAYER.glideDiveFwd;
            sink = PLAYER.glideDiveSink;
          }
          if (mag > 0.1 && glideMode === 0 && state.action !== "aim") {
            state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), PLAYER.glideTurn * dt);
          }
          const tx = Math.sin(state.yaw) * fwd, tz = Math.cos(state.yaw) * fwd;
          const k = Math.min(1, (glideMode === 2 ? 1.2 : 2.2) * dt);
          v.x += (tx - v.x) * k;
          v.z += (tz - v.z) * k;
          const up = plus.updraftAt ? plus.updraftAt(p.x, p.y, p.z) : 0;
          if (pullUp > 0 && up <= 0) {
            const vy = 6;
            v.y += (vy - v.y) * Math.min(1, 10 * dt);
            pullUp -= Math.max(0, v.y) * dt;
          } else {
            const ty = up > 0 ? up : -sink;
            v.y += (ty - v.y) * Math.min(1, (v.y < ty ? 3 : v.y > 0 ? 8 : 2.2) * dt);
          }
          // close: a fresh glide / jump press after 0.3 s (the opening press never closes it)
          const closePress = (btn.glide.pressed || btn.jump.pressed) && glideT >= 0.3;
          if (closePress || state.stamina <= 0 || !state.hasGlider) {
            jumpBuf = 0;
            pullUp = 0;
            glideMode = 0;
            setMode("air");
            airTopY = p.y;
          }
          maxFall = 0;
        } else if (state.mode === "swim") {
          state.sprinting = false;
          sinceGround = PLAYER.coyote;
          // dash: sprint or dodge press, swimDashTime s at swimFast for swimDashCost stamina
          swimDashT = Math.max(0, swimDashT - dt);
          if ((btn.sprint.pressed || btn.dodge.pressed) && swimDashT <= 0 && !state.exhausted && state.stamina > 0) {
            swimDashT = PLAYER.swimDashTime;
            state.stamina -= PLAYER.swimDashCost;
            staminaUse += 0.001;
          }
          const fast = swimDashT > 0;
          const sp = fast ? PLAYER.swimFast * Math.max(mag, 0.8) : PLAYER.swim * mag;
          staminaUse += mag > 0.1 ? PLAYER.swimCost : PLAYER.treadCost;
          regen = false;
          state.sprinting = fast;
          const k = Math.min(1, 5 * dt);
          const sx = mag > 0.05 ? wx : fast ? Math.sin(state.yaw) : 0, sz = mag > 0.05 ? wz : fast ? Math.cos(state.yaw) : 0;
          v.x += (sx * sp - v.x) * k;
          v.z += (sz * sp - v.z) * k;
          if (mag > 0.05) state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), 6 * dt);
          const ty = waterY - 1.22;
          v.y += ((ty - p.y) * 26 - v.y * 7) * dt;
          if (state.action !== "hurt") setAction("none");
          if (state.stamina <= 0) {
            events.push({ type: "drowned", pos: posV3() });
            hurt(PLAYER.drownPenalty, false);
            for (let i = 0; i < pending.length; i++) events.push(pending[i]);
            pending.length = 0;
            if (!isDead()) {
              setMode("ground");
              p.copy(state.lastSafe);
              v.set(0, 0, 0);
              state.stamina = smax;
              state.exhausted = false;
              setAction("none");
            }
          }
        }

        // soft world edge: past the coast a growing push turns Wren back; at the band's end outward motion stops
        edgeAt(world, p.x, p.z, edge);
        if (edge.k > 0) {
          const out = -(v.x * edge.nx + v.z * edge.nz);
          if (out > 0) {
            const keep = 1 - edge.k;
            v.x += edge.nx * out * (1 - keep * keep);
            v.z += edge.nz * out * (1 - keep * keep);
          }
          v.x += edge.nx * 12 * edge.k * dt;
          v.z += edge.nz * 12 * edge.k * dt;
          if (state.mode === "swim") staminaUse = 0; // never drown out at the edge
        }
        // exact per-frame gravity (rise at GRAVITY, fall at GRAVITY * fallGravityMul): jump height does not depend on dt
        const gFall = GRAVITY * PLAYER.fallGravityMul;
        let dy = v.y * dt;
        if (state.mode === "air" || state.mode === "ground") {
          const vy0 = v.y;
          if (vy0 > 0 && state.mode === "air") {
            const t1 = Math.min(dt, vy0 / GRAVITY), t2 = dt - t1;
            dy = vy0 * t1 - 0.5 * GRAVITY * t1 * t1 - 0.5 * gFall * t2 * t2;
            v.y = vy0 - GRAVITY * t1 - gFall * t2;
          } else {
            const g = state.mode === "air" ? gFall : GRAVITY;
            dy = vy0 * dt - 0.5 * g * dt * dt;
            v.y = vy0 - g * dt;
          }
        }
        if (state.mode === "air" && v.y < -42) {
          v.y = -42;
          dy = Math.max(dy, -42 * dt);
        }
        if (state.mode === "air") airTopY = Math.max(airTopY, p.y);
        else if (state.mode !== "glide") airTopY = p.y;
        hspPre = Math.hypot(v.x, v.z); // speed before walls eat it (vault keeps 80% of this)
        const travel = Math.hypot(v.x * dt, dy, v.z * dt);
        const steps = Math.min(10, Math.max(1, Math.ceil(travel / SUBSTEP_MAX)));
        const h = dt / steps;
        gather(p.x, p.z, R + travel + 1.2);
        const wasGrounded = state.grounded && state.mode === "ground";
        const allow = state.mode === "ground" ? PLAYER.stepUp : state.mode === "swim" ? 0.6 : 0.15;
        const snap = state.mode === "ground" && v.y <= 0 ? 0.55 : 0;
        maxFall = state.mode === "air" ? Math.max(maxFall, -v.y) : maxFall;
        for (let i = 0; i < steps; i++) {
          moveStep(v.x * h, dy / steps, v.z * h, allow, wasGrounded && i === 0 ? true : state.grounded && state.mode === "ground", snap);
        }
        if (state.mode === "swim") state.grounded = false;

        const depth = inWater ? waterY - groundHeight(p.x, p.y + 0.3, p.z, 0.3) : 0;
        const sub = inWater ? waterY - p.y : 0;
        wade = state.mode === "ground" && inWater ? clamp(sub / 1.1, 0, 1) : 0;
        if (state.mode !== "swim" && inWater && depth > 1.3 && sub > 1.05) {
          const size = clamp(-v.y / 10, 0.3, 2);
          events.push({ type: "splash", pos: v3(p.x, waterY, p.z), size });
          ctx.fx.burst("splash", v3(p.x, waterY, p.z), Math.round(6 + size * 10), v3(0, 1, 0), 2 + size * 2);
          if (state.shieldUp) {
            state.shieldUp = false;
            events.push({ type: "shield", on: false });
          }
          setAction("none");
          state.charge = 0;
          setMode("swim");
          v.y *= 0.35;
          v.x *= 0.5;
          v.z *= 0.5;
          maxFall = 0;
        } else if (state.mode === "swim" && (!inWater || depth < 1.15)) {
          setMode("ground");
          state.grounded = true;
          v.y = 0;
        } else if (state.mode === "ground" && !state.grounded) {
          setMode("air");
          sinceGround = 0;
          maxFall = 0;
          airTopY = p.y;
          if (state.action === "skid") setAction("none");
        } else if ((state.mode === "air" || state.mode === "glide") && state.grounded) {
          // impact from the drop height (exact) capped by the measured speed (knockback, ride exits)
          const hImpact = Math.sqrt(2 * gFall * Math.max(0, airTopY - p.y));
          const impact = state.mode === "glide" ? Math.min(maxFall, 3) : Math.min(maxFall, hImpact);
          glidePromptSent = false;
          setMode("ground");
          sinceGround = 0;
          model.land(impact / 18);
          if (impact > 2.5) {
            events.push({ type: "land", pos: posV3(), speed: impact, surface: surfaceHere() });
            ctx.fx.burst("dust", posV3(0.05), Math.round(clamp(impact, 3, 18)), v3(0, 0.6, 0), 1 + impact * 0.12);
          }
          const hs = Math.hypot(v.x, v.z);
          const rollable = impact < PLAYER.fallSafe + 6;
          const startRollLand = () => {
            skidSp = Math.max(hs, PLAYER.run * 0.6);
            if (hs > 0.5) {
              rollX = v.x / hs;
              rollZ = v.z / hs;
            } else if (mag > 0.2) {
              rollX = wx;
              rollZ = wz;
            } else {
              rollX = Math.sin(state.yaw);
              rollZ = Math.cos(state.yaw);
            }
            state.yaw = Math.atan2(rollX, rollZ);
            setAction("rollLand");
            events.push({ type: "dodge", pos: posV3() });
          };
          if (state.action === "aim" || state.action === "attack1" || state.action === "attack2" || state.action === "attack3") {
            if (state.action !== "aim") setAction("none");
          }
          if (impact > PLAYER.fallSafe && wade < 0.5) {
            const q = Math.ceil((impact - PLAYER.fallSafe) / PLAYER.fallPerQuarter);
            if (rollable && rollPressT <= PLAYER.rollLandWindow + EPS) startRollLand();
            else if (rollable) {
              landPendQ = q; // wait rollLandWindow for a roll press before it hurts
              landPendT = 0;
              setAction("land");
            } else events.push({ type: "fallDamage", amount: q });
            jumpBuf = 0;
          } else if (impact > 9 && rollPressT <= PLAYER.rollLandWindow + EPS && state.action === "none") startRollLand();
          else if (impact > 9 && state.action === "none" && jumpBuf <= 0) setAction("land");
          rollPressT = 99;
          maxFall = 0;
          jumpRising = false;
          if (jumpBuf > 0 && (state.action === "none" || state.action === "land")) {
            setAction("none");
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
            jumpT = 0;
            jumpCut = !btn.jump.down;
            airTopY = p.y;
            state.grounded = false;
            setMode("air");
            sinceGround = PLAYER.coyote;
            events.push({ type: "jump", pos: posV3() });
          }
        }

        if (contact && !isDead()) {
          const into = mag > 0.3 ? -(wx * contactNx + wz * contactNz) : 0;
          if (into > 0.55) wallPushT += dt;
          else wallPushT = 0;
          const okAct = state.action === "none" || state.action === "push" || state.action === "land";
          const box = contactBox as Box | null;
          if (state.mode === "ground" && box && box.tag === "pushable" && into > 0.7 && (Math.abs(contactNx) > 0.9 || Math.abs(contactNz) > 0.9) && okAct) {
            pushT += dt;
            if (pushT > 0.18) {
              state.pushBox = box.id;
              state.pushDir.x = Math.abs(contactNx) > 0.9 ? -Math.sign(contactNx) : 0;
              state.pushDir.y = Math.abs(contactNz) > 0.9 ? -Math.sign(contactNz) : 0;
              setAction("push");
              const sp = PUSH_SPEED;
              v.x = state.pushDir.x * sp;
              v.z = state.pushDir.y * sp;
              state.yaw = turnToward(state.yaw, Math.atan2(state.pushDir.x, state.pushDir.y), 8 * dt);
            }
          } else if (into > 0.55 && okAct && box && box.tag !== "pushable" && state.mode === "ground" && hspPre > 3 &&
            box.maxY - p.y >= PLAYER.vaultMin - 0.01 && box.maxY - p.y <= PLAYER.vaultMax && tryVault(box, contactNx, contactNz, hspPre)) {
            // vaulted on contact
          } else if (into > 0.55 && okAct && !state.exhausted && state.stamina > 0) {
            const top = box ? box.maxY - p.y : 99;
            const fast = hspPre > 3;
            const quick = state.mode !== "ground" || wallPushT > 0.14;
            const maxUp = state.mode === "air" ? PLAYER.mantleMax + PLAYER.ledgeCatch : PLAYER.mantleMax;
            if (box && top > PLAYER.stepUp && top <= maxUp && box.tag !== "pushable" && (state.mode === "ground" || state.mode === "air") && (quick || (fast && top > PLAYER.vaultMax))) {
              climbEvent = false;
              const exit = top > PLAYER.vaultMax ? hspPre * PLAYER.mantleExitMul : 0;
              if (!tryMantle(contactNx, contactNz, PLAYER.stepUp, maxUp + 0.05, top > PLAYER.vaultMax ? PLAYER.mantleTime : PLAYER.vaultTime, exit)) {
                wallPushT = 0;
                if (top > PLAYER.vaultMax && quick && probeWall(p.x, p.y + 0.95, p.z, contactNx, contactNz, R + 0.6) && climbable()) {
                  startClimb(hit.normal.x, hit.normal.y, hit.normal.z);
                }
              }
            } else if (quick && (state.mode === "ground" || state.mode === "air" || state.mode === "glide" || state.mode === "swim")) {
              const py = state.mode === "swim" ? waterY - 0.4 : p.y + 0.95;
              if (probeWall(p.x, py, p.z, contactNx, contactNz, R + 0.6) && climbable()) {
                if (state.mode === "swim") p.y = Math.max(p.y, waterY - 1.3);
                startClimb(hit.normal.x, hit.normal.y, hit.normal.z);
              }
            }
          }
        } else wallPushT = 0;
        if (state.pushBox < 0) {
          pushT = contact ? pushT : 0;
          if (state.action === "push") setAction("none");
        }
        if (state.mode === "ground" && !groundBox && groundNy < CLIMB_NY && mag > 0.3 && state.action === "none" && !state.exhausted) {
          const nh = Math.hypot(groundN.x, groundN.z);
          if (nh > 1e-3 && -(wx * groundN.x + wz * groundN.z) / nh > 0.6) {
            if (probeWall(p.x, p.y + 0.95, p.z, groundN.x / nh, groundN.z / nh, R + 0.9) && climbable()) startClimb(hit.normal.x, hit.normal.y, hit.normal.z);
          }
        }
      }

      if (wasPush >= 0 && state.pushBox < 0) events.push({ type: "push", on: false });
      else if (wasPush < 0 && state.pushBox >= 0) events.push({ type: "push", on: true });

      if (staminaUse > 0) {
        state.stamina -= staminaUse * dt;
        staminaIdle = 0;
      } else if (regen) {
        staminaIdle += dt;
        if (staminaIdle >= PLAYER.staminaDelay) state.stamina += PLAYER.staminaRegen * dt * (state.mode === "air" ? 0.5 : 1);
      }
      if (state.stamina <= 0) {
        state.stamina = 0;
        if (!state.exhausted) {
          state.exhausted = true;
          events.push({ type: "staminaOut" });
          if (state.mode === "glide") setMode("air");
        }
      }
      if (state.stamina >= smax) {
        state.stamina = smax;
        state.exhausted = false;
      }

      if (state.mode === "ground" && state.grounded && wade < 0.3 && groundNy >= PLAYER.slopeWalk && state.action !== "dodge") {
        safeT += dt;
        if (safeT > 0.3) state.lastSafe.copy(p);
      } else safeT = 0;

      finish(ctx, dt, mag);
      return events;
    },

    handle(evs) {
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        switch (e.type) {
          case "hit": {
            if (e.team !== "enemy" || e.target !== -1 || state.mode === "dead") break;
            if (e.parried) {
              setAction("parry");
              riposteT = SWORD.parryStun;
              combatT = 0;
              lastFx?.burst("spark", e.pos, 14, e.dir, 5);
              break;
            }
            if (e.blocked) {
              state.vel.x += e.dir.x * e.knockback * 0.6;
              state.vel.z += e.dir.z * e.knockback * 0.6;
              blockShove = 0.2;
              lastFx?.burst("spark", e.pos, 6, e.dir, 3);
              if (e.damage > 0) hurt(e.damage, false);
              break;
            }
            if (state.iFrames > 0) break;
            const big = e.kind === "slam" || e.kind === "warden" || e.knockback >= 7;
            hurt(e.damage, big);
            const kb = e.knockback * (big ? 1.15 : 1);
            state.vel.x = e.dir.x * kb;
            state.vel.z = e.dir.z * kb;
            if (big && !isDead()) state.vel.y = Math.max(state.vel.y, 4);
            break;
          }
          case "fallDamage":
            if (state.mode !== "dead") {
              hurt(e.amount, e.amount >= 3);
              state.vel.x = state.vel.z = 0;
            }
            break;
          case "pickup":
            switch (e.kind) {
              case "glimmer": state.glimmers += e.amount; break;
              case "arrows": state.arrows = Math.min(PLAYER.maxArrows, state.arrows + e.amount); break;
              case "bow":
                state.hasBow = true;
                state.arrows = Math.min(PLAYER.maxArrows, state.arrows + e.amount);
                break;
              case "glider": state.hasGlider = true; break;
              case "heart": {
                const before = state.hp;
                state.hp = Math.min(state.maxHp, state.hp + e.amount);
                if (state.hp > before) pending.push({ type: "heal", amount: state.hp - before, hp: state.hp });
                break;
              }
              case "shard":
                state.shards += e.amount;
                while (state.shards >= PLAYER.shardsPerHeart && state.maxHp < PLAYER.maxHearts * 4) {
                  state.shards -= PLAYER.shardsPerHeart;
                  state.maxHp += 4;
                  const amt = state.maxHp - state.hp;
                  state.hp = state.maxHp;
                  pending.push({ type: "heal", amount: amt, hp: state.hp });
                }
                if (state.maxHp >= PLAYER.maxHearts * 4) state.shards = Math.min(state.shards, PLAYER.shardsPerHeart - 1);
                break;
            }
            break;
          case "rest":
            if (state.mode !== "dead" && state.hp < state.maxHp) {
              const amt = state.maxHp - state.hp;
              state.hp = state.maxHp;
              pending.push({ type: "heal", amount: amt, hp: state.hp });
            }
            state.stamina = smax;
            state.exhausted = false;
            break;
          default:
            break;
        }
      }
    },

    place(pos, yaw, hp) {
      const p = state.pos;
      p.set(pos.x, pos.y, pos.z);
      gather(p.x, p.z, R + 1);
      const gy = groundHeight(p.x, p.y + 1, p.z, 0.5);
      if (p.y < gy) p.y = gy;
      state.vel.set(0, 0, 0);
      state.yaw = yaw;
      prevYaw = yaw;
      state.mode = "ground";
      state.grounded = true;
      state.action = "none";
      state.actionT = 0;
      state.charge = 0;
      state.shieldUp = false;
      state.parryT = 0;
      state.pushBox = -1;
      state.iFrames = 0;
      state.sprinting = false;
      state.stamina = smax;
      state.exhausted = false;
      if (hp !== undefined) state.hp = hp;
      if (state.hp <= 0) state.hp = state.maxHp;
      state.lastSafe.copy(p);
      mantleT = -1;
      climbEvent = false;
      jumpBuf = 0;
      maxFall = 0;
      stepOffset = 0;
      combo = 1;
      riposteT = 0;
      pending.length = 0;
    },

    load(s: SaveData) {
      state.maxHp = s.maxHp;
      state.hp = Math.min(s.hp, s.maxHp);
      state.shards = s.shards;
      state.glimmers = s.glimmers;
      state.arrows = s.arrows;
      state.hasBow = s.hasBow;
      state.hasGlider = s.hasGlider;
    },

    setQuality(q) {
      model.setShadows(QUALITY[q].shadow > 0);
    },

    dispose() {
      scene.remove(group);
      model.dispose();
    },
  };

  /** Shared tail: animation, sockets, transforms. */
  function finish(ctx: FrameCtx, dt: number, mag: number) {
    const p = state.pos, v = state.vel;
    if (dt > 0) {
      turnRate = turnRate + (wrap(state.yaw - prevYaw) / dt - turnRate) * Math.min(1, 10 * dt);
    }
    prevYaw = state.yaw;
    stepOffset *= Math.max(0, 1 - 14 * dt);
    if (Math.abs(stepOffset) > 0.6) stepOffset = Math.sign(stepOffset) * 0.6;
    gather(p.x, p.z, R + 0.5);
    groundBelow = groundHeight(p.x, p.y + 0.05, p.z, 0);

    const armed = combatT < SHEATHE_AFTER || state.lockId >= 0;
    const hsp = Math.hypot(v.x, v.z);
    anim.mode = state.mode;
    anim.action = state.action;
    anim.actionT = state.actionT;
    anim.speed = state.mode === "climb" ? 0 : hsp;
    anim.vy = v.y;
    anim.grounded = state.grounded;
    anim.sprint = state.sprinting;
    anim.turn = turnRate;
    anim.climbX = climbVX;
    anim.climbY = climbVY;
    anim.mantle = state.mode === "climb" && mantleT >= 0 ? mantleT : -1;
    anim.combo = state.action === "riposte" ? 3 : combo;
    anim.windup = SWORD.comboWindup[Math.max(0, Math.min(2, combo - 1))];
    anim.recover = SWORD.comboRecover[Math.max(0, Math.min(2, combo - 1))];
    anim.charge = state.action === "charge" ? state.charge : 0;
    anim.draw = state.action === "aim" ? state.charge : 0;
    anim.shield = state.shieldUp;
    anim.swimMove = state.mode === "swim" ? clamp(hsp / PLAYER.swim, 0, 1) * (mag > 0.05 ? 1 : 0.6) : 0;
    anim.wade = wade;
    anim.hurtBig = hurtBig;
    anim.armed = armed;
    anim.hasBow = state.hasBow;
    anim.time = ctx.time;
    anim.windX = ctx.env.wind.x;
    anim.windZ = ctx.env.wind.y;
    anim.exhausted = state.exhausted;
    const nh = Math.hypot(groundN.x, groundN.z);
    anim.slope = state.mode === "ground" && nh > 1e-3 ? clamp(-(Math.sin(state.yaw) * groundN.x + Math.cos(state.yaw) * groundN.z), -0.8, 0.8) : 0;
    if (blockShove > 0 && state.action === "block") anim.actionT = 0.15;
    // v2 anim fields (HeroAnimIn); the v1 model ignores what it does not know
    const leanTo = state.mode === "glide" ? clamp(turnRate / PLAYER.glideTurn, -1, 1)
      : state.sprinting ? clamp(turnRate / PLAYER.sprintTurn, -1, 1) : 0; // +yaw = turning left
    lean += (leanTo - lean) * Math.min(1, 8 * dt);
    const a2 = anim;
    a2.lean = lean;
    a2.skid = state.action === "skid" ? clamp(skidT / PLAYER.skidTime, 0, 1) : -1;
    a2.vault = vaultT >= 0 ? clamp(vaultT, 0, 1) : -1;
    a2.rideT = state.mode === "ride" && ctx.threads ? ctx.threads.ride.t : -1;
    a2.pinAim = false;
    a2.glideMode = state.mode === "glide" ? glideMode : 0;
    // reticle ray for thread / bow aiming
    const cam = ctx.camera;
    if (cam && state.aimOrigin && state.aimDir) {
      state.aimOrigin.copy(cam.position);
      cam.getWorldDirection(state.aimDir);
    }

    group.position.set(p.x, p.y + stepOffset, p.z);
    group.rotation.y = state.yaw;
    model.setGroundOffset(Math.min(0, groundBelow - p.y - stepOffset));
    model.trailOn = plus.ownTrail;
    model.update(anim, dt);
    state.lanternPos.copy(model.lanternWorld);
    state.handPos.copy(model.handWorld);

    if (model.footstep && state.mode === "ground") {
      events.push({ type: "footstep", pos: posV3(), surface: surfaceHere(), run: hsp > PLAYER.walk + 0.5 });
      if (hsp > PLAYER.run + 0.5) ctx.fx.burst(wade > 0.1 ? "splash" : "dust", posV3(0.05), 2, v3(-v.x * 0.05, 0.4, -v.z * 0.05), 1);
    }
    const a = state.action;
    const swinging = ((a === "attack1" || a === "attack2" || a === "attack3" || a === "riposte") && state.actionT < 0.35) || (a === "spin" && state.actionT < 0.45);
    ctx.fx.trail(0, model.bladeTipWorld, swinging);
    plus.debug.combo = combo;
    plus.debug.mantle = mantleT;
    plus.debug.climbing = state.mode === "climb";
    plus.debug.wade = wade;
    plus.debug.groundY = groundBelow;
    void tv;
  }

  model.update(anim, 0);
  state.lanternPos.copy(model.lanternWorld);
  state.handPos.copy(model.handWorld);
  return plus;
}
