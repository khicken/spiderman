import * as THREE from "three";
import type { CameraRig, CreateCamera, FrameCtx, GameEvent, ScreenPoint, Settings, V3, World } from "./contracts";
import { angleDiff } from "./state";
import { clearDistance } from "./camera-collide";
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
const DIST_BASE = 6.2;
const ZOOM_MIN = -2.4;
const ZOOM_MAX = 5;
const EYE = 1.45;
const SHOULDER = 0.75;
const AIM_DIST = 3.1;
const AIM_LOOK_SCALE = 0.6;
const FOLLOW_IDLE = 1.1; // s without look input before auto-follow starts

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

type Cine = "none" | "beacon" | "boss";

const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _shake: ShakeOut = { x: 0, y: 0, roll: 0 };

export interface CameraPlus extends CameraRig {
  /** Plays a short cinematic on demand (lab and cutscenes). beaconLit and bossWake events already do this. */
  cinematic(kind: "beacon" | "boss", at: V3): void;
  readonly cinematicActive: boolean;
  readonly aiming: boolean;
}

export const createCamera = ((camera: THREE.PerspectiveCamera, world: World): CameraPlus => {
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
  let shoulder = 0, aimK = 0;
  let snap = true;
  let phaseT = 0;
  const pivot = new THREE.Vector3();
  const playerAt = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  let cine: Cine = "none";
  let cineT = 0, cineDur = 0, cineAngle = 0;
  const cineFocus = new THREE.Vector3();

  function startCine(kind: "beacon" | "boss", at: V3) {
    cine = kind;
    cineT = 0;
    cineDur = kind === "beacon" ? 3.6 : 4.2;
    cineFocus.set(at.x, at.y + (kind === "beacon" ? 2.5 : 3), at.z);
    cineAngle = Math.atan2(playerAt.x - at.x, playerAt.z - at.z);
  }

  const rig: CameraPlus = {
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get lockId() { return lockId; },
    get cinematicActive() { return cine !== "none"; },
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
        distCur = collDist = DIST_BASE;
        lockId = -1;
        cine = "none";
        sinceLook = 99;
        shoulder = aimK = 0;
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
          }
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
        if (lockId >= 0) zoomOff = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomOff + inp.zoom));
      }
      sinceLook = hasLook ? 0 : sinceLook + dt;

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
        } else if (sinceLook > FOLLOW_IDLE && !aiming) {
          const mv = Math.hypot(inp.move.x, inp.move.y);
          if (climbing) {
            yaw += angleDiff(p.yaw, yaw) * damp(2.4, dt);
          } else if (mv > 0.2 && inp.move.y > -0.3 && speedXZ > 1.2) {
            const diff = angleDiff(p.yaw, yaw);
            if (Math.abs(diff) < 2.3) {
              const w = Math.min(1, Math.abs(inp.move.x) * 1.4 + 0.12);
              yaw += diff * damp(1.7 * w, dt);
            }
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
      if (climbing) {
        wantDist = Math.min(wantDist, 5.2);
        eye = 1.7;
        followY = 9;
      } else if (gliding) {
        wantDist += 2.2;
        wantFov += 6 + Math.min(5, Math.max(0, speedXZ - 8) * 0.8);
        followXZ = 9;
        followY = 5;
      } else if (swimming) {
        eye = 0.7;
        followY = 5;
      } else if (p.sprinting && speedXZ > 6.5) {
        wantFov += 5;
        wantDist += 0.4;
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

      const err = Math.hypot(p.pos.x - pivot.x, p.pos.z - pivot.z);
      const kxz = err > 9 ? 1 : damp(followXZ, dt);
      pivot.x += (p.pos.x - pivot.x) * kxz;
      pivot.z += (p.pos.z - pivot.z) * kxz;
      pivot.y += (p.pos.y + eye - pivot.y) * (Math.abs(p.pos.y + eye - pivot.y) > 9 ? 1 : damp(followY, dt));

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
        if (cineT > 1.2 && cineT < cineDur - 0.9 && (inp.btn.jump.pressed || inp.btn.attack.pressed)) cineT = cineDur - 0.9;
        const u = cineT / cineDur;
        const w = smooth(cineT / 0.9) * (1 - smooth((cineT - (cineDur - 0.9)) / 0.9));
        if (cine === "beacon") {
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
        fovOut = fov + ((cine === "boss" ? 46 : baseFov - 8) - fov) * w;
        if (cineT >= cineDur) {
          cine = "none";
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
          case "land": if (e.speed > 13) shake.add(Math.min(0.5, (e.speed - 13) * 0.025 + 0.08)); break;
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
          case "enemyDied":
            if (e.id === lockId) { lockId = -1; wantEmit = true; }
            break;
          default: break;
        }
      }
    },

    toScreen(pt: V3, out: ScreenPoint) {
      _proj.set(pt.x, pt.y, pt.z).project(camera);
      const w = window.innerWidth, h = window.innerHeight;
      out.x = (_proj.x * 0.5 + 0.5) * w;
      out.y = (-_proj.y * 0.5 + 0.5) * h;
      out.on = _proj.z < 1 && Math.abs(_proj.x) <= 1 && Math.abs(_proj.y) <= 1;
      return out;
    },

    snapBehind() {
      snap = true;
    },

    setSettings(_s: Settings) {},

    dispose() {
      events.length = 0;
    },
  };
  return rig;
}) satisfies CreateCamera;
