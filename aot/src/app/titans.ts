import * as THREE from "three";
import type { GameEvent } from "./contracts";
import type { Fx } from "./fx";
import { buildTitan, type HitSphere, type Part, type TitanModel } from "./titan-model";
import { rng } from "./world-textures";
import { GATE, WALL_IN, WALL_OUT, type World } from "./world";

type State = "walk" | "windup" | "grab" | "hold" | "stomp" | "recover" | "kneel" | "dead";

export type Titan = {
  m: TitanModel;
  h: number;
  s: number;
  abnormal: boolean;
  pos: THREE.Vector3;
  yaw: number;
  state: State;
  t: number;
  nape: number;
  napeMax: number;
  leg: number;
  arm: [number, number];
  armOff: [number, number];
  arm0: 0 | 1;
  cool: number;
  phase: number;
  stuck: number;
  side: number;
  removed: boolean;
  spotted: boolean;
};

export type Target = { pos: THREE.Vector3; vel: THREE.Vector3; alive: boolean };

const SIZES = [7, 10, 14, 18];
const MAX_ALIVE = 18;
const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();

function pose(obj: THREE.Object3D, x: number, y: number, z: number, k: number) {
  obj.quaternion.slerp(_q.setFromEuler(_e.set(x, y, z)), k);
}

// Point a joint's -y axis at a world position.
function reach(obj: THREE.Object3D, at: THREE.Vector3, k: number) {
  obj.getWorldPosition(_v);
  const d = _w.copy(at).sub(_v).normalize();
  obj.parent!.getWorldQuaternion(_q2).invert();
  d.applyQuaternion(_q2);
  obj.quaternion.slerp(_q.setFromUnitVectors(DOWN, d), k);
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) {
  _x.copy(o).sub(c);
  const b = _x.dot(d);
  const cc = _x.lengthSq() - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : -1;
}

export function createTitans(scene: THREE.Scene, world: World, fx: Fx) {
  const r = rng(99);
  const list: Titan[] = [];
  let wave = 0;
  let kills = 0;
  let breakT = 6;
  let started = false;
  let queue: { h: number; abnormal: boolean; inside: boolean }[] = [];
  let held: Titan | null = null;
  let escape = 0;
  const heldPos = new THREE.Vector3();
  const mouth = new THREE.Vector3();

  const blocked = (t: Titan) => {
    const rad = Math.max(1.2, t.h * 0.16);
    for (const b of world.near(t.pos.x, t.pos.z, rad + 2)) {
      if ((b.maxY < t.h * 0.5 && b.maxY < 30) || b.minY > t.h * 0.6) continue;
      const cx = THREE.MathUtils.clamp(t.pos.x, b.minX, b.maxX);
      const cz = THREE.MathUtils.clamp(t.pos.z, b.minZ, b.maxZ);
      const dx = t.pos.x - cx;
      const dz = t.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rad * rad) continue;
      if (d2 < 1e-6) {
        const px = Math.min(t.pos.x - b.minX, b.maxX - t.pos.x);
        const pz = Math.min(t.pos.z - b.minZ, b.maxZ - t.pos.z);
        if (px < pz) t.pos.x = t.pos.x - b.minX < b.maxX - t.pos.x ? b.minX - rad : b.maxX + rad;
        else t.pos.z = t.pos.z - b.minZ < b.maxZ - t.pos.z ? b.minZ - rad : b.maxZ + rad;
      } else {
        const d = Math.sqrt(d2);
        t.pos.x = cx + (dx / d) * rad;
        t.pos.z = cz + (dz / d) * rad;
      }
    }
  };

  const spawn = (h: number, abnormal: boolean, at: THREE.Vector3) => {
    const m = buildTitan(h, abnormal, r);
    scene.add(m.root);
    const napeMax = 20 + h * 3;
    const t: Titan = {
      m,
      h,
      s: h / 10,
      abnormal,
      pos: at.clone(),
      yaw: Math.PI,
      state: "walk",
      t: 0,
      nape: napeMax,
      napeMax,
      leg: 30 + h * 2,
      arm: [24 + h * 2, 24 + h * 2],
      armOff: [0, 0],
      arm0: 0,
      cool: 2,
      phase: r() * 6,
      stuck: 0,
      side: 0,
      removed: false,
      spotted: false,
    };
    list.push(t);
    blocked(t);
    return t;
  };

  const streetSpot = (from: THREE.Vector3, minD: number) => {
    for (let k = 0; k < 40; k++) {
      const x = -300 + Math.floor(r() * 11) * 60 + (r() - 0.5) * 6;
      const z = -300 + r() * 600;
      if (x > 90 && z < -90) continue;
      if (Math.hypot(x - from.x, z - from.z) > minD) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, WALL_IN - 30);
  };

  const startWave = () => {
    wave++;
    const n = Math.min(4 + wave * 2, 24);
    queue = [];
    for (let i = 0; i < n; i++) {
      const big = Math.min(3, Math.floor(r() * (1.6 + wave * 0.5)));
      queue.push({ h: SIZES[big] * (0.9 + r() * 0.2), abnormal: r() < Math.min(0.35, 0.05 + wave * 0.05), inside: wave === 1 || r() < 0.5 });
    }
    if (wave === 1) for (const q of queue) q.abnormal = false;
  };

  const kill = (t: Titan, events: GameEvent[], speed: number) => {
    t.state = "dead";
    t.t = 0;
    t.m.napeMark.visible = false;
    kills++;
    if (held === t) held = null;
    const bonus = Math.round(speed * 2);
    events.push(
      { type: "sfx", name: "napeKill" },
      { type: "slowmo", scale: 0.25, duration: 0.35 },
      { type: "shake", strength: 0.35 },
      { type: "score", amount: Math.round(100 + t.h * 10 + (t.abnormal ? 80 : 0) + bonus), reason: t.abnormal ? "Abnormal slain" : `${Math.round(t.h)} m titan slain` },
    );
    const body = t.m.spine;
    fx.emit(() => (t.removed ? null : body.getWorldPosition(new THREE.Vector3())), 30 + t.h * 3, 9, { size: 1 + t.s * 2, grow: 4, life: 3.5, rise: 3, spread: t.h * 0.4, speed: 1.5 });
  };

  const syncSpheres = (t: Titan) => {
    t.m.root.updateMatrixWorld(true);
    for (const sp of t.m.spheres) sp.world.copy(sp.local).applyMatrix4(sp.obj.matrixWorld);
  };

  const sphereR = (t: Titan, sp: HitSphere) => sp.r * t.s;

  const update = (dt: number, player: Target) => {
    const events: GameEvent[] = [];
    if (started) {
      const alive = list.filter((t) => t.state !== "dead").length;
      if (!queue.length && alive === 0) {
        if (breakT <= 0) {
          breakT = 12;
          events.push({ type: "toast", title: `Wave ${wave} cleared`, text: "Resupply before the next wave" }, { type: "score", amount: 250 * wave, reason: "Wave bonus" });
        }
        breakT -= dt;
        if (breakT <= 0) {
          startWave();
          events.push({ type: "sfx", name: "horn" }, { type: "toast", title: `Wave ${wave}`, text: `${queue.length} titans` });
        }
      }
      while (queue.length && list.filter((t) => t.state !== "dead").length < MAX_ALIVE) {
        const q = queue.shift()!;
        const at = q.inside ? (wave === 1 ? new THREE.Vector3((r() - 0.5) * 140, 0, WALL_IN - 60 - r() * 80) : streetSpot(player.pos, 140)) : new THREE.Vector3((r() - 0.5) * 120, 0, WALL_OUT + 60 + r() * 100);
        const t = spawn(q.h, q.abnormal, at);
        t.yaw = Math.atan2(player.pos.x - at.x, player.pos.z - at.z);
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const m = t.m;
      const k = 1 - Math.exp(-10 * dt);
      t.t += dt;
      t.cool -= dt;
      for (const a of [0, 1] as const) if (t.armOff[a] > 0) t.armOff[a] -= dt;

      if (t.state === "dead") {
        const fall = Math.min(1, t.t / 1.6);
        m.root.rotation.set(fall * fall * 1.45, t.yaw, 0, "YXZ");
        if (t.t > 4) m.root.position.y = -(t.t - 4) * t.h * 0.03;
        if (t.t > 10) {
          scene.remove(m.root);
          t.removed = true;
          list.splice(i, 1);
        }
        continue;
      }

      const toP = _v.set(player.pos.x - t.pos.x, 0, player.pos.z - t.pos.z);
      const dist = toP.length();
      const sees = player.alive && dist < (t.abnormal ? 220 : 160);
      if (sees && !t.spotted) {
        t.spotted = true;
        if (t.abnormal) events.push({ type: "sfx", name: "roar", volume: Math.max(0.2, 1 - dist / 220) });
      }

      // Titans outside the wall walk to the breach first.
      const goal =
        t.pos.z > WALL_IN + 4 && (player.pos.z < WALL_IN || !sees)
          ? _w.set(THREE.MathUtils.clamp(t.pos.x, -GATE + 6, GATE - 6) * 0.3, 0, Math.abs(t.pos.x) < GATE - 3 ? WALL_IN - 30 : WALL_OUT + 10)
          : _w.copy(player.pos).setY(0);

      const shoulderH = 8 * t.s;
      const relY = player.pos.y;
      const facing = Math.atan2(toP.x, toP.z) - t.yaw;
      const ahead = Math.cos(facing) > 0.35;
      const free = [0, 1].filter((a) => t.armOff[a] <= 0) as (0 | 1)[];

      if (t.state === "walk") {
        if (sees && t.cool <= 0 && ahead && free.length && dist < 5.6 * t.s + 4 && relY > t.h * 0.15 && relY < t.h * 1.25) {
          t.state = "windup";
          t.t = 0;
          const sideX = Math.sin(facing);
          t.arm0 = free.length === 2 ? (sideX > 0 ? 0 : 1) : free[0];
        } else if (sees && t.cool <= 0 && dist < t.h * 0.35 + 2.5 && relY < Math.max(3, t.h * 0.15)) {
          t.state = "stomp";
          t.t = 0;
        }
      }

      let speed = 0;
      if (t.state === "walk") {
        const dx = goal.x - t.pos.x;
        const dz = goal.z - t.pos.z;
        let want = Math.atan2(dx, dz);
        if (t.side) want += t.side;
        const d = Math.atan2(Math.sin(want - t.yaw), Math.cos(want - t.yaw));
        const turn = (t.abnormal ? 3 : 1.4) * dt;
        t.yaw += THREE.MathUtils.clamp(d, -turn, turn);
        const close = sees && dist < 4 * t.s + 2;
        speed = close ? 0 : (t.abnormal ? 9 + t.h * 0.35 : 1.6 + t.h * 0.2) * Math.max(0.2, Math.cos(d));
        const ox = t.pos.x;
        const oz = t.pos.z;
        t.pos.x += Math.sin(t.yaw) * speed * dt;
        t.pos.z += Math.cos(t.yaw) * speed * dt;
        blocked(t);
        const got = Math.hypot(t.pos.x - ox, t.pos.z - oz);
        if (speed > 0.5 && got < speed * dt * 0.3) t.stuck += dt;
        else t.stuck = Math.max(0, t.stuck - dt);
        if (t.stuck > 1.2 && !t.side) {
          t.side = (r() < 0.5 ? -1 : 1) * 1.3;
          t.stuck = 0;
          t.t = 0;
        }
        if (t.side && t.t > 1.8) t.side = 0;
      }

      const run = t.abnormal && speed > 4;
      const prev = t.phase;
      t.phase += (speed / (2.2 * t.s)) * dt * (run ? 1.2 : 1);
      const sw = Math.sin(t.phase);
      const amp = run ? 0.9 : 0.45;
      const kneel = t.state === "kneel";
      m.root.position.set(t.pos.x, 0, t.pos.z);
      m.root.rotation.set(0, t.yaw, 0);
      m.hips.position.y = kneel ? 2.4 : 4.65 + Math.abs(Math.cos(t.phase)) * 0.12 * Math.min(1, speed);
      pose(m.spine, kneel ? 0.6 : run ? 0.45 : 0.06, 0, Math.sin(t.phase * 0.5) * 0.04, k);
      for (const a of [0, 1] as const) {
        const sx = a ? 1 : -1;
        const legSw = sw * amp * (a ? 1 : -1) * Math.min(1, speed);
        pose(m.hipJ[a], kneel ? -1.5 : -legSw, 0, 0, k);
        pose(m.knees[a], kneel ? 1.6 : 0.1 + Math.max(0, Math.sin(t.phase + (a ? 0 : Math.PI) + 1.2)) * 0.8 * Math.min(1, speed), 0, 0, k);
        const busy = (t.state === "windup" || t.state === "grab" || t.state === "hold") && t.arm0 === a;
        if (busy) continue;
        if (t.armOff[a] > 0) {
          pose(m.shoulders[a], 0.1, 0, sx * 0.15, k * 0.3);
          pose(m.elbows[a], 0, 0, 0, k * 0.3);
        } else if (kneel) {
          pose(m.shoulders[a], -0.6, 0, sx * 0.25, k);
          pose(m.elbows[a], -0.4, 0, 0, k);
        } else if (run) {
          pose(m.shoulders[a], -0.6 + Math.sin(t.phase * 2 + a) * 0.9, 0, sx * (0.6 + Math.sin(t.phase + a) * 0.5), k);
          pose(m.elbows[a], -0.8, 0, 0, k);
        } else {
          pose(m.shoulders[a], legSw * 0.7, 0, sx * 0.12, k);
          pose(m.elbows[a], -0.3, 0, 0, k);
        }
      }
      const lookYaw = sees ? THREE.MathUtils.clamp(Math.atan2(Math.sin(facing), Math.cos(facing)), -0.9, 0.9) : 0;
      pose(m.neck, 0, lookYaw * 0.5, 0, k * 0.5);
      pose(m.head, sees ? THREE.MathUtils.clamp(-Math.atan2(relY - t.h, dist + 1) * 0.6, -0.5, 0.6) : 0, lookYaw * 0.5, 0, k * 0.5);

      const a = t.arm0;
      if (t.state === "windup") {
        const wind = t.abnormal ? 0.45 : 0.8;
        m.shoulders[a].updateMatrixWorld();
        reach(m.shoulders[a], _x.set(player.pos.x, player.pos.y + 6 * t.s, player.pos.z), k);
        pose(m.elbows[a], -1.3, 0, 0, k);
        if (t.abnormal) {
          t.pos.x += Math.sin(t.yaw) * 6 * dt;
          t.pos.z += Math.cos(t.yaw) * 6 * dt;
          blocked(t);
        }
        if (t.t > wind) {
          t.state = "grab";
          t.t = 0;
        }
      } else if (t.state === "grab") {
        reach(m.shoulders[a], player.pos, 1 - Math.exp(-14 * dt));
        pose(m.elbows[a], 0, 0, 0, 1 - Math.exp(-14 * dt));
        syncSpheres(t);
        const hand = m.hands[a].getWorldPosition(_x);
        if (player.alive && !held && hand.distanceTo(player.pos) < 0.9 * t.s + 1.4) {
          t.state = "hold";
          t.t = 0;
          held = t;
          escape = 0;
          events.push({ type: "sfx", name: "grabbed" }, { type: "shake", strength: 0.5 }, { type: "toast", title: "Grabbed", text: "Mash E to cut free" });
        } else if (t.t > 0.5) {
          t.state = "recover";
          t.t = 0;
        }
      } else if (t.state === "hold") {
        m.head.getWorldPosition(mouth);
        mouth.y += 0.6 * t.s;
        mouth.x += Math.sin(t.yaw) * 2.2 * t.s;
        mouth.z += Math.cos(t.yaw) * 2.2 * t.s;
        const lift = Math.min(1, t.t / 2.6);
        m.shoulders[a].getWorldPosition(_w);
        _x.copy(_w).lerp(mouth, 0.3 + lift * 0.7).addScaledVector(_v.set(Math.sin(t.yaw), 0, Math.cos(t.yaw)), 4 * t.s * (1 - lift));
        reach(m.shoulders[a], _x, k);
        pose(m.elbows[a], -1.4 * lift, 0, 0, k);
        if (t.t > 3.2) {
          held = null;
          t.state = "recover";
          t.t = 0;
          t.cool = 4;
          events.push({ type: "sfx", name: "death" }, { type: "hurt", amount: 1 }, { type: "shake", strength: 0.8 });
        }
      } else if (t.state === "stomp") {
        const lift = t.t < 0.7 ? t.t / 0.7 : Math.max(0, 1 - (t.t - 0.7) / 0.15);
        const leg = 1;
        pose(m.hipJ[leg], -1.1 * lift, 0, 0, 1);
        pose(m.knees[leg], 1.3 * lift, 0, 0, 1);
        if (t.t > 0.85 && t.t - dt <= 0.85) {
          m.knees[leg].getWorldPosition(_x);
          const d = Math.hypot(_x.x - player.pos.x, _x.z - player.pos.z);
          events.push({ type: "sfx", name: "stomp", volume: 1 }, { type: "shake", strength: 0.3 + t.s * 0.2 });
          fx.burst(_x.setY(0.5), 20, { size: 1.4, grow: 3, life: 1.2, speed: 6, rise: 0.5, spread: 2 });
          if (player.alive && d < t.h * 0.2 + 2.5 && player.pos.y < 4) events.push({ type: "hurt", amount: 0.35 }, { type: "sfx", name: "hurt" });
        }
        if (t.t > 1.4) {
          t.state = "walk";
          t.cool = 2;
        }
      } else if (t.state === "recover" && t.t > 1.1) {
        t.state = "walk";
        t.cool = t.abnormal ? 1.2 : 2.2;
      } else if (kneel && t.t > 7) {
        t.state = "walk";
        t.leg = 30 + t.h * 2;
      }

      if (Math.floor(prev / Math.PI) !== Math.floor(t.phase / Math.PI) && t.h >= 10 && dist < 90)
        events.push({ type: "sfx", name: "stomp", volume: (1 - dist / 90) * 0.35 });

      syncSpheres(t);
    }

    if (held) {
      const hand = held.m.hands[held.arm0];
      hand.getWorldPosition(heldPos);
    }
    return events;
  };

  const alive = () => list.filter((t) => t.state !== "dead");

  return {
    update,
    start() {
      started = true;
    },
    get wave() {
      return wave;
    },
    get kills() {
      return kills;
    },
    get left() {
      return alive().length + queue.length;
    },
    get breakT() {
      return started && !queue.length && !alive().length ? Math.max(0, breakT) : 0;
    },
    held: () => (held ? heldPos : null),
    get escape() {
      return held ? escape : null;
    },
    list: () => list,
    raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number) {
      let best: { t: number; titan: Titan; sphere: HitSphere } | null = null;
      for (const t of list) {
        if (t.removed || _v.copy(t.pos).setY(t.h * 0.5).distanceTo(o) > maxT + t.h) continue;
        for (const sp of t.m.spheres) {
          const hit = raySphere(o, d, sp.world, sphereR(t, sp));
          if (hit >= 0 && hit <= maxT && (!best || hit < best.t)) best = { t: hit, titan: t, sphere: sp };
        }
      }
      return best;
    },
    nearestNape(pos: THREE.Vector3, look: THREE.Vector3) {
      let best: Titan | null = null;
      let score = Infinity;
      for (const t of alive()) {
        const n = t.m.spheres[0].world;
        _v.copy(n).sub(pos);
        const d = _v.length();
        if (d > 250) continue;
        const ang = Math.acos(THREE.MathUtils.clamp(_v.divideScalar(d).dot(look), -1, 1));
        const s = d * (1 + ang * 2);
        if (s < score) {
          score = s;
          best = t;
        }
      }
      return best;
    },
    nape: (t: Titan) => (t.state === "dead" || t.removed ? null : t.m.spheres[0].world),
    gone: (t: Titan) => t.removed,
    pushOut(p: THREE.Vector3, rad: number, v: THREE.Vector3) {
      for (const t of list) {
        if (t.state === "dead" || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > t.h + 4) continue;
        for (const sp of t.m.spheres) {
          const rr = sphereR(t, sp) + rad;
          _x.copy(p).sub(sp.world);
          const d = _x.length();
          if (d >= rr || d < 1e-4) continue;
          _x.divideScalar(d);
          p.addScaledVector(_x, rr - d);
          const into = v.dot(_x);
          if (into < 0) v.addScaledVector(_x, -into);
        }
      }
    },
    slash(center: THREE.Vector3, radius: number, speed: number, sharp: number) {
      const events: GameEvent[] = [];
      if (held) {
        escape += 0.2;
        fx.burst(heldPos, 6, { tint: 0.7, size: 0.6, life: 0.8, speed: 4 });
        events.push({ type: "sfx", name: "slashHit" });
        if (escape >= 1) {
          const t = held;
          held = null;
          t.armOff[t.arm0] = 12;
          t.state = "recover";
          t.t = 0;
          t.cool = 3;
          events.push({ type: "sfx", name: "escape" }, { type: "toast", title: "Cut free" }, { type: "score", amount: 60, reason: "Escaped a grab" });
          return { events, hit: true, escaped: true };
        }
        return { events, hit: true, escaped: false };
      }
      const rank: Record<Part, number> = { nape: 5, legL: 3, legR: 3, armL: 2, armR: 2, head: 1, body: 0 };
      let pick: { t: Titan; sp: HitSphere } | null = null;
      for (const t of alive())
        for (const sp of t.m.spheres)
          if (sp.world.distanceTo(center) < radius + sphereR(t, sp) && (!pick || rank[sp.part] > rank[pick.sp.part])) pick = { t, sp };
      if (!pick) return { events, hit: false, escaped: false };
      const { t, sp } = pick;
      const dmg = (18 + speed * 1.4) * (0.3 + 0.7 * sharp) * (t.state === "kneel" ? 1.5 : 1);
      fx.burst(sp.world, 14, { tint: 0.8, size: 0.5 + t.s * 0.4, grow: 3, life: 1.2, speed: 5, spread: 0.6 });
      if (sp.part === "nape") {
        t.nape -= dmg;
        if (t.nape <= 0) kill(t, events, speed);
        else events.push({ type: "sfx", name: "slashHit" }, { type: "toast", title: "Too shallow", text: "Hit faster to cut deeper" }, { type: "shake", strength: 0.15 });
      } else if (sp.part === "legL" || sp.part === "legR") {
        t.leg -= dmg;
        events.push({ type: "sfx", name: "slashHit" });
        if (t.leg <= 0 && t.state !== "kneel") {
          if (held === t) held = null;
          t.state = "kneel";
          t.t = 0;
          events.push({ type: "sfx", name: "cripple" }, { type: "shake", strength: 0.3 }, { type: "score", amount: 40, reason: "Tendon cut" });
        }
      } else if (sp.part === "armL" || sp.part === "armR") {
        const a = sp.part === "armL" ? 0 : 1;
        t.arm[a] -= dmg;
        events.push({ type: "sfx", name: "slashHit" });
        if (t.arm[a] <= 0) {
          t.arm[a] = 24 + t.h * 2;
          t.armOff[a] = 12;
          if ((t.state === "windup" || t.state === "grab") && t.arm0 === a) t.state = "recover";
          events.push({ type: "sfx", name: "cripple" }, { type: "score", amount: 25, reason: "Arm severed" });
        }
      } else events.push({ type: "sfx", name: "slashHit", volume: 0.5 });
      return { events, hit: true, escaped: false };
    },
    dispose() {
      for (const t of list) scene.remove(t.m.root);
      list.length = 0;
    },
  };
}

export type Titans = ReturnType<typeof createTitans>;
