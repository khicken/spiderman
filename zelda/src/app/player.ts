import * as THREE from "three";
import type {
  Box, FrameCtx, GameEvent, Look, MoveMode, Player, PlayerAction, Quality, RayHit, SaveData, Shot, Strike, Surface, V3, World,
} from "./contracts";
import { BOW, GRAVITY, PLAYER, QUALITY, SUBSTEP_MAX, SWORD } from "./contracts";
import { newPlayerState } from "./state";
import { createWrenModel, newAnimIn } from "./player-model";


/** Extra hooks the integrator may wire. Everything in the Player contract is unchanged. */
export type PlayerPlus = Player & {
  /** Vertical updraft speed (m/s) at a point, or 0. Landmarks' warm air columns at the cliff top. */
  updraftAt: ((x: number, y: number, z: number) => number) | null;
  /** Draw Wren's own sword ribbon (turn off if render's Fx.trail already draws one). */
  ownTrail: boolean;
  /** Lab/debug: current combo index, mantle progress, wall normal. */
  readonly debug: { combo: number; mantle: number; climbing: boolean; wade: number; groundY: number };
};

const R = PLAYER.radius;
const H = PLAYER.height;
const CLIMB_NY = 0.643; // normal.y below this is a climbable face (50 deg)
const PUSH_SPEED = 1.5;
const ROLL_K = PLAYER.dodgeDist / (PLAYER.dodgeTime * 0.8);
const SPIN_TIME = 0.55;
const MANTLE_TIME = 0.5;
const VAULT_TIME = 0.32;
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
  const anim = newAnimIn();
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
  let chargeSent = false;
  let riposteT = 0;
  let combatT = 99;
  let rollX = 0, rollZ = 1;
  let hurtBig = false;
  let aimT = 0;
  let lungeV = 0;
  let blockShove = 0;
  let deadT = 0;
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
    return world.isClimbable(hit.normal, hit.box) && hit.normal.y < PLAYER.slopeWalk;
  }

  function startClimb(nx: number, ny: number, nz: number) {
    wallN.set(nx, ny, nz).normalize();
    climbEvent = true;
    state.vel.set(0, 0, 0);
    climbJumpT = 0;
    setAction("none");
    state.shieldUp = false;
    setMode("climb");
    state.grounded = false;
    state.yaw = Math.atan2(-wallN.x, -wallN.z);
  }

  /** Find a walkable top over a ledge in front (direction -nx,-nz) and start a mantle. */
  function tryMantle(nx: number, nz: number, minUp: number, maxUp: number, dur: number): boolean {
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
    state.vel.set(0, 0, 0);
    state.yaw = Math.atan2(-nx, -nz);
    setAction("none");
    setMode("climb");
    return true;
  }

  function hurt(amount: number, big: boolean) {
    if (state.mode === "dead" || amount <= 0) return;
    state.hp = Math.max(0, state.hp - amount);
    state.iFrames = PLAYER.hurtIFrames;
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

  function doStrike(ctx: FrameCtx, kind: Strike["kind"], damage: number, reach: number, arc: number) {
    const p = state.pos;
    strike.origin.x = p.x;
    strike.origin.y = p.y + 1.0;
    strike.origin.z = p.z;
    strike.yaw = state.yaw;
    strike.kind = kind;
    strike.damage = damage;
    strike.reach = reach;
    strike.arc = arc;
    strike.knockback = kind === "spin" ? SWORD.knockback * 1.6 : kind === "riposte" ? SWORD.knockback * 1.4 : SWORD.knockback;
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

  function startSwing(n: 1 | 2 | 3, ctx: FrameCtx, wx: number, wz: number, mag: number) {
    combo = n;
    struck = false;
    queued = false;
    setAction(n === 1 ? "attack1" : n === 2 ? "attack2" : "attack3");
    combatT = 0;
    const tgt = lockTarget(ctx);
    if (tgt) state.yaw = Math.atan2(tgt.x - state.pos.x, tgt.z - state.pos.z);
    else if (mag > 0.2) state.yaw = Math.atan2(wx, wz);
    lungeV = state.grounded ? (n === 3 ? 4.5 : 3.2) : 0;
  }

  const plus: PlayerPlus = {
    state,
    group,
    updraftAt: null,
    ownTrail: true,
    debug: { combo: 1, mantle: -1, climbing: false, wade: 0, groundY: 0 },

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
      if (btn.jump.pressed) jumpBuf = PLAYER.jumpBuffer;

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
            v.set(0, 0, 0);
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
          let speed = PLAYER.climb;
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
          if (cm > 0.1 && climbJumpT <= 0) staminaUse += PLAYER.climbCost * rainMul * Math.min(1, cm);
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
            } else if (!state.exhausted) {
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
            if (state.mode === "climb" && state.exhausted && mantleT < 0) {
              setMode("air");
              climbEvent = false;
              v.set(nx * 1.2, 0, nz * 1.2);
            }
          }
        }
        if (state.mode !== "climb") {
          sinceGround = state.mode === "ground" ? 0 : PLAYER.coyote;
          maxFall = 0;
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

        const a2 = state.action;
        if (a2 === "attack1" || a2 === "attack2" || a2 === "attack3" || a2 === "riposte") {
          const i = a2 === "riposte" ? 2 : combo - 1;
          const wind = a2 === "riposte" ? 0.06 : SWORD.comboWindup[i];
          const rec = a2 === "riposte" ? 0.4 : SWORD.comboRecover[i];
          speedCap = 0;
          combatT = 0;
          if (!struck && state.actionT >= wind) {
            struck = true;
            if (a2 === "riposte") doStrike(ctx, "riposte", SWORD.riposte, SWORD.reach + 0.3, SWORD.arc);
            else doStrike(ctx, "sword", SWORD.combo[i], SWORD.reach, SWORD.arc);
            events.push({ type: "swing", pos: posV3(1), combo: (a2 === "riposte" ? 3 : combo) as 1 | 2 | 3 });
          }
          if (btn.attack.pressed && state.actionT > wind * 0.5) queued = true;
          if (state.mode !== "ground") v.y = Math.max(v.y, -2.5);
          if (a2 === "attack1" && struck && btn.attack.down && btn.attack.held > 0.32 && !queued && state.mode === "ground") {
            setAction("charge");
            chargeSent = false;
            state.charge = 0;
          } else if (queued && combo < 3 && a2 !== "riposte" && state.actionT >= wind + 0.13) {
            startSwing((combo + 1) as 2 | 3, ctx, wx, wz, mag);
          } else if (state.actionT >= wind + rec) {
            setAction("none");
            combo = 1;
          } else if (btn.dodge.pressed && struck && state.mode === "ground") {
            setAction("none");
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
        } else if (btn.attack.pressed && (free || a2 === "block" || a2 === "parry") && state.mode !== "glide") {
          state.shieldUp = false;
          if (riposteT > 0) {
            combo = 3;
            struck = false;
            setAction("riposte");
            riposteT = 0;
            if (lockT) state.yaw = Math.atan2(lockT.x - p.x, lockT.z - p.z);
            lungeV = 5;
          } else startSwing(1, ctx, wx, wz, mag);
        }

        const a3 = state.action;
        const wantBlock = btn.block.down && state.mode === "ground" && (a3 === "none" || a3 === "block" || a3 === "parry" || a3 === "push" || a3 === "land");
        if (wantBlock && !state.shieldUp) {
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
        if (btn.dodge.pressed && state.mode === "ground" && !state.exhausted && (a4 === "none" || a4 === "block" || a4 === "land" || a4 === "push" || a4 === "charge" || ((a4 === "attack1" || a4 === "attack2" || a4 === "attack3") && struck))) {
          if (state.shieldUp) {
            state.shieldUp = false;
            events.push({ type: "shield", on: false });
          }
          state.charge = 0;
          let rx2 = wx, rz2 = wz;
          if (mag < 0.2) {
            if (lockT) {
              rx2 = -Math.sin(state.yaw);
              rz2 = -Math.cos(state.yaw);
            } else {
              rx2 = Math.sin(state.yaw);
              rz2 = Math.cos(state.yaw);
            }
          }
          rollX = rx2;
          rollZ = rz2;
          state.yaw = Math.atan2(rollX, rollZ);
          state.stamina -= PLAYER.dodgeCost;
          staminaUse += 0.001;
          state.iFrames = Math.max(state.iFrames, PLAYER.dodgeIFrames);
          setAction("dodge");
          events.push({ type: "dodge", pos: posV3() });
          ctx.fx.burst("dust", posV3(0.1), 6, v3(-rollX, 0.4, -rollZ), 2);
        }
        if (state.action === "dodge" && state.actionT >= PLAYER.dodgeTime) setAction("none");
        if (state.action === "hurt" && state.actionT >= (hurtBig ? 1.15 : 0.38)) setAction("none");
        if (state.action === "land" && state.actionT >= 0.28) setAction("none");
        if (state.action === "interact" && state.actionT >= 0.45) setAction("none");
        if (btn.use.pressed && state.action === "none" && state.mode === "ground") setAction("interact");
      }

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
          if (act2 === "dodge") {
            const k = state.actionT / PLAYER.dodgeTime;
            const sp = ROLL_K * (1 - 0.6 * k * k);
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
            const ax = tx - v.x, az = tz - v.z;
            const al = Math.hypot(ax, az);
            if (al > 1e-5) {
              const vsp = Math.hypot(v.x, v.z);
              const rev = vsp > 0.5 ? Math.max(0, -(v.x * wx + v.z * wz) / vsp) : 0;
              const rate = (mag < 0.05 ? PLAYER.accel * 1.35 : PLAYER.accel * (1 + 0.8 * rev)) * dt;
              const s = Math.min(1, rate / al);
              v.x += ax * s;
              v.z += az * s;
            }
            if (mag > 0.05 && !lockT && act2 !== "charge" && act2 !== "aim") {
              const vsp = Math.hypot(v.x, v.z);
              const tr = PLAYER.turnRate * (vsp > 7 ? 0.75 : 1) * (act2 === "push" ? 0.3 : 1);
              state.yaw = turnToward(state.yaw, Math.atan2(wx, wz), tr * dt);
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
          if (jumpBuf > 0 && (act2 === "none" || act2 === "land" || act2 === "push" || act2 === "block")) {
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
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
          if (jumpBuf > 0 && sinceGround < PLAYER.coyote && v.y <= 0.5 && act2 !== "dodge") {
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
            sinceGround = PLAYER.coyote;
            events.push({ type: "jump", pos: posV3() });
          }
          if (jumpRising && !btn.jump.down && v.y > 0) {
            v.y *= 0.5;
            jumpRising = false;
          }
          if (v.y <= 0) jumpRising = false;
          const wantGlide = btn.glide.pressed || (btn.jump.pressed && sinceGround >= PLAYER.coyote && jumpBuf > 0);
          if (wantGlide && state.hasGlider && !state.exhausted && act2 !== "hurt") {
            gather(p.x, p.z, R + 1);
            const gb = Math.max(groundHeight(p.x, p.y, p.z, 0), inWater ? waterY : -Infinity);
            if (p.y - gb >= PLAYER.glideMinHeight) {
              jumpBuf = 0;
              setMode("glide");
              if (act2 !== "aim") setAction("none");
              maxFall = 0;
              v.y = Math.max(v.y, -1.5);
              ctx.fx.burst("leaf", posV3(2), 5, v3(0, 1, 0), 1.5);
            }
          }
        } else if (state.mode === "glide") {
          state.sprinting = false;
          regen = false;
          staminaUse += PLAYER.glideCost;
          sinceGround += dt;
          const fyaw = Math.sin(state.yaw), fyz = Math.cos(state.yaw);
          let tgtYaw = state.yaw;
          let fwd = PLAYER.glideFwd * 0.8;
          if (mag > 0.1) {
            tgtYaw = Math.atan2(wx, wz);
            const back = Math.max(0, -(wx * fyaw + wz * fyz));
            fwd = PLAYER.glideFwd * (1 - 0.55 * back);
          }
          const ny = turnToward(state.yaw, tgtYaw, 2.4 * dt);
          state.yaw = state.action === "aim" ? state.yaw : ny;
          const tx = Math.sin(state.yaw) * fwd, tz = Math.cos(state.yaw) * fwd;
          const k = Math.min(1, 2.2 * dt);
          v.x += (tx - v.x) * k;
          v.z += (tz - v.z) * k;
          const up = plus.updraftAt ? plus.updraftAt(p.x, p.y, p.z) : 0;
          const ty = up > 0 ? up : -PLAYER.glideSink;
          v.y += (ty - v.y) * Math.min(1, (v.y < ty ? 3 : 2.2) * dt);
          if (btn.glide.pressed || btn.jump.pressed || state.stamina <= 0 || !state.hasGlider) {
            jumpBuf = 0;
            setMode("air");
          }
          maxFall = 0;
        } else if (state.mode === "swim") {
          state.sprinting = false;
          sinceGround = PLAYER.coyote;
          const fast = btn.sprint.down && !state.exhausted && mag > 0.3;
          const sp = (fast ? PLAYER.swimFast : PLAYER.swim) * mag;
          if (mag > 0.1) staminaUse += fast ? PLAYER.swimFastCost : PLAYER.swimCost;
          regen = mag <= 0.1;
          state.sprinting = fast;
          const k = Math.min(1, 5 * dt);
          v.x += ((mag > 0.05 ? wx * sp : 0) - v.x) * k;
          v.z += ((mag > 0.05 ? wz * sp : 0) - v.z) * k;
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
              state.stamina = PLAYER.staminaMax;
              state.exhausted = false;
              setAction("none");
            }
          }
        }

        if (state.mode === "air" || state.mode === "ground") v.y -= GRAVITY * dt * (state.mode === "air" && v.y < 0 ? 1.08 : 1);
        if (state.mode === "air") v.y = Math.max(v.y, -42);
        const travel = Math.hypot(v.x, v.y, v.z) * dt;
        const steps = Math.min(10, Math.max(1, Math.ceil(travel / SUBSTEP_MAX)));
        const h = dt / steps;
        gather(p.x, p.z, R + travel + 1.2);
        const wasGrounded = state.grounded && state.mode === "ground";
        const allow = state.mode === "ground" ? PLAYER.stepUp : state.mode === "swim" ? 0.6 : 0.15;
        const snap = state.mode === "ground" && v.y <= 0 ? 0.55 : 0;
        maxFall = state.mode === "air" ? Math.max(maxFall, -v.y) : maxFall;
        for (let i = 0; i < steps; i++) {
          moveStep(v.x * h, v.y * h, v.z * h, allow, wasGrounded && i === 0 ? true : state.grounded && state.mode === "ground", snap);
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
        } else if ((state.mode === "air" || state.mode === "glide") && state.grounded) {
          const impact = state.mode === "glide" ? Math.min(maxFall, 3) : maxFall;
          setMode("ground");
          sinceGround = 0;
          model.land(impact / 18);
          if (impact > 2.5) {
            events.push({ type: "land", pos: posV3(), speed: impact, surface: surfaceHere() });
            ctx.fx.burst("dust", posV3(0.05), Math.round(clamp(impact, 3, 18)), v3(0, 0.6, 0), 1 + impact * 0.12);
          }
          if (impact > PLAYER.fallSafe && wade < 0.5) {
            const q = Math.ceil((impact - PLAYER.fallSafe) / PLAYER.fallPerQuarter);
            events.push({ type: "fallDamage", amount: q });
          }
          if (impact > 9 && state.action === "none") setAction("land");
          if (state.action === "aim" || state.action === "attack1" || state.action === "attack2" || state.action === "attack3") {
            if (state.action !== "aim") setAction("none");
          }
          maxFall = 0;
          jumpRising = false;
          if (jumpBuf > 0 && state.action !== "land") {
            jumpBuf = 0;
            v.y = PLAYER.jumpV;
            jumpRising = true;
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
          } else if (into > 0.55 && okAct && !state.exhausted && state.stamina > 0) {
            const top = box ? box.maxY - p.y : 99;
            const quick = state.mode !== "ground" || wallPushT > 0.14;
            if (box && top > PLAYER.stepUp && top <= 1.3 && box.tag !== "pushable" && (state.mode === "ground" || state.mode === "air") && quick) {
              climbEvent = false;
              if (!tryMantle(contactNx, contactNz, PLAYER.stepUp, 1.35, VAULT_TIME)) wallPushT = 0;
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
      if (state.stamina >= PLAYER.staminaMax) {
        state.stamina = PLAYER.staminaMax;
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
            state.stamina = PLAYER.staminaMax;
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
      state.stamina = PLAYER.staminaMax;
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
