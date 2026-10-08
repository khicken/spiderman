import * as THREE from "three";
import type { Blade, Fx, GameEvent, HitZone, PlayerView, Sfx, StrikeResult, TitanHit, TitanKind, TitanPart, Titans, TitanView, World } from "./contracts";
import { crawlPitch, newPose, pose, type Pose } from "./titan-anim";
import { BN, buildVariant, makeRig, rand, type Limb, type Rig, type Spec, type Variant } from "./titan-model";
import { toon } from "./toon";

type Act = "walk" | "grab" | "hold" | "chew" | "swat" | "stomp" | "leap" | "lunge" | "punch" | "kick" | "roar" | "flinch";
type Cap = { a: THREE.Vector3; b: THREE.Vector3; r: number; zone: HitZone; bone: THREE.Object3D };

type T = {
  id: number;
  kind: TitanKind;
  name: string;
  height: number;
  pos: THREE.Vector3;
  yaw: number;
  alive: boolean;
  v: Variant;
  rig: Rig;
  p: Pose;
  cp: number;
  hp: Record<TitanPart, number>;
  sev: [number, number, number, number];
  blind: number;
  act: Act;
  at: number;
  side: 0 | 1;
  cool: number;
  speed: number;
  walkSpeed: number;
  turn: number;
  goal: THREE.Vector3;
  wanderT: number;
  ignore: boolean;
  sprint: number;
  sprintT: number;
  stuck: number;
  stuckN: number;
  detour: number;
  detourT: number;
  wade: number;
  prev: THREE.Vector3;
  dead: number;
  fall: number;
  landed: boolean;
  hard: number;
  hardened: boolean;
  aim: THREE.Vector3;
  aim2: THREE.Vector3;
  hit: boolean;
  flash: number;
  tint: THREE.Color;
  caps: Cap[];
  nape: THREE.Vector3;
  eyes: THREE.Vector3;
  center: THREE.Vector3;
  steamT: number;
  stepS: number;
  roarT: number;
  removed: boolean;
  crystalScale: THREE.Vector3[];
  tilt: number;
  jawIdle: number;
  reachK: number;
};

type Drop = { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; t: number; base: number; pos: THREE.Vector3; r: number; rest: THREE.Quaternion | null };

const MAX_ALIVE = 16;
const CUT = [BN.armL, BN.armR, BN.shinL, BN.shinR];
const LIMB_IDX: Record<string, number> = { armL: 0, armR: 1, legL: 2, legR: 3 };
const LIMBS: Limb[] = ["armL", "armR", "legL", "legR"];
const SKINS = [0xe9b49c, 0xdda08a, 0xf0c3aa, 0xcf9479, 0xe5ac92, 0xd8a48e, 0xeab8a0, 0xd39a82];
const CHAR = new THREE.Color(0x3a2724);
const SPECS: Spec[] = [
  { body: "normal", face: "grin", hair: "short", hairColor: 0x2a1d16, skin: SKINS[0], seed: 11 },
  { body: "lanky", face: "stare", hair: "bowl", hairColor: 0x3b2a1e, skin: SKINS[2], seed: 12 },
  { body: "chubby", face: "grin", hair: "none", hairColor: 0, skin: SKINS[1], seed: 13 },
  { body: "muscular", face: "gape", hair: "wild", hairColor: 0x16110e, skin: SKINS[3], seed: 14 },
  { body: "elderly", face: "smirk", hair: "sparse", hairColor: 0x8c8478, skin: SKINS[5], seed: 15, beard: true },
  { body: "normal", face: "bulge", hair: "long", hairColor: 0x5a3d25, skin: SKINS[4], seed: 16 },
  { body: "lanky", face: "grin", hair: "none", hairColor: 0, skin: SKINS[6], seed: 17 },
  { body: "chubby", face: "stare", hair: "bowl", hairColor: 0x2a1d16, skin: SKINS[7], seed: 18 },
  { body: "muscular", face: "grin", hair: "short", hairColor: 0x3b2a1e, skin: SKINS[2], seed: 19 },
  { body: "normal", face: "stare", hair: "none", hairColor: 0, skin: SKINS[1], seed: 20 },
  { body: "child", face: "grin", hair: "bowl", hairColor: 0x2a1d16, skin: SKINS[2], seed: 21 },
  { body: "child", face: "bulge", hair: "none", hairColor: 0, skin: SKINS[0], seed: 22 },
  { body: "child", face: "stare", hair: "short", hairColor: 0x5a3d25, skin: SKINS[4], seed: 23 },
  { body: "elderly", face: "gape", hair: "long", hairColor: 0x9a9286, skin: SKINS[3], seed: 24 },
  { body: "female", face: "female", hair: "bob", hairColor: 0xe2c47c, skin: 0xe8b8a0, seed: 25 },
];
const POOL: Record<TitanKind, number[]> = {
  normal: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 13],
  abnormal: [1, 3, 5, 6, 8, 13],
  crawler: [10, 11, 12],
  female: [14],
};
const SMALL = [10, 12];
const ADJ: Record<string, string> = { grin: "Grinning", stare: "Staring", bulge: "Bug-Eyed", gape: "Gaping", smirk: "Smirking", female: "" };
const NOUN: Record<string, string> = { normal: "Titan", lanky: "Beanpole", chubby: "Fatso", muscular: "Brute", child: "Runt", elderly: "Old Man", female: "" };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
const lp = (b: THREE.Object3D, x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, y, z).applyMatrix4(b.matrixWorld);

function capT(o: THREE.Vector3, d: THREE.Vector3, pa: THREE.Vector3, pb: THREE.Vector3, r: number) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  if (baba > 1e-8 && a > 1e-8) {
    const b = baba * rdoa - baoa * bard;
    const c = baba * oaoa - baoa * baoa - r * r * baba;
    const h = b * b - a * c;
    if (h < 0) return -1;
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  }
  const t1 = sphT(o, d, pa, r), t2 = baba > 1e-8 ? sphT(o, d, pb, r) : -1;
  return t1 < 0 ? t2 : t2 < 0 ? t1 : Math.min(t1, t2);
}

function sphT(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = d.x * ox + d.y * oy + d.z * oz;
  const h = b * b - (ox * ox + oy * oy + oz * oz - r * r);
  return h < 0 ? -1 : -b - Math.sqrt(h);
}

function segClosest(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) {
  out.copy(b).sub(a);
  const l2 = out.lengthSq();
  const t = l2 > 1e-8 ? clamp01(_s.copy(p).sub(a).dot(out) / l2) : 0;
  return out.multiplyScalar(t).add(a);
}

export function createTitans(scene: THREE.Scene, world: World, fx: Fx): Titans {
  const variants = SPECS.map(buildVariant);
  const rnd = rand(Date.now() & 0xffff);
  const R = (a: number, b: number) => a + (b - a) * rnd();
  const list: T[] = [];
  const drops: Drop[] = [];
  const out: GameEvent[] = [];
  const queued: GameEvent[] = [];
  let nextId = 1;
  let wave = 0, kills = 0, quota = 0, spawned = 0, killedWave = 0, spawnT = 0, breakT = 0, bossPending = false;
  let heldBy: T | null = null;
  let esc = 0;
  let holdSide: 0 | 1 = 0;
  const heldPos = new THREE.Vector3();
  const bossOut = { name: "Female Titan", health: 1, hardened: false };
  const hits: TitanHit[] = [];
  let hitI = 0;
  let player: PlayerView | null = null;

  const sfx = (name: Sfx, at?: THREE.Vector3, volume?: number) => out.push({ type: "sfx", name, at: at?.clone(), volume });

  function spawn(kind: TitanKind, h: number, at: THREE.Vector3, force?: number) {
    const pool = kind === "normal" && h < 5.5 ? SMALL : POOL[kind];
    const vi = force ?? pool[Math.floor(rnd() * pool.length)];
    const v = variants[vi];
    const tint = new THREE.Color().setHSL(0.03 * (rnd() - 0.5), 0.15 * rnd(), 0.88 + rnd() * 0.12);
    if (kind === "female") tint.setRGB(1, 1, 1);
    const rig = makeRig(v, tint);
    rig.group.scale.setScalar(h);
    scene.add(rig.group);
    const caps: Cap[] = [];
    const mk = (zone: HitZone, bone: number) => caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0, zone, bone: rig.bones[bone] });
    mk("body", BN.chest); mk("body", BN.head); mk("armL", BN.armL); mk("armL", BN.foreL); mk("armR", BN.armR); mk("armR", BN.foreR);
    mk("legL", BN.thighL); mk("legL", BN.shinL); mk("legR", BN.thighR); mk("legR", BN.shinR);
    const p = newPose(rnd());
    p.hunch = v.spec.body === "elderly" ? 0.45 : v.spec.body === "lanky" ? 0.15 : 0;
    const ws = kind === "female" ? 4.5 : kind === "crawler" ? 8 + rnd() * 2 : kind === "abnormal" ? 2.8 + h * 0.24 : 1.5 + h * 0.22;
    const name = kind === "female" ? "Female Titan" : kind === "crawler" ? "Crawler" : kind === "abnormal" ? `Abnormal ${NOUN[v.spec.body]}` : `${ADJ[v.spec.face]} ${NOUN[v.spec.body]}`;
    const ti: T = {
      id: nextId++, kind, name, height: h, pos: at.clone(), yaw: Math.atan2(world.breach.x - at.x, world.breach.z - at.z), alive: true,
      v, rig, p, cp: crawlPitch(v.d), hp: { nape: 1, eyes: 1, armL: 1, armR: 1, legL: 1, legR: 1 }, sev: [0, 0, 0, 0], blind: 0,
      act: kind === "female" ? "roar" : "walk", at: 0, side: 0, cool: 2, speed: 0, walkSpeed: ws, turn: kind === "normal" ? 0.9 : kind === "female" ? 2.2 : 2.6,
      goal: new THREE.Vector3(), wanderT: 0, ignore: kind === "abnormal" && rnd() < 0.3, sprint: 0, sprintT: R(1, 4), stuck: 0, stuckN: 0, detour: 0, detourT: 0, wade: 0,
      prev: at.clone(), dead: 0, fall: rnd() < 0.7 ? 1 : -1, landed: false, hard: 0, hardened: false, aim: new THREE.Vector3(), aim2: new THREE.Vector3(), hit: false,
      flash: 0, tint, caps, nape: new THREE.Vector3(), eyes: new THREE.Vector3(), center: new THREE.Vector3(), steamT: R(1, 5), stepS: 0, roarT: 25, removed: false,
      crystalScale: rig.crystals.map((c) => c.scale.clone()), tilt: (rnd() - 0.5) * (kind === "abnormal" ? 0.7 : 0.35), reachK: kind === "normal" && rnd() < 0.5 ? 0.5 + rnd() * 0.5 : 0, jawIdle: v.spec.face === "gape" ? 0.35 : v.spec.face === "bulge" ? 0.12 : 0.03,
    };
    if (kind === "crawler") p.crawl = 1;
    list.push(ti);
    spawned++;
    place(ti);
    return ti;
  }

  function spawnPoint(out: THREE.Vector3) {
    const s = world.titanSpawns;
    if (s.length) out.copy(s[Math.floor(rnd() * s.length)]);
    else out.copy(world.breach).add(_d.set(0, 0, -60));
    out.x += R(-14, 14);
    out.z += R(-14, 14);
    out.y = 0;
    return out;
  }

  function pickKind(): [TitanKind, number] {
    const r = rnd();
    if (wave >= 3 && r < 0.15) return ["crawler", R(4, 7)];
    if (wave >= 2 && r < (wave >= 3 ? 0.42 : 0.28)) return ["abnormal", R(10, 14)];
    if (rnd() < 0.18) return ["normal", R(4, 7)];
    return ["normal", R(8, wave >= 3 ? 15 : wave === 2 ? 14 : 12)];
  }

  const inward = new THREE.Vector3();
  function nearBreach(o: THREE.Vector3, inside: boolean) {
    inward.set(0, 0, 0);
    for (const p of world.titanSpawns) inward.add(p);
    if (world.titanSpawns.length) inward.divideScalar(world.titanSpawns.length).sub(world.breach).negate();
    else inward.set(0, 0, 1);
    inward.y = 0;
    inward.normalize();
    const side = R(-14, 14);
    return o.copy(world.breach).addScaledVector(inward, inside ? R(22, 55) : -R(6, 28)).add(_c.set(inward.z * side, 0, -inward.x * side));
  }

  function spawnNear(inside: boolean) {
    const [k, h] = pickKind();
    const t = spawn(k, h, nearBreach(_d, inside));
    t.yaw = Math.atan2(inward.x, inward.z);
    t.cool = R(0.5, 1.5);
    place(t);
  }

  function beginWave(n: number) {
    wave = n;
    const boss = n % 4 === 0;
    quota = boss ? 8 + n : 6 + 2 * n;
    spawned = 0;
    killedWave = 0;
    spawnT = 0.4;
    breakT = 0;
    bossPending = boss;
    out.push({ type: "stinger", name: "wave" }, { type: "toast", title: `Wave ${n}`, text: boss ? "Something is coming" : n === 1 ? "Titans pour through the breach" : `${quota} titans incoming` });
    sfx("horn");
    for (let i = n === 1 ? 3 : 2; i > 0 && !boss && aliveCount() < MAX_ALIVE; i--) spawnNear(true);
  }

  function aliveCount() {
    let n = 0;
    for (const t of list) if (t.alive) n++;
    return n;
  }

  function toWorld(ti: T, x: number, y: number, z: number, o: THREE.Vector3) {
    const s = Math.sin(ti.yaw), c = Math.cos(ti.yaw);
    return o.set(ti.pos.x + x * c + z * s, ti.pos.y + y, ti.pos.z - x * s + z * c);
  }
  const palm = (ti: T, i: number, o: THREE.Vector3) => lp(ti.rig.bones[i === 0 ? BN.handL : BN.handR], 0, -ti.v.d.hand * 0.35, 0, o);
  const mouth = (ti: T, o: THREE.Vector3) => lp(ti.rig.bones[BN.head], 0, ti.v.d.hh * 0.27, ti.v.d.hd * 1.15, o);
  const foot = (ti: T, i: number, o: THREE.Vector3) => lp(ti.rig.bones[i === 0 ? BN.footL : BN.footR], 0, -0.01, ti.v.d.hand * 0.4, o);
  const stump = (ti: T, k: number, o: THREE.Vector3) => ti.rig.bones[CUT[k]].getWorldPosition(o);

  function updateCaps(ti: T) {
    const b = ti.rig.bones, d = ti.v.d;
    const S = ti.rig.group.scale.x;
    const c = ti.caps;
    b[BN.pelvis].getWorldPosition(c[0].a);
    const tr = Math.max(d.cw, d.cd * 1.2) * 0.95;
    lp(b[BN.chest], 0, Math.max(0.02, d.shY - ti.v.bind[BN.chest].y - tr * 0.8), 0, c[0].b);
    c[0].r = tr * S;
    lp(b[BN.head], 0, d.hh * 0.32, 0, c[1].a);
    lp(b[BN.head], 0, d.hh * 0.68, 0, c[1].b);
    c[1].r = d.hw * S * 1.1;
    for (let i = 0; i < 2; i++) {
      const up = c[2 + i * 2], lo = c[3 + i * 2];
      const on = ti.sev[i] <= 0 ? 1 : 0;
      b[i ? BN.armR : BN.armL].getWorldPosition(up.a);
      b[i ? BN.foreR : BN.foreL].getWorldPosition(up.b);
      up.r = d.ar * S * 1.35 * on;
      lo.a.copy(up.b);
      lp(b[i ? BN.handR : BN.handL], 0, -d.hand * 0.55, 0, lo.b);
      lo.r = d.ar * S * 1.3 * on;
      const th = c[6 + i * 2], sh = c[7 + i * 2];
      b[i ? BN.thighR : BN.thighL].getWorldPosition(th.a);
      b[i ? BN.shinR : BN.shinL].getWorldPosition(th.b);
      th.r = d.lr * S * 1.05;
      sh.a.copy(th.b);
      b[i ? BN.footR : BN.footL].getWorldPosition(sh.b);
      sh.r = d.lr * S * 0.75 * (ti.sev[2 + i] <= 0 ? 1 : 0);
    }
    lp(b[BN.neck], 0, d.nl * 0.75, -d.nr * 1.15, ti.nape);
    lp(b[BN.head], 0, ti.v.bind[BN.eyeL].y - d.hb, d.hd * 0.85, ti.eyes);
    ti.center.copy(c[0].a).add(c[0].b).multiplyScalar(0.5);
  }

  const napeR = (ti: T) => Math.max(0.8, ti.v.d.nr * ti.height * 1.7);
  const eyesR = (ti: T) => ti.v.d.hw * ti.height * 0.8;
  const partR = (ti: T, part: TitanPart) =>
    part === "nape" ? napeR(ti) : part === "eyes" ? eyesR(ti) : part[0] === "a" ? ti.v.d.ar * ti.height * 1.5 : ti.v.d.lr * ti.height * 1.1;

  function place(ti: T) {
    const g = ti.rig.group;
    g.position.copy(ti.pos);
    g.rotation.y = ti.yaw;
    pose(ti.rig, ti.v.d, ti.p, ti.cp);
    updateCaps(ti);
  }

  function hurt(amount: number, from: THREE.Vector3, knock: number, up: number) {
    if (!player || !player.alive || heldBy) return;
    out.push({ type: "hurt", amount, from: from.clone() }, { type: "shake", strength: 0.35 + amount * 0.6 });
    _d.copy(player.pos).sub(from);
    _d.y = 0;
    if (_d.lengthSq() < 1e-4) _d.set(0, 0, 1);
    _d.normalize();
    player.vel.addScaledVector(_d, knock);
    player.vel.y += up;
  }

  function startAct(ti: T, act: Act) {
    ti.act = act;
    ti.at = 0;
    ti.hit = false;
  }

  function sever(ti: T, k: number, dir: THREE.Vector3, events: GameEvent[]) {
    const part = LIMBS[k];
    const H = ti.height;
    ti.hp[part] = 0;
    ti.sev[k] = 15;
    const bone = ti.rig.bones[CUT[k]];
    const m = toon({ color: ti.tint, vertexColors: true });
    const mesh = new THREE.Mesh(ti.v.limbs[part], m);
    mesh.castShadow = true;
    bone.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    scene.add(mesh);
    const drop: Drop = { mesh, vel: dir.clone().multiplyScalar(5).add(_a.set(0, 3, 0)), spin: new THREE.Vector3(R(-3, 3), R(-1, 1), R(-3, 3)), t: 0, base: mesh.scale.x, pos: mesh.position, r: (k < 2 ? ti.v.d.ar : ti.v.d.lr * 0.6) * H, rest: null };
    drops.push(drop);
    stump(ti, k, _a);
    fx.blood(_a, dir, H * 0.18);
    const sv = new THREE.Vector3();
    fx.steamFollow(() => (ti.sev[k] > 0 && !ti.removed ? stump(ti, k, sv) : null), H * 0.07, 15);
    fx.steamFollow(() => (drop.t < 8 ? drop.pos : null), H * 0.06, 8);
    events.push({ type: "sfx", name: "sever", at: _a.clone() }, { type: "sfx", name: "titanHurt", at: _a.clone(), volume: 0.8 });
    if (ti.act === "grab" && ti.side === (k as 0 | 1)) startAct(ti, "flinch");
    if (k >= 2 && ti.kind !== "crawler") events.push({ type: "sfx", name: "titanFall", at: ti.pos.clone(), volume: 0.6 });
    if (ti.kind === "female") {
      const n = ti.sev.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
      events.push(n >= 2 ? { type: "toast", title: "Hardening broken", text: "Charged cut to the nape, now" } : { type: "toast", title: "One more limb", text: "Her nape is still hardened" });
    }
  }

  function kill(ti: T, blade: Blade, crit: boolean, events: GameEvent[]) {
    ti.alive = false;
    ti.hp.nape = 0;
    ti.dead = 0;
    kills++;
    killedWave++;
    const H = ti.height;
    fx.blood(ti.nape, blade.dir, H * 0.3);
    fx.steam(ti.nape, H * 0.2, 2);
    fx.steamFollow(() => (ti.removed ? null : ti.center), H * 0.32, 14);
    _a.copy(blade.dir);
    _a.y = 0;
    const fwdDot = Math.sin(ti.yaw) * _a.x + Math.cos(ti.yaw) * _a.z;
    ti.fall = fwdDot >= 0 || ti.kind === "female" ? 1 : -1;
    const pts = Math.round((ti.kind === "female" ? 1500 : 100 + H * 15 + Math.max(0, blade.speed - 20) * 4) * (crit ? 1.5 : 1));
    events.push(
      { type: "hitstop", duration: 0.12 },
      { type: "impact", kind: "kill" },
      { type: "shake", strength: 0.55 },
      { type: "sfx", name: "napeKill", at: ti.nape.clone() },
      { type: "stinger", name: ti.kind === "female" ? "bossDown" : "kill" },
      { type: "slowmo", scale: 0.3, duration: ti.kind === "female" ? 1.2 : 0.5 },
      { type: "kill", height: H, kind: ti.kind, speed: blade.speed },
      { type: "score", amount: pts, reason: crit ? "Perfect nape cut" : "Nape cut" },
    );
    if (ti.kind === "female") events.push({ type: "toast", title: "Female Titan down", text: "Her nape is open. Not for long." });
  }

  function strike(blade: Blade, target: { titan: TitanView; part: TitanPart } | null): StrikeResult {
    const events: GameEvent[] = [];
    let ti: T | null = null;
    let zone: HitZone | null = null;
    const pt = new THREE.Vector3();
    if (target && target.titan.alive) {
      const tt = target.titan as T;
      if (partPos(tt, target.part, pt) && pt.distanceTo(blade.pos) <= blade.radius + partR(tt, target.part) + 1.5) {
        ti = tt;
        zone = target.part;
      }
    }
    if (!ti) {
      let best = -1, bestD = Infinity;
      for (const t of list) {
        if (!t.alive || t.center.distanceTo(blade.pos) > t.height + blade.radius) continue;
        const consider = (z: HitZone, d: number, r: number, pri: number, p: THREE.Vector3) => {
          if (d > r + blade.radius) return;
          if (pri > best || (pri === best && d < bestD)) {
            best = pri;
            bestD = d;
            ti = t;
            zone = z;
            pt.copy(p);
          }
        };
        consider("nape", t.nape.distanceTo(blade.pos), napeR(t), 3, t.nape);
        if (t.blind <= 0) consider("eyes", t.eyes.distanceTo(blade.pos), eyesR(t), 2, t.eyes);
        for (const c of t.caps) {
          if (c.r <= 0) continue;
          segClosest(blade.pos, c.a, c.b, _c);
          consider(c.zone, _c.distanceTo(blade.pos), c.r, c.zone === "body" ? 0 : 1, _c);
        }
      }
    }
    const t = ti as T | null;
    const part = zone as HitZone | null;
    if (!t || !part) return { events, zone: null, titan: null, killed: false };
    const H = t.height;
    const crit = blade.charge >= 0.92;
    const P = blade.speed * (0.55 + 0.45 * clamp01(blade.charge)) * (crit ? 1.5 : 1);
    const hitSfx: Sfx = crit ? "slashCrit" : "slashHit";
    t.flash = 1;
    let killed = false;
    if (part === "nape") {
      if (t.hardened) {
        events.push({ type: "sfx", name: "clang", at: pt }, { type: "hitstop", duration: 0.06 }, { type: "shake", strength: 0.3 }, { type: "toast", title: "Hardened", text: t.kind === "female" ? "Sever two limbs to break it" : "Sever a limb to break it" });
        fx.steam(pt, 1.5, 0.6);
        return { events, zone: "nape", titan: t, killed: false };
      }
      const need = H * 2.75 * (t.kind === "female" ? 1.6 : 1);
      t.hp.nape -= P / need;
      if (t.kind === "female" && blade.charge < 0.7) t.hp.nape = Math.max(0.15, t.hp.nape);
      if (t.hp.nape <= 0.001) {
        kill(t, blade, crit, events);
        killed = true;
      } else {
        fx.blood(pt, blade.dir, H * 0.08);
        events.push(
          { type: "sfx", name: hitSfx, at: pt }, { type: "sfx", name: "titanHurt", at: pt, volume: 0.7 }, { type: "hitstop", duration: crit ? 0.09 : 0.07 },
          { type: "impact", kind: crit ? "crit" : "hit" }, { type: "shake", strength: 0.22 }, { type: "score", amount: 10, reason: "Nape hit" },
          { type: "toast", title: "Too shallow", text: "Faster, or charge the cut" },
        );
        if (t.act === "walk") startAct(t, "flinch");
      }
    } else if (part === "eyes") {
      t.hp.eyes = 0;
      t.blind = 6;
      fx.blood(t.eyes, blade.dir, H * 0.08);
      fx.steamFollow(() => (t.blind > 0 && t.alive ? t.eyes : null), H * 0.05, 6);
      events.push(
        { type: "sfx", name: hitSfx, at: pt }, { type: "sfx", name: "titanHurt", at: pt }, { type: "hitstop", duration: 0.07 }, { type: "impact", kind: crit ? "crit" : "hit" },
        { type: "shake", strength: 0.2 }, { type: "score", amount: 30, reason: "Blinded" },
      );
      if (t.act !== "hold") startAct(t, "flinch");
    } else if (part !== "body") {
      const k = LIMB_IDX[part];
      const need = (k < 2 ? 1.9 : 2.2) * H + 6;
      t.hp[part] -= P / need;
      if (t.hp[part] <= 0) {
        sever(t, k, blade.dir, events);
        events.push({ type: "hitstop", duration: 0.09 }, { type: "impact", kind: "crit" }, { type: "shake", strength: 0.35 }, { type: "score", amount: 50, reason: k < 2 ? "Arm severed" : "Hamstrung" });
        if (t.act !== "hold") startAct(t, "flinch");
      } else {
        fx.blood(pt, blade.dir, H * 0.06);
        events.push({ type: "sfx", name: hitSfx, at: pt }, { type: "hitstop", duration: 0.05 }, { type: "impact", kind: "hit" }, { type: "shake", strength: 0.12 }, { type: "score", amount: 5, reason: "Cut" });
      }
    } else {
      fx.blood(pt, blade.dir, H * 0.04);
      events.push({ type: "sfx", name: "slashHit", at: pt, volume: 0.5 }, { type: "hitstop", duration: 0.03 });
    }
    return { events, zone: part, titan: t, killed };
  }

  function partPos(view: TitanView, part: TitanPart, o: THREE.Vector3): THREE.Vector3 | null {
    const t = view as T;
    if (!t.alive) return null;
    if (part === "nape") return o.copy(t.nape);
    if (part === "eyes") return t.blind > 0 ? null : o.copy(t.eyes);
    const k = LIMB_IDX[part];
    if (t.sev[k] > 0) return null;
    const c = t.caps[k < 2 ? 2 + k * 2 : 6 + (k - 2) * 2 + 1];
    return o.copy(c.a).lerp(c.b, k < 2 ? 0.55 : 0.4);
  }

  function decide(ti: T, dt: number) {
    if (!player || !player.alive || heldBy || ti.cool > 0) return;
    const H = ti.height;
    _a.copy(player.pos).sub(ti.pos);
    const dy = _a.y;
    const dh = Math.hypot(_a.x, _a.z);
    const fwd = (Math.sin(ti.yaw) * _a.x + Math.cos(ti.yaw) * _a.z) / Math.max(dh, 0.01);
    const lx = Math.cos(ti.yaw) * _a.x - Math.sin(ti.yaw) * _a.z;
    const near: 0 | 1 = lx >= 0 ? 0 : 1;
    const pick: 0 | 1 = ti.sev[near] <= 0 ? near : ((1 - near) as 0 | 1);
    const anyArm = ti.sev[0] <= 0 || ti.sev[1] <= 0;
    const napeD = ti.nape.distanceTo(player.pos);
    const legs = ti.sev[2] <= 0 && ti.sev[3] <= 0;
    if (ti.blind > 0) {
      if (anyArm && rnd() < dt * 0.7) {
        ti.side = pick;
        toWorld(ti, R(-0.4, 0.4) * H, R(0.5, 1) * H, R(0.1, 0.5) * H, ti.aim);
        startAct(ti, "swat");
      }
      return;
    }
    if (ti.ignore && dh > H * 0.7) return;
    if (ti.kind === "crawler") {
      if (dh < H * 1.4 + 4 && dy < H * 0.8 && fwd > 0.5) startAct(ti, "lunge");
      return;
    }
    if (ti.kind === "female") {
      if (ti.roarT <= 0 && aliveCount() < 8) return startAct(ti, "roar");
      if (napeD < H * 0.35 + 4 && dy > H * 0.6 && anyArm) {
        ti.side = pick;
        return startAct(ti, "swat");
      }
      if (dh < H * 0.5 + 5 && dy < H * 1.0 && fwd > 0.3) {
        if (dy < H * 0.5 && legs && rnd() < 0.55) return startAct(ti, "kick");
        if (anyArm) {
          ti.side = pick;
          return startAct(ti, rnd() < 0.2 ? "grab" : "punch");
        }
      }
      return;
    }
    const reach = H * 0.6 + 2;
    if (anyArm && dh < reach && dy > -2 && dy < H * 1.05 && fwd > 0.25 && rnd() < dt * 2.5) {
      ti.side = pick;
      return startAct(ti, "grab");
    }
    if (anyArm && napeD < H * 0.45 + 3 && (fwd < 0.3 || dy > H * 0.8) && rnd() < dt * 3) {
      ti.side = pick;
      return startAct(ti, "swat");
    }
    if (legs && player.grounded && dh < H * 0.35 + 1.5 && dy < 3 && rnd() < dt * 2) return startAct(ti, "stomp");
    if (ti.kind === "abnormal" && legs && dh > 14 && dh < 55 && rnd() < dt * 0.35) startAct(ti, "leap");
  }

  function act(ti: T, dt: number, tg: Targets) {
    const H = ti.height, a = ti.at, p = ti.p, i = ti.side;
    const pl = player!;
    switch (ti.act) {
      case "walk":
        return;
      case "grab": {
        tg.move = 0;
        tg.twist = clamp(p.lookYaw, -0.7, 0.7);
        if (a < 0.75) {
          toWorld(ti, (i ? -1 : 1) * 0.3 * H, 0.86 * H, 0.18 * H, _b);
          tg.ik[i] = 0.85;
          tg.ikP[i].copy(_b);
          tg.curl[i] = -0.35;
          tg.jaw = 0.3;
          tg.lean = 0.1;
          ti.aim.copy(pl.pos);
        } else if (a < 1.2) {
          ti.aim.lerp(pl.pos, 1 - Math.exp(-5 * dt));
          tg.ik[i] = 1;
          tg.ikP[i].copy(ti.aim);
          tg.ikRate = 14;
          tg.curl[i] = a > 1.05 ? 1 : -0.35;
          tg.lean = clamp((0.6 * H - (ti.aim.y - ti.pos.y)) / H, 0, 0.7);
          tg.jaw = 0.45;
          palm(ti, i, _c);
          if (!ti.hit && a > 0.9 && pl.alive && !heldBy && _c.distanceTo(pl.pos) < H * 0.08 + 1.7) {
            ti.hit = true;
            heldBy = ti;
            holdSide = i;
            esc = 0;
            heldPos.copy(_c);
            startAct(ti, "hold");
            out.push({ type: "sfx", name: "grabbed", at: _c.clone() }, { type: "shake", strength: 0.45 }, { type: "toast", title: "Grabbed", text: "Mash to break free" });
          }
        } else if (a < 1.9) {
          tg.curl[i] = 1;
          tg.ik[i] = 0;
        } else {
          ti.cool = R(1.5, 3);
          startAct(ti, "walk");
        }
        return;
      }
      case "hold": {
        tg.move = 0;
        mouth(ti, _c);
        _b.set(_c.x - ti.pos.x, 0, _c.z - ti.pos.z).normalize();
        _c.addScaledVector(_b, H * 0.1);
        _c.y -= H * 0.02;
        tg.ik[i] = 1;
        tg.ikRate = 3;
        tg.ikP[i].copy(a < 1.2 ? heldPos : _c);
        tg.curl[i] = 1;
        tg.lookAt = heldPos;
        tg.jaw = a < 1.2 ? 0.2 : a < 3.4 ? 0.2 + 0.75 * clamp01((a - 1.2) / 1.6) : 0;
        if (a > 3.6 && heldBy === ti) {
          heldBy = null;
          mouth(ti, _c);
          fx.blood(_c, UP, 2);
          out.push({ type: "sfx", name: "bite", at: _c.clone() }, { type: "shake", strength: 1 });
          out.push({ type: "hurt", amount: 1, from: _c.clone() });
          startAct(ti, "chew");
        }
        if (heldBy !== ti && ti.act === "hold") {
          ti.cool = 3;
          startAct(ti, "flinch");
        }
        return;
      }
      case "chew":
        tg.move = 0;
        tg.jaw = 0.25 + 0.2 * Math.sin(a * 14);
        tg.curl[i] = 1;
        if (a > 2) {
          ti.cool = 3;
          startAct(ti, "walk");
        }
        return;
      case "swat": {
        tg.move = 0.2;
        const s = i ? -1 : 1;
        if (a < 0.45) {
          if (ti.blind <= 0) ti.aim.copy(pl.pos);
          toWorld(ti, -s * 0.12 * H, 0.88 * H, 0.22 * H, _b);
          tg.ik[i] = 1;
          tg.ikP[i].copy(_b);
          tg.ikRate = 10;
          tg.twist = -s * 0.5;
          tg.curl[i] = 0.2;
          tg.jaw = 0.35;
        } else if (a < 0.85) {
          const k = clamp01((a - 0.45) / 0.3);
          toWorld(ti, -s * 0.12 * H, 0.88 * H, 0.22 * H, _b);
          _c.copy(ti.aim).sub(ti.pos);
          _c.y = 0;
          _c.normalize();
          _d.copy(ti.aim).addScaledVector(_c, H * 0.25);
          tg.ikP[i].copy(_b).lerp(_d, k);
          tg.ik[i] = 1;
          tg.ikRate = 22;
          tg.twist = s * 0.6;
          tg.curl[i] = 0;
          palm(ti, i, _c);
          if (!ti.hit && _c.distanceTo(pl.pos) < H * 0.09 + 1.7) {
            ti.hit = true;
            out.push({ type: "sfx", name: "swat", at: _c.clone() });
            hurt(0.3, _c, 26, 7);
          }
        } else if (a < 1.4) tg.ik[i] = 0;
        else {
          ti.cool = R(1, 2);
          startAct(ti, "walk");
        }
        return;
      }
      case "stomp":
        tg.move = 0;
        if (a < 0.65) {
          tg.stomp = 1;
          tg.stompRate = 5;
          tg.lean = 0.15;
          tg.jaw = 0.3;
        } else if (a < 0.8) {
          tg.stomp = 0;
          tg.stompRate = 30;
        } else if (!ti.hit) {
          ti.hit = true;
          foot(ti, 0, _c);
          fx.dust(_c, H * 0.35);
          out.push({ type: "sfx", name: "stomp", at: _c.clone() });
          if (pl.pos.distanceTo(_c) < 40) out.push({ type: "shake", strength: 0.3 });
          if (pl.pos.y - ti.pos.y < 3.5 && Math.hypot(pl.pos.x - _c.x, pl.pos.z - _c.z) < H * 0.16 + 2.5) hurt(0.45, _c, 14, 6);
        } else if (a > 1.4) {
          ti.cool = R(1.5, 2.5);
          startAct(ti, "walk");
        }
        return;
      case "leap": {
        tg.move = 0;
        if (a < 0.55) {
          tg.crouch = 1;
          tg.jaw = 0.7;
          if (!ti.hit) {
            ti.hit = true;
            out.push({ type: "sfx", name: "roar", at: ti.pos.clone(), volume: 0.6 });
          }
          ti.aim.copy(ti.pos);
          ti.aim2.copy(pl.pos);
          _a.copy(ti.aim2).sub(ti.pos).setY(0);
          const dl = _a.length();
          ti.aim2.copy(ti.pos).addScaledVector(_a.normalize(), Math.max(0, dl - H * 0.3));
          ti.aim2.y = 0;
        } else {
          const dur = clamp(ti.aim.distanceTo(ti.aim2) / 26, 0.7, 1.5);
          const k = clamp01((a - 0.55) / dur);
          if (k < 1) {
            tg.crouch = 0;
            tg.air = 1;
            tg.flail = 0.6;
            tg.jaw = 0.9;
            ti.pos.lerpVectors(ti.aim, ti.aim2, k);
            ti.pos.y = Math.sin(k * Math.PI) * (H * 0.35 + ti.aim.distanceTo(ti.aim2) * 0.22);
          } else if (ti.pos.y !== 0) {
            ti.pos.y = 0;
            tg.air = 0;
            tg.crouch = 0.8;
            ti.p.air = 0;
            ti.p.crouch = 0.8;
            fx.dust(ti.pos, H * 0.6);
            out.push({ type: "sfx", name: "stomp", at: ti.pos.clone() });
            if (pl.pos.distanceTo(ti.pos) < 60) out.push({ type: "shake", strength: 0.6 });
            if (pl.pos.y - ti.pos.y < H * 0.5 && Math.hypot(pl.pos.x - ti.pos.x, pl.pos.z - ti.pos.z) < H * 0.4 + 3) hurt(0.5, ti.pos, 22, 9);
          } else if (a > 0.55 + dur + 0.9) {
            ti.cool = R(2, 4);
            startAct(ti, "walk");
          } else tg.crouch = 0.6;
        }
        return;
      }
      case "lunge": {
        tg.move = 0;
        if (a < 0.38) {
          tg.jaw = 0.95;
          tg.crouch = 0.5;
          tg.lookPitchAdd = 0.4;
          ti.aim.copy(pl.pos);
        } else if (a < 0.75) {
          tg.jaw = a < 0.62 ? 1 : 0;
          tg.crouch = 0;
          _a.copy(ti.aim).sub(ti.pos).setY(0);
          if (_a.length() > H * 0.4) {
            _a.normalize();
            ti.pos.addScaledVector(_a, Math.min(_a.length(), H * 6 * dt));
            ti.speed = H * 4;
          }
          mouth(ti, _c);
          if (!ti.hit && _c.distanceTo(pl.pos) < H * 0.18 + 1.6) {
            ti.hit = true;
            out.push({ type: "sfx", name: "bite", at: _c.clone(), volume: 0.8 });
            hurt(0.4, _c, 16, 5);
          }
        } else if (a > 1.3) {
          ti.cool = R(1.2, 2.2);
          startAct(ti, "walk");
        }
        return;
      }
      case "punch": {
        tg.move = 0.3;
        const s = i ? -1 : 1;
        tg.fist = i;
        if (a < 0.32) {
          toWorld(ti, s * 0.22 * H, 0.72 * H, -0.18 * H, _b);
          tg.ik[i] = 1;
          tg.ikP[i].copy(_b);
          tg.ikRate = 12;
          tg.curl[i] = 1;
          tg.twist = -s * 0.55;
          ti.aim.copy(pl.pos);
        } else if (a < 0.52) {
          _c.copy(ti.aim).sub(ti.pos).setY(0).normalize();
          tg.ikP[i].copy(ti.aim).addScaledVector(_c, H * 0.2);
          tg.ik[i] = 1;
          tg.ikRate = 30;
          tg.curl[i] = 1;
          tg.twist = s * 0.6;
          tg.lean = 0.3;
          palm(ti, i, _c);
          if (!ti.hit && _c.distanceTo(pl.pos) < H * 0.08 + 2) {
            ti.hit = true;
            out.push({ type: "sfx", name: "swat", at: _c.clone() });
            hurt(0.45, _c, 32, 6);
          }
        } else if (a > 0.95) {
          ti.cool = R(0.6, 1.3);
          startAct(ti, "walk");
        } else tg.curl[i] = 1;
        return;
      }
      case "kick": {
        tg.move = 0.2;
        if (a < 0.3) {
          tg.crouch = 0.25;
          tg.twist = -0.5;
          ti.aim.copy(pl.pos);
        } else if (a < 0.6) {
          tg.kick = 1;
          tg.kickRate = 20;
          tg.twist = 0.5;
          foot(ti, 1, _c);
          if (!ti.hit && _c.distanceTo(pl.pos) < H * 0.11 + 2.2) {
            ti.hit = true;
            out.push({ type: "sfx", name: "swat", at: _c.clone() });
            hurt(0.55, _c, 38, 10);
          }
        } else if (a > 1.05) {
          ti.cool = R(0.6, 1.4);
          startAct(ti, "walk");
        }
        return;
      }
      case "roar":
        tg.move = 0;
        tg.roar = a > 0.25 && a < 1.7 ? 1 : 0;
        tg.jaw = a > 0.2 && a < 1.8 ? 1.05 : 0.1;
        if (!ti.hit && a > 0.35) {
          ti.hit = true;
          ti.roarT = 30;
          mouth(ti, _c);
          fx.steam(_c, ti.height * 0.15, 1.5);
          out.push({ type: "sfx", name: "roar", at: _c.clone(), volume: 1 }, { type: "shake", strength: 0.35 });
          if (ti.kind === "female" && wave > 0) {
            let n = 0;
            for (let k = 0; k < 3 && aliveCount() < MAX_ALIVE; k++) {
              const [kind, h] = rnd() < 0.5 ? (["abnormal", R(6, 12)] as const) : (["normal", R(5, 13)] as const);
              const nt = spawn(kind, h, spawnPoint(_d));
              nt.ignore = false;
              quota++;
              n++;
            }
            if (n) out.push({ type: "toast", title: "She called the titans", text: `${n} more coming` });
          }
        }
        if (a > 2.1) {
          ti.cool = 0.8;
          startAct(ti, "walk");
        }
        return;
      case "flinch":
        tg.move = 0;
        tg.jaw = 0.75;
        tg.flail = 0.35;
        tg.lean = -0.25;
        if (!ti.hit) {
          ti.hit = true;
          if (ti.kind !== "female" || rnd() < 0.5) out.push({ type: "sfx", name: "titanHurt", at: ti.nape.clone(), volume: 0.6 });
        }
        if (a > 0.7) {
          ti.cool = Math.max(ti.cool, 0.6);
          startAct(ti, "walk");
        }
        return;
    }
  }

  type Targets = {
    move: number; twist: number; jaw: number; lean: number; crouch: number; air: number; flail: number; roar: number; kick: number; kickRate: number;
    stomp: number; stompRate: number; ik: [number, number]; ikP: [THREE.Vector3, THREE.Vector3]; ikRate: number; curl: [number, number];
    lookAt: THREE.Vector3 | null; lookPitchAdd: number; fist: number;
  };
  const tg: Targets = {
    move: 1, twist: 0, jaw: 0, lean: 0, crouch: 0, air: 0, flail: 0, roar: 0, kick: 0, kickRate: 8, stomp: 0, stompRate: 8,
    ik: [0, 0], ikP: [new THREE.Vector3(), new THREE.Vector3()], ikRate: 6, curl: [0.3, 0.3], lookAt: null, lookPitchAdd: 0, fist: -1,
  };

  function tick(ti: T, dt: number) {
    const p = ti.p, H = ti.height, pl = player!;
    ti.at += dt;
    ti.cool -= dt;
    ti.roarT -= dt;
    p.t += dt;
    ti.flash = Math.max(0, ti.flash - dt * 6);
    if (ti.blind > 0) {
      ti.blind -= dt;
      if (ti.blind <= 0) ti.hp.eyes = 1;
    }
    for (let k = 0; k < 4; k++) {
      if (ti.sev[k] > 0) {
        ti.sev[k] -= dt;
        if (ti.sev[k] <= 0) {
          ti.sev[k] = 0;
          ti.hp[LIMBS[k]] = 0.6;
          stump(ti, k, _a);
          fx.steam(_a, H * 0.12, 1.5);
          out.push({ type: "sfx", name: "steamHiss", at: _a.clone(), volume: 0.6 });
        }
      }
      p.sev[k] = ti.sev[k] > 0 ? clamp01(1 - ti.sev[k] / 3) : 1;
    }
    ti.hp.nape = Math.min(1, ti.hp.nape + dt * 0.02);

    tg.move = 1; tg.twist = 0; tg.jaw = ti.jawIdle + 0.05 * Math.sin(p.t * 0.9 + p.seed * 5); tg.lean = 0; tg.crouch = 0; tg.air = 0; tg.flail = 0; tg.roar = 0;
    tg.kick = 0; tg.kickRate = 8; tg.stomp = 0; tg.stompRate = 8; tg.ik[0] = tg.ik[1] = 0; tg.ikRate = 6; tg.curl[0] = tg.curl[1] = 0.35;
    tg.lookAt = pl.alive ? pl.pos : null; tg.lookPitchAdd = 0; tg.fist = -1;

    if (ti.act === "walk") decide(ti, dt);
    act(ti, dt, tg);

    const kneeling = ti.kind !== "crawler" && (ti.sev[2] > 0 || ti.sev[3] > 0);
    const outside = !world.inside(ti.pos.x, ti.pos.z);
    ti.wanderT -= dt;
    if (outside) ti.goal.copy(world.breach);
    else if (ti.blind > 0 || ti.ignore || !pl.alive) {
      if (ti.wanderT <= 0) {
        ti.wanderT = R(2, 6);
        ti.goal.set(ti.pos.x + R(-60, 60), 0, ti.pos.z + R(-60, 60));
        if (ti.ignore && rnd() < 0.25) ti.ignore = false;
      }
    } else {
      ti.goal.copy(pl.pos);
      if (ti.kind === "abnormal" && ti.wanderT <= 0 && rnd() < 0.15) ti.ignore = true;
    }
    if (ti.wanderT <= 0) ti.wanderT = R(4, 9);

    let want = ti.walkSpeed;
    if (ti.kind === "abnormal") {
      ti.sprintT -= dt;
      if (ti.sprintT <= 0) {
        ti.sprint = ti.sprint > 0 ? 0 : 1;
        ti.sprintT = ti.sprint ? R(1.5, 3) : R(2, 5);
      }
      want *= 1 + 2 * ti.sprint;
      tg.flail = Math.max(tg.flail, ti.sprint * 0.8);
    }
    _a.copy(ti.goal).sub(ti.pos);
    const dist = Math.hypot(_a.x, _a.z);
    if (ti.kind === "female" && dist > 40 && !outside) want = 11;
    if (!outside && pl.alive && dist < H * (ti.kind === "crawler" ? 0.2 : 0.38) + 1 && ti.blind <= 0 && !ti.ignore) want = 0;
    if (kneeling) want = 0;
    let heading = Math.atan2(_a.x, _a.z);
    if (ti.detourT > 0) {
      ti.detourT -= dt;
      heading += ti.detour;
    }
    if (ti.blind > 0) heading += Math.sin(p.t * 1.7) * 0.8;
    const diff = wrap(heading - ti.yaw);
    const turn = (ti.act === "walk" || ti.act === "lunge" ? ti.turn : ti.turn * 0.6) * (kneeling ? 0.5 : 1);
    if (ti.act !== "leap" || ti.at < 0.55) ti.yaw = wrap(ti.yaw + clamp(diff, -turn * dt, turn * dt));
    want *= tg.move * Math.max(0, Math.cos(diff)) ** 2;
    if (ti.act === "lunge" && ti.at > 0.38 && ti.at < 0.75) want = ti.speed;
    ti.speed = ease(ti.speed, want, ti.kind === "crawler" ? 6 : 2.5, dt);

    if (ti.act !== "leap" && ti.act !== "lunge") {
      ti.pos.x += Math.sin(ti.yaw) * ti.speed * dt;
      ti.pos.z += Math.cos(ti.yaw) * ti.speed * dt;
    }
    if (ti.act !== "leap") {
      ti.pos.y = 0;
      ti.wade -= dt;
      world.pushTitan(ti.pos, H * 0.13, H * (ti.wade > 0 ? 1.0 : 0.55));
      for (const o of list) {
        if (o === ti || !o.alive) continue;
        const dx = ti.pos.x - o.pos.x, dz = ti.pos.z - o.pos.z;
        const rr = (H + o.height) * 0.14;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = ((rr - d) / d) * (o.height / (H + o.height));
          ti.pos.x += dx * push;
          ti.pos.z += dz * push;
        }
      }
      const moved = Math.hypot(ti.pos.x - ti.prev.x, ti.pos.z - ti.prev.z);
      if (ti.speed > 0.6 && moved < ti.speed * dt * 0.3) ti.stuck += dt;
      else ti.stuck = Math.max(0, ti.stuck - dt * 0.5);
      if (ti.stuck > 1.2) {
        ti.stuck = 0;
        ti.stuckN++;
        ti.detour = (rnd() < 0.5 ? -1 : 1) * R(0.9, 1.6);
        ti.detourT = R(1.5, 3);
        if (ti.stuckN >= 3) {
          ti.wade = 4;
          ti.stuckN = 0;
        }
      }
    }
    ti.prev.copy(ti.pos);

    const sp = ti.speed / Math.max(0.5, ti.walkSpeed);
    p.walk = ease(p.walk, clamp01(sp) * (kneeling ? 0 : 1), 5, dt);
    p.run = ease(p.run, clamp01((sp - 1.3) / 1.2) * (ti.kind === "crawler" ? 0 : 1), 4, dt);
    const cycle = (ti.kind === "crawler" ? 1.3 : 1.7 * ti.v.d.hipY * (1 + p.run * 0.7)) * H;
    p.phase += (ti.speed * dt * Math.PI * 2) / cycle;
    p.kneel = ease(p.kneel, kneeling ? 1 : 0, 4, dt);
    p.jaw = ease(p.jaw, tg.jaw, 10, dt);
    p.lean = ease(p.lean, tg.lean, 5, dt);
    p.twist = ease(p.twist, tg.twist, 7, dt);
    p.crouch = ease(p.crouch, tg.crouch, 9, dt);
    p.air = ease(p.air, tg.air, 8, dt);
    p.flail = ease(p.flail, tg.flail, 5, dt);
    p.reach = ease(p.reach, ti.act === "walk" && ti.blind <= 0 && pl.alive && dist < 70 && !ti.ignore ? ti.reachK : 0, 2, dt);
    p.roar = ease(p.roar, tg.roar, 6, dt);
    p.kick = ease(p.kick, tg.kick, tg.kickRate, dt);
    p.stomp = ease(p.stomp, tg.stomp, tg.stompRate, dt);
    p.blind = ease(p.blind, ti.blind > 0 ? 1 : 0, 6, dt);
    p.tilt = ti.tilt + (ti.kind === "abnormal" ? Math.sin(p.t * 1.3) * 0.25 : 0);
    if (ti.blind > 4.5) {
      const hand: 0 | 1 = ti.sev[0] <= 0 ? 0 : 1;
      if (ti.sev[hand] <= 0) {
        lp(ti.rig.bones[BN.head], 0, ti.v.d.hh * 0.5, ti.v.d.hd * 2.2, tg.ikP[hand]);
        tg.ik[hand] = 0.9;
        tg.curl[hand] = 0.2;
      }
    }
    for (let k = 0; k < 2; k++) {
      p.ikW[k] = ease(p.ikW[k], tg.ik[k], tg.ikRate, dt);
      if (tg.ik[k] > 0) {
        if (p.ikW[k] < 0.02) p.ik[k].copy(tg.ikP[k]);
        else p.ik[k].lerp(tg.ikP[k], 1 - Math.exp(-tg.ikRate * 1.5 * dt));
      }
      p.curl[k] = ease(p.curl[k], tg.curl[k], 10, dt);
    }

    ti.rig.bones[BN.head].getWorldPosition(_b);
    const look = ti.blind > 0 ? null : tg.lookAt;
    let ly = Math.sin(p.t * 0.31 + p.seed * 3) * 0.4, lpch = 0;
    if (look && look.distanceTo(ti.pos) < 180) {
      _a.copy(look).sub(_b);
      ly = wrap(Math.atan2(_a.x, _a.z) - ti.yaw);
      lpch = Math.atan2(_a.y, Math.hypot(_a.x, _a.z));
    }
    const lr = ti.kind === "normal" ? 2.5 : 6;
    p.lookYaw = ease(p.lookYaw, clamp(ly, -2, 2), lr, dt);
    p.lookPitch = ease(p.lookPitch, clamp(lpch + tg.lookPitchAdd, -0.9, 1.1), lr, dt);

    const s0 = Math.sin(p.phase);
    if (ti.stepS * s0 < 0 && ti.speed > 0.5 && H >= 7) {
      const d = pl.pos.distanceTo(ti.pos);
      if (d < 140) {
        foot(ti, s0 > 0 ? 1 : 0, _c);
        out.push({ type: "sfx", name: "titanStep", at: _c.clone(), volume: Math.min(1, H / 13) });
        if (H >= 11 && d < 90) fx.dust(_c, H * 0.12);
        if (H >= 12 && d < 30) out.push({ type: "shake", strength: 0.06 });
      }
    }
    ti.stepS = s0;

    if (ti.kind === "female") {
      const anySev = (ti.sev[0] > 0 ? 1 : 0) + (ti.sev[1] > 0 ? 1 : 0) + (ti.sev[2] > 0 ? 1 : 0) + (ti.sev[3] > 0 ? 1 : 0) >= 2;
      const want2 = !anySev && pl.alive && ti.nape.distanceTo(pl.pos) < 45;
      if (want2 && !ti.hardened) out.push({ type: "sfx", name: "harden", at: ti.nape.clone() });
      if (!want2 && ti.hardened && anySev) fx.steam(ti.nape, 2, 1);
      ti.hardened = want2;
      ti.hard = ease(ti.hard, want2 ? 1 : 0, 5, dt);
      const cr = ti.rig.crystals;
      cr[0].visible = ti.hard > 0.03;
      cr[0].scale.copy(ti.crystalScale[0]).multiplyScalar(ti.hard);
      for (let k = 0; k < 2; k++) {
        const on = tg.fist === k || (ti.act === "punch" && ti.side === k);
        cr[1 + k].visible = on && ti.sev[k] <= 0;
        cr[1 + k].scale.copy(ti.crystalScale[1 + k]);
      }
    }

    ti.steamT -= dt;
    if (ti.steamT <= 0) {
      ti.steamT = R(2.5, 6);
      if (pl.pos.distanceTo(ti.pos) < 160) {
        lp(ti.rig.bones[BN.chest], (rnd() - 0.5) * ti.v.d.cw * 2, 0.1, -ti.v.d.cd, _c);
        fx.steam(_c, H * 0.08, 1.6);
      }
    }
    const f = ti.flash;
    ti.rig.mat.emissive.setRGB(f * 0.5, f * 0.18, f * 0.12);
    place(ti);
  }

  function tickDead(ti: T, dt: number) {
    const p = ti.p, H = ti.height, g = ti.rig.group;
    ti.dead += dt;
    p.t += dt;
    p.walk = ease(p.walk, 0, 6, dt);
    p.run = 0;
    p.limp = ease(p.limp, 1, 3, dt);
    p.jaw = ease(p.jaw, 0.55, 4, dt);
    p.ikW[0] = ease(p.ikW[0], 0, 6, dt);
    p.ikW[1] = ease(p.ikW[1], 0, 6, dt);
    p.flail = p.air = p.crouch = p.kick = p.stomp = p.roar = 0;
    p.curl[0] = p.curl[1] = ease(p.curl[0], 0.1, 3, dt);
    p.blind = ease(p.blind, 1, 2, dt);
    ti.flash = Math.max(0, ti.flash - dt * 4);
    ti.pos.y = Math.max(0, ti.pos.y - dt * 20);
    const k = clamp01(ti.dead / 1.5);
    const fallK = k * k;
    if (ti.kind === "crawler") {
      g.rotation.z = fallK * 0.6 * ti.fall;
      g.position.y = ti.pos.y;
    } else {
      p.kneel = ease(p.kneel, 1, 5, dt);
      const ang = ti.fall * fallK * 1.42;
      g.rotation.x = ang;
      g.position.y = ti.pos.y + Math.sin(Math.abs(ang)) * ti.v.d.cd * H * 0.9;
    }
    if (k >= 1 && !ti.landed) {
      ti.landed = true;
      fx.dust(ti.center, H * 0.6);
      out.push({ type: "sfx", name: "titanFall", at: ti.center.clone() }, { type: "sfx", name: "steamHiss", at: ti.center.clone(), volume: 0.7 });
      if (player && player.pos.distanceTo(ti.center) < H * 4) out.push({ type: "shake", strength: Math.min(0.6, H * 0.04) });
    }
    const e = clamp01((ti.dead - 1.5) / 10);
    ti.rig.mat.color.copy(ti.tint).lerp(CHAR, e * e * 0.85 + e * 0.1);
    ti.rig.mat.emissive.setRGB(ti.flash * 0.5 + e * (1 - e) * 0.25, ti.flash * 0.18 + e * (1 - e) * 0.06, ti.flash * 0.1);
    g.scale.setScalar(H * (1 - 0.4 * e * e));
    if (ti.kind !== "crawler") g.position.y *= 1 - e * 0.6;
    g.position.x = ti.pos.x;
    g.position.z = ti.pos.z;
    pose(ti.rig, ti.v.d, p, ti.cp);
    updateCaps(ti);
    if (ti.dead > 13) remove(ti);
  }

  function remove(ti: T) {
    ti.removed = true;
    scene.remove(ti.rig.group);
    ti.rig.mat.dispose();
    ti.rig.mesh.skeleton.dispose();
  }

  function tickDrops(dt: number) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (!d.rest) {
        d.vel.y -= 22 * dt;
        d.pos.addScaledVector(d.vel, dt);
        _q.setFromEuler(_e.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt));
        d.mesh.quaternion.premultiply(_q);
        if (d.pos.y <= d.r) {
          d.pos.y = d.r;
          d.rest = new THREE.Quaternion().setFromEuler(_e.set(Math.PI / 2, rnd() * Math.PI * 2, 0, "YXZ"));
          _e.order = "XYZ";
          fx.dust(d.pos, d.base * 0.1);
          out.push({ type: "sfx", name: "land", at: d.pos.clone(), volume: 0.8 });
        }
      } else d.mesh.quaternion.slerp(d.rest, 1 - Math.exp(-6 * dt));
      const e = clamp01((d.t - 2) / 6);
      (d.mesh.material as THREE.MeshToonMaterial).color.setRGB(1, 1, 1).lerp(CHAR, e * 0.85);
      d.mesh.scale.setScalar(d.base * (1 - 0.5 * e));
      if (d.t > 8.5) {
        scene.remove(d.mesh);
        (d.mesh.material as THREE.Material).dispose();
        drops.splice(i, 1);
      }
    }
  }

  const api: Titans = {
    get wave() {
      return wave;
    },
    get kills() {
      return kills;
    },
    get left() {
      return wave === 0 ? 0 : Math.max(0, quota - killedWave);
    },
    get breakT() {
      return Math.max(0, breakT);
    },
    get escape() {
      return heldBy ? esc : null;
    },
    start() {
      if (wave !== 0) return;
      beginWave(1);
      queued.push(...out);
      out.length = 0;
    },
    update(dt, _t, pv) {
      out.length = 0;
      if (queued.length) {
        out.push(...queued);
        queued.length = 0;
      }
      player = pv;
      if (dt <= 0) return out;
      if (wave > 0) {
        if (breakT > 0) {
          breakT -= dt;
          if (breakT <= 0) beginWave(wave + 1);
        } else if (spawned < quota && aliveCount() < MAX_ALIVE) {
          spawnT -= dt;
          if (spawnT <= 0) {
            const early = spawned < 8;
            spawnT = early ? R(0.7, 1.4) : R(1.2, 2.6);
            if (bossPending) {
              bossPending = false;
              spawn("female", 14, nearBreach(_d, false));
              out.push({ type: "stinger", name: "bossIntro" }, { type: "toast", title: "Female Titan", text: "Sever two limbs to break her hardening" });
            } else if (early) spawnNear(false);
            else {
              const [k, h] = pickKind();
              spawn(k, h, spawnPoint(_d));
            }
          }
        } else if (spawned >= quota && killedWave >= quota) {
          breakT = 15;
          out.push({ type: "stinger", name: "waveClear" }, { type: "toast", title: `Wave ${wave} cleared`, text: "Resupply. Next wave in 15 s" }, { type: "score", amount: 200 * wave, reason: "Wave cleared" });
        }
      }
      for (const ti of list) {
        if (ti.removed) continue;
        if (ti.alive) tick(ti, dt);
        else tickDead(ti, dt);
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].removed) list.splice(i, 1);
      if (heldBy) {
        esc = Math.max(0, esc - dt * 0.12);
        palm(heldBy, holdSide, heldPos);
        if (!heldBy.alive || !pv.alive) heldBy = null;
      }
      tickDrops(dt);
      return out;
    },
    list() {
      return list;
    },
    raycast(o, d, maxT) {
      let best: T | null = null, bt = maxT, bz: HitZone = "body", bo: THREE.Object3D | null = null;
      for (const t of list) {
        if (t.removed || t.dead > 8) continue;
        _a.copy(t.center).sub(o);
        const along = _a.dot(d);
        const rad = t.height * 0.85;
        if (along < -rad || along > bt + rad || _a.lengthSq() - along * along > rad * rad) continue;
        for (const c of t.caps) {
          if (c.r <= 0) continue;
          const tc = capT(o, d, c.a, c.b, c.r);
          if (tc > 0 && tc < bt) {
            bt = tc; best = t; bz = c.zone; bo = c.bone;
          }
        }
        if (t.alive) {
          const tn = capT(o, d, t.nape, t.nape, napeR(t) * 0.7);
          if (tn > 0 && tn - 0.6 < bt && tn < maxT) {
            bt = tn; best = t; bz = "nape"; bo = t.rig.bones[BN.neck];
          }
        }
      }
      if (!best || !bo) return null;
      if (hits.length < 4) hits.push({ t: 0, point: new THREE.Vector3(), titan: best, zone: "body", obj: bo });
      const h = hits[hitI++ % hits.length];
      h.t = bt;
      h.point.copy(o).addScaledVector(d, bt);
      h.titan = best;
      h.zone = bz;
      h.obj = bo;
      return h;
    },
    partPos,
    partHealth(view, part) {
      const t = view as T;
      if (!t.alive) return 0;
      return clamp01(t.hp[part]);
    },
    nearest(pos, look, maxDist) {
      let best: T | null = null, bs = Infinity;
      for (const t of list) {
        if (!t.alive) continue;
        _a.copy(t.nape).sub(pos);
        const d = _a.length();
        if (d > maxDist) continue;
        const dot = d > 0.01 ? _a.dot(look) / d : 1;
        const s = d * (dot > 0.5 ? 1 : 1.5 + (0.5 - dot) * 4);
        if (s < bs) {
          bs = s;
          best = t;
        }
      }
      return best;
    },
    strike,
    held() {
      return heldBy ? heldPos : null;
    },
    struggle() {
      if (!heldBy) return [];
      esc += (0.09 * 12) / (heldBy.height + 5);
      if (esc < 1) return [{ type: "shake", strength: 0.06 }];
      const t = heldBy;
      heldBy = null;
      esc = 0;
      t.cool = 3;
      startAct(t, "flinch");
      return [{ type: "sfx", name: "escape" }, { type: "toast", title: "Broke free" }, { type: "score", amount: 25, reason: "Escape" }];
    },
    pushOut(pos, radius, vel) {
      if (heldBy) return;
      for (const t of list) {
        if (t.removed || t.dead > 6) continue;
        if (t.center.distanceTo(pos) > t.height * 0.85 + radius) continue;
        for (const c of t.caps) {
          if (c.r <= 0) continue;
          segClosest(pos, c.a, c.b, _c);
          _a.copy(pos).sub(_c);
          const d = _a.length(), min = c.r + radius;
          if (d >= min) continue;
          if (d < 1e-4) _a.set(0, 1, 0);
          else _a.divideScalar(d);
          pos.addScaledVector(_a, min - d);
          const vn = vel.dot(_a);
          if (vn < 0) vel.addScaledVector(_a, -vn);
        }
      }
    },
    boss() {
      for (const t of list)
        if (t.kind === "female" && t.alive) {
          bossOut.health = clamp01(t.hp.nape);
          bossOut.hardened = t.hardened;
          return bossOut;
        }
      return null;
    },
    dispose() {
      for (const t of list) if (!t.removed) remove(t);
      list.length = 0;
      for (const d of drops) {
        scene.remove(d.mesh);
        (d.mesh.material as THREE.Material).dispose();
      }
      drops.length = 0;
      for (const v of variants) {
        v.geo.dispose();
        for (const l of LIMBS) v.limbs[l].dispose();
      }
    },
  };
  return api;
}
