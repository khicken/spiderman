import * as THREE from "three";
import type { Action, Blade, TitanHit, CameraView, Fx, GameEvent, Input, Lock, Player, PlayerHud, PlayerMode, Sfx, TitanPart, TitanView, Titans, World, Hint } from "./contracts";
import { createWires, type Hook } from "./player-wire";
import { getCharacter, type CharStats } from "./progression-chars";
import { isBoss } from "./titan-waves";
import { createScout, SCOUT_HALF, type ScoutAnim, type ScoutFrame } from "./scout";

const G = 24;
const RUN = 10.5;
const JUMP = 9.5;
const RANGE = 90;
const HOOK_SPEED = 300;
const RADIUS = 0.35;
const HEIGHT = SCOUT_HALF * 2;
const MAX_SPEED = 88;
const SPARE = 8;
const CHARGE_T = 0.6;
const PERFECT = [0.5, 0.82] as const;
const SLASH_T = 0.42;
const TAP = 0.25;
const PARTS: TitanPart[] = ["nape", "eyes", "armL", "armR", "legL", "legR"];
const UP = new THREE.Vector3(0, 1, 0);

type Act = { name: ScoutAnim | null; t: number; dur: number };

export function createPlayer(scene: THREE.Scene, world: World, titans: Titans, fx: Fx): Player {
  let scout = createScout();
  let st: CharStats = getCharacter("cadet").stats;
  let charId = "cadet";
  const drain = () => st.gasDrain / st.tank;
  const chargeFull = () => CHARGE_T * st.chargeTime;
  scene.add(scout.root);
  const wires = createWires(scene);
  const hooks = wires.hooks;

  const pos = world.spawn.clone();
  const vel = new THREE.Vector3();
  const orient = new THREE.Quaternion().setFromAxisAngle(UP, world.spawnYaw);
  let mode: PlayerMode = "ground";
  let grounded = true;
  let health = 1;
  let gas = 1;
  let blades = SPARE;
  let sharp = 1;
  let lock: Lock | null = null;
  let deadT = 0;
  let dashCd = 0;
  let gasPuffT = 0;
  let inSupply = false;
  let supplyT = 0;
  let combo = 0;
  let comboT = 0;
  let time = 0;
  let reelT = 0;
  let wallT = 0;
  let chargeT = 0;
  let charging = false;
  let flashed = false;
  let brokeToast = 0;
  let wasHeld = false;
  let flipNext = false;
  let toastT = -10;
  const act: Act = { name: null, t: 0, dur: 0 };
  const wallN = new THREE.Vector3();
  const facing = new THREE.Vector3(Math.sin(world.spawnYaw), 0, Math.cos(world.spawnYaw));

  const slash = { on: false, t: 0, struck: false, charge: 0, side: 1, speed: 0, titan: null as TitanView | null, part: "nape" as TitanPart, dir: new THREE.Vector3() };
  const blade: Blade = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, charge: 0, radius: 2.5 };

  const aim = { kind: "none" as "none" | "world" | "titan", blocked: false, dist: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), obj: null as THREE.Object3D | null, titan: null as TitanView | null };
  const frame: ScoutFrame = { anim: "idle", t: 0, k: 0, speed: 0, vel, charge: 0, side: 1, broken: false };
  const pressT = new Map<Action, number>();
  const lastLook = new THREE.Vector3(0, 0, 1);
  const hv = new THREE.Vector3();
  const used = new Map<string, number>();
  let shown: (Hint & { acts: Action[]; rel?: boolean }) | null = null;
  const tip = (acts: Action[], key: string, text: string, touch: string, rel = false) => ((used.get(text) ?? 0) >= 3 ? null : { acts, key, text, touch, rel });
  const hint = () => {
    if (mode === "dead" || mode === "held") return null;
    if (charging) return tip(["attack"], "E", "Release to strike", "Release Slash to strike", true);
    if (sharp <= 0) return blades > 0 ? tip(["swap"], "R", "Swap blades", "Tap Swap for fresh blades") : null;
    const near = (lock && titans.partPos(lock.titan, lock.part, hv) && hv.distanceTo(pos) < 32) || ((ti) => ti && titans.partPos(ti, "nape", hv))(titans.nearest(pos, lastLook, 22));
    if (near) {
      const b = lock?.part === "nape" && isBoss(lock.titan.kind) ? titans.boss() : null;
      if (b?.hardened) return lock!.titan.kind === "armored" ? tip(["cycle"], "Tab", "Target a leg", "Tap Lock to target a leg") : tip(["cycle"], "Tab", "Target a limb", "Tap Lock to target a limb");
      if (vel.length() < 12) return tip(["gas"], "", "Swing in fast, then strike", "Swing in fast with Gas, then Slash");
      return tip(["attack"], "E", "Hold, release to strike", "Hold Slash, release to strike");
    }
    const on = hooks.some((h) => h.state === "on");
    if (on && hooks.some((h) => h.state === "on" && h.titan)) return tip(["gas"], "Space", "Gas to close in", "Hold Gas to close in");
    if (on) return hooks.some((h) => h.latch) ? tip(["gas"], "", "Space to boost, F to let go", "Hold Gas to boost, tap Hook to let go") : null;
    const seen = !lock && ((ti) => ti && titans.partPos(ti, "nape", hv) && reach(hv) < 0)(titans.nearest(pos, lastLook, RANGE));
    if (aim.kind === "titan" || (lock && hv.distanceTo(pos) < RANGE) || seen) return tip(["autoHook"], "F", "Hook the titan", "Tap Hook to anchor the titan");
    if (!lock && titans.nearest(pos, lastLook, RANGE)) return tip(["lock"], "Q", "Lock on a titan", "Tap Lock to target a titan");
    if (lock) return tip(["autoHook"], "F", "Anchor toward the titan", "Tap Hook to fly toward it");
    return tip(["anchorL", "anchorR"], "", "Click to anchor, Space for gas", "Tap L or R, hold Gas");
  };
  const countHint = (input: Input) => {
    if (shown && shown.acts.some((a) => (shown!.rel ? input.released : input.pressed).has(a))) used.set(shown.text, (used.get(shown.text) ?? 0) + 1);
  };
  let gasWarn = 0;
  let dullWarn = false;
  const warn = () => {
    if (gas > 0.5) gasWarn = 0;
    if (gas < 0.2 && gasWarn < 1) {
      gasWarn = 1;
      out.push({ type: "toast", title: "Gas low", text: "Land at the green smoke" });
    }
    if (gas <= 0 && gasWarn < 2) {
      gasWarn = 2;
      out.push({ type: "toast", title: "Out of gas", text: "Refill at the green smoke" });
    }
    if (sharp >= 0.5) dullWarn = false;
    if (sharp < 0.2 && sharp > 0 && blades > 0 && !dullWarn) {
      dullWarn = true;
      out.push({ type: "toast", title: "Blades dull. Swap now", text: "Press R", touch: "Tap Swap" });
    }
  };
  const hud: PlayerHud = { health: 1, gas: 1, blades: SPARE, sharp: 1, hooks: [false, false], charge: null, aim: "none", aimDist: 0, supply: false, dead: false, combo: 0, hint: null };
  const lockPoint = new THREE.Vector3();
  const view: CameraView = { pos, vel, mode, lockPoint: null, charge: 0 };

  const out: GameEvent[] = [];
  const a = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const t3 = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const bodyUp = new THREE.Vector3();
  const rightV = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const qGoal = new THREE.Quaternion();

  const sfx = (name: Sfx, volume?: number, at?: THREE.Vector3) => out.push(at ? { type: "sfx", name, volume, at: at.clone() } : { type: "sfx", name, volume });
  const startAct = (name: ScoutAnim, dur: number) => {
    act.name = name;
    act.t = 0;
    act.dur = dur;
  };

  const hip = (i: number, o: THREE.Vector3) => o.set(i ? -0.22 : 0.22, -0.1, -0.12).applyQuaternion(orient).add(pos);

  const fire = (i: number, button: Action, point: THREE.Vector3 | null, obj: THREE.Object3D | null, titan: TitanView | null, normal: THREE.Vector3 | null, dir: THREE.Vector3) => {
    const h = hooks[i];
    h.button = button;
    h.state = "fly";
    h.latch = false;
    hip(i, h.head);
    h.hit = !!point;
    h.obj = obj;
    h.titan = titan;
    h.t = 0;
    if (point) {
      h.point.copy(point);
      if (obj) {
        obj.updateWorldMatrix(true, false);
        obj.worldToLocal(h.local.copy(point));
      }
      if (normal) h.normal.copy(normal);
      else h.normal.set(0, 0, 0);
    } else h.point.copy(pos).addScaledVector(dir, RANGE);
    sfx("anchorFire", 0.8);
  };

  const release = (i: number, quiet = false) => {
    const h = hooks[i];
    if (h.state === "idle") return;
    const wasOn = h.state === "on";
    h.state = "back";
    h.latch = false;
    h.obj = null;
    h.titan = null;
    if (wasOn && !quiet) {
      const sp = vel.length();
      if (sp > 16) {
        const other = hooks[1 - i].state === "on";
        vel.multiplyScalar(1.07).addScaledVector(UP, 3.5);
        sfx("release", Math.min(1, sp / 50));
        if (!other && vel.y > 1 && sp > 22 && !slash.on) {
          startAct("flip", 0.6);
          frame.side = Math.random() < 0.5 ? -1 : 1;
        }
      }
    }
  };

  const eye = new THREE.Vector3();
  const rDir = new THREE.Vector3();
  const rNorm = new THREE.Vector3();
  const reach = (p: THREE.Vector3) => {
    eye.copy(pos).addScaledVector(UP, 0.7);
    rDir.copy(p).sub(eye);
    const d = rDir.length();
    if (d < 0.5) return -1;
    rDir.divideScalar(d);
    return world.raycast(eye, rDir, d - 0.4, rNorm);
  };
  const say = (title: string) => {
    if (time - toastT < 1.5) return;
    toastT = time;
    out.push({ type: "toast", title, low: true });
  };

  const findAim = (input: Input, assist = false) => {
    const o = input.camPos;
    const d = input.look;
    const ahead = t1.copy(pos).sub(o).dot(d);
    const maxT = RANGE + Math.max(0, ahead) + 2;
    aim.kind = "none";
    aim.obj = null;
    aim.titan = null;
    aim.blocked = false;
    let best = world.raycast(o, d, maxT, aim.normal);
    if (best >= 0 && best > ahead) {
      aim.kind = "world";
      aim.point.copy(o).addScaledVector(d, best);
    } else best = Infinity;
    const th = titans.raycast(o, d, maxT);
    if (th && th.t < best && th.t > ahead) {
      best = th.t;
      aim.kind = "titan";
      aim.point.copy(th.point);
      aim.obj = th.obj;
      aim.titan = th.titan;
    }
    if (aim.kind !== "titan") {
      let bestA = 0.06;
      let found: TitanView | null = null;
      for (const ti of titans.list()) {
        if (!ti.alive || ti.pos.distanceTo(pos) > RANGE + 30) continue;
        for (const p of PARTS) {
          if (!titans.partPos(ti, p, t2)) continue;
          if (t2.distanceTo(pos) > RANGE) continue;
          t3.copy(t2).sub(o);
          const along = t3.dot(d);
          if (along <= ahead) continue;
          const ang = t3.addScaledVector(d, -along).length() / along;
          if (ang < bestA && along < best && reach(t2) < 0) {
            bestA = ang;
            found = ti;
            mid.copy(t2);
          }
        }
      }
      if (found) {
        t3.copy(mid).sub(pos).normalize();
        const hit = titans.raycast(pos, t3, RANGE + 3);
        if (hit) {
          aim.kind = "titan";
          aim.point.copy(hit.point);
          aim.obj = hit.obj;
          aim.titan = hit.titan;
        }
      }
    }
    if (aim.kind === "none" && assist) {
      rightV.set(-d.z, 0, d.x).normalize();
      bodyUp.crossVectors(rightV, d);
      for (let ring = 1; ring <= 2 && aim.kind === "none"; ring++) {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const r = ring * 0.045;
          t3.copy(d).addScaledVector(rightV, Math.cos(ang) * r).addScaledVector(bodyUp, Math.sin(ang) * r).normalize();
          const t = world.raycast(o, t3, maxT, aim.normal);
          if (t > ahead && t >= 0) {
            aim.point.copy(o).addScaledVector(t3, t);
            if (aim.point.distanceTo(pos) <= RANGE && reach(aim.point) < 0) {
              aim.kind = "world";
              break;
            }
          }
        }
      }
    }
    if (aim.kind !== "none") {
      const b = reach(aim.point);
      if (b >= 0 && b < 4) {
        aim.kind = "none";
        aim.blocked = true;
      } else if (b >= 0) {
        aim.kind = "world";
        aim.obj = null;
        aim.titan = null;
        aim.point.copy(eye).addScaledVector(rDir, b);
        aim.normal.copy(rNorm);
      }
    }
    aim.dist = aim.kind === "none" ? 0 : aim.point.distanceTo(pos);
    if (aim.dist > RANGE) aim.kind = "none";
  };

  const nextPart = (ti: TitanView, from: TitanPart, step: number): TitanPart | null => {
    const s = PARTS.indexOf(from);
    for (let k = step; k <= PARTS.length; k++) {
      const p = PARTS[(s + k) % PARTS.length];
      if (titans.partHealth(ti, p) > 0 && titans.partPos(ti, p, t2)) return p;
    }
    return null;
  };

  const acquire = (input: Input): Lock | null => {
    const ti = titans.nearest(pos, input.look, 160);
    if (!ti) return null;
    const p = nextPart(ti, "nape", 0);
    return p ? { titan: ti, part: p } : null;
  };

  const crosshair = (input: Input) => {
    if (aim.kind === "none") findAim(input, true);
    if (aim.kind === "none") return false;
    for (let i = 0; i < 2; i++) fire(i, "autoHook", aim.point, aim.obj, aim.titan, aim.kind === "world" ? aim.normal : null, input.look);
    return true;
  };

  const toward = (goal: THREE.Vector3) => {
    eye.copy(pos).addScaledVector(UP, 0.7);
    t1.copy(goal).sub(eye);
    const yaw = Math.atan2(t1.x, t1.z);
    const base = Math.atan2(t1.y, Math.hypot(t1.x, t1.z));
    t1.normalize();
    let best = 0;
    for (const off of [-0.7, -0.5, -0.35, -0.2, -0.1, 0, 0.12, 0.25, 0.4, 0.6, 0.85])
      for (const side of [0, -0.15, 0.15]) {
        const p = THREE.MathUtils.clamp(base + off, -1.3, 1.3);
        const y = yaw + side;
        t2.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
        const t = world.raycast(eye, t2, RANGE, rNorm);
        const gain = t * t2.dot(t1);
        if (t > 8 && gain > best) {
          best = gain;
          aim.point.copy(eye).addScaledVector(t2, t);
          aim.normal.copy(rNorm);
        }
      }
    if (!best) return false;
    t2.copy(aim.point).sub(pos).normalize();
    for (let i = 0; i < 2; i++) fire(i, "autoHook", aim.point, null, null, aim.normal, t2);
    return true;
  };

  const autoHook = (input: Input) => {
    if (!lock && crosshair(input)) return;
    const target = lock ?? acquire(input);
    if (!target || !titans.partPos(target.titan, target.part, mid)) {
      if (crosshair(input)) return;
      sfx("anchorMiss", 0.6);
      say("No titan in range");
      return;
    }
    t1.copy(mid).sub(pos);
    rightV.set(-t1.z, 0, t1.x).normalize();
    const hits: (TitanHit | null)[] = [null, null];
    for (let i = 0; i < 2; i++) {
      t2.copy(mid).addScaledVector(rightV, i ? -1.6 : 1.6).addScaledVector(UP, 0.8).sub(pos);
      const len = t2.length();
      t2.divideScalar(len);
      let hit = len < RANGE ? titans.raycast(pos, t2, len + 6) : null;
      if (hit && reach(hit.point) >= 0) hit = null;
      if (!hit) {
        t2.copy(mid).sub(pos).normalize();
        hit = titans.raycast(pos, t2, RANGE);
        if (hit && reach(hit.point) >= 0) hit = null;
      }
      hits[i] = hit;
    }
    if (!hits[0] && !hits[1]) {
      if (lock ? toward(mid) : crosshair(input)) return;
      sfx("anchorMiss", 0.6);
      say(mid.distanceTo(pos) > RANGE ? "Out of range" : "No clear line");
      return;
    }
    for (let i = 0; i < 2; i++) {
      const h = hits[i];
      if (h) fire(i, "autoHook", h.point, h.obj, h.titan, null, t2.copy(h.point).sub(pos).normalize());
    }
  };

  const strike = () => {
    slash.struck = true;
    blade.pos.copy(pos).addScaledVector(slash.dir, 0.9);
    blade.dir.copy(slash.dir);
    blade.speed = Math.max(vel.length(), slash.speed) * st.damage;
    blade.charge = slash.charge;
    blade.radius = 2.5 + 1.5 * slash.charge;
    const r = titans.strike(blade, slash.titan ? { titan: slash.titan, part: slash.part } : null);
    for (const e of r.events) out.push(e);
    rightV.crossVectors(slash.dir, UP);
    if (rightV.lengthSq() < 1e-4) rightV.set(1, 0, 0);
    rightV.normalize();
    t1.copy(blade.pos).addScaledVector(rightV, -2.4 * slash.side).addScaledVector(UP, -0.8);
    t2.copy(blade.pos).addScaledVector(slash.dir, 1.6).addScaledVector(UP, 0.4);
    t3.copy(blade.pos).addScaledVector(rightV, 2.4 * slash.side).addScaledVector(UP, 0.9);
    fx.slash(t1, t2, t3);
    if (!r.zone) return;
    sharp -= (slash.charge >= 1 ? 0.08 : 0.14) * st.wear;
    if (r.zone !== "nape" || r.killed) {
      combo = comboT > 0 ? combo + 1 : 1;
      comboT = 4;
    }
    vel.multiplyScalar(0.25).addScaledVector(slash.dir, -6).addScaledVector(UP, 11);
    for (let i = 0; i < 2; i++) if (hooks[i].latch) release(i, true);
    slash.on = false;
    flipNext = true;
    if (sharp <= 0) {
      sharp = 0;
      sfx("bladeBreak");
    }
  };

  const startSlash = (input: Input) => {
    const c = Math.min(1, chargeT / chargeFull());
    const perfect = chargeT >= PERFECT[0] * st.chargeTime && chargeT <= PERFECT[1] * st.chargeTime;
    slash.on = true;
    slash.t = 0;
    slash.struck = false;
    slash.charge = perfect ? 1 : c * 0.85;
    slash.side = Math.random() < 0.5 ? -1 : 1;
    slash.titan = null;
    if (lock && titans.partPos(lock.titan, lock.part, t1) && t1.distanceTo(pos) < 32) {
      slash.titan = lock.titan;
      slash.part = lock.part;
    } else {
      const ti = titans.nearest(pos, input.look, 22);
      if (ti && titans.partPos(ti, "nape", t1)) {
        slash.titan = ti;
        slash.part = "nape";
      }
    }
    if (slash.titan) slash.dir.copy(t1).sub(pos).normalize();
    else slash.dir.copy(input.look);
    const lunge = 22 + 22 * slash.charge;
    const along = vel.dot(slash.dir);
    t2.copy(vel).addScaledVector(slash.dir, -along).multiplyScalar(0.35);
    vel.copy(slash.dir).multiplyScalar(Math.max(along, lunge)).add(t2);
    slash.speed = vel.length();
    gas = Math.max(0, gas - 0.02 * drain());
    frame.side = slash.side;
    startAct("slash", SLASH_T);
    sfx("slash", 0.7 + 0.3 * slash.charge);
    if (perfect) out.push({ type: "shake", strength: 0.25 });
    fx.gas(pos, t1.copy(slash.dir).negate(), 1.2);
  };

  const updateSlash = (dt: number) => {
    slash.t += dt;
    if (slash.titan) {
      if (!slash.titan.alive || !titans.partPos(slash.titan, slash.part, t1)) slash.titan = null;
      else {
        t1.sub(pos);
        const d = t1.length();
        t1.divideScalar(d);
        slash.dir.lerp(t1, 1 - Math.exp(-14 * dt)).normalize();
        const sp = Math.max(vel.length(), 20);
        vel.lerp(t2.copy(slash.dir).multiplyScalar(sp), 1 - Math.exp(-10 * dt));
        if (!slash.struck && d <= 2.5 + 1.5 * slash.charge + 1.2) strike();
      }
    } else if (!slash.struck && slash.t >= 0.16) strike();
    if (slash.on && slash.t >= SLASH_T) {
      if (!slash.struck && slash.titan && titans.partPos(slash.titan, slash.part, t1) && t1.distanceTo(pos) < 9) strike();
      slash.on = false;
    }
  };

  const die = () => {
    mode = "dead";
    deadT = 0;
    health = 0;
    slash.on = false;
    charging = false;
    for (let i = 0; i < 2; i++) release(i, true);
    out.push({ type: "sfx", name: "death" }, { type: "stinger", name: "death" });
  };

  const respawn = () => {
    let best = world.spawn;
    let bd = Infinity;
    for (const s of world.supplies) {
      const d = s.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    pos.copy(best);
    if (best !== world.spawn) pos.y += SCOUT_HALF + 0.05;
    vel.set(0, 0, 0);
    health = 1;
    gas = 1;
    blades = SPARE;
    sharp = 1;
    mode = "ground";
    lock = null;
    slash.on = false;
    act.name = null;
    flipNext = false;
    combo = 0;
    for (const h of hooks) {
      h.state = "idle";
      h.obj = null;
      h.titan = null;
    }
  };

  const supply = (dt: number) => {
    let near = false;
    for (const s of world.supplies) {
      const dx = s.x - pos.x;
      const dz = s.z - pos.z;
      if (dx * dx + dz * dz < 64 && Math.abs(pos.y - s.y) < 8) near = true;
    }
    if (near && !inSupply && (gas < 0.99 || blades < SPARE || sharp < 1 || health < 1)) sfx("resupply");
    inSupply = near;
    if (!near) return;
    gas = Math.min(1, gas + 0.4 * st.refill * dt);
    health = Math.min(1, health + 0.2 * dt);
    supplyT += dt;
    if (supplyT > 0.5 / st.refill) {
      supplyT = 0;
      if (sharp < 1) sharp = 1;
      else if (blades < SPARE) blades++;
    }
  };

  const gasPuff = (dir: THREE.Vector3, strength: number, dt: number, every = 0.03) => {
    gasPuffT -= dt;
    if (gasPuffT > 0) return;
    gasPuffT = every;
    t3.set(0, -0.1, -0.22).applyQuaternion(orient).add(pos);
    fx.gas(t3, dir, strength);
  };

  const orientTo = (f: THREE.Vector3, up: THREE.Vector3, rate: number, dt: number) => {
    fwd.copy(f).addScaledVector(up, -f.dot(up));
    if (fwd.lengthSq() < 1e-5) return;
    fwd.normalize();
    rightV.crossVectors(up, fwd);
    m4.makeBasis(rightV, up, fwd);
    qGoal.setFromRotationMatrix(m4);
    orient.slerp(qGoal, 1 - Math.exp(-rate * dt));
  };

  const physics = (dt: number, input: Input) => {
    const wish = input.wish;
    const look = input.look;
    const held = input.held;
    prevVel.copy(vel);
    a.set(0, -G, 0);
    const speed = vel.length();

    let n = 0;
    mid.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      const h = hooks[i];
      if (h.state !== "on") continue;
      wires.anchor(h, t1);
      h.point.copy(t1);
      mid.add(t1);
      n++;
    }
    reelT = n ? reelT + dt : 0;
    const boosting = held.has("gas") && !grounded && gas > 0;

    if (n && !slash.on) {
      mid.divideScalar(n);
      t1.copy(mid).sub(pos);
      const d = t1.length();
      if (d > 1e-3) {
        t1.divideScalar(d);
        const ramp = Math.min(1, reelT / 0.45);
        const curve = 0.3 + 0.7 * ramp * ramp * (3 - 2 * ramp);
        const power = (n === 2 ? 72 : 50) * st.reel * curve * (gas > 0 ? 1 : 0.4) * (boosting ? 1.25 : 1);
        const vr = vel.dot(t1);
        const cap = (n === 2 ? 58 : 46) * st.reel;
        if (vr < cap) a.addScaledVector(t1, power * Math.min(1, (cap - vr) / 10));
        a.y += G * 0.35;
        if (grounded) {
          vel.y = Math.max(vel.y, 6 + Math.max(0, t1.y) * 6);
          grounded = false;
        }
        t2.copy(wish).addScaledVector(t1, -wish.dot(t1));
        a.addScaledVector(t2, 26);
        if (d < 3.2 && vr > 0) vel.addScaledVector(t1, -vr * Math.min(1, 9 * dt));
        if (d < 2.4) a.addScaledVector(t1, -a.dot(t1));
        gas = Math.max(0, gas - 0.012 * n * drain() * dt);
        if (gas > 0 && !boosting) gasPuff(t2.copy(t1).negate(), 0.25 + 0.2 * ramp, dt, 0.07);
      }
    }

    if (mode === "wall") {
      a.addScaledVector(wallN, -a.dot(wallN));
      a.y *= 0.2;
      a.addScaledVector(wallN, -6);
      t2.copy(wish).addScaledVector(wallN, -wish.dot(wallN));
      if (t2.lengthSq() > 1e-4) {
        t2.normalize();
        const along = vel.dot(t2);
        if (along < 16) a.addScaledVector(t2, 40);
      }
      if (input.pressed.has("gas")) {
        vel.addScaledVector(wallN, 13).addScaledVector(UP, 9).addScaledVector(look, 6);
        wallT = 0;
        sfx("gasBurst", 0.7);
        startAct("flip", 0.55);
        for (let i = 0; i < 2; i++) if (hooks[i].state === "on") release(i, true);
      }
    }

    if (grounded && !n) {
      t2.copy(wish).multiplyScalar(RUN * st.run);
      const k = 1 - Math.exp(-(wish.lengthSq() > 0 ? 9 : 12) * dt);
      if (speed < RUN * st.run * 1.2 || wish.lengthSq() === 0) {
        vel.x += (t2.x - vel.x) * k;
        vel.z += (t2.z - vel.z) * k;
      } else {
        vel.x *= 1 - 2.5 * dt;
        vel.z *= 1 - 2.5 * dt;
      }
      if (input.pressed.has("gas")) {
        vel.y = JUMP;
        grounded = false;
        sfx("land", 0.4);
      }
    } else if (!n && mode !== "wall") a.addScaledVector(wish, 9);

    if (boosting && !input.pressed.has("gas")) {
      if (n) t1.copy(look);
      else t1.copy(wish.lengthSq() > 0 ? wish : look).setY(0).normalize();
      const along = vel.dot(t1);
      a.addScaledVector(t1, (n ? 34 : 26) * Math.max(0.3, 1 - Math.max(0, along) / 48));
      if (n) a.y += 6;
      else if (vel.y < 0) a.y += 3;
      gas = Math.max(0, gas - 0.09 * drain() * dt);
      gasPuff(t2.copy(t1).negate(), 1, dt);
    }

    dashCd -= dt;
    if (input.pressed.has("dash") && dashCd <= 0 && gas > 0.02 && mode !== "held") {
      dashCd = 0.45;
      gas = Math.max(0, gas - 0.05 * drain());
      if (wish.lengthSq() > 0) t2.copy(wish).addScaledVector(UP, grounded ? 0.12 : 0.18).normalize();
      else if (n) t2.copy(look);
      else t2.copy(look).setY(0).normalize().addScaledVector(UP, 0.12).normalize();
      const along = vel.dot(t2);
      vel.addScaledVector(t2, Math.max(16, 30 - Math.max(0, along) * 0.4));
      startAct("dash", 0.28);
      sfx("gasDash");
      out.push({ type: "shake", strength: 0.12 });
      rightV.crossVectors(t2, UP);
      if (rightV.lengthSq() < 1e-4) rightV.set(1, 0, 0);
      rightV.normalize();
      bodyUp.crossVectors(rightV, t2);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        t3.copy(rightV).multiplyScalar(Math.cos(ang)).addScaledVector(bodyUp, Math.sin(ang)).addScaledVector(t2, -0.6);
        t1.copy(pos).addScaledVector(t3, 0.5);
        fx.gas(t1, t3, 0.9);
      }
      grounded = false;
    }

    vel.addScaledVector(a, dt);
    if (!grounded) vel.multiplyScalar(1 - Math.min(0.5, 0.0021 * speed * dt));
    const sp = vel.length();
    if (sp > MAX_SPEED * st.maxSpeed) vel.multiplyScalar((MAX_SPEED * st.maxSpeed) / sp);
    pos.addScaledVector(vel, dt);

    for (let i = 0; i < 2; i++) {
      const h = hooks[i];
      if (h.state !== "on") continue;
      t1.copy(pos).sub(h.point);
      const d = t1.length();
      if (slash.on) h.len = Math.max(h.len, d);
      else if (d > h.len && d > 1e-3) {
        t1.divideScalar(d);
        pos.copy(h.point).addScaledVector(t1, h.len);
        const vr = vel.dot(t1);
        if (vr > 0) vel.addScaledVector(t1, -vr);
      } else h.len = Math.max(1.2, d);
    }

    const wasGrounded = grounded;
    const fallV = -vel.y;
    const hsp = Math.hypot(vel.x, vel.z);
    const res = world.collide(pos, vel, RADIUS, HEIGHT);
    titans.pushOut(pos, RADIUS + 0.1, vel);
    grounded = res.grounded;
    wallT -= dt;
    if (res.wall && !grounded) {
      wallN.copy(res.wall);
      wallN.y = 0;
      if (wallN.lengthSq() > 1e-4) {
        wallN.normalize();
        if (n) wallT = Math.max(wallT, 0.2);
      }
    }
    if (grounded) wallT = 0;
    if (grounded && !wasGrounded) {
      if (fallV > 15 || hsp > 21) {
        startAct("roll", 0.55);
        sfx("roll");
        fx.dust(t1.copy(pos).addScaledVector(UP, -SCOUT_HALF), 1.4);
        vel.x *= 0.75;
        vel.z *= 0.75;
        out.push({ type: "shake", strength: Math.min(0.5, fallV / 60) });
      } else if (fallV > 5) {
        sfx("land", Math.min(1, fallV / 15));
        if (fallV > 9) fx.dust(t1.copy(pos).addScaledVector(UP, -SCOUT_HALF), 0.7);
      }
    }
    if (pos.y < -60) respawn();
  };

  const updateHooks = (dt: number, input: Input) => {
    for (let i = 0; i < 2; i++) {
      const h = hooks[i];
      h.t += dt;
      if (h.state === "fly") {
        if (!h.latch && !input.held.has(h.button)) {
          h.state = "back";
          continue;
        }
        if (h.titan && !h.titan.alive) {
          h.hit = false;
          h.obj = null;
          h.titan = null;
        }
        wires.anchor(h, t1);
        t2.copy(t1).sub(h.head);
        const d = t2.length();
        const step = HOOK_SPEED * dt;
        if (d <= step) {
          h.head.copy(t1);
          if (h.hit) {
            h.state = "on";
            h.len = Math.max(1.2, pos.distanceTo(t1));
            sfx("anchorHit", 0.8, t1);
            if (!h.titan) fx.dust(t1, 0.35);
          } else {
            h.state = "back";
            sfx("anchorMiss", 0.5);
          }
        } else h.head.addScaledVector(t2, step / d);
      } else if (h.state === "on") {
        if (h.latch && !h.titan && pos.distanceTo(h.point) < 4) release(i);
        else if ((!h.latch && !input.held.has(h.button)) || (h.titan && !h.titan.alive)) release(i);
        else wires.anchor(h, h.head);
      } else if (h.state === "back") {
        hip(i, t1);
        t2.copy(t1).sub(h.head);
        const d = t2.length();
        const step = HOOK_SPEED * 1.3 * dt;
        if (d <= step) h.state = "idle";
        else h.head.addScaledVector(t2, step / d);
      }
    }
  };

  const pickMode = () => {
    if (mode === "dead" || mode === "held") return;
    const on = hooks[0].state === "on" || hooks[1].state === "on";
    if (wallT > 0 && !grounded) mode = "wall";
    else if (on) mode = "reel";
    else mode = grounded ? "ground" : "air";
  };

  const animate = (dt: number, input: Input | null) => {
    const speed = vel.length();
    if (act.name) {
      act.t += dt;
      if (act.t >= act.dur) {
        act.name = null;
        if (flipNext) startAct("flip", 0.5);
        flipNext = false;
      }
    }
    let anim: ScoutAnim;
    const hsp = Math.hypot(vel.x, vel.z);
    if (mode === "dead") anim = "dead";
    else if (mode === "held") anim = "held";
    else if (act.name === "slash" || act.name === "roll") anim = act.name;
    else if (charging) anim = "charge";
    else if (act.name) anim = act.name;
    else if (mode === "wall") anim = "wall";
    else if (mode === "reel") anim = "reel";
    else if (mode === "ground") anim = hsp > 0.6 ? "run" : "idle";
    else anim = "air";
    if (frame.anim !== anim) frame.t = 0;
    frame.anim = anim;
    frame.t += dt;
    frame.k = act.name ? Math.min(1, act.t / act.dur) : 0;
    frame.speed = mode === "ground" || mode === "wall" ? hsp : speed;
    frame.charge = charging ? Math.min(1, chargeT / chargeFull()) : 0;
    frame.broken = sharp <= 0;

    if (hsp > 0.5) facing.set(vel.x / hsp, 0, vel.z / hsp);
    if (anim === "dead") {
      orientTo(UP, bodyUp.copy(facing), 6, dt);
    } else if (anim === "wall") {
      t1.copy(vel).addScaledVector(wallN, -vel.dot(wallN));
      if (t1.lengthSq() < 0.5) t1.copy(facing).addScaledVector(wallN, -facing.dot(wallN));
      bodyUp.copy(wallN).multiplyScalar(0.85).addScaledVector(UP, 0.35).normalize();
      orientTo(t1, bodyUp, 12, dt);
    } else if (anim === "charge") {
      if (input && lock && titans.partPos(lock.titan, lock.part, t1)) t1.sub(pos);
      else if (input) t1.copy(input.look);
      else t1.copy(facing);
      orientTo(t1, UP, 16, dt);
    } else if (anim === "slash") {
      bodyUp.copy(slash.dir).lerp(UP, 0.2).normalize();
      t1.copy(UP);
      if (Math.abs(bodyUp.y) > 0.9) t1.copy(facing);
      orientTo(t1, bodyUp, 22, dt);
    } else if (anim === "reel" || anim === "air" || anim === "dash" || anim === "flip") {
      const fast = Math.min(1, speed / 40);
      if (anim === "reel") {
        t1.copy(mid).sub(pos).normalize();
        bodyUp.copy(UP).lerp(t1, 0.55).normalize();
        t2.copy(t1);
      } else {
        t2.copy(speed > 1 ? vel : facing).normalize();
        bodyUp.copy(UP).lerp(t2, (anim === "dash" ? 0.7 : 0.45) * fast).normalize();
      }
      if (Math.abs(t2.dot(bodyUp)) > 0.98) t2.copy(facing);
      orientTo(t2, bodyUp, 9, dt);
    } else orientTo(facing, UP, mode === "held" ? 4 : 14, dt);

    scout.root.position.copy(pos);
    if (mode === "dead") scout.root.position.y -= SCOUT_HALF - 0.15;
    scout.root.quaternion.copy(orient);
    scout.update(dt, frame);
    for (let i = 0; i < 2; i++) wires.draw(i, hip(i, t1), time);
  };

  const player: Player = {
    pos,
    vel,
    get mode() {
      return mode;
    },
    get alive() {
      return mode !== "dead";
    },
    get grounded() {
      return grounded;
    },
    get lock() {
      return lock;
    },
    update(dt, input, playing) {
      out.length = 0;
      time += dt;
      if (!playing || dt <= 0) {
        if (!playing) charging = false;
        animate(dt, null);
        return out;
      }
      findAim(input);
      lastLook.copy(input.look);
      comboT -= dt;
      if (comboT <= 0) combo = 0;

      if (mode === "dead") {
        deadT += dt;
        vel.y -= G * dt;
        vel.x *= 1 - 3 * dt;
        vel.z *= 1 - 3 * dt;
        pos.addScaledVector(vel, dt);
        grounded = world.collide(pos, vel, RADIUS, HEIGHT).grounded;
        if (deadT > 3) respawn();
        animate(dt, input);
        return out;
      }

      const heldAt = titans.held();
      if (heldAt) {
        if (!wasHeld) {
          for (let i = 0; i < 2; i++) release(i, true);
          slash.on = false;
          charging = false;
          act.name = null;
        }
        wasHeld = true;
        mode = "held";
        pos.copy(heldAt);
        vel.set(0, 0, 0);
        if (input.pressed.has("attack") || input.pressed.has("gas")) for (const e of titans.struggle()) out.push(e);
        updateHooks(dt, input);
        animate(dt, input);
        return out;
      }
      if (wasHeld) {
        wasHeld = false;
        mode = "air";
        grounded = false;
        vel.set(facing.x * -6, 10, facing.z * -6);
        startAct("flip", 0.6);
      }

      if (lock) {
        if (!lock.titan.alive) lock = acquire(input);
        else if (!titans.partPos(lock.titan, lock.part, t1)) {
          const p = nextPart(lock.titan, lock.part, 1);
          lock = p ? { titan: lock.titan, part: p } : null;
        }
      }
      if (input.pressed.has("lock")) {
        lock = lock ? null : acquire(input);
        sfx(lock ? "lock" : "ui", 0.6);
      }
      if (input.pressed.has("cycle") && lock) {
        const p = nextPart(lock.titan, lock.part, 1);
        if (p && p !== lock.part) {
          lock = { titan: lock.titan, part: p };
          sfx("lockCycle", 0.6);
        }
      }

      const unlatch = (btn: Action) => {
        let any = false;
        for (let i = 0; i < 2; i++) {
          const h = hooks[i];
          if (h.latch && h.button === btn && (h.state === "fly" || h.state === "on")) {
            release(i);
            any = true;
          }
        }
        return any;
      };
      const hookBtns: Action[] = ["anchorL", "anchorR", "autoHook"];
      const fresh = new Set<Action>();
      for (const btn of hookBtns) {
        if (!input.pressed.has(btn)) continue;
        if (unlatch(btn)) continue;
        if (btn === "autoHook") unlatch("anchorL") || unlatch("anchorR");
        pressT.set(btn, time);
        fresh.add(btn);
      }
      if (aim.kind === "none" && (fresh.has("anchorL") || fresh.has("anchorR"))) findAim(input, true);
      for (let i = 0; i < 2; i++) {
        const btn: Action = i ? "anchorR" : "anchorL";
        if (!fresh.has(btn)) continue;
        if (aim.kind === "none") {
          fire(i, btn, null, null, null, null, input.look);
          say(aim.blocked ? "No clear line" : "Out of range");
        }
        else fire(i, btn, aim.point, aim.obj, aim.titan, aim.kind === "world" ? aim.normal : null, input.look);
      }
      if (fresh.has("autoHook")) autoHook(input);
      for (const btn of hookBtns) {
        if (!input.released.has(btn) || time - (pressT.get(btn) ?? -9) > TAP) continue;
        pressT.delete(btn);
        for (const h of hooks) if (h.button === btn && (h.state === "fly" || h.state === "on")) h.latch = true;
      }
      updateHooks(dt, input);

      if (input.pressed.has("swap") && !slash.on) {
        if (blades > 0 && sharp < 1) {
          blades--;
          sharp = 1;
          sfx("bladeSwap");
          startAct("swap", 0.45);
        } else if (blades === 0) out.push({ type: "toast", title: "No blades left", text: "Resupply at the green smoke" });
      }

      if (input.pressed.has("attack") && !slash.on) {
        charging = true;
        flashed = false;
        sfx("bladeDraw", 0.6);
      }
      if (charging) {
        chargeT = input.holdTime("attack");
        if (!flashed && chargeT >= PERFECT[0] * st.chargeTime) {
          flashed = true;
          sfx("charge");
        }
        if (!input.held.has("attack")) {
          charging = false;
          if (sharp > 0) startSlash(input);
          else if (time - brokeToast > 2) {
            brokeToast = time;
            sfx("clang", 0.6);
          }
        }
      }

      physics(dt, input);
      if (slash.on) updateSlash(dt);
      pickMode();
      supply(dt);
      warn();
      countHint(input);
      animate(dt, input);
      return out;
    },
    damage(amount, from) {
      if (mode === "dead") return [];
      const ev: GameEvent[] = [{ type: "sfx", name: "hurt" }, { type: "shake", strength: 0.35 + amount }];
      health -= amount;
      if (from && mode !== "held") {
        t1.copy(pos).sub(from);
        t1.y = Math.max(0.3, t1.y);
        vel.addScaledVector(t1.normalize(), 14);
      }
      if (health <= 0) {
        const saved = out.length;
        die();
        for (let i = saved; i < out.length; i++) ev.push(out[i]);
        out.length = saved;
      }
      return ev;
    },
    respawn,
    hud() {
      hud.health = Math.max(0, health);
      hud.gas = gas;
      hud.blades = blades;
      hud.sharp = sharp;
      hud.hooks[0] = hooks[0].state === "on";
      hud.hooks[1] = hooks[1].state === "on";
      hud.charge = charging ? Math.min(1, chargeT / chargeFull()) : null;
      hud.aim = aim.kind;
      hud.aimDist = aim.dist;
      hud.supply = inSupply;
      hud.dead = mode === "dead";
      hud.combo = combo;
      shown = hint();
      hud.hint = shown;
      return hud;
    },
    cameraView() {
      view.mode = mode;
      view.charge = charging ? Math.min(1, chargeT / chargeFull()) : 0;
      view.lockPoint = lock && titans.partPos(lock.titan, lock.part, lockPoint) ? lockPoint : null;
      return view;
    },
    setVisible(on) {
      scout.root.visible = on;
    },
    setCharacter(id) {
      const ch = getCharacter(id);
      st = ch.stats;
      if (ch.id === charId) return;
      charId = ch.id;
      const vis = scout.root.visible;
      scene.remove(scout.root);
      scout.dispose();
      scout = createScout(ch.look);
      scout.root.visible = vis;
      scene.add(scout.root);
    },
    dispose() {
      scene.remove(scout.root);
      scout.dispose();
      wires.dispose();
    },
  };
  if (process.env.NODE_ENV !== "production") Object.defineProperty(player, "stats", { get: () => ({ id: charId, ...st }) });
  return player;
}
