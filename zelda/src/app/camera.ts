import * as THREE from "three";
import type { CameraRigV2, EnemyState, FrameCtx, GameEvent, RayHit, ScreenPoint, Settings, V3, World } from "./contracts";
import { CAMERA } from "./contracts";
import { angleDiff } from "./state";
import { clearDistance, lineClear, shotClear } from "./camera-collide";
import { LOCK_DROP, LOS_GRACE, blocked, pickLock, pickSwitch, targetOk } from "./camera-lock";
import { createShake } from "./camera-shake";
import type { ShakeOut } from "./camera-shake";

// Third-person orbit. Order each frame: input -> lock-on -> orbit angles -> pivot and distance by mode -> collision ->
// cinematic blend -> shake -> write the THREE camera.

const PITCH_DEFAULT = 0.3;
const PITCH_MIN = -0.5;
const PITCH_MAX = 1.3;
const AIM_PITCH_MIN = -0.9;
const AIM_PITCH_MAX = 1.0;
const DIST_BASE: number = CAMERA.dist;
const ZOOM_MIN = -2.4;
const ZOOM_MAX = 5;
const EYE = 1.45;
const SHOULDER = 0.75;
const AIM_DIST = 3.1;
const AIM_LOOK_SCALE = 0.6;
const SPRINT_FOV = 66;
const LEAD = 0.6; // m the pivot leads Wren along her velocity

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

type Cine = "none" | "beacon" | "boss" | "shot";
type Shot = { pos: V3; look: V3; seconds: number; skippable: boolean };

const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _hit: RayHit = { hit: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), kind: "terrain", box: null };
const _shake: ShakeOut = { x: 0, y: 0, roll: 0 };

const FRAME_YAWS = 24;
const FRAME_ENEMY_R = 30; // m: enemies this close count toward picking a framing yaw
const WALL_LOOK = 9; // m ahead of the pivot a wall starts to crowd the view
const SWING_DUR = 0.55; // s for an automatic swing (fight start, collision)
const SWING_CD = 1.6; // s between automatic collision swings

export interface CameraPlus extends CameraRigV2 {
  /** Plays a short cinematic on demand (lab and cutscenes). beaconLit and bossWake events already do this. */
  cinematic(kind: "beacon" | "boss", at: V3): void;
  readonly cinematicActive: boolean;
  readonly aiming: boolean;
}

export const createCamera = (camera: THREE.PerspectiveCamera, world: World): CameraPlus => {
  const baseFov = camera.fov;
  const shake = createShake();
  const events: GameEvent[] = [];
  let yaw = Math.PI, pitch = PITCH_DEFAULT;
  let zoomOff = 0;
  let distCur = DIST_BASE, collDist = DIST_BASE;
  let fov = baseFov;
  let lockId = -1;
  let wantEmit = false;
  let losLost = 0;
  let switchCd = 0, flick = 0;
  let sinceLook = 99;
  let lookPad = false; // last look input came from a stick (shorter follow delay)
  let follow = true; // Settings.cameraFollow
  let recT = -1, recFrom = 0; // recenter swing
  let recTo: number | null = null, recDur: number = CAMERA.recenterTime; // swing target (null: behind Wren) and length
  let frameT = -1; // >= 0: waiting to swing to a framing yaw (fight start), seconds waited
  let tightT = 0, swingCd = 0; // collision pulled in hard: how long, and cooldown between automatic swings
  let dip = 0; // landing dip (m), decays
  let shot: Shot | null = null;
  const lead = new THREE.Vector3();
  let shoulder = 0, aimK = 0;
  let snap = true;
  let phaseT = 0;
  const pivot = new THREE.Vector3();
  const playerAt = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  let cine: Cine = "none";
  let cineT = 0, cineDur = 0, cineAngle = 0;
  const cineFocus = new THREE.Vector3();

  function startRecenter() {
    recT = 0;
    recFrom = yaw;
    recTo = null;
    recDur = CAMERA.recenterTime;
  }

  function swingTo(to: number) {
    recT = 0;
    recFrom = yaw;
    recTo = to;
    recDur = SWING_DUR;
  }

  /**
   * Picks an orbit yaw that sees Wren and nearby enemies with open space ahead, scoring a full circle of candidates.
   * Used on respawn and at a fight start, where "behind Wren" often faces a tower wall or puts a pedestal over her.
   */
  function frameYaw(px: number, py: number, pz: number, prefer: number, enemies: readonly EnemyState[]): number {
    const cp = Math.cos(PITCH_DEFAULT), sp = Math.sin(PITCH_DEFAULT);
    const oy = py + EYE, ty = py + 0.9;
    let best = prefer, bestS = -Infinity;
    for (let i = 0; i < FRAME_YAWS; i++) {
      const y0 = prefer + (i * Math.PI * 2) / FRAME_YAWS;
      const sy = Math.sin(y0), cy = Math.cos(y0);
      const bx = -sy * cp, bz = -cy * cp;
      const c = clearDistance(world, px, oy, pz, bx, sp, bz, DIST_BASE, -cy, sy);
      let s = (3 * c) / DIST_BASE;
      const cx = px + bx * c, cyy = oy + sp * c, cz = pz + bz * c;
      // her torso must be visible from the lens
      const hx = px - cx, hy = ty - cyy, hz = pz - cz, hl = Math.hypot(hx, hy, hz);
      if (hl > 0.3 && !lineClear(world, cx, cyy, cz, hx / hl, hy / hl, hz / hl, hl - 0.2)) s -= 3;
      // a wall or tower base just ahead fills the frame (low row: knee-high plinths the eye-height row misses)
      for (const ry of [oy, py + 0.35]) {
        for (const o of [-0.4, 0, 0.4]) {
          const fx = Math.sin(y0 + o), fz = Math.cos(y0 + o);
          if (world.raycast(px, ry, pz, fx, 0, fz, WALL_LOOK, _hit, false)) {
            const bx2 = _hit.box;
            if (bx2 && bx2.tag !== "tree" && bx2.tag !== "decor") s -= ((WALL_LOOK - _hit.dist) / WALL_LOOK) * 1.6;
          }
        }
      }
      // enemies in front of the lens, and visible from it
      let es = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.pos.x - px, dz = e.pos.z - pz, d = Math.hypot(dx, dz);
        if (d > FRAME_ENEMY_R || d < 0.5) continue;
        const k = (dx * sy + dz * cy) / d;
        if (k < 0.3) continue;
        const ex = e.aimPoint.x - cx, ey = e.aimPoint.y - cyy, ez = e.aimPoint.z - cz, el = Math.hypot(ex, ey, ez);
        if (el > 0.3 && !lineClear(world, cx, cyy, cz, ex / el, ey / el, ez / el, el - 0.4)) continue;
        es += k;
      }
      s += Math.min(3, es * 1.2);
      s += 0.6 * Math.cos(angleDiff(y0, prefer));
      if (s > bestS) { bestS = s; best = y0; }
    }
    return best;
  }

  function startCine(kind: "beacon" | "boss", at: V3) {
    cine = kind;
    cineT = 0;
    cineDur = kind === "beacon" ? 3.6 : 4.2;
    cineFocus.set(at.x, at.y + (kind === "beacon" ? 2.5 : 3), at.z);
    cineAngle = Math.atan2(playerAt.x - at.x, playerAt.z - at.z);
  }

  // reading innerWidth after HUD style writes forces a style recalc every frame; cache it
  let vw = window.innerWidth, vh = window.innerHeight;
  const onResize = () => { vw = window.innerWidth; vh = window.innerHeight; };
  window.addEventListener("resize", onResize);

  const rig: CameraPlus = {
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get lockId() { return lockId; },
    get cinematicActive() { return cine !== "none"; },
    get cineOn() { return cine !== "none"; },
    recenter: startRecenter,
    cine(s: Shot | null) {
      if (!s) {
        if (cine === "shot") cineT = Math.max(cineT, cineDur - 0.5);
        return;
      }
      shot = { ...s, pos: { ...s.pos } };
      // a scripted shot can land beside a lamp post or under a lintel: swing it around its target until it is clear
      if (!shotClear(world, s.look, s.pos)) {
        const ox = s.pos.x - s.look.x, oz = s.pos.z - s.look.z;
        for (const a of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 2.0, -2.0]) {
          const c = Math.cos(a), sn = Math.sin(a);
          const tryPos = { x: s.look.x + ox * c + oz * sn, y: s.pos.y, z: s.look.z - ox * sn + oz * c };
          tryPos.y = Math.max(tryPos.y, world.heightAt(tryPos.x, tryPos.z) + 1.2);
          if (shotClear(world, s.look, tryPos)) {
            shot.pos = tryPos;
            break;
          }
        }
      }
      cine = "shot";
      cineT = 0;
      cineDur = Math.max(0.6, s.seconds);
    },
    get aiming() { return aimK > 0.5; },
    cinematic: startCine,

    update(ctx: FrameCtx) {
      events.length = 0;
      const dt = ctx.realDt;
      const inp = ctx.input;
      const p = ctx.player;
      playerAt.copy(p.pos);

      if (snap) {
        yaw = p.yaw;
        pitch = PITCH_DEFAULT;
        zoomOff = 0;
        pivot.set(p.pos.x, p.pos.y + EYE, p.pos.z);
        // respawn and teleports: face open ground that sees Wren and any nearby enemies, not the wall behind her
        yaw = frameYaw(p.pos.x, p.pos.y, p.pos.z, p.yaw, ctx.enemies);
        distCur = collDist = DIST_BASE;
        lockId = -1;
        cine = "none";
        sinceLook = 99;
        shoulder = aimK = 0;
        recT = -1;
        frameT = -1;
        tightT = 0;
        snap = false;
        wantEmit = true;
      }
      if (wantEmit) {
        wantEmit = false;
        events.push({ type: "lock", id: lockId });
      }

      const aiming = inp.aim && cine === "none";
      const climbing = p.mode === "climb";
      const gliding = p.mode === "glide";
      const swimming = p.mode === "swim";

      switchCd -= dt;
      if (lockId >= 0) {
        const e = ctx.enemies[lockId];
        const d = targetOk(e) ? Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) : Infinity;
        if (!targetOk(e) || d > LOCK_DROP || p.mode === "dead") {
          lockId = -1;
          events.push({ type: "lock", id: -1 });
        } else {
          losLost = blocked(ctx.world, p.pos.x, p.pos.y, p.pos.z, e) ? losLost + dt : 0;
          if (losLost > LOS_GRACE) {
            lockId = -1;
            losLost = 0;
            events.push({ type: "lock", id: -1 });
          }
        }
      }
      if (inp.btn.lock.pressed && cine === "none") {
        if (lockId >= 0) {
          lockId = -1;
          events.push({ type: "lock", id: -1 });
        } else {
          const cp = Math.cos(pitch);
          _fwd.set(Math.sin(yaw) * cp, -Math.sin(pitch), Math.cos(yaw) * cp);
          const id = pickLock(ctx, camera.position.x, camera.position.y, camera.position.z, _fwd.x, _fwd.y, _fwd.z);
          if (id >= 0) {
            lockId = id;
            losLost = 0;
            events.push({ type: "lock", id });
          } else startRecenter();
        }
      }

      const lookScale = aiming ? AIM_LOOK_SCALE : 1;
      const lx = inp.look.x, ly = inp.look.y;
      const hasLook = Math.abs(lx) + Math.abs(ly) > 0.0005;
      if (cine === "none") {
        if (lockId >= 0) {
          flick = flick * Math.exp(-dt * 7) + lx;
          if (switchCd <= 0 && Math.abs(flick) > 0.18) {
            const id = pickSwitch(ctx, lockId, flick > 0 ? 1 : -1);
            flick = 0;
            switchCd = 0.4;
            if (id >= 0) {
              lockId = id;
              losLost = 0;
              events.push({ type: "lock", id });
            }
          }
        } else {
          flick = 0;
          yaw -= lx * lookScale;
          pitch += ly * lookScale;
          zoomOff = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomOff + inp.zoom));
        }
        if (lockId >= 0 && inp.zoom !== 0 && switchCd <= 0) {
          // mouse wheel cycles lock targets
          const id = pickSwitch(ctx, lockId, inp.zoom > 0 ? 1 : -1);
          switchCd = 0.25;
          if (id >= 0) {
            lockId = id;
            losLost = 0;
            events.push({ type: "lock", id });
          }
        }
      }
      if (hasLook) lookPad = inp.device !== "keys";
      sinceLook = hasLook ? 0 : sinceLook + dt;
      if (hasLook || lockId >= 0 || cine !== "none") recT = -1;

      if (frameT >= 0) {
        // fight start: wait out any cinematic, then swing once to a yaw that frames Wren and the enemies
        frameT += dt;
        if (hasLook || lockId >= 0 || frameT > 4) frameT = -1;
        else if (cine === "none") {
          frameT = -1;
          const to = frameYaw(p.pos.x, p.pos.y, p.pos.z, yaw, ctx.enemies);
          if (Math.abs(angleDiff(to, yaw)) > 0.2) swingTo(to);
        }
      }

      const speedXZ = Math.hypot(p.vel.x, p.vel.z);
      if (cine === "none") {
        if (lockId >= 0) {
          const e = ctx.enemies[lockId];
          const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          const wantYaw = Math.atan2(dx, dz);
          yaw += angleDiff(wantYaw, yaw) * damp(7, dt);
          const rise = (p.pos.y + EYE - e.aimPoint.y) / Math.max(d, 4);
          const wantPitch = Math.max(0.12, Math.min(0.75, PITCH_DEFAULT + rise * 0.8));
          pitch += (wantPitch - pitch) * damp(5, dt);
        } else if (recT >= 0) {
          // recenter: ease behind Wren in CAMERA.recenterTime
          recT += dt;
          const k = smooth(Math.min(1, recT / recDur));
          yaw = recFrom + angleDiff(recTo ?? p.yaw, recFrom) * k;
          pitch += (PITCH_DEFAULT - pitch) * damp(10, dt);
          if (recT >= recDur) recT = -1;
        } else if (follow && sinceLook > (lookPad ? CAMERA.followDelayStick : CAMERA.followDelayMouse) && !aiming) {
          const mv = Math.min(1, Math.hypot(inp.move.x, inp.move.y));
          const strafe = Math.abs(inp.move.x) > 0.9 && Math.abs(inp.move.y) < 0.2;
          const maxStep = CAMERA.followRate * dt;
          if (climbing) {
            yaw += Math.max(-maxStep, Math.min(maxStep, angleDiff(p.yaw, yaw)));
            pitch += (CAMERA.climbPitch - pitch) * damp(1.5, dt);
          } else if (mv > 0.2 && !strafe && inp.move.y > -0.3 && speedXZ > 1.2) {
            // capped at followRate (30 deg/s) and scaled by stick: never spins the view on a strafe
            const diff = angleDiff(p.yaw, yaw);
            if (Math.abs(diff) < 2.3) yaw += Math.max(-maxStep * mv, Math.min(maxStep * mv, diff * damp(3, dt)));
          }
          if (speedXZ > 1.2 && (p.grounded || gliding)) {
            pitch += ((gliding ? 0.2 : PITCH_DEFAULT) - pitch) * damp(0.7, dt);
          }
        }
      }
      yaw = ((yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const aimLo = lockId >= 0 ? 0.05 : aiming ? AIM_PITCH_MIN : PITCH_MIN;
      pitch = Math.max(aimLo, Math.min(aiming ? AIM_PITCH_MAX : PITCH_MAX, pitch));

      let wantDist = DIST_BASE + zoomOff;
      let wantFov = baseFov;
      let eye = EYE;
      let followXZ = 18;
      let followY = 7;
      const riding = p.mode === "ride";
      if (climbing) {
        wantDist = CAMERA.distClimb + zoomOff;
        eye = 1.9;
        followY = 9;
      } else if (gliding || riding) {
        wantDist = (gliding ? CAMERA.distGlide : CAMERA.distRide) + zoomOff;
        wantFov += 6 + Math.min(5, Math.max(0, speedXZ - 8) * 0.8);
        followXZ = 9;
        followY = 5;
      } else if (swimming) {
        eye = 0.7;
        followY = 5;
      } else if (p.sprinting && speedXZ > 6.5) {
        wantFov = Math.max(wantFov, SPRINT_FOV);
        wantDist = CAMERA.distSprint + zoomOff;
      }
      if (!p.grounded && p.vel.y < -14) wantFov += 3;
      if (lockId >= 0) {
        const e = ctx.enemies[lockId];
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        wantDist += Math.min(3.5, d * 0.14) + (e.kind === "warden" ? 3 : 0);
      }
      const aimTarget = aiming ? 1 : 0;
      aimK += (aimTarget - aimK) * damp(aiming ? 11 : 7, dt);
      if (aimK > 0.001) {
        wantDist += (AIM_DIST - wantDist) * aimK;
        wantFov += (48 - wantFov) * aimK;
      }
      phaseT = Math.max(0, phaseT - dt);
      if (phaseT > 0) {
        const env = Math.sin(Math.PI * (1 - phaseT / 2));
        wantDist += 3.6 * env;
        wantFov += 3 * env;
      }
      if (p.mode === "dead") wantDist += 1.5;

      const dRate = aiming || aimK > 0.2 ? 9 : 4;
      distCur += (wantDist - distCur) * damp(dRate, dt);
      fov += (wantFov - fov) * damp(5, dt);
      shoulder = SHOULDER * aimK;

      // pivot leads along her ground velocity; a hard landing dips it briefly
      const leadK = !climbing && !aiming && lockId < 0 ? Math.min(1, speedXZ / 9) * LEAD : 0;
      const lx2 = speedXZ > 0.1 ? (p.vel.x / speedXZ) * leadK : 0, lz2 = speedXZ > 0.1 ? (p.vel.z / speedXZ) * leadK : 0;
      lead.x += (lx2 - lead.x) * damp(3, dt);
      lead.z += (lz2 - lead.z) * damp(3, dt);
      dip *= Math.exp(-dt * 6);
      const gx = p.pos.x + lead.x, gz = p.pos.z + lead.z, gy = p.pos.y + eye - dip;
      const err = Math.hypot(gx - pivot.x, gz - pivot.z);
      const kxz = err > 9 ? 1 : damp(followXZ, dt);
      pivot.x += (gx - pivot.x) * kxz;
      pivot.z += (gz - pivot.z) * kxz;
      pivot.y += (gy - pivot.y) * (Math.abs(gy - pivot.y) > 9 ? 1 : damp(followY, dt));

      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const rx = -cy, rz = sy;
      const tx = pivot.x + rx * shoulder;
      const ty = pivot.y + 0.15 * aimK;
      const tz = pivot.z + rz * shoulder;
      const bx = -sy * cp, by = sp, bz = -cy * cp;
      const clear = clearDistance(world, tx, ty, tz, bx, by, bz, distCur, rx, rz);
      if (clear < collDist) collDist = clear;
      else collDist += (clear - collDist) * damp(3.5, dt);
      const dist = Math.min(distCur, collDist);
      // a box pulled the lens in tight: rather than sit pressed on Wren's back, swing around it once the player
      // has left the camera alone
      swingCd -= dt;
      const free = cine === "none" && lockId < 0 && aimK < 0.1 && recT < 0 && !climbing && sinceLook > 1;
      tightT = free && collDist < distCur * 0.55 ? tightT + dt : 0;
      if (tightT > 0.35 && swingCd <= 0) {
        tightT = 0;
        swingCd = SWING_CD;
        let to = NaN;
        for (const o of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
          const y0 = yaw + o, s0 = Math.sin(y0), c0 = Math.cos(y0);
          const c = clearDistance(world, tx, ty, tz, -s0 * cp, sp, -c0 * cp, distCur, -c0, s0);
          if (c >= distCur * 0.85 && lineClear(world, tx, ty, tz, -s0 * cp, sp, -c0 * cp, c)) { to = y0; break; }
        }
        if (!Number.isNaN(to)) swingTo(to);
      }
      camPos.set(tx + bx * dist, ty + by * dist, tz + bz * dist);
      let floor = Math.max(world.heightAt(camPos.x, camPos.z), world.groundAt(camPos.x, ty + 1, camPos.z)) + 0.5;
      if (swimming) {
        const wl = world.waterAt(camPos.x, camPos.z);
        if (wl > -1e6) floor = Math.max(floor, wl + 0.35);
      }
      if (camPos.y < floor) camPos.y = floor;
      _look.set(tx, ty, tz);

      let fovOut = fov;
      if (cine !== "none") {
        cineT += dt;
        const anyKey = inp.btn.jump.pressed || inp.btn.attack.pressed || inp.btn.use.pressed || inp.btn.pause.pressed;
        if (cine === "shot") {
          if (shot && shot.skippable && cineT > 0.3 && cineT < cineDur - 0.5 && anyKey) cineT = cineDur - 0.5;
        } else if (cineT > 1.2 && cineT < cineDur - 0.9 && anyKey) cineT = cineDur - 0.9;
        const u = cineT / cineDur;
        const edge = cine === "shot" ? Math.min(0.5, cineDur / 3) : 0.9;
        const w = smooth(cineT / edge) * (1 - smooth((cineT - (cineDur - edge)) / edge));
        if (cine === "shot" && shot) {
          _pos.set(shot.pos.x, shot.pos.y, shot.pos.z);
          _proj.set(shot.look.x, shot.look.y, shot.look.z);
          // narrow landscape (phones) cuts the sides of a two-subject shot: aim between the target and Wren so she
          // stays near the middle, a little below center, clear of the touch stick
          if (vw > vh * 1.75) {
            _fwd.set(p.pos.x, p.pos.y + 1.6, p.pos.z);
            if (_fwd.distanceTo(_pos) < 40) _proj.lerp(_fwd, 0.75);
          }
        } else if (cine === "beacon") {
          const a = cineAngle + u * 0.7;
          _pos.set(cineFocus.x + Math.sin(a) * 15, cineFocus.y + 3 + u * 3, cineFocus.z + Math.cos(a) * 15);
          _proj.set(cineFocus.x, cineFocus.y + 2 + smooth(u) * 6, cineFocus.z);
        } else {
          const dx = cineFocus.x - p.pos.x, dz = cineFocus.z - p.pos.z;
          const back = 28 - 9 * smooth(u);
          const sw = Math.atan2(dx, dz) + 0.35 - 0.25 * u;
          _pos.set(cineFocus.x - Math.sin(sw) * back, cineFocus.y + 2.5 + 3 * (1 - u), cineFocus.z - Math.cos(sw) * back);
          _proj.set(cineFocus.x, cineFocus.y + 1 + u * 1.5, cineFocus.z);
        }
        const g = Math.max(world.heightAt(_pos.x, _pos.z) + 1.2, _pos.y);
        _pos.y = g;
        camPos.lerp(_pos, w);
        _look.lerp(_proj, w);
        fovOut = fov + ((cine === "boss" ? 46 : cine === "shot" ? baseFov : baseFov - 8) - fov) * w;
        if (cineT >= cineDur) {
          cine = "none";
          shot = null;
          sinceLook = 0;
        }
      }

      shake.step(dt, _shake);
      camera.position.copy(camPos);
      camera.lookAt(_look);
      if (_shake.roll !== 0) camera.rotateZ(_shake.roll);
      if (_shake.x !== 0 || _shake.y !== 0) {
        camera.translateX(_shake.x);
        camera.translateY(_shake.y);
      }
      if (Math.abs(camera.fov - fovOut) > 0.01) {
        camera.fov = fovOut;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      return events;
    },

    handle(list: readonly GameEvent[]) {
      for (const e of list) {
        switch (e.type) {
          case "shake": shake.add(e.strength); break;
          case "hurt": shake.add(Math.min(0.7, 0.22 + e.amount * 0.07)); break;
          case "land":
            if (e.speed > 9) dip = Math.max(dip, Math.min(0.35, (e.speed - 9) * 0.03));
            if (e.speed > 13) shake.add(Math.min(0.5, (e.speed - 13) * 0.025 + 0.08));
            break;
          case "hit": if (e.team === "enemy" && e.target === -1 && !e.blocked) shake.add(0.18); break;
          case "thunder": shake.add(0.12); break;
          case "bossPhase": phaseT = 2; shake.add(0.8); break;
          case "bossDefeated": shake.add(0.9); break;
          case "beaconLit": startCine("beacon", e.pos); break;
          case "bossWake": startCine("boss", e.pos); break;
          case "died": case "respawned":
            if (lockId >= 0) { lockId = -1; wantEmit = true; }
            if (e.type === "respawned") snap = true;
            break;
          case "prologue": if (e.step === "gladeFight") frameT = 0; break;
          case "enemyDied":
            if (e.id === lockId) { lockId = -1; wantEmit = true; }
            break;
          default: break;
        }
      }
    },

    toScreen(pt: V3, out: ScreenPoint) {
      _proj.set(pt.x, pt.y, pt.z).project(camera);
      const w = vw, h = vh;
      out.x = (_proj.x * 0.5 + 0.5) * w;
      out.y = (-_proj.y * 0.5 + 0.5) * h;
      out.on = _proj.z < 1 && Math.abs(_proj.x) <= 1 && Math.abs(_proj.y) <= 1;
      return out;
    },

    snapBehind() {
      snap = true;
    },

    setSettings(s: Settings) {
      follow = s.cameraFollow !== false;
    },

    dispose() {
      window.removeEventListener("resize", onResize);
      events.length = 0;
    },
  };
  return rig;
};
