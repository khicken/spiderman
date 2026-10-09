import * as THREE from "three";
import type { Box, City } from "./city";
import type { GameEvent, HeroPose, HudState, Input, Marker, PlayerApi } from "./contracts";
import * as EM from "./enemy-models";
import { createBosses, type BossName } from "./bosses";

export type EnemyKind = "thug" | "brute" | "shield" | "gunner" | "rocket" | "sniper";
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type GroupOpts = { mix?: Partial<Record<EnemyKind, number>>; radius?: number; bounds?: Bounds; aware?: boolean };
export type Civilians = { count(pos: THREE.Vector3, r: number): number };
export type HitKind = "punch" | "heavy" | "launch" | "air" | "slam" | "strike" | "finisher" | "gadget" | "throw" | "counter";
export type Hit = { dmg: number; kind: HitKind; dir: THREE.Vector3; behind: boolean };
export type HitResult = "none" | "hit" | "block" | "ko";
export type Threat = { at: number; sensed: boolean };

export interface Hittable {
  readonly center: THREE.Vector3;
  readonly radius: number;
  targetable(): boolean;
  airborne(): boolean;
  yaw(): number;
  hit(h: Hit): HitResult;
  web(n: number): boolean;
  yank(from: THREE.Vector3, throwDir: THREE.Vector3): boolean;
  finishable(): boolean;
  finishCost(): number;
  finish(dir: THREE.Vector3): void;
  hint?(): { key: string; label: string } | null;
}

export type CombatCtx = {
  group: THREE.Group;
  city: City;
  events: GameEvent[];
  now(): number;
  player(): PlayerApi;
  hurt(dmg: number, from: THREE.Vector3, knock?: number): boolean;
  downed(): boolean;
  warn(th: Threat, at: number): void;
  unwarn(th: Threat): void;
  spawnGroup(kind: EnemyKind, pos: THREE.Vector3, count: number, opts?: GroupOpts): number;
  groupDone(id: number): boolean;
  clearGroup(id: number): void;
  burst(p: THREE.Vector3, n: number, speed: number, r: number, g: number, b: number): void;
  ring(c: THREE.Vector3, speed: number, maxR: number, dmg: number, r: number, g: number, b: number): void;
  fire(kind: "blast" | "feather" | "rocket", from: THREE.Vector3, vel: THREE.Vector3, dmg: number): void;
  line(a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number): void;
  floorAt(x: number, z: number, y: number): number;
  xp(amount: number, reason: string): void;
  detail(): number;
};

type EState = "idle" | "move" | "windup" | "recover" | "aim" | "fire" | "stagger" | "launched" | "flying" | "webbed" | "down" | "wall" | "getup" | "hung";
type Group = { id: number; active: boolean; members: Enemy[]; center: THREE.Vector3; floorY: number; roof: Box | null; bounds: Bounds | null; near: Box[]; aware: boolean };
type Enemy = {
  i: number;
  active: boolean;
  kind: EnemyKind;
  st: EState;
  t: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  spin: number;
  hp: number;
  web: number;
  webT: number;
  armed: boolean;
  cd: number;
  g: Group | null;
  threat: Threat;
  hang: number;
  flash: number;
  phase: number;
  strafe: number;
  ko: boolean;
  thrown: boolean;
  anchor: THREE.Vector3;
  center: THREE.Vector3;
  aim: THREE.Vector3;
  shots: number;
  jacket: THREE.Color;
  hat: THREE.Color;
  skin: THREE.Color;
  hit: Hittable;
  sus: number;
  base: number;
  patT: number;
  patK: number;
  los: boolean;
  losT: number;
  seen: boolean;
  walker: boolean;
};
type ActKind = "none" | "punch" | "launch" | "dodge" | "shoot" | "strike" | "yank" | "finisher" | "gadget" | "hurt" | "down" | "takedown" | "counter";
type Proj = {
  active: boolean;
  kind: "web" | "impact" | "bomb" | "rocket" | "blast" | "feather";
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  hostile: boolean;
  tgt: Hittable | null;
  owner: Enemy | null;
  back: boolean;
  threat: Threat;
};
type Ring = { active: boolean; c: THREE.Vector3; r: number; speed: number; maxR: number; dmg: number; done: boolean; col: THREE.Color; threat: Threat };
type Mine = { active: boolean; pos: THREE.Vector3; t: number };

const G = 24;
const MAX_E = 36;
const MAX_P = 48;
const MAX_R = 10;
const MAX_LINES = 420;
const SPARKS = 160;
const SPARK_SCALE = [0, 0.6, 1];
const SPARK_SIZE = [0.22, 0.28, 0.26];
const FOCUS_MAX = 4;
const FEET = 0.95;
const STATS: Record<EnemyKind, { hp: number; web: number; scale: number; bulk: number; speed: number; reach: number; windup: number; dmg: number; knock: number; range: number; cd: number }> = {
  thug: { hp: 6, web: 3, scale: 1, bulk: 1, speed: 3.6, reach: 2.2, windup: 0.8, dmg: 8, knock: 5, range: 0, cd: 1.6 },
  brute: { hp: 14, web: 5, scale: 1.45, bulk: 1.3, speed: 2.7, reach: 3.3, windup: 1.1, dmg: 22, knock: 11, range: 0, cd: 2.4 },
  shield: { hp: 7, web: 3, scale: 1.05, bulk: 1.1, speed: 2.8, reach: 2.4, windup: 0.9, dmg: 10, knock: 6, range: 0, cd: 1.9 },
  gunner: { hp: 5, web: 3, scale: 1, bulk: 1, speed: 3.3, reach: 2.2, windup: 1.3, dmg: 12, knock: 3, range: 32, cd: 3.2 },
  rocket: { hp: 5, web: 3, scale: 1.05, bulk: 1.12, speed: 2.9, reach: 2.2, windup: 1.2, dmg: 20, knock: 8, range: 40, cd: 4.5 },
  sniper: { hp: 4, web: 3, scale: 1, bulk: 0.95, speed: 3, reach: 2.2, windup: 2.0, dmg: 18, knock: 4, range: 90, cd: 4.5 },
};
const LOOK: Record<EnemyKind, { jackets: string[]; hat: "beanie" | "helmet" | "hood"; hats: string[] }> = {
  thug: { jackets: ["#2b2f3a", "#6a1f1f", "#2f4a2a", "#3a3d6b", "#6b4a1f", "#4a4a4a"], hat: "beanie", hats: ["#c62828", "#1d1d1f", "#1565c0", "#f9a825", "#e0e0e0"] },
  brute: { jackets: ["#c4561d"], hat: "helmet", hats: ["#2a2a2e"] },
  shield: { jackets: ["#1f2c4a"], hat: "helmet", hats: ["#24345a"] },
  gunner: { jackets: ["#3b3b44", "#2a2a30"], hat: "beanie", hats: ["#b3161c"] },
  rocket: { jackets: ["#4b5a2a"], hat: "helmet", hats: ["#3c4a22"] },
  sniper: { jackets: ["#2a2e3a"], hat: "hood", hats: ["#3a1c22"] },
};
const SKINS = ["#e0b89a", "#a36f4f", "#6b4430", "#c99476"];
const GADGETS = [
  { name: "Web Bomb", max: 2 },
  { name: "Impact Web", max: 3 },
  { name: "Trip Mine", max: 2 },
] as const;
const REFILL = 10;
const CONE = Math.cos((35 * Math.PI) / 180);
const VIEW = 24;
const VIEW_SNIPER = 60;
const STEALTH_R = 60;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const inBox = (b: Box, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
const defeated = (e: Enemy) => e.st === "down" || e.st === "wall" || e.st === "hung";

export function createCombat(scene: THREE.Scene, city: City, civilians?: Civilians) {
  let seed = 991;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const root = new THREE.Group();
  root.name = "combat";
  scene.add(root);

  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _m3 = new THREE.Matrix4();
  const _root = new THREE.Matrix4();
  const _torso = new THREE.Matrix4();
  const _arm = new THREE.Matrix4();
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);
  const hitInfo: Hit = { dmg: 1, kind: "punch", dir: new THREE.Vector3(), behind: false };
  const senseOut = { level: "white" as "white" | "red", x: 0, y: 0 };

  const events: GameEvent[] = [];
  const out: GameEvent[] = [];
  const xpQueue: { amount: number; reason: string }[] = [];
  let now = 0;
  let detail = 2;
  let P: PlayerApi | null = null;

  const geo = EM.enemyGeometries();
  const lit = (rough: number) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough });
  const inst = (g: THREE.BufferGeometry, mat: THREE.Material, n: number, colors: boolean) => {
    const m = new THREE.InstancedMesh(g, mat, n);
    m.frustumCulled = false;
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colors) m.setColorAt(0, _c.setRGB(1, 1, 1));
    root.add(m);
    return m;
  };
  const torsos = inst(geo.torso, lit(0.8), MAX_E, true);
  const heads = inst(geo.head, lit(0.6), MAX_E, true);
  const beanies = inst(geo.beanie, lit(0.9), MAX_E, true);
  const helmets = inst(geo.helmet, lit(0.35), MAX_E, true);
  const hoods = inst(geo.hood, lit(0.9), MAX_E, true);
  const legs = inst(geo.leg, lit(0.8), MAX_E * 2, false);
  const arms = inst(geo.arm, lit(0.8), MAX_E * 2, true);
  const guns = inst(geo.gun, lit(0.4), MAX_E, false);
  const shields = inst(geo.shield, lit(0.3), MAX_E, false);
  const launchers = inst(geo.launcher, lit(0.5), MAX_E, false);
  const rifles = inst(geo.rifle, lit(0.4), MAX_E, false);
  const cocoons = inst(geo.cocoon, new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.55, emissive: "#9aa4b8", emissiveIntensity: 0.35, flatShading: true }), MAX_E + 8, false);
  const pips = inst(geo.pip, EM.glow(), MAX_E + 8, true);
  const rockets = inst(EM.rocketGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), 12, false);
  const feathers = inst(EM.featherGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.8 }), 24, false);
  const mines = inst(EM.mineGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 4, false);
  const orbs = inst(new THREE.IcosahedronGeometry(1, 2), EM.glow(), MAX_P, true);
  const ringMesh = inst(EM.ringGeometry(), EM.glow(THREE.DoubleSide), MAX_R, true);
  const acc = EM.sniperAccentGeometries();
  const accentMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  const visors = inst(acc.visor, accentMat, MAX_E, false);
  const scopes = inst(acc.scope, accentMat, MAX_E, false);
  const marks = inst(EM.markGeometry(), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), MAX_E * 2, true);
  const beams = inst(EM.beamGeometry(), EM.glow(THREE.DoubleSide), MAX_E, true);
  marks.renderOrder = beams.renderOrder = 5;
  const meterGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const meterMat = (opacity: number) => new THREE.MeshBasicMaterial({ transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const susBg = inst(meterGeo, meterMat(0.55), MAX_E, true);
  const susFill = inst(meterGeo.clone(), meterMat(0.95), MAX_E, true);
  susBg.renderOrder = 6;
  susFill.renderOrder = 7;
  const camPos = new THREE.Vector3();
  let dodgeCue = false;
  const bodyMeshes = [torsos, heads, beanies, helmets, hoods, legs, arms, guns, shields, launchers, rifles, cocoons];
  for (const m of bodyMeshes) m.castShadow = true;
  const allMeshes = [...bodyMeshes, pips, rockets, feathers, mines, orbs, ringMesh, visors, scopes, marks, beams, susBg, susFill];

  const linePos = new Float32Array(MAX_LINES * 6);
  const lineCol = new Float32Array(MAX_LINES * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, fog: false }));
  lines.frustumCulled = false;
  root.add(lines);
  let lineN = 0;
  const line = (a: THREE.Vector3, b: THREE.Vector3, r: number, g: number, bl: number) => {
    if (lineN >= MAX_LINES) return;
    const k = lineN * 6;
    linePos[k] = a.x;
    linePos[k + 1] = a.y;
    linePos[k + 2] = a.z;
    linePos[k + 3] = b.x;
    linePos[k + 4] = b.y;
    linePos[k + 5] = b.z;
    lineCol[k] = lineCol[k + 3] = r;
    lineCol[k + 1] = lineCol[k + 4] = g;
    lineCol[k + 2] = lineCol[k + 5] = bl;
    lineN++;
  };

  const sparkPos = new Float32Array(SPARKS * 3).fill(-9999);
  const sparkCol = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkBase = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const dot = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) {
    const d = Math.hypot((i % 16) - 7.5, Math.floor(i / 16) - 7.5) / 7.5;
    dot.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d) ** 2)], i * 4);
  }
  const dotTex = new THREE.DataTexture(dot, 16, 16);
  dotTex.needsUpdate = true;
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.22, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false;
  root.add(sparks);
  let sparkNext = 0;
  let sparksAlive = 0;
  const burst = (p: THREE.Vector3, n: number, speed: number, r: number, g: number, b: number) => {
    n = Math.round(n * SPARK_SCALE[detail]);
    if (n <= 0) return;
    for (let k = 0; k < n; k++) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARKS;
      _u.set(rnd() - 0.5, rnd() * 0.9 + 0.1, rnd() - 0.5).normalize().multiplyScalar(speed * (0.35 + rnd() * 0.65));
      p.toArray(sparkPos, i * 3);
      _u.toArray(sparkVel, i * 3);
      sparkBase[i * 3] = r;
      sparkBase[i * 3 + 1] = g;
      sparkBase[i * 3 + 2] = b;
      sparkLife[i] = 0.35 + rnd() * 0.35;
    }
    sparksAlive = 1;
    sparks.visible = true;
  };

  const floorAt = (x: number, z: number, y: number) => {
    let f = 0;
    for (const b of city.near(x, z, 1)) if (inBox(b, x, z) && b.maxY <= y + 0.6) f = Math.max(f, b.maxY);
    return f;
  };
  const roofUnder = (x: number, z: number, y: number) => city.near(x, z, 1).find((b) => inBox(b, x, z) && Math.abs(b.maxY - y) < 0.6) ?? null;
  const blocked = (near: Box[], x: number, z: number, y: number, m: number) => {
    for (const b of near) if (b.maxY > y + 0.5 && inBox(b, x, z, m)) return b;
    return null;
  };
  const wallNear = (e: Enemy, maxD: number, out: THREE.Vector3) => {
    const g = e.g!;
    let best = maxD;
    let found = false;
    for (const b of g.near) {
      if (b.maxY < g.floorY + 2.5) continue;
      const cx = clamp(e.pos.x, b.minX, b.maxX);
      const cz = clamp(e.pos.z, b.minZ, b.maxZ);
      const d = Math.hypot(cx - e.pos.x, cz - e.pos.z);
      if (d > 0.01 && d < best) {
        best = d;
        out.set(cx, g.floorY, cz);
        found = true;
      }
    }
    return found;
  };

  const threats = new Set<Threat>();
  const warn = (th: Threat, at: number) => {
    if (!threats.has(th)) th.sensed = false;
    th.at = at;
    threats.add(th);
  };
  const unwarn = (th: Threat) => {
    threats.delete(th);
  };

  let health = 1;
  let focus = 0;
  let invuln = 0;
  let comboStep = 0;
  let comboGap = 9;
  let hits = 0;
  let hitsT = 0;
  let gadget = 0;
  const charges = GADGETS.map((g) => g.max as number);
  const refill = GADGETS.map(() => 0);
  let lmbT = -1;
  let lmbUsed = true;
  let fT = -1;
  let fUsed = true;
  let buffer = 0;
  let downT = 0;
  let wasInCombat = false;
  const act = { kind: "none" as ActKind, t: 0, dur: 0, hitAt: 0, hitDone: false, step: 0, tgt: null as Hittable | null, pose: "idle" as HeroPose, lunging: false, lungeT: 0, air: false };
  const actDir = new THREE.Vector3();
  const lastLook = new THREE.Vector3(0, 0, 1);
  const tdAnchor = new THREE.Vector3();
  const tdHangPos = new THREE.Vector3();
  const hand = new THREE.Vector3();
  let tdAbove = false;
  let tdHang = false;
  let counterT = 0;
  let counterTgt: Hittable | null = null;
  let slowEnd = 0;
  const slowmo = (scale: number, duration: number, force = false) => {
    if (!force && now < slowEnd) return;
    slowEnd = now + duration * scale;
    events.push({ type: "slowmo", scale, duration });
  };

  const addFocus = (k: number) => {
    const before = Math.floor(focus);
    focus = clamp(focus + k, 0, FOCUS_MAX);
    if (Math.floor(focus) > before) events.push({ type: "sfx", name: "focusFull", volume: 0.6 });
  };
  const queueXp = (amount: number, reason: string) => xpQueue.push({ amount, reason });

  const start = (kind: ActKind, dur: number, pose: HeroPose, tgt: Hittable | null = null, hitAt = 0) => {
    act.kind = kind;
    act.t = 0;
    act.dur = dur;
    act.pose = pose;
    act.tgt = tgt;
    act.hitAt = hitAt;
    act.hitDone = false;
    act.lunging = false;
    act.lungeT = 0;
  };

  const hurt = (dmg: number, from: THREE.Vector3, knock = 4) => {
    if (!P || invuln > 0 || act.kind === "down") return false;
    health = Math.max(0, health - dmg / 100);
    hits = 0;
    comboStep = 0;
    _u.set(P.pos.x - from.x, 0, P.pos.z - from.z);
    if (_u.lengthSq() < 1e-4) _u.copy(P.facing).negate();
    _u.normalize().multiplyScalar(knock);
    _u.y = Math.min(4, knock * 0.4);
    P.push(_u);
    events.push({ type: "hurt", amount: dmg / 100 }, { type: "sfx", name: "hurt" }, { type: "shake", strength: 0.25 + dmg / 50 });
    burst(_v.copy(P.pos), 8, 6, 3, 0.4, 0.3);
    invuln = 0.45;
    if (health <= 0) {
      start("down", 2.2, "down");
      events.push({ type: "toast", title: "DOWN", text: "Get back up" });
      slowmo(0.4, 0.6, true);
    } else start("hurt", 0.38, "hurt");
    return true;
  };

  const groups: Group[] = [];
  let groupSeq = 0;
  const enemies: Enemy[] = [];
  const makeHit = (e: Enemy): Hittable => ({
    center: e.center,
    get radius() {
      return 0.5 * STATS[e.kind].scale;
    },
    targetable: () => e.active && !defeated(e) && !(e.st === "flying" && (e.ko || e.thrown)),
    airborne: () => e.st === "launched" || (e.g !== null && e.pos.y > e.g.floorY + 1.2),
    yaw: () => e.yaw,
    hit: (h) => hitEnemy(e, h),
    web: (n) => webEnemy(e, n),
    yank: (from, dir) => yankEnemy(e, from, dir),
    finishable: () => e.active && !defeated(e) && e.st !== "flying",
    finishCost: () => 1,
    finish: (dir) => ko(e, dir, 6, true),
    hint: () => {
      if (e.kind === "brute" && e.web < STATS.brute.web) return { key: "RMB", label: "Web the brute first" };
      if (e.kind === "shield" && e.armed) return { key: "F", label: "Hold to yank the shield" };
      return null;
    },
  });
  for (let i = 0; i < MAX_E; i++) {
    const e: Enemy = {
      i,
      active: false,
      kind: "thug",
      st: "idle",
      t: 0,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      spin: 0,
      hp: 1,
      web: 0,
      webT: 0,
      armed: true,
      cd: 0,
      g: null,
      threat: { at: 0, sensed: false },
      hang: 0,
      flash: 0,
      phase: 0,
      strafe: 1,
      ko: false,
      thrown: false,
      anchor: new THREE.Vector3(),
      center: new THREE.Vector3(),
      aim: new THREE.Vector3(),
      shots: 0,
      jacket: new THREE.Color(),
      hat: new THREE.Color(),
      skin: new THREE.Color(),
      hit: null as unknown as Hittable,
      sus: 0,
      base: 0,
      patT: 0,
      patK: 0,
      los: false,
      losT: 0,
      seen: false,
      walker: false,
    };
    e.hit = makeHit(e);
    enemies.push(e);
  }

  const setState = (e: Enemy, st: EState) => {
    e.st = st;
    e.t = 0;
    if (st !== "windup" && st !== "aim") unwarn(e.threat);
  };

  const ko = (e: Enemy, dir: THREE.Vector3, power: number, finisher = false) => {
    if (defeated(e) || e.ko) return;
    e.ko = true;
    e.hp = 0;
    setState(e, "flying");
    e.vel.set(dir.x, 0, dir.z).normalize().multiplyScalar(7 + power);
    e.vel.y = 5 + power * 0.3;
    e.spin = 0;
    events.push({ type: "sfx", name: "ko" });
    burst(e.center, 12, 9, 3, 2.4, 1.2);
    queueXp(finisher ? 50 : 25, finisher ? "Finisher" : "Takedown");
    if (e.g) e.g.aware = true;
  };

  const stickToWall = (e: Enemy, reach = 2.6) => {
    if (!wallNear(e, reach, e.anchor)) return false;
    _u.set(e.pos.x - e.anchor.x, 0, e.pos.z - e.anchor.z).normalize();
    e.pos.set(e.anchor.x + _u.x * 0.45, e.g!.floorY + 0.9, e.anchor.z + _u.z * 0.45);
    e.yaw = Math.atan2(_u.x, _u.z);
    e.anchor.y = e.g!.floorY + 1.8;
    if (!e.ko) queueXp(25, "Webbed to a wall");
    e.ko = true;
    e.hp = 0;
    setState(e, "wall");
    events.push({ type: "sfx", name: "webImpact" });
    burst(e.center, 8, 5, 2.4, 2.4, 2.6);
    return true;
  };

  const hitEnemy = (e: Enemy, h: Hit): HitResult => {
    if (!e.active || defeated(e)) return "none";
    const s = STATS[e.kind];
    const fullWeb = e.web >= s.web;
    if (e.g) e.g.aware = true;
    const special = h.kind === "finisher" || h.kind === "gadget" || h.kind === "throw" || h.kind === "counter";
    if (!special && !fullWeb && e.st !== "launched") {
      if (e.kind === "brute") return "block";
      if (e.kind === "shield" && e.armed && !h.behind && e.st !== "stagger") return "block";
    }
    e.hp -= h.dmg * (h.behind ? 1.5 : 1);
    e.flash = 0.12;
    if (e.hp <= 0) {
      ko(e, h.dir, h.kind === "heavy" || h.kind === "slam" || h.kind === "gadget" || h.kind === "counter" ? 6 : 3);
      if (h.kind === "slam") e.vel.y = -18;
      return "ko";
    }
    switch (h.kind) {
      case "launch":
        setState(e, "launched");
        e.vel.set(h.dir.x * 0.6, 13.5, h.dir.z * 0.6);
        e.hang = 0;
        break;
      case "air":
        setState(e, "launched");
        e.vel.set(h.dir.x * 0.8, Math.max(e.vel.y, 1.2), h.dir.z * 0.8);
        e.hang = 0.55;
        break;
      case "slam":
        setState(e, "flying");
        e.vel.set(h.dir.x * 2, -18, h.dir.z * 2);
        break;
      case "heavy":
      case "counter":
      case "strike":
      case "gadget":
      case "throw": {
        const k = h.kind === "gadget" || h.kind === "throw" ? 15 : h.kind === "heavy" || h.kind === "counter" ? 8 : 6;
        setState(e, "flying");
        e.vel.set(h.dir.x * k, h.kind === "gadget" ? 2.5 : 4.5, h.dir.z * k);
        e.thrown = h.kind === "gadget" || h.kind === "throw";
        break;
      }
      default:
        if (e.st === "webbed") {
          e.vel.set(h.dir.x * 1.5, 0, h.dir.z * 1.5);
        } else {
          setState(e, "stagger");
          e.vel.set(h.dir.x * 2.4, 0, h.dir.z * 2.4);
        }
    }
    e.spin = 0;
    return "hit";
  };

  const webEnemy = (e: Enemy, n: number) => {
    if (!e.active || defeated(e)) return false;
    const s = STATS[e.kind];
    if (e.g) e.g.aware = true;
    e.web = Math.min(s.web + 2, e.web + n);
    e.webT = 0;
    if ((e.st === "aim" || e.st === "windup") && e.kind !== "brute") setState(e, "recover");
    if (e.web >= s.web && e.st !== "webbed" && e.st !== "flying" && e.st !== "launched") {
      setState(e, "webbed");
      e.vel.set(0, 0, 0);
      if (!stickToWall(e, 1.4)) events.push({ type: "sfx", name: "webImpact" });
    }
    return true;
  };

  const yankEnemy = (e: Enemy, from: THREE.Vector3, dir: THREE.Vector3) => {
    if (!e.active || defeated(e)) return false;
    if (e.g) e.g.aware = true;
    const s = STATS[e.kind];
    if (e.web >= s.web) {
      setState(e, "flying");
      e.thrown = true;
      e.vel.set(dir.x * 16, 5, dir.z * 16);
      return true;
    }
    if (e.armed && e.kind !== "thug" && e.kind !== "brute") {
      e.armed = false;
      setState(e, "stagger");
      events.push({ type: "sfx", name: "metal" });
      burst(e.center, 8, 6, 2.5, 2.5, 2.5);
      return true;
    }
    if (e.kind === "brute") {
      setState(e, "stagger");
      return true;
    }
    setState(e, "flying");
    _u.set(from.x - e.pos.x, 0, from.z - e.pos.z);
    const d = _u.length();
    _u.normalize();
    e.vel.set(_u.x * Math.min(14, d * 1.6), 4.5, _u.z * Math.min(14, d * 1.6));
    return true;
  };

  const spawnGroup = (kind: EnemyKind, pos: THREE.Vector3, count: number, opts: GroupOpts = {}) => {
    let g = groups.find((x) => !x.active);
    if (!g) {
      g = { id: 0, active: false, members: [], center: new THREE.Vector3(), floorY: 0, roof: null, bounds: null, near: [], aware: false };
      groups.push(g);
    }
    g.id = ++groupSeq;
    g.active = true;
    g.members.length = 0;
    g.center.copy(pos);
    g.roof = pos.y > 0.5 ? roofUnder(pos.x, pos.z, pos.y) : null;
    g.floorY = g.roof ? g.roof.maxY : pos.y;
    g.bounds = opts.bounds ?? null;
    g.near = city.near(pos.x, pos.z, 70);
    g.aware = opts.aware ?? false;
    const list: EnemyKind[] = [];
    for (let k = 0; k < count; k++) list.push(kind);
    for (const [k, n] of Object.entries(opts.mix ?? {}) as [EnemyKind, number][]) for (let j = 0; j < n; j++) list.push(k);
    const rad = opts.radius ?? 3 + list.length * 0.5;
    list.forEach((kd, k) => {
      const e = enemies.find((x) => !x.active);
      if (!e) return;
      const s = STATS[kd];
      e.active = true;
      e.kind = kd;
      e.hp = s.hp;
      e.web = 0;
      e.webT = 0;
      e.armed = true;
      e.cd = 0.8 + rnd() * 1.5;
      e.g = g!;
      e.hang = 0;
      e.flash = 0;
      e.ko = false;
      e.thrown = false;
      e.phase = rnd() * 10;
      e.strafe = rnd() < 0.5 ? -1 : 1;
      e.vel.set(0, 0, 0);
      setState(e, "idle");
      for (let n = 0; n < 10; n++) {
        const a = (k / list.length) * Math.PI * 2 + rnd() * 0.5;
        const rr = rad * (0.5 + rnd() * 0.5) * (kd === "sniper" ? 1.6 : 1);
        e.pos.set(pos.x + Math.cos(a) * rr, g!.floorY, pos.z + Math.sin(a) * rr);
        clampFloor(e);
        if (!blocked(g!.near, e.pos.x, e.pos.z, g!.floorY, 0.5)) break;
        e.pos.set(pos.x + (rnd() - 0.5) * 2, g!.floorY, pos.z + (rnd() - 0.5) * 2);
      }
      e.anchor.copy(e.pos);
      if (kd === "sniper" && g!.roof) {
        pickPerch(e, null);
        e.pos.copy(e.anchor);
      }
      const r = g!.roof;
      const ox = kd === "sniper" && r ? (r.minX + r.maxX) / 2 : pos.x;
      const oz = kd === "sniper" && r ? (r.minZ + r.maxZ) / 2 : pos.z;
      const out = Math.atan2(e.pos.x - ox, e.pos.z - oz);
      // Sentries face out or along the ring, never across it, so a rear approach exists.
      e.base = kd === "sniper" || k % 3 !== 2 ? out : out + (k % 2 ? 1.4 : -1.4);
      e.yaw = e.base;
      e.sus = 0;
      e.patT = rnd() * 3;
      e.patK = Math.floor(rnd() * 4);
      e.los = false;
      e.losT = rnd() * 0.15;
      e.seen = false;
      e.walker = kd !== "sniper" && k % 3 === 0;
      const look = LOOK[kd];
      e.jacket.set(look.jackets[Math.floor(rnd() * look.jackets.length)]);
      e.hat.set(look.hats[Math.floor(rnd() * look.hats.length)]);
      e.skin.set(SKINS[Math.floor(rnd() * SKINS.length)]);
      e.center.set(e.pos.x, e.pos.y + 1.1 * s.scale, e.pos.z);
      g!.members.push(e);
    });
    return g.id;
  };
  const groupById = (id: number) => groups.find((g) => g.active && g.id === id) ?? null;
  const groupDone = (id: number) => {
    const g = groupById(id);
    return !g || g.members.every((e) => !e.active || defeated(e));
  };
  const clearGroup = (id: number) => {
    const g = groupById(id);
    if (!g) return;
    for (const e of g.members) {
      e.active = false;
      unwarn(e.threat);
    }
    g.active = false;
  };

  const clampFloor = (e: Enemy) => {
    const g = e.g!;
    const r = g.roof;
    if (r) {
      e.pos.x = clamp(e.pos.x, r.minX + 1, r.maxX - 1);
      e.pos.z = clamp(e.pos.z, r.minZ + 1, r.maxZ - 1);
    }
    const b = g.bounds;
    if (b) {
      e.pos.x = clamp(e.pos.x, b.minX, b.maxX);
      e.pos.z = clamp(e.pos.z, b.minZ, b.maxZ);
    }
  };

  const moveEnemy = (e: Enemy, vx: number, vz: number, dt: number) => {
    const g = e.g!;
    const nx = e.pos.x + vx * dt;
    const nz = e.pos.z + vz * dt;
    if (!blocked(g.near, nx, e.pos.z, e.pos.y, 0.4)) e.pos.x = nx;
    if (!blocked(g.near, e.pos.x, nz, e.pos.y, 0.4)) e.pos.z = nz;
    clampFloor(e);
  };

  let meleeTokens = 0;
  let rangedTokens = 0;
  let attackGap = 0;

  const physics = (e: Enemy, dt: number) => {
    const g = e.g!;
    const grav = e.st === "launched" && e.hang > 0 ? G * 0.12 : G;
    e.hang -= dt;
    e.vel.y -= grav * dt;
    if (e.st === "launched" && e.hang > 0) e.vel.y = Math.max(e.vel.y, -1);
    const nx = e.pos.x + e.vel.x * dt;
    const nz = e.pos.z + e.vel.z * dt;
    const wall = blocked(g.near, nx, nz, e.pos.y, 0.3);
    if (wall) {
      if ((e.ko || e.thrown || e.web >= STATS[e.kind].web) && stickToWall(e)) return;
      e.vel.x *= -0.25;
      e.vel.z *= -0.25;
    } else {
      e.pos.x = nx;
      e.pos.z = nz;
    }
    const bx = e.pos.x;
    const bz = e.pos.z;
    clampFloor(e);
    if (bx !== e.pos.x) e.vel.x = 0;
    if (bz !== e.pos.z) e.vel.z = 0;
    e.pos.y += e.vel.y * dt;
    e.spin += dt * (e.st === "launched" ? 2 : 9);
    if (e.pos.y <= g.floorY && e.vel.y <= 0) {
      e.pos.y = g.floorY;
      if (e.ko || e.web >= STATS[e.kind].web || e.thrown) {
        if (!e.ko) queueXp(25, "Webbed up");
        e.ko = true;
        setState(e, "down");
        e.vel.set(0, 0, 0);
        events.push({ type: "sfx", name: "land", volume: 0.5 });
        burst(_v.set(e.pos.x, g.floorY + 0.4, e.pos.z), 6, 4, 2.2, 2.2, 2.4);
      } else {
        const wasSlam = e.vel.y < -12;
        e.vel.set(0, 0, 0);
        setState(e, "getup");
        if (wasSlam) {
          e.hp -= 1;
          events.push({ type: "sfx", name: "punchHeavy" }, { type: "shake", strength: 0.4 });
          burst(_v.set(e.pos.x, g.floorY + 0.2, e.pos.z), 12, 7, 2, 1.6, 1);
          if (e.hp <= 0) {
            e.ko = true;
            queueXp(25, "Takedown");
            setState(e, "down");
          }
        }
      }
    }
  };

  const think = (e: Enemy, dt: number) => {
    const g = e.g!;
    const s = STATS[e.kind];
    const p = P!;
    e.t += dt;
    e.flash -= dt;
    e.phase += dt;
    if (e.web > 0 && e.st !== "webbed" && !defeated(e)) {
      e.webT += dt;
      if (e.webT > 3) {
        e.web--;
        e.webT = 0;
      }
    }
    if (e.st === "hung") {
      e.pos.lerp(e.aim, e.t < 0.45 ? 1 - Math.exp(-14 * dt) : 1);
      return;
    }
    if (defeated(e)) return;
    if (e.st === "launched" || e.st === "flying") {
      physics(e, dt);
      return;
    }
    if (e.pos.y > g.floorY + 0.01) {
      e.vel.x = e.vel.z = 0;
      physics(e, dt);
      return;
    }
    if (e.st === "webbed") {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      moveEnemy(e, e.vel.x, e.vel.z, dt);
      if (e.t > (e.kind === "brute" ? 5 : 6.5)) {
        e.web = 0;
        setState(e, "recover");
        burst(e.center, 6, 4, 2, 2, 2.2);
      }
      return;
    }
    if (e.st === "stagger") {
      e.vel.multiplyScalar(Math.exp(-5 * dt));
      moveEnemy(e, e.vel.x, e.vel.z, dt);
      if (e.t > 0.42) setState(e, "move");
      return;
    }
    if (e.st === "getup") {
      if (e.t > 0.7) setState(e, "move");
      return;
    }
    const feet = p.pos.y - FEET;
    const dx = p.pos.x - e.pos.x;
    const dz = p.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    const dy = feet - e.pos.y;
    if (!g.aware) {
      if (act.kind === "takedown" && act.tgt === e.hit) return;
      patrol(e, dt);
      watch(e, dt);
      return;
    }
    const face = Math.atan2(dx, dz);
    e.cd -= dt;
    const ranged = s.range > 0 && e.armed;
    if (e.st === "windup") {
      e.yaw = turn(e.yaw, face, dt * (e.kind === "brute" ? 2 : 5));
      if (e.t >= s.windup) {
        unwarn(e.threat);
        if (d < s.reach + 0.7 && Math.abs(dy) < 2) hurt(e.kind === "gunner" || e.kind === "sniper" || e.kind === "rocket" ? 7 : s.dmg, e.pos, s.knock);
        events.push({ type: "sfx", name: e.kind === "brute" ? "punchHeavy" : "whoosh", volume: 0.5 });
        if (e.kind === "brute") ring(_v.copy(e.pos), 18, 4, 0, 1.6, 0.8, 0.4);
        setState(e, "recover");
        e.cd = s.cd * (0.8 + rnd() * 0.6);
      }
      return;
    }
    if (e.st === "aim") {
      e.yaw = turn(e.yaw, face, dt * 6);
      _v.set(p.pos.x, p.pos.y + 0.1, p.pos.z);
      e.aim.lerp(_v, 1 - Math.exp(-(e.kind === "sniper" ? 3 : 7) * dt));
      if (e.t >= s.windup) {
        unwarn(e.threat);
        if (e.kind === "rocket") {
          muzzle(e, _v);
          _w.subVectors(e.aim, _v).normalize().multiplyScalar(15);
          const pr = fire("rocket", _v, _w, s.dmg);
          if (pr) pr.owner = e;
          setState(e, "recover");
        } else {
          setState(e, "fire");
          e.shots = 0;
          if (e.kind === "sniper") pickPerch(e, p.pos);
          if (d < s.range + 10 && (e.kind !== "sniper" || sees(muzzle(e, _u), _w.set(p.pos.x, p.pos.y + 0.3, p.pos.z)))) hurt(s.dmg, e.pos, s.knock);
        }
        e.cd = s.cd * (0.8 + rnd() * 0.5);
      }
      return;
    }
    if (e.st === "fire") {
      if (e.t > e.shots * 0.09 && e.shots < (e.kind === "sniper" ? 1 : 3)) {
        e.shots++;
        events.push({ type: "sfx", name: "gunshot", volume: e.kind === "sniper" ? 1 : 0.6 });
      }
      if (e.t > 0.35) setState(e, "recover");
      return;
    }
    if (e.st === "recover") {
      if (e.t > 0.55) setState(e, "move");
      return;
    }
    e.yaw = turn(e.yaw, face, dt * 7);
    if (e.st === "idle") setState(e, "move");
    const tokensFree = attackGap <= 0 ? 1 : 0;
    if (ranged) {
      if (d < 3.2 && e.cd <= 0 && meleeTokens < 2 && tokensFree && Math.abs(dy) < 1.6) {
        startWindup(e, 0.8);
        return;
      }
      if (e.kind === "sniper") {
        _w.set(e.anchor.x - e.pos.x, 0, e.anchor.z - e.pos.z);
        const ad = _w.length();
        if (ad > 0.6) {
          e.yaw = turn(e.yaw, Math.atan2(_w.x, _w.z), dt * 8);
          moveEnemy(e, (_w.x / ad) * s.speed * 1.3, (_w.z / ad) * s.speed * 1.3, dt);
          if (Math.hypot(e.anchor.x - e.pos.x, e.anchor.z - e.pos.z) > ad - s.speed * dt * 0.5) e.anchor.copy(e.pos);
          return;
        }
        if (e.cd > 0) return;
        for (const o of g.members) if (o !== e && o.kind === "sniper" && o.st === "aim") return;
        if (!sees(muzzle(e, _u), _w.set(p.pos.x, p.pos.y + 0.3, p.pos.z))) {
          pickPerch(e, p.pos);
          e.cd = 0.8;
          return;
        }
      }
      if (e.cd <= 0 && rangedTokens < 2 && d < s.range && Math.abs(dy) < 60 && attackGap <= 0) {
        setState(e, "aim");
        e.aim.set(p.pos.x + (rnd() - 0.5) * 4, p.pos.y + 1, p.pos.z + (rnd() - 0.5) * 4);
        warn(e.threat, now + s.windup);
        rangedTokens++;
        attackGap = 0.35;
        return;
      }
      if (e.kind === "sniper") return;
      const want = e.kind === "rocket" ? 15 : 11;
      const k = d > want + 3 ? 1 : d < want - 3 ? -1 : 0;
      const tx = (dx / (d || 1)) * k + (-dz / (d || 1)) * e.strafe * 0.5;
      const tz = (dz / (d || 1)) * k + (dx / (d || 1)) * e.strafe * 0.5;
      moveEnemy(e, tx * s.speed, tz * s.speed, dt);
    } else {
      if (d < s.reach && e.cd <= 0 && meleeTokens < 2 && tokensFree && Math.abs(dy) < 1.6) {
        startWindup(e, s.windup);
        return;
      }
      const engage = e.cd <= 0 && meleeTokens < 2;
      const want = engage ? s.reach - 0.4 : 4 + (e.i % 3) * 0.8;
      const k = d > want + 0.3 ? 1 : d < want - 0.6 ? -0.6 : 0;
      const fast = d > 10 ? 1.6 : 1;
      const side = engage ? 0.15 : 0.55;
      const tx = (dx / (d || 1)) * k + (-dz / (d || 1)) * e.strafe * side;
      const tz = (dz / (d || 1)) * k + (dx / (d || 1)) * e.strafe * side;
      moveEnemy(e, tx * s.speed * fast, tz * s.speed * fast, dt);
      if (rnd() < dt * 0.3) e.strafe *= -1;
    }
    for (const o of g.members) {
      if (o === e || !o.active || defeated(o)) continue;
      const ox = e.pos.x - o.pos.x;
      const oz = e.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      const min = 1.1 * (STATS[e.kind].scale + STATS[o.kind].scale) * 0.5;
      if (od < min && od > 1e-3) moveEnemy(e, (ox / od) * 3, (oz / od) * 3, dt);
    }
  };

  const patrol = (e: Enemy, dt: number) => {
    const p = P!;
    if (e.sus > 0.35) {
      if (e.st !== "idle") setState(e, "idle");
      e.yaw = turn(e.yaw, Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z), dt * 2.5);
      return;
    }
    if (!e.walker) {
      if (e.st !== "idle") setState(e, "idle");
      e.yaw = turn(e.yaw, e.base + Math.sin(e.phase * 0.45) * 0.6, dt * 1.5);
      return;
    }
    e.patT -= dt;
    const wx = e.anchor.x + (e.patK === 1 || e.patK === 2 ? 3.5 : -3.5) - e.pos.x;
    const wz = e.anchor.z + (e.patK >= 2 ? 3.5 : -3.5) - e.pos.z;
    const wd = Math.hypot(wx, wz);
    if (e.patT > 0) {
      if (e.st !== "idle") setState(e, "idle");
      e.yaw = turn(e.yaw, Math.atan2(wx, wz), dt * 1.2);
      return;
    }
    if (wd < 0.4 || e.patT < -7) {
      e.patK = (e.patK + 1) % 4;
      e.patT = 1.5 + rnd();
      return;
    }
    if (e.st !== "move") setState(e, "move");
    e.yaw = turn(e.yaw, Math.atan2(wx, wz), dt * 3);
    moveEnemy(e, (wx / wd) * 1.4, (wz / wd) * 1.4, dt);
  };

  const eyeOf = (e: Enemy, out: THREE.Vector3) => out.set(e.pos.x, e.pos.y + 1.6 * STATS[e.kind].scale, e.pos.z);
  // Flat distance when the point is inside the view cone, else -1.
  const inView = (e: Enemy, x: number, y: number, z: number) => {
    const dx = x - e.pos.x;
    const dz = z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > (e.kind === "sniper" ? VIEW_SNIPER : VIEW)) return -1;
    if (e.kind !== "sniper" && y - e.pos.y - 1.6 > d + 2) return -1;
    if (d > 0.8 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d < CONE) return -1;
    return d;
  };

  const alarm = (g: Group) => {
    if (g.aware) return;
    g.aware = true;
    for (const o of g.members) o.sus = 0;
    events.push({ type: "sfx", name: "alert" });
  };

  const watch = (e: Enemy, dt: number) => {
    const p = P!;
    const d = inView(e, p.pos.x, p.pos.y, p.pos.z);
    e.seen = false;
    if (d < 0) e.losT = 0;
    else {
      e.losT -= dt;
      if (e.losT <= 0) {
        e.losT = 0.15;
        e.los = sees(eyeOf(e, _u), p.pos);
      }
      e.seen = e.los;
    }
    if (!e.seen) {
      e.sus = Math.max(0, e.sus - 0.3 * dt);
      return;
    }
    const high = p.pos.y - FEET - e.pos.y;
    let rate = 0.25 + 1.25 * (1 - d / (e.kind === "sniper" ? VIEW_SNIPER : VIEW));
    if (high > 3) rate *= Math.max(0.3, 1 - (high - 3) / 12);
    if (p.mode === "perch") rate *= 0.6;
    e.sus += rate * dt;
    if (e.sus >= 1) alarm(e.g!);
  };

  const sees = (a: THREE.Vector3, b: THREE.Vector3) => {
    const n = Math.ceil(a.distanceTo(b) / 3);
    for (let k = 1; k < n; k++) {
      const f = k / n;
      const x = a.x + (b.x - a.x) * f;
      const y = a.y + (b.y - a.y) * f;
      const z = a.z + (b.z - a.z) * f;
      for (const bx of city.near(x, z, 1)) if (bx.maxY > y && inBox(bx, x, z)) return false;
    }
    return true;
  };

  // Snipers perch near the roof edge that faces the player, so street level can see them. After a shot they relocate.
  const pickPerch = (e: Enemy, toward: THREE.Vector3 | null) => {
    const g = e.g!;
    const r = g.roof;
    for (let k = 0; k < 12; k++) {
      let x = r ? r.minX + 1.2 + rnd() * Math.max(0, r.maxX - r.minX - 2.4) : g.center.x + (rnd() - 0.5) * 14;
      let z = r ? r.minZ + 1.2 + rnd() * Math.max(0, r.maxZ - r.minZ - 2.4) : g.center.z + (rnd() - 0.5) * 14;
      if (r) {
        const hx = (r.maxX - r.minX) / 2;
        const hz = (r.maxZ - r.minZ) / 2;
        const dx = toward ? toward.x - (r.minX + hx) : rnd() - 0.5;
        const dz = toward ? toward.z - (r.minZ + hz) : rnd() - 0.5;
        const alongX = Math.abs(dx) / hx > Math.abs(dz) / hz !== rnd() < 0.2;
        if (alongX) x = dx > 0 ? r.maxX - 1.2 : r.minX + 1.2;
        else z = dz > 0 ? r.maxZ - 1.2 : r.minZ + 1.2;
      }
      const d = Math.hypot(x - e.pos.x, z - e.pos.z);
      if (toward && (d < 3 || d > 26)) continue;
      if (blocked(g.near, x, z, g.floorY, 0.5)) continue;
      if (g.members.some((o) => o !== e && o.kind === "sniper" && Math.hypot(o.anchor.x - x, o.anchor.z - z) < 4)) continue;
      e.anchor.set(x, g.floorY, z);
      return;
    }
    e.anchor.copy(e.pos);
  };

  const startWindup = (e: Enemy, dur: number) => {
    setState(e, "windup");
    warn(e.threat, now + dur);
    meleeTokens++;
    attackGap = 0.45;
    e.vel.set(0, 0, 0);
    if (dur !== STATS[e.kind].windup) e.t = STATS[e.kind].windup - dur;
  };

  const muzzle = (e: Enemy, out: THREE.Vector3) => {
    const s = STATS[e.kind].scale;
    const fx = Math.sin(e.yaw);
    const fz = Math.cos(e.yaw);
    if (e.kind === "rocket") return out.set(e.pos.x + fx * 0.8 + Math.cos(e.yaw) * 0.3, e.pos.y + 1.65 * s, e.pos.z + fz * 0.8 - Math.sin(e.yaw) * 0.3);
    return out.set(e.pos.x + fx * (e.kind === "sniper" ? 1.6 : 0.95) - fz * 0.33, e.pos.y + 1.45 * s, e.pos.z + fz * (e.kind === "sniper" ? 1.6 : 0.95) + fx * 0.33);
  };

  const projs: Proj[] = Array.from({ length: MAX_P }, () => ({ active: false, kind: "web" as Proj["kind"], pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, dmg: 0, hostile: false, tgt: null, owner: null, back: false, threat: { at: 0, sensed: false } }));
  const fire = (kind: Proj["kind"], from: THREE.Vector3, vel: THREE.Vector3, dmg: number, tgt: Hittable | null = null) => {
    const pr = projs.find((x) => !x.active);
    if (!pr) return null;
    pr.active = true;
    pr.kind = kind;
    pr.pos.copy(from);
    pr.vel.copy(vel);
    pr.life = kind === "rocket" ? 6 : kind === "bomb" ? 1.2 : 3;
    pr.dmg = dmg;
    pr.hostile = kind === "rocket" || kind === "blast" || kind === "feather";
    pr.tgt = tgt;
    pr.owner = null;
    pr.back = false;
    if (kind === "rocket") events.push({ type: "sfx", name: "rocket" });
    return pr;
  };
  const rings: Ring[] = Array.from({ length: MAX_R }, () => ({ active: false, c: new THREE.Vector3(), r: 0, speed: 0, maxR: 0, dmg: 0, done: false, col: new THREE.Color(), threat: { at: 0, sensed: false } }));
  const ring = (c: THREE.Vector3, speed: number, maxR: number, dmg: number, r: number, g: number, b: number) => {
    const x = rings.find((y) => !y.active) ?? rings[0];
    x.active = true;
    x.c.copy(c);
    x.r = 0.3;
    x.speed = speed;
    x.maxR = maxR;
    x.dmg = dmg;
    x.done = dmg <= 0;
    x.col.setRGB(r, g, b);
    unwarn(x.threat);
  };
  const minesList: Mine[] = Array.from({ length: 4 }, () => ({ active: false, pos: new THREE.Vector3(), t: 0 }));

  const explode = (pos: THREE.Vector3, radius: number, dmg: number, friendly: boolean) => {
    events.push({ type: "sfx", name: "explosion" }, { type: "shake", strength: 0.6 });
    burst(pos, 22, 11, 4, 1.8, 0.4);
    ring(_u.copy(pos), 16, radius + 1, 0, 3, 1.4, 0.4);
    if (!friendly && P && P.pos.distanceTo(pos) < radius) hurt(dmg, pos, 9);
    if (friendly) {
      for (const e of enemies) if (e.active && !defeated(e) && e.center.distanceTo(pos) < radius) ko(e, _w.subVectors(e.pos, pos).setY(0), 5);
      if (civilians && civilians.count(pos, radius + 2) > 0) events.push({ type: "penalty", reason: "Explosion near civilians" });
    }
  };

  const updateProjs = (dt: number) => {
    const p = P!;
    for (const pr of projs) {
      if (!pr.active) continue;
      pr.life -= dt;
      if (pr.kind === "bomb") pr.vel.y -= G * 0.8 * dt;
      if (pr.tgt && (pr.kind === "web" || pr.kind === "impact")) {
        _v.subVectors(pr.tgt.center, pr.pos);
        const d = _v.length();
        if (d < pr.tgt.radius + 0.6 || d < pr.vel.length() * dt) {
          pr.active = false;
          if (pr.kind === "web") {
            pr.tgt.web(1);
            events.push({ type: "sfx", name: "webImpact", volume: 0.5 });
          } else {
            pr.tgt.web(10);
            hitInfo.dmg = 1;
            hitInfo.kind = "gadget";
            hitInfo.behind = false;
            hitInfo.dir.copy(pr.vel).setY(0).normalize();
            pr.tgt.hit(hitInfo);
            events.push({ type: "sfx", name: "webImpact" }, { type: "shake", strength: 0.3 });
          }
          burst(pr.tgt.center, 6, 5, 2.4, 2.4, 2.6);
          continue;
        }
        pr.vel.copy(_v.normalize().multiplyScalar(pr.vel.length()));
      }
      if (pr.kind === "rocket") {
        const home = pr.back && pr.owner ? pr.owner.center : p.pos;
        _v.subVectors(home, pr.pos);
        const d = _v.length();
        const speed = pr.back ? 24 : 15;
        _v.normalize();
        _w.copy(pr.vel).normalize().lerp(_v, Math.min(1, dt * (pr.back ? 8 : 1.1))).normalize();
        pr.vel.copy(_w).multiplyScalar(speed);
        if (!pr.back) warn(pr.threat, now + d / speed);
        if (detail > 0 && Math.floor(now * 30) % 3 === 0) burst(_u.copy(pr.pos).addScaledVector(_w, -0.5), 1, 1.5, 3, 1.2, 0.3);
        if (pr.back && pr.owner && d < 1.3) {
          pr.active = false;
          unwarn(pr.threat);
          explode(pr.pos, 3.5, 0, true);
          queueXp(40, "Rocket returned");
          continue;
        }
      }
      pr.pos.addScaledVector(pr.vel, dt);
      if (pr.hostile && pr.kind !== "rocket" && !pr.back) {
        _v.subVectors(p.pos, pr.pos);
        const along = _v.dot(_w.copy(pr.vel).normalize());
        if (along > 0) warn(pr.threat, now + along / pr.vel.length());
        else unwarn(pr.threat);
      }
      const fl = floorAt(pr.pos.x, pr.pos.z, pr.pos.y);
      const hitWorld = pr.pos.y < fl + 0.05 || blocked(city.near(pr.pos.x, pr.pos.z, 1), pr.pos.x, pr.pos.z, pr.pos.y, 0);
      if (pr.hostile && !pr.back && pr.pos.distanceTo(p.pos) < (pr.kind === "rocket" ? 1.3 : 1.1)) {
        pr.active = false;
        unwarn(pr.threat);
        if (pr.kind === "rocket") explode(pr.pos, 3.2, pr.dmg, false);
        else {
          hurt(pr.dmg, _v.copy(pr.pos).addScaledVector(pr.vel, -0.1), 5);
          burst(pr.pos, 8, 6, 1, 2.5, 4);
        }
        continue;
      }
      if (pr.kind === "bomb") {
        let near = hitWorld;
        for (const e of enemies) if (e.active && !defeated(e) && e.center.distanceTo(pr.pos) < 1.2) near = true;
        if (near || pr.life <= 0) {
          pr.active = false;
          webBomb(pr.pos);
          continue;
        }
      }
      if (pr.life <= 0 || hitWorld) {
        pr.active = false;
        unwarn(pr.threat);
        if (pr.kind === "rocket") explode(pr.pos, 3.2, pr.dmg, pr.back);
        else burst(pr.pos, 4, 3, 1.5, 1.5, 1.8);
      }
    }
  };

  const webBomb = (pos: THREE.Vector3) => {
    events.push({ type: "sfx", name: "webImpact" }, { type: "shake", strength: 0.25 });
    ring(_u.copy(pos), 14, 5.5, 0, 2.6, 2.6, 2.8);
    burst(pos, 18, 9, 2.4, 2.4, 2.6);
    for (const h of targets()) if (h.center.distanceTo(pos) < 5.5) h.web(3);
    if (civilians && civilians.count(pos, 5.5) > 0) events.push({ type: "penalty", reason: "Web bomb hit civilians" });
  };

  const updateRings = (dt: number) => {
    const p = P!;
    for (const x of rings) {
      if (!x.active) continue;
      x.r += x.speed * dt;
      if (x.r >= x.maxR) {
        x.active = false;
        unwarn(x.threat);
        continue;
      }
      if (x.done) continue;
      const hd = Math.hypot(p.pos.x - x.c.x, p.pos.z - x.c.z);
      const feet = p.pos.y - FEET;
      if (hd > x.r + 0.6) {
        if (hd < x.maxR) warn(x.threat, now + (hd - x.r) / x.speed);
      } else {
        x.done = true;
        unwarn(x.threat);
        if (hd > x.r - 1.2 && feet < x.c.y + 0.7) hurt(x.dmg, x.c, 6);
      }
    }
  };

  const updateMines = (dt: number) => {
    for (const m of minesList) {
      if (!m.active) continue;
      m.t += dt;
      if (m.t > 30) {
        m.active = false;
        continue;
      }
      if (m.t < 0.5) continue;
      for (const e of enemies) {
        if (!e.active || defeated(e) || e.st === "flying") continue;
        if (Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) > 3.2 || Math.abs(e.pos.y - m.pos.y) > 1.5) continue;
        m.active = false;
        e.web = STATS[e.kind].web;
        e.ko = true;
        queueXp(30, "Trip mine");
        setState(e, "flying");
        e.vel.set((m.pos.x - e.pos.x) * 2, 3, (m.pos.z - e.pos.z) * 2);
        events.push({ type: "sfx", name: "webImpact" });
        ring(_u.copy(m.pos), 10, 3.5, 0, 2.4, 2.4, 2.8);
        burst(_u.copy(m.pos).setY(m.pos.y + 0.5), 10, 6, 2.4, 2.4, 2.6);
        break;
      }
    }
  };

  const ctx: CombatCtx = {
    group: root,
    city,
    events,
    now: () => now,
    player: () => P!,
    hurt,
    downed: () => act.kind === "down",
    warn,
    unwarn,
    spawnGroup: (k, p, n, o) => spawnGroup(k, p, n, o),
    groupDone: (id) => groupDone(id),
    clearGroup: (id) => clearGroup(id),
    burst,
    ring,
    fire: (kind, from, vel, dmg) => {
      fire(kind, from, vel, dmg);
    },
    line,
    floorAt,
    xp: queueXp,
    detail: () => detail,
  };
  const bosses = createBosses(ctx);

  const targetList: Hittable[] = [];
  const targets = () => {
    targetList.length = 0;
    for (const e of enemies) if (e.active && e.hit.targetable()) targetList.push(e.hit);
    for (const b of bosses.targets()) if (b.targetable()) targetList.push(b);
    return targetList;
  };

  const pick = (range: number, dir: THREE.Vector3, cone: number, filter?: (h: Hittable) => boolean) => {
    const p = P!;
    let best: Hittable | null = null;
    let bestS = Infinity;
    for (const h of targets()) {
      if (filter && !filter(h)) continue;
      _v.subVectors(h.center, p.pos);
      const dy = _v.y;
      _v.y = 0;
      const d = _v.length();
      if (d > range || Math.abs(dy) > Math.max(4, range * 0.6)) continue;
      const dot = d > 0.01 ? _v.dot(dir) / d : 1;
      if (dot < cone && d > 2.5) continue;
      const score = d - dot * 3 + Math.abs(dy) * 0.5;
      if (score < bestS) {
        bestS = score;
        best = h;
      }
    }
    return best;
  };

  const flatAim = (input: Input, out: THREE.Vector3) => {
    if (input.wish.lengthSq() > 0.01) out.set(input.wish.x, 0, input.wish.z);
    else out.set(input.look.x, 0, input.look.z);
    if (out.lengthSq() < 1e-4) out.copy(P!.facing);
    return out.normalize();
  };
  const lookFlat = (input: Input, out: THREE.Vector3) => {
    out.set(input.look.x, 0, input.look.z);
    if (out.lengthSq() < 1e-4) out.copy(P!.facing);
    return out.normalize();
  };

  const doHit = (tgt: Hittable, dmg: number, kind: HitKind) => {
    const p = P!;
    hitInfo.dmg = dmg;
    hitInfo.kind = kind;
    hitInfo.dir.set(tgt.center.x - p.pos.x, 0, tgt.center.z - p.pos.z);
    if (hitInfo.dir.lengthSq() < 1e-4) hitInfo.dir.copy(p.facing);
    hitInfo.dir.normalize();
    const y = tgt.yaw();
    hitInfo.behind = Math.sin(y) * -hitInfo.dir.x + Math.cos(y) * -hitInfo.dir.z < -0.35;
    const res = tgt.hit(hitInfo);
    if (res === "block") {
      events.push({ type: "sfx", name: "metal" }, { type: "shake", strength: 0.15 });
      burst(_v.copy(tgt.center).addScaledVector(hitInfo.dir, -0.4), 6, 5, 1.2, 1.8, 3);
      comboStep = 0;
      p.push(_v.copy(hitInfo.dir).multiplyScalar(p.grounded ? -5 : -3).setY(0));
      return res;
    }
    if (res === "none") return res;
    hits++;
    hitsT = 0;
    const air = !p.grounded;
    addFocus(air ? 0.2 : 0.12);
    const heavy = kind !== "punch" && kind !== "air";
    events.push({ type: "sfx", name: heavy ? "punchHeavy" : "punch", volume: 0.8 }, { type: "shake", strength: heavy ? 0.35 : 0.12 });
    if (kind === "heavy" || kind === "slam" || kind === "counter") slowmo(0.35, 0.07);
    else slowmo(0.05, 0.035);
    burst(_v.copy(tgt.center).addScaledVector(hitInfo.dir, -0.3), heavy ? 12 : 6, heavy ? 8 : 5, 3, 2.2, 1);
    if (air) {
      const up = 3.2 - p.vel.y;
      if (up > 0) p.push(_v.set(0, up, 0));
    }
    return res;
  };

  const lungeTo = (tgt: Hittable, speed: number, stop: number) => {
    const p = P!;
    _v.subVectors(tgt.center, p.pos);
    if (p.grounded && !tgt.airborne()) _v.y = 0;
    const d = _v.length();
    if (d <= stop) return true;
    _w.copy(tgt.center).addScaledVector(_v.normalize(), -stop * 0.9);
    if (p.grounded && !tgt.airborne()) _w.y = p.pos.y;
    p.lunge(_w, speed);
    const rise = _w.y - p.pos.y;
    if (Math.abs(rise) > 0.4 && (tgt.airborne() || !p.grounded)) {
      const vy = clamp(rise * 6, -16, 16) - p.vel.y;
      if (Math.abs(vy) > 0.5) p.push(_u.set(0, vy, 0));
    }
    p.face(_u.set(_v.x, 0, _v.z).normalize());
    return false;
  };

  const tryAttack = (input: Input, launch: boolean) => {
    const p = P!;
    flatAim(input, _dir);
    const air = !p.grounded;
    const tgt = pick(8, _dir, 0.25, air ? (h) => h.airborne() || h.center.y > p.pos.y - 2 : undefined);
    if (!tgt) {
      if (air || !inCombat()) return false;
      if (comboGap > 1.1) comboStep = 0;
      comboGap = 0;
      start("punch", 0.32, (`punch${(comboStep % 4) + 1}` as HeroPose), null, 0.14);
      comboStep = (comboStep + 1) % 4;
      events.push({ type: "sfx", name: "whiff", volume: 0.5 });
      return true;
    }
    if (comboGap > 1.1) comboStep = 0;
    comboGap = 0;
    if (launch && !air && !tgt.airborne()) {
      start("launch", 0.42, "uppercut", tgt, 0.17);
      comboStep = 0;
      return true;
    }
    const step = comboStep;
    comboStep = (comboStep + 1) % 4;
    const last = step === 3;
    const pose: HeroPose = air ? "airPunch" : (`punch${step + 1}` as HeroPose);
    start("punch", last ? 0.46 : 0.32, pose, tgt, last ? 0.2 : 0.13);
    act.step = step;
    act.air = air;
    act.lunging = true;
    return true;
  };

  const tryDodge = (input: Input) => {
    const p = P!;
    let perfect = false;
    let soon = Infinity;
    for (const th of threats) {
      const k = th.at - now;
      if (k > -0.05 && k < 0.28) perfect = true;
      if (k > -0.05 && k < soon) soon = k;
    }
    flatAim(input, _dir);
    if (input.wish.lengthSq() < 0.01) {
      let nearest: Enemy | null = null;
      let nd = 12;
      for (const e of enemies) {
        if (!e.active || defeated(e)) continue;
        const d = e.pos.distanceTo(p.pos);
        if (d < nd) {
          nd = d;
          nearest = e;
        }
      }
      if (nearest) _dir.set(-(nearest.pos.z - p.pos.z), 0, nearest.pos.x - p.pos.x).normalize();
      else _dir.copy(p.facing).negate();
    }
    let slide: Enemy | null = null;
    for (const e of enemies) {
      if (!e.active || e.kind !== "shield" || !e.armed || defeated(e)) continue;
      _v.subVectors(e.pos, p.pos).setY(0);
      const d = _v.length();
      if (d < 4.5 && _v.dot(_dir) / (d || 1) > 0.6) slide = e;
    }
    start("dodge", 0.4, "dodge");
    invuln = Math.max(invuln, perfect ? 0.7 : 0.42, soon < 0.65 ? soon + 0.15 : 0);
    if (slide) {
      _v.subVectors(slide.pos, p.pos).setY(0).normalize();
      p.push(_v.multiplyScalar(15));
      setState(slide, "stagger");
      slide.t = -0.5;
      events.push({ type: "sfx", name: "whoosh" });
    } else {
      _v.copy(_dir).multiplyScalar(11);
      _v.y = p.grounded ? 1.5 : 0;
      p.push(_v);
      events.push({ type: "sfx", name: "dodge" });
    }
    addFocus(0.06);
    if (perfect) {
      addFocus(0.5);
      events.push({ type: "sfx", name: "perfectDodge" });
      slowmo(0.3, 0.35, true);
      queueXp(10, "Perfect dodge");
      counterT = 0.6;
      counterTgt = null;
      for (const e of enemies) {
        const k = e.threat.at - now;
        if (e.active && threats.has(e.threat) && k > -0.05 && k < 0.28 && e.pos.distanceTo(p.pos) < 12) counterTgt = e.hit;
      }
      for (const pr of projs) {
        if (pr.active && pr.kind === "rocket" && !pr.back && pr.owner && pr.threat.at - now < 0.5) {
          pr.back = true;
          unwarn(pr.threat);
        }
      }
    }
    return perfect;
  };

  const useGadget = (input: Input) => {
    const p = P!;
    if (charges[gadget] <= 0) {
      events.push({ type: "sfx", name: "whiff", volume: 0.4 });
      return;
    }
    lookFlat(input, _dir);
    hand.set(p.pos.x + _dir.x * 0.6, p.pos.y + 0.4, p.pos.z + _dir.z * 0.6);
    if (gadget === 0) {
      _w.copy(_dir).multiplyScalar(15);
      _w.y = 5 + input.look.y * 10;
      fire("bomb", hand, _w, 0);
    } else if (gadget === 1) {
      const tgt = pick(30, _dir, 0.7) ?? pick(14, _dir, -1);
      if (!tgt) {
        events.push({ type: "sfx", name: "whiff", volume: 0.4 });
        return;
      }
      fire("impact", hand, _w.subVectors(tgt.center, hand).normalize().multiplyScalar(55), 0, tgt);
    } else {
      const m = minesList.find((x) => !x.active) ?? minesList[0];
      m.active = true;
      m.t = 0;
      const x = p.pos.x + _dir.x * 2.5;
      const z = p.pos.z + _dir.z * 2.5;
      m.pos.set(x, floorAt(x, z, p.pos.y), z);
    }
    charges[gadget]--;
    start("gadget", 0.28, "throw");
    events.push({ type: "sfx", name: "webShot" });
  };

  const respawn = () => {
    const p = P!;
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const e of enemies) {
      if (!e.active || defeated(e) || e.pos.distanceTo(p.pos) > 30) continue;
      cx += e.pos.x;
      cz += e.pos.z;
      n++;
    }
    _v.set(n ? p.pos.x - cx / n : -p.facing.x, 0, n ? p.pos.z - cz / n : -p.facing.z);
    if (_v.lengthSq() < 1e-4) _v.set(1, 0, 0);
    _v.normalize();
    const feet = p.pos.y - FEET;
    let best = _w.copy(p.pos);
    for (const dist of [12, 8, 4]) {
      const x = p.pos.x + _v.x * dist;
      const z = p.pos.z + _v.z * dist;
      const f = floorAt(x, z, feet + 0.5);
      if (Math.abs(f - feet) < 0.7 && !blocked(city.near(x, z, 1), x, z, f, 0.5)) {
        best = _w.set(x, f + FEET, z);
        break;
      }
    }
    p.teleport(best);
    health = 1;
    invuln = 2.5;
    for (const e of enemies) if (e.active) e.cd = Math.max(e.cd, 2);
    bosses.onPlayerDown();
    events.push({ type: "toast", title: "BACK ON YOUR FEET", text: "Health restored" }, { type: "sfx", name: "heal" });
  };

  const inCombat = () => {
    if (bosses.active()) return true;
    const p = P;
    if (!p) return false;
    for (const e of enemies) if (e.active && !defeated(e) && e.g?.aware && e.pos.distanceTo(p.pos) < 45) return true;
    return false;
  };

  const findTakedown = () => {
    const p = P;
    if (!p) return null;
    let best: Enemy | null = null;
    let bestS = Infinity;
    const feet = p.pos.y - FEET;
    for (const e of enemies) {
      if (!e.active || !e.g || e.g.aware || defeated(e) || (e.st !== "idle" && e.st !== "move")) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const dy = feet - e.pos.y;
      const above = p.mode === "perch" || (dy > 3 && p.mode !== "swing");
      let score: number;
      if (above) {
        const d3 = Math.hypot(d, dy);
        if (dy < 1.5 || d3 > 25) continue;
        score = d3 - (d > 0.1 ? (dx * lastLook.x + dz * lastLook.z) / d : 1) * 6;
      } else {
        if (d > 3.4 || Math.abs(dy) > 1.2 || e.seen) continue;
        if (d > 0.3 && (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d < 0.2) continue;
        score = d;
      }
      if (score >= bestS) continue;
      // Start the sight line past the roof lip so the perch edge does not block it.
      if (above && !sees(_w.set(p.pos.x + (dx / (d || 1)) * 0.8, p.pos.y + 0.3, p.pos.z + (dz / (d || 1)) * 0.8), e.center)) continue;
      bestS = score;
      best = e;
      tdAbove = above;
    }
    return best;
  };

  // Rope top just past the roof edge, toward the victim, with room below for the body.
  const hangSpot = (e: Enemy) => {
    const p = P!;
    _u.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z);
    if (_u.lengthSq() < 1e-4) return false;
    _u.normalize();
    const top = p.pos.y - FEET - 0.15;
    if (top - 3.2 < e.pos.y + 0.5) return false;
    for (let k = 0.4; k <= 3; k += 0.4) {
      const x = p.pos.x + _u.x * k;
      const z = p.pos.z + _u.z * k;
      if (blocked(city.near(x, z, 1), x, z, top - 3.7, 0.45)) continue;
      tdAnchor.set(x, top, z);
      tdHangPos.set(x, top - 0.7, z);
      return true;
    }
    return false;
  };

  const startTakedown = (e: Enemy) => {
    const p = P!;
    tdHang = tdAbove && p.mode === "perch" && hangSpot(e);
    start("takedown", tdAbove ? 0.75 : 0.7, "takedown", e.hit, tdAbove ? 0.3 : 0.28);
    act.lunging = !tdAbove;
    events.push({ type: "sfx", name: "thwip", volume: 0.5 });
  };

  const takedown = (e: Enemy) => {
    if (!e.active || defeated(e) || !e.g) return;
    const g = e.g;
    unwarn(e.threat);
    e.ko = true;
    e.hp = 0;
    e.web = STATS[e.kind].web;
    e.vel.set(0, 0, 0);
    e.sus = 0;
    if (tdHang) {
      e.anchor.copy(tdAnchor);
      e.aim.copy(tdHangPos);
      setState(e, "hung");
    } else {
      e.pos.y = g.floorY;
      setState(e, "down");
    }
    events.push({ type: "sfx", name: "takedown" }, { type: "shake", strength: 0.2 });
    burst(e.center, 12, 5, 2.4, 2.4, 2.6);
    queueXp(50, "Silent takedown");
    for (const o of g.members) {
      if (g.aware || o === e || !o.active || defeated(o)) continue;
      if (inView(o, e.center.x, e.center.y, e.center.z) < 0 || !sees(eyeOf(o, _u), e.center)) continue;
      o.sus = Math.max(o.sus + 0.6, 0.75);
      if (o.sus >= 1) alarm(g);
    }
  };

  const tryCounter = (input: Input) => {
    const p = P!;
    flatAim(input, _dir);
    const tgt = counterTgt && counterTgt.targetable() && counterTgt.center.distanceTo(p.pos) < 12 ? counterTgt : pick(10, _dir, -1);
    if (!tgt) return false;
    counterT = 0;
    counterTgt = null;
    comboStep = 0;
    start("counter", 0.5, "counter", tgt, 0.2);
    act.lunging = true;
    return true;
  };

  const runAction = (dt: number, input: Input) => {
    const p = P!;
    if (act.kind === "none") return;
    if (act.lunging && act.tgt) {
      act.lungeT += dt;
      const stop = 1.5 + act.tgt.radius;
      const speed = act.kind === "strike" ? 34 : act.kind === "finisher" ? 22 : act.kind === "takedown" ? 16 : act.kind === "counter" ? 30 : 24;
      const there = !act.tgt.targetable() && act.kind !== "finisher" ? true : lungeTo(act.tgt, speed, stop);
      if (!there && act.lungeT < (act.kind === "strike" ? 0.8 : 0.45)) {
        p.act(act.pose, 0);
        if (act.kind === "strike") line(_v.copy(p.pos).setY(p.pos.y + 0.4), act.tgt.center, 2.4, 2.4, 2.6);
        return;
      }
      act.lunging = false;
    }
    act.t += dt;
    const prog = Math.min(1, act.t / act.dur);
    p.act(act.pose, prog);
    if (act.tgt && act.kind !== "yank") {
      _v.subVectors(act.tgt.center, p.pos).setY(0);
      if (_v.lengthSq() > 1e-4) p.face(_v.normalize());
    }
    if (!act.hitDone && act.t >= act.hitAt) {
      act.hitDone = true;
      const tgt = act.tgt;
      const reach = tgt ? tgt.center.distanceTo(p.pos) < 2.6 + tgt.radius : false;
      switch (act.kind) {
        case "punch":
          if (tgt && reach) {
            const last = act.step === 3;
            if (act.air) doHit(tgt, last ? 2 : 1, last ? "slam" : "air");
            else doHit(tgt, last ? 2 : 1, last ? "heavy" : "punch");
          }
          break;
        case "launch":
          if (tgt && reach && doHit(tgt, 1, "launch") === "hit") {
            p.push(_v.set(0, 12.5, 0));
            addFocus(0.1);
          }
          break;
        case "strike":
          if (tgt && reach) doHit(tgt, 2, "strike");
          break;
        case "counter":
          if (tgt && reach && doHit(tgt, 3, "counter") !== "block") {
            events.push({ type: "shake", strength: 0.5 });
            burst(tgt.center, 16, 9, 3, 2.6, 1.2);
            queueXp(15, "Counter");
          }
          break;
        case "takedown": {
          const e = tgt ? enemies.find((x) => x.hit === tgt) : undefined;
          if (e) takedown(e);
          break;
        }
        case "yank":
          if (tgt) {
            lookFlat(input, _dir);
            tgt.yank(p.pos, _dir);
            events.push({ type: "sfx", name: "thwip" });
          }
          break;
        case "finisher":
          if (tgt && tgt.finishable()) {
            focus = Math.max(0, focus - tgt.finishCost());
            _v.subVectors(tgt.center, p.pos).setY(0).normalize();
            tgt.finish(_v);
            events.push({ type: "sfx", name: "finisher" }, { type: "shake", strength: 0.7 });
            slowmo(0.25, 0.55, true);
            burst(tgt.center, 22, 10, 4, 3, 1.4);
          }
          break;
        case "shoot":
          if (tgt) {
            _v.set(p.pos.x + p.facing.x * 0.5, p.pos.y + 0.35, p.pos.z + p.facing.z * 0.5);
            fire("web", _v, _w.subVectors(tgt.center, _v).normalize().multiplyScalar(60), 0, tgt);
            events.push({ type: "sfx", name: "webShot", volume: 0.7 });
          }
          break;
        default:
      }
    }
    if (act.kind === "yank" && act.tgt && act.t < act.dur * 0.7) line(_v.copy(p.pos).setY(p.pos.y + 0.4), act.tgt.center, 2.4, 2.4, 2.6);
    if (act.kind === "takedown" && act.tgt && act.t < act.hitAt + 0.15) line(_v.copy(p.pos).setY(p.pos.y + 0.4), act.tgt.center, 2.4, 2.4, 2.6);
    if (act.t >= act.dur) {
      if (act.kind === "down") {
        respawn();
      }
      act.kind = "none";
      act.tgt = null;
    }
  };

  const handleInput = (dt: number, input: Input) => {
    const p = P!;
    const locked = act.kind === "down" || act.kind === "hurt";
    if (input.pressed.has("attack")) {
      lmbT = 0;
      lmbUsed = false;
    } else if (lmbT >= 0 && input.held.has("attack")) lmbT += dt;
    if (input.pressed.has("strike")) {
      fT = 0;
      fUsed = false;
    } else if (fT >= 0 && input.held.has("strike")) fT += dt;
    if (input.pressed.has("gadgetNext")) {
      gadget = (gadget + 1) % GADGETS.length;
      events.push({ type: "sfx", name: "ui" });
    }
    if (locked) {
      lmbUsed = fUsed = true;
      return;
    }
    if (counterT > 0 && input.pressed.has("attack") && (act.kind === "none" || act.kind === "dodge" || act.kind === "punch") && tryCounter(input)) {
      lmbUsed = true;
      return;
    }
    if (input.pressed.has("dodge") && act.kind !== "dodge") {
      tryDodge(input);
      return;
    }
    if (input.pressed.has("heal") && focus >= 1 && health < 1) {
      focus -= 1;
      health = Math.min(1, health + 0.4);
      events.push({ type: "sfx", name: "heal" });
      burst(_v.copy(p.pos), 12, 4, 0.6, 3, 1);
      ring(_v.copy(p.pos).setY(p.pos.y - FEET + 0.1), 6, 3, 0, 0.6, 3, 1);
    }
    const free = act.kind === "none" || (act.kind === "punch" && act.hitDone && act.t > act.dur * 0.6) || act.kind === "gadget" && act.t > 0.2;
    if (input.pressed.has("strike") && free) {
      const e = findTakedown();
      if (e) {
        fUsed = true;
        startTakedown(e);
        return;
      }
    }
    if (input.pressed.has("finisher") && free) {
      lookFlat(input, _dir);
      const tgt = pick(7, _dir, -1, (h) => h.finishable() && focus >= h.finishCost());
      if (tgt) {
        start("finisher", 0.85, "finisher", tgt, 0.45);
        act.lunging = true;
        return;
      }
    }
    if (input.pressed.has("gadget") && free) {
      useGadget(input);
      return;
    }
    if (input.pressed.has("web") && inCombat() && (free || act.kind === "shoot")) {
      lookFlat(input, _dir);
      const tgt = pick(32, _dir, 0.82) ?? pick(16, _dir, 0.2);
      if (tgt) {
        start("shoot", 0.22, "webShoot", tgt, 0.05);
        return;
      }
    }
    if (!fUsed && free) {
      const released = !input.held.has("strike");
      if (fT > 0.3 || released) {
        fUsed = true;
        lookFlat(input, _dir);
        const tgt = pick(22, _dir, 0.55) ?? pick(10, _dir, -1);
        if (tgt) {
          if (fT > 0.3) start("yank", 0.45, "yank", tgt, 0.12);
          else {
            start("strike", 0.4, "kick", tgt, 0.05);
            act.lunging = true;
          }
          events.push({ type: "sfx", name: "zip" });
          return;
        }
      }
    }
    if (!lmbUsed) {
      buffer = 0.35;
      const held = input.held.has("attack");
      if (held && lmbT < 0.22) return;
      if (free) {
        lmbUsed = true;
        tryAttack(input, held && lmbT >= 0.22);
      } else if (!held) {
        lmbUsed = true;
        buffer = 0.35;
      }
    } else if (buffer > 0) {
      buffer -= dt;
      if (free && act.kind !== "punch") {
        buffer = 0;
        tryAttack(input, false);
      } else if (free && act.kind === "punch") {
        buffer = 0;
        tryAttack(input, false);
      }
    }
  };

  const part = (out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, ax: number, az: number) => {
    _e.set(ax, 0, az, "XYZ");
    _m3.makeRotationFromEuler(_e).setPosition(x, y, z);
    return out.multiplyMatrices(parent, _m3);
  };

  let markN = 0;
  let beamN = 0;
  const faceCam = (p: THREE.Vector3) => _q.setFromAxisAngle(UP, Math.atan2(camPos.x - p.x, camPos.z - p.z));

  // Diamond above every live sniper, held near a constant screen size and unfogged so it reads at 100+ m.
  const drawSniperMark = (e: Enemy, sc: number, t: number) => {
    _v.set(e.pos.x, e.pos.y + 2.2 * sc, e.pos.z);
    const dc = _v.distanceTo(camPos);
    if (dc > 260 || markN >= MAX_E * 2) return;
    const aiming = e.st === "aim";
    const k = aiming ? Math.min(1, e.t / STATS.sniper.windup) : 0;
    const flash = aiming && e.threat.at - now < 0.3;
    const aware = e.g?.aware ?? false;
    const pulse = 0.5 + 0.5 * Math.sin(t * (aiming ? 7 + 16 * k : aware ? 3.5 : 2) + e.phase);
    const size = Math.max(0.22, dc * 0.0135) * (0.9 + 0.25 * pulse + (flash ? 0.3 : 0));
    _v.y += size;
    marks.setMatrixAt(markN, _m.compose(_v, faceCam(_v), _s.setScalar(size)));
    const I = flash ? (Math.sin(t * 60) > 0 ? 3 : 1.4) : aiming ? 1 + 0.8 * k * pulse : aware ? 0.8 + 0.3 * pulse : 0.55 + 0.2 * pulse;
    marks.setColorAt(markN++, flash ? _c.setRGB(I, I * 0.12, I * 0.08) : _c.setRGB(I, I * 0.03, I * 0.03));
  };

  // Scope glint plus a tapered beam toward the aim point. Width follows camera distance so the far end stays a few pixels wide.
  const drawSniperAim = (e: Enemy, k: number, I: number, flash: boolean, strobe: boolean, t: number) => {
    dodgeCue ||= e.threat.at - now < 0.6;
    const dc = _v.distanceTo(camPos);
    if (markN < MAX_E * 2) {
      const gl = Math.max(0.1, dc * 0.007) * (0.5 + 0.9 * k) * (0.85 + 0.3 * Math.sin(t * 45 + e.i));
      _w.copy(_v);
      marks.setMatrixAt(markN, _m.compose(_w, faceCam(_w), _s.set(gl * 2.4, gl * 0.45, gl)));
      marks.setColorAt(markN++, flash && strobe ? _c.setRGB(4, 1.2, 0.9) : _c.setRGB(1 + 1.6 * k, 0.15 + 0.35 * k, 0.1 + 0.25 * k));
    }
    _dir.subVectors(e.aim, _v);
    const full = _dir.length();
    const len = full - 1.2;
    if (len < 1 || beamN >= MAX_E) return;
    _dir.divideScalar(full);
    const w = clamp(dc * 0.0028, 0.03, 0.45) * (flash ? 1.5 : 0.6 + 0.5 * k);
    _q.setFromUnitVectors(FWD, _dir);
    beams.setMatrixAt(beamN, _m.compose(_v, _q, _s.set(w, w, len)));
    beams.setColorAt(beamN++, flash ? _c.setRGB(I * 0.6, I * 0.05, I * 0.03) : _c.setRGB(I * 0.45, I * 0.02, I * 0.015));
  };

  // Suspicion bar over the head: fills left to right, yellow to red, held near a constant screen size.
  const drawMeter = (e: Enemy, sc: number, i: number, t: number) => {
    _v.set(e.pos.x, e.pos.y + 2.3 * sc, e.pos.z);
    const size = clamp(_v.distanceTo(camPos) * 0.045, 0.6, 6);
    const k = Math.min(1, e.sus);
    const hot = k > 0.7 && Math.sin(t * 24) > 0 ? 1.4 : 1;
    faceCam(_v);
    _w.set(1, 0, 0).applyQuaternion(_q);
    _v.addScaledVector(_w, -size * 0.5);
    susBg.setMatrixAt(i, _m.compose(_v, _q, _s.set(size, size * 0.2, 1)));
    susBg.setColorAt(i, _c.setRGB(0.03, 0.03, 0.04));
    _v.addScaledVector(_w, size * 0.04).y += size * 0.04;
    susFill.setMatrixAt(i, _m.compose(_v, _q, _s.set(size * 0.92 * Math.max(0.03, k), size * 0.12, 1)));
    susFill.setColorAt(i, _c.setRGB(2 * hot, (1.7 - 1.5 * k) * hot, 0.2 * hot));
  };

  const drawEnemies = (t: number) => {
    markN = 0;
    beamN = 0;
    let n = 0;
    const counts = { beanie: 0, helmet: 0, hood: 0, gun: 0, shield: 0, launcher: 0, rifle: 0, cocoon: 0, pip: 0, visor: 0, scope: 0, mark: 0, beam: 0, sus: 0 };
    dodgeCue = false;
    for (const e of enemies) {
      if (!e.active) continue;
      const s = STATS[e.kind];
      const sc = s.scale;
      const ph = e.phase;
      let legL = 0;
      let legR = 0;
      let armL = -0.1;
      let armR = -0.1;
      let sprL = 0.12;
      let sprR = 0.12;
      let lean = 0.03;
      let bob = 0;
      let tilt = 0;
      let roll = 0;
      let lift = 0;
      const aware = e.g?.aware ?? false;
      switch (e.st) {
        case "idle":
          armL = -0.05 + Math.sin(ph * 1.7) * 0.06;
          armR = -0.05 - Math.sin(ph * 1.7) * 0.06;
          break;
        case "move": {
          const w = Math.sin(ph * 9);
          legL = w * 0.55;
          legR = -w * 0.55;
          if (aware) {
            armL = -1.3 + Math.sin(ph * 6) * 0.1;
            armR = -1.1 + Math.cos(ph * 6) * 0.1;
            sprL = sprR = 0.35;
            lean = 0.16;
          } else {
            armL = -w * 0.5;
            armR = w * 0.5;
          }
          bob = Math.abs(w) * 0.05;
          break;
        }
        case "windup": {
          const k = Math.min(1, e.t / s.windup);
          if (e.kind === "brute") {
            armL = armR = -0.6 - 2.3 * k;
            sprL = sprR = 0.25;
            lean = -0.15 * k;
          } else {
            armL = -1.3;
            armR = 0.3 + 0.7 * k;
            sprR = 0.5;
            lean = -0.08 * k;
          }
          legL = -0.3;
          legR = 0.25;
          break;
        }
        case "recover": {
          const k = Math.max(0, 1 - e.t / 0.3);
          if (e.kind === "brute") {
            armL = armR = -0.6 * k - 0.3;
            lean = 0.45 * k;
          } else {
            armR = -1.55 * k - 0.3;
            armL = -1.2;
            lean = 0.25 * k;
          }
          legL = -0.3;
          legR = 0.25;
          break;
        }
        case "aim":
        case "fire": {
          const kick = e.st === "fire" ? Math.max(0, 0.25 - e.t) : 0;
          if (e.kind === "rocket") {
            armR = -1.2;
            armL = -1.0;
            sprL = 0.2;
            sprR = 0.5;
          } else {
            armR = -1.57 + kick;
            armL = -1.45 + kick;
            sprL = -0.35;
            sprR = 0.05;
          }
          legL = -0.25;
          legR = 0.25;
          lean = -kick;
          break;
        }
        case "stagger":
          lean = -0.4;
          armL = -0.8 + Math.sin(ph * 20) * 0.3;
          armR = -0.6;
          sprL = sprR = 0.8;
          legL = 0.3;
          break;
        case "getup":
          tilt = -Math.PI / 2 * Math.max(0, 1 - e.t / 0.6);
          lift = 0.15 * Math.max(0, 1 - e.t / 0.6);
          armL = armR = -0.4;
          break;
        case "launched":
        case "flying":
          tilt = e.st === "launched" ? -0.5 - Math.sin(e.spin) * 0.3 : -e.spin;
          armL = -2.6 + Math.sin(ph * 20) * 0.3;
          armR = -2.4;
          sprL = sprR = 0.6;
          legL = 0.5;
          legR = -0.3;
          break;
        case "webbed":
          armL = armR = 0;
          sprL = sprR = 0.04;
          roll = Math.sin(ph * 14) * 0.05;
          break;
        case "down":
          tilt = -Math.PI / 2;
          lift = 0.16 * sc;
          armL = armR = -0.1;
          sprL = sprR = 0.06;
          break;
        case "hung":
          tilt = Math.PI;
          armL = armR = -2.9 + Math.sin(ph * 2) * 0.08;
          sprL = sprR = 0.1;
          roll = Math.sin(e.t * 2.2) * 0.08;
          break;
        case "wall":
          armL = armR = -2.8;
          sprL = sprR = 0.3;
          legL = legR = 0;
          tilt = 0.12;
          break;
      }
      _e.set(tilt, e.yaw, roll, "YXZ");
      _q.setFromEuler(_e);
      _m.compose(_v.set(e.pos.x, e.pos.y + bob + lift, e.pos.z), _q, _s.setScalar(sc));
      _root.copy(_m);
      if (!defeated(e) && e.st !== "flying" && e.st !== "launched") e.center.set(e.pos.x, e.pos.y + 1.1 * sc, e.pos.z);
      else e.center.set(0, 0.95, 0).applyMatrix4(_root);
      legs.setMatrixAt(n * 2, part(_m, _root, EM.HIP_X, EM.HIP_Y, 0, legL, 0));
      legs.setMatrixAt(n * 2 + 1, part(_m, _root, -EM.HIP_X, EM.HIP_Y, 0, legR, 0));
      part(_torso, _root, 0, EM.HIP_Y, 0, lean, 0);
      _m3.makeScale(s.bulk, 1, s.bulk);
      _m.multiplyMatrices(_torso, _m3);
      torsos.setMatrixAt(n, _m);
      const fl = e.flash > 0 ? 3 : 1;
      torsos.setColorAt(n, _c.copy(e.jacket).multiplyScalar(fl));
      part(_arm, _torso, -EM.SHOULDER_X * s.bulk, EM.SHOULDER_Y, 0, armL, sprL);
      arms.setMatrixAt(n * 2, _arm);
      arms.setColorAt(n * 2, _c);
      part(_arm, _torso, EM.SHOULDER_X * s.bulk, EM.SHOULDER_Y, 0, armR, -sprR);
      arms.setMatrixAt(n * 2 + 1, _arm);
      arms.setColorAt(n * 2 + 1, _c);
      const armed = e.armed && !defeated(e) && e.st !== "webbed";
      if (armed && e.kind === "gunner") guns.setMatrixAt(counts.gun++, _arm);
      if (armed && e.kind === "sniper") {
        rifles.setMatrixAt(counts.rifle++, _arm);
        scopes.setMatrixAt(counts.scope++, _arm);
      }
      part(_m, _torso, 0, EM.HEAD_Y, 0, -lean * 0.5, 0);
      heads.setMatrixAt(n, _m);
      heads.setColorAt(n, _c.copy(e.skin).multiplyScalar(fl));
      if (e.kind === "sniper" && !defeated(e)) visors.setMatrixAt(counts.visor++, _m);
      const hat = LOOK[e.kind].hat;
      const hm = hat === "beanie" ? beanies : hat === "helmet" ? helmets : hoods;
      const hi = counts[hat]++;
      hm.setMatrixAt(hi, _m);
      hm.setColorAt(hi, e.hat);
      if (armed && e.kind === "shield") {
        _m3.makeTranslation(0.05, 0.3, 0.45);
        shields.setMatrixAt(counts.shield++, _m.multiplyMatrices(_torso, _m3));
      }
      if (armed && e.kind === "rocket") {
        _m3.makeTranslation(-0.3, 0.68, 0.05);
        launchers.setMatrixAt(counts.launcher++, _m.multiplyMatrices(_torso, _m3));
      }
      const need = s.web;
      if (e.web > 0 || defeated(e)) {
        const full = e.web >= need || defeated(e);
        const k = full ? 1 : 0.45 + (0.4 * e.web) / need;
        _m3.makeScale(0.42 * k * s.bulk, (full ? 0.98 : 0.5) * k, 0.36 * k * s.bulk).setPosition(0, full ? 0.95 : 1.2, 0);
        cocoons.setMatrixAt(counts.cocoon++, _m.multiplyMatrices(_root, _m3));
      }
      if ((e.st === "windup" || e.st === "aim") && e.kind !== "sniper") {
        const left = e.threat.at - now;
        const red = left < 0.25 || e.kind === "brute";
        const pulse = 1 + 0.25 * Math.sin(t * 30);
        _m.compose(_v.set(e.pos.x, e.pos.y + 2.15 * sc, e.pos.z), _q.setFromAxisAngle(UP, t * 4), _s.setScalar(pulse));
        pips.setMatrixAt(counts.pip, _m);
        pips.setColorAt(counts.pip++, red ? _c.setRGB(4, 0.25, 0.2) : _c.setRGB(3, 3, 3));
      }
      if (e.st === "aim") {
        muzzle(e, _v);
        const k = Math.min(1, e.t / s.windup);
        const flash = e.threat.at - now < 0.3;
        const strobe = Math.sin(t * 60) > 0;
        const I = flash ? (strobe ? 6 : 3.5) : (0.6 + 2.6 * k * k) * (0.8 + 0.2 * Math.sin(t * 43 + e.i * 7) * Math.sin(t * 19 + e.i));
        if (flash) line(_v, e.aim, I, I * 0.12, I * 0.08);
        else line(_v, e.aim, I, I * 0.05, I * 0.04);
        if (e.kind === "sniper") drawSniperAim(e, k, I, flash, strobe, t);
      }
      if (e.st === "fire" && e.t < 0.3 && Math.sin(t * 60) > 0) {
        muzzle(e, _v);
        line(_v, _w.copy(e.aim).addScaledVector(_u.subVectors(e.aim, _v).normalize(), 6), 4, 3, 1);
      }
      if (e.st === "down" && e.g) {
        for (let k = 0; k < 2; k++) {
          const a = e.yaw + (k ? 1.7 : -1.7);
          _v.set(e.pos.x, e.g.floorY + 0.3, e.pos.z);
          line(_v, _w.set(e.pos.x + Math.sin(a) * 1.3, e.g.floorY, e.pos.z + Math.cos(a) * 1.3), 2, 2, 2.2);
        }
      }
      if (e.st === "hung") line(e.anchor, e.pos, 2, 2, 2.2);
      if (e.sus > 0.02 && e.g && !e.g.aware && !defeated(e) && counts.sus < MAX_E) drawMeter(e, sc, counts.sus++, t);
      if (e.st === "wall") {
        line(e.center, e.anchor, 2, 2, 2.2);
        line(e.center, _w.copy(e.anchor).setY(e.anchor.y - 1.6), 2, 2, 2.2);
      }
      if (e.kind === "sniper" && !defeated(e) && e.st !== "flying" && e.st !== "launched" && e.st !== "webbed") drawSniperMark(e, sc, t);
      n++;
    }
    torsos.count = heads.count = n;
    legs.count = arms.count = n * 2;
    beanies.count = counts.beanie;
    helmets.count = counts.helmet;
    hoods.count = counts.hood;
    guns.count = counts.gun;
    shields.count = counts.shield;
    launchers.count = counts.launcher;
    rifles.count = counts.rifle;
    visors.count = counts.visor;
    scopes.count = counts.scope;
    marks.count = markN;
    beams.count = beamN;
    susBg.count = susFill.count = counts.sus;
    return counts;
  };

  const drawFx = (dt: number, t: number, counts: { cocoon: number; pip: number }) => {
    let nr = 0;
    let nf = 0;
    let no = 0;
    for (const pr of projs) {
      if (!pr.active) continue;
      if (pr.kind === "rocket") {
        _q.setFromUnitVectors(FWD, _v.copy(pr.vel).normalize());
        rockets.setMatrixAt(nr++, _m.compose(pr.pos, _q, _s.setScalar(1)));
      } else if (pr.kind === "feather") {
        _q.setFromUnitVectors(FWD, _v.copy(pr.vel).normalize());
        feathers.setMatrixAt(nf++, _m.compose(pr.pos, _q, _s.setScalar(1)));
      } else if (no < MAX_P) {
        const size = pr.kind === "blast" ? 0.55 : pr.kind === "bomb" ? 0.32 : 0.16;
        orbs.setMatrixAt(no, _m.compose(pr.pos, _q.identity(), _s.setScalar(size * (1 + 0.15 * Math.sin(t * 40)))));
        orbs.setColorAt(no++, pr.kind === "blast" ? _c.setRGB(1.2, 2.6, 4) : _c.setRGB(2.6, 2.6, 2.8));
        if (pr.kind === "web" || pr.kind === "impact") line(pr.pos, _v.copy(pr.pos).addScaledVector(pr.vel, -0.05), 2.4, 2.4, 2.6);
      }
    }
    rockets.count = nr;
    feathers.count = nf;
    orbs.count = no;
    let nm = 0;
    for (const m of minesList) {
      if (!m.active) continue;
      _m.compose(m.pos, _q.setFromAxisAngle(UP, t * 2), _s.setScalar(1 + (m.t < 0.5 ? 0 : 0.08 * Math.sin(t * 8))));
      mines.setMatrixAt(nm++, _m);
    }
    mines.count = nm;
    let ng = 0;
    for (const x of rings) {
      if (!x.active) continue;
      const f = 1 - x.r / x.maxR;
      _m.compose(_v.copy(x.c).setY(x.c.y + 0.12), _q.identity(), _s.set(x.r, 1, x.r));
      ringMesh.setMatrixAt(ng, _m);
      ringMesh.setColorAt(ng++, _c.copy(x.col).multiplyScalar(f));
    }
    ringMesh.count = ng;
    cocoons.count = counts.cocoon;
    pips.count = counts.pip;
    if (sparksAlive) {
      let alive = 0;
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) continue;
        sparkLife[i] -= dt;
        const k = i * 3;
        if (sparkLife[i] <= 0) {
          sparkPos[k + 1] = -9999;
          continue;
        }
        alive++;
        sparkVel[k + 1] -= G * 0.5 * dt;
        sparkPos[k] += sparkVel[k] * dt;
        sparkPos[k + 1] += sparkVel[k + 1] * dt;
        sparkPos[k + 2] += sparkVel[k + 2] * dt;
        const f = Math.min(1, sparkLife[i] * 3);
        sparkCol[k] = sparkBase[k] * f;
        sparkCol[k + 1] = sparkBase[k + 1] * f;
        sparkCol[k + 2] = sparkBase[k + 2] * f;
      }
      sparksAlive = alive;
      sparks.visible = alive > 0;
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;
    }
    lineGeo.setDrawRange(0, lineN * 2);
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.attributes.color.needsUpdate = true;
    for (const m of allMeshes) {
      m.visible = m.count > 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  let sense: HudState["sense"] = null;
  let stealthOn = false;
  const stealthOut = { hidden: true, alert: 0 };
  const update = (dt: number, t: number, input: Input, player: PlayerApi, camera: THREE.Camera): GameEvent[] => {
    lineN = 0;
    P = player;
    camPos.setFromMatrixPosition(camera.matrixWorld);
    now += dt;
    invuln -= dt;
    comboGap += dt;
    hitsT += dt;
    attackGap -= dt;
    counterT -= dt;
    lookFlat(input, lastLook);
    if (hitsT > 3) hits = 0;
    for (let i = 0; i < GADGETS.length; i++) {
      if (charges[i] >= GADGETS[i].max) continue;
      refill[i] += dt;
      if (refill[i] >= REFILL) {
        refill[i] = 0;
        charges[i]++;
      }
    }
    handleInput(dt, input);
    runAction(dt, input);
    player.busy = act.kind !== "none" && act.kind !== "shoot";
    if (act.kind === "down") downT += dt;
    else downT = 0;

    meleeTokens = 0;
    rangedTokens = 0;
    for (const e of enemies) {
      if (!e.active) continue;
      if (e.st === "windup") meleeTokens++;
      if (e.st === "aim") rangedTokens++;
    }
    for (const e of enemies) if (e.active && e.g) think(e, dt);
    stealthOn = false;
    stealthOut.hidden = true;
    stealthOut.alert = 0;
    const onFoot = player.mode === "ground" || player.mode === "perch" || player.mode === "wall";
    if (onFoot) for (const e of enemies) {
      if (!e.active || !e.g || e.g.aware || defeated(e) || e.pos.distanceToSquared(player.pos) > STEALTH_R * STEALTH_R) continue;
      stealthOn = true;
      if (e.seen) stealthOut.hidden = false;
      stealthOut.alert = Math.max(stealthOut.alert, Math.min(1, e.sus));
    }
    for (const g of groups) {
      if (!g.active) continue;
      if (g.members.every((e) => !e.active)) g.active = false;
      else if (g.members.every((e) => !e.active || defeated(e)) && g.center.distanceTo(player.pos) > 140) clearGroup(g.id);
    }
    bosses.update(dt, t, input);
    updateProjs(dt);
    updateRings(dt);
    updateMines(dt);

    let soon = Infinity;
    for (const th of threats) {
      const k = th.at - now;
      if (k < -0.15) {
        threats.delete(th);
        continue;
      }
      if (k < soon) soon = k;
      if (!th.sensed && k < 0.6) {
        th.sensed = true;
        events.push({ type: "sfx", name: "spiderSense", volume: 0.6 });
      }
    }
    if (soon < 0.6) {
      _v.set(player.pos.x, player.pos.y + 1.1, player.pos.z).project(camera);
      senseOut.level = soon < 0.25 ? "red" : "white";
      senseOut.x = (_v.x + 1) / 2;
      senseOut.y = (1 - _v.y) / 2;
      sense = senseOut;
    } else sense = null;
    const fighting = inCombat();
    if (fighting !== wasInCombat) {
      wasInCombat = fighting;
      if (fighting && !bosses.active()) events.push({ type: "music", state: "combat", duration: 4 });
    }

    const counts = drawEnemies(t);
    bosses.render(dt, t);
    drawFx(dt, t, counts);
    out.length = 0;
    for (const e of events) out.push(e);
    events.length = 0;
    return out;
  };

  const hud = () => {
    const prompts: { key: string; label: string }[] = [];
    const markers: Marker[] = [];
    const p = P;
    if (p) {
      for (const e of enemies) if (e.active && !defeated(e) && e.g?.aware && e.pos.distanceTo(p.pos) < 220) markers.push({ x: e.pos.x, z: e.pos.z, kind: "enemy" });
      bosses.markers(markers);
      bosses.prompts(prompts);
      if (act.kind === "none" && findTakedown()) prompts.push({ key: "F", label: "Takedown" });
      if (act.kind === "none" && prompts.length === 0) {
        _dir.copy(p.facing);
        const fin = pick(7, _dir, -1, (h) => h.finishable() && focus >= h.finishCost());
        if (fin && focus >= 1) prompts.push({ key: "X", label: "Finisher" });
        const near = pick(9, _dir, -1);
        const hint = near?.hint?.();
        if (hint) prompts.push(hint);
      }
      if (health < 0.5 && focus >= 1) prompts.push({ key: "H", label: "Heal" });
      if (dodgeCue && act.kind !== "dodge") prompts.unshift({ key: "Q", label: "Dodge the sniper" });
    }
    const g = GADGETS[gadget];
    return {
      health,
      focus,
      focusMax: FOCUS_MAX,
      inCombat: inCombat(),
      sense: sense ? { ...sense } : null,
      boss: bosses.hud(),
      gadget: { name: g.name, charges: charges[gadget], max: g.max },
      prompts,
      markers,
      combo: hits,
    };
  };

  const strikeTarget = (pos: THREE.Vector3, range: number): THREE.Vector3 | null => {
    let best: Hittable | null = null;
    let bd = range;
    for (const h of targets()) {
      const d = h.center.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best ? best.center : null;
  };

  const nearEnemy = (pos: THREE.Vector3, r: number) => strikeTarget(pos, r) !== null;

  const setDetail = (level: 0 | 1 | 2) => {
    detail = level;
    sparks.visible = level > 0 && sparksAlive > 0;
    (sparks.material as THREE.PointsMaterial).size = SPARK_SIZE[level];
    for (const m of bodyMeshes) m.castShadow = level === 2;
    bosses.setDetail(level);
  };

  const dispose = () => {
    scene.remove(root);
    bosses.dispose();
    dotTex.dispose();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  };

  const takeXp = () => xpQueue.splice(0, xpQueue.length);

  return {
    update,
    hud,
    hurtPlayer: hurt,
    healPlayer: (amount: number) => {
      health = Math.min(1, health + amount);
    },
    spawnGroup,
    groupDone,
    clearGroup,
    groupAlive: (id: number) => {
      const g = groupById(id);
      return g ? g.members.filter((e) => e.active && !defeated(e)).length : 0;
    },
    spawnBoss: (name: BossName, pos: THREE.Vector3) => bosses.start(name, pos),
    bossDone: (id: number) => bosses.done(id),
    bossActive: () => bosses.active(),
    cancelBoss: () => bosses.cancel(),
    strikeTarget,
    nearEnemy,
    takeXp,
    stealth: (): HudState["stealth"] => (stealthOn ? { hidden: stealthOut.hidden, alert: stealthOut.alert } : null),
    setDetail,
    dispose,
  };
}

export type Combat = ReturnType<typeof createCombat>;
