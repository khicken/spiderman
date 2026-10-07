import * as THREE from "three";
import { BLOCKS, HALF, PERIOD, STREET, rng, type Box, type City } from "./city";
import type { GameEvent, HudState, Marker, Objective } from "./contracts";
import type { Combat, EnemyKind } from "./combat";
import { BOSSES, bossArena, type BossName } from "./bosses";
import * as M from "./missions-models";

type Player = { pos: THREE.Vector3; vel: THREE.Vector3; mode: string; camera: THREE.Camera };
export type MissionHud = Pick<HudState, "objective" | "markers" | "progress" | "prompts" | "combo"> & { race: boolean; xp: number };

const G = 24;
const COLLECTIBLES = 30;
const SLOTS = 2;
const CAR_LINES = 8;
const SPARKS = 120;
const BEAM_RACE = 0;
const BEAM_CRIME = 6;
const BEAM_CHASE = 10;
const BEAM_NEXT = 12;
const BEAM_HIDEOUT = 13;
const BEAM_BOSS = 17;
const BEAMS = 23;
const CHASE_HITS = 3;
const SIDEWALK = STREET / 2 + 1.5;
const XP_ITEM = 100;
const XP_CRIME = 250;
const XP_CHASE = 400;
const XP_HIDEOUT = 600;
const MEDALS = ["GOLD", "SILVER", "BRONZE"] as const;
const MEDAL_XP = [600, 400, 250, 100];
const RACES = [
  { name: "Midtown Rush", i: 8, j: 9, di: 0, dj: -1, rings: 12 },
  { name: "Harlem Hustle", i: 3, j: 2, di: 1, dj: 0, rings: 13 },
  { name: "Skyline Sprint", i: 11, j: 6, di: 0, dj: -1, rings: 14 },
];
const CRIMES: { name: string; text: string; kind: EnemyKind; min: number; max: number; mix: Partial<Record<EnemyKind, number>>; roof: boolean; car: boolean }[] = [
  { name: "Mugging", text: "Stop the muggers", kind: "thug", min: 2, max: 4, mix: {}, roof: false, car: false },
  { name: "Store robbery", text: "Armed robbers. Web the gunmen", kind: "gunner", min: 2, max: 2, mix: { thug: 2 }, roof: false, car: false },
  { name: "Rooftop snipers", text: "Take out the sniper squad", kind: "sniper", min: 2, max: 3, mix: { thug: 1, rocket: 1 }, roof: true, car: false },
  { name: "Car theft", text: "Stop the car thieves", kind: "thug", min: 2, max: 3, mix: { shield: 1 }, roof: false, car: true },
];
const WAVES: { kind: EnemyKind; n: number; mix: Partial<Record<EnemyKind, number>> }[] = [
  { kind: "thug", n: 4, mix: {} },
  { kind: "thug", n: 2, mix: { shield: 1, gunner: 1 } },
  { kind: "brute", n: 1, mix: { thug: 2, rocket: 1 } },
];
const BOSS_ORDER: BossName[] = ["kingpin", "shocker", "vulture"];
const PAINT = ["#b01c1c", "#f2f2f2", "#2a4f8f", "#e3b81f", "#7d8288"];

type Crime = { state: "empty" | "active"; kind: number; center: THREE.Vector3; group: number; noticed: boolean; respawnAt: number; farT: number };
type Race = { name: string; start: THREE.Vector3; rings: THREE.Vector3[]; quats: THREE.Quaternion[]; times: number[]; limit: number; best: number; done: boolean };
type Hideout = { pos: THREE.Vector3; state: "idle" | "active" | "done"; wave: number; group: number; waitT: number };
type BossSlot = { name: BossName; pos: THREE.Vector3; state: "locked" | "open" | "active" | "done"; id: number };

const lineAt = (k: number) => -HALF + k * PERIOD;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const inBox = (b: Box, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
const levelNeed = (level: number) => 300 + 200 * level;
const district = (x: number, z: number) => {
  const j = Math.floor((z + HALF) / PERIOD);
  return j <= 1 ? "Harlem" : j <= 5 ? "Upper Manhattan" : j <= 10 ? "Midtown" : "Downtown";
};

export function createMissions(scene: THREE.Scene, city: City, combat: Combat) {
  const r = rng(4242);
  const group = new THREE.Group();
  group.name = "missions";
  scene.add(group);

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const FWD = new THREE.Vector3(0, 0, 1);
  const _m = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _m3 = new THREE.Matrix4();
  const _root = new THREE.Matrix4();
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _c = new THREE.Color();
  const prev = new THREE.Vector3();
  const last = new THREE.Vector3();
  const target = new THREE.Vector3();
  const strikeOut = new THREE.Vector3();

  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, colors = false) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      m.setMatrixAt(i, ZERO);
      if (colors) m.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    group.add(m);
    return m;
  };
  const setColor = (m: THREE.InstancedMesh, i: number, rr: number, g: number, b: number) => {
    m.setColorAt(i, _c.setRGB(rr, g, b));
  };

  const packs = inst(M.backpackGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), COLLECTIBLES);
  const halos = inst(M.haloGeometry(), M.glowMaterial(true), COLLECTIBLES, true);
  const beams = inst(M.beamGeometry(), M.glowMaterial(true, THREE.DoubleSide), BEAMS, true);
  const bases = inst(M.baseRingGeometry(), M.glowMaterial(true, THREE.DoubleSide), BEAMS, true);
  const rings = inst(M.ringGeometry(), M.glowMaterial(false), 14, true);
  const arrow = inst(M.arrowGeometry(), M.glowMaterial(false), 1, true);
  setColor(arrow, 0, 0.5, 1.6, 4);
  const cocoons = inst(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.55, emissive: "#9aa4b8", emissiveIntensity: 0.35, flatShading: true }), 1);
  const cg = M.carGeometries();
  const cars = inst(cg.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 }), 1 + SLOTS, true);
  cars.castShadow = true;
  const carLights = inst(cg.lights, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 1 + SLOTS);
  const hazards = inst(cg.hazards, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff9a1a").multiplyScalar(6), toneMapped: false }), 1 + SLOTS);
  const meshes = [packs, halos, beams, bases, rings, arrow, cocoons, cars, carLights, hazards];

  const linePos = new Float32Array(CAR_LINES * 6).fill(-9999);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage));
  const webs = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(2, 2, 2.2), toneMapped: false }));
  webs.frustumCulled = false;
  group.add(webs);

  const sparkPos = new Float32Array(SPARKS * 3).fill(-9999);
  const sparkCol = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkBase = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.45, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sparks.frustumCulled = false;
  group.add(sparks);
  let sparkNext = 0;
  let sparksAlive = 0;
  let sparksOn = true;

  const burst = (x: number, y: number, z: number, n: number, speed: number, rr: number, g: number, b: number) => {
    if (!sparksOn) return;
    for (let k = 0; k < n; k++) {
      const i = sparkNext;
      sparkNext = (sparkNext + 1) % SPARKS;
      _v.set(r() - 0.5, r() * 0.8 + 0.2, r() - 0.5).normalize().multiplyScalar(speed * (0.4 + r() * 0.6));
      sparkPos[i * 3] = x;
      sparkPos[i * 3 + 1] = y;
      sparkPos[i * 3 + 2] = z;
      sparkVel[i * 3] = _v.x;
      sparkVel[i * 3 + 1] = _v.y;
      sparkVel[i * 3 + 2] = _v.z;
      sparkBase[i * 3] = rr;
      sparkBase[i * 3 + 1] = g;
      sparkBase[i * 3 + 2] = b;
      sparkLife[i] = 0.5 + r() * 0.4;
    }
    sparksAlive = 1;
  };

  const insideAny = (x: number, y: number, z: number, m: number) => city.near(x, z, m + 2).some((b) => inBox(b, x, z, m) && y < b.maxY + m);
  const heightNear = (x: number, z: number, rad: number) => {
    let h = 0;
    for (const b of city.near(x, z, rad)) if (Math.hypot(x - clamp(x, b.minX, b.maxX), z - clamp(z, b.minZ, b.maxZ)) < rad) h = Math.max(h, b.maxY);
    return h;
  };
  const roofBox = (s: THREE.Vector3) => city.near(s.x, s.z, 1).find((b) => inBox(b, s.x, s.z) && Math.abs(b.maxY - s.y) < 0.05) ?? null;
  const shuffled = <T,>(a: T[]) => a.map((v) => [r(), v] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  const streetSpots: THREE.Vector3[] = city.streetSpots.slice();
  if (!streetSpots.length) {
    for (let k = 1; k < BLOCKS; k++) {
      for (let j = 0; j < BLOCKS; j++) {
        const t = lineAt(j) + PERIOD / 2;
        for (const side of [-1, 1]) streetSpots.push(new THREE.Vector3(lineAt(k) + side * SIDEWALK, 0, t), new THREE.Vector3(t, 0, lineAt(k) + side * SIDEWALK));
      }
    }
  }

  const items: { pos: THREE.Vector3; got: boolean; popT: number }[] = [];
  const addItem = (x: number, y: number, z: number) => {
    if (items.length >= COLLECTIBLES || items.some((it) => Math.hypot(it.pos.x - x, it.pos.z - z) < 40)) return;
    items.push({ pos: new THREE.Vector3(x, y, z), got: false, popT: 0 });
  };
  const roofs = shuffled(city.roofSpots.filter((s) => s.y > 14 && s.y < 260));
  for (const s of roofs.slice(0, 40)) {
    const b = roofBox(s);
    if (!b || items.length >= 12) continue;
    addItem(b.minX + 2 + r() * (b.maxX - b.minX - 4), b.maxY + 1.1, b.minZ + 2 + r() * (b.maxZ - b.minZ - 4));
  }
  for (const b of shuffled(city.boxes.filter((b) => b.maxY > 40)).slice(0, 60)) {
    if (items.length >= 20) break;
    const face = Math.floor(r() * 4);
    const y = 12 + r() * (b.maxY - 20);
    const u = r();
    const x = face === 0 ? b.minX - 1 : face === 1 ? b.maxX + 1 : b.minX + 2 + u * (b.maxX - b.minX - 4);
    const z = face === 2 ? b.minZ - 1 : face === 3 ? b.maxZ + 1 : b.minZ + 2 + u * (b.maxZ - b.minZ - 4);
    if (!insideAny(x, y, z, 0.6)) addItem(x, y, z);
  }
  for (let n = 0; n < 40 && items.length < 26; n++) {
    const line = lineAt(1 + Math.floor(r() * (BLOCKS - 1)));
    const t = lineAt(Math.floor(r() * BLOCKS)) + PERIOD / 2;
    const [x, z] = r() < 0.5 ? [line, t] : [t, line];
    addItem(x, clamp(heightNear(x, z, 30) * 0.5, 14, 40), z);
  }
  for (let n = 0; n < 400 && items.length < COLLECTIBLES; n++) {
    const x0 = lineAt(Math.floor(r() * BLOCKS)) + STREET / 2 + 3;
    const z0 = lineAt(Math.floor(r() * BLOCKS)) + STREET / 2 + 3;
    const x = x0 + r() * (PERIOD - STREET - 6);
    const z = z0 + r() * (PERIOD - STREET - 6);
    const close = city.near(x, z, 6).filter((b) => Math.hypot(x - clamp(x, b.minX, b.maxX), z - clamp(z, b.minZ, b.maxZ)) < 4).length;
    if (close >= 2 && !insideAny(x, 1, z, 0.8)) addItem(x, 1.1, z);
  }
  for (const s of roofs) {
    if (items.length >= COLLECTIBLES) break;
    addItem(s.x, s.y + 1.1, s.z);
  }

  const races: Race[] = RACES.map((def) => {
    let gi = def.i;
    let gj = def.j;
    let di = def.di;
    let dj = def.dj;
    const ringsAt: THREE.Vector3[] = [];
    const quats: THREE.Quaternion[] = [];
    const visited = new Set([gi * 100 + gj]);
    const ok = (i: number, j: number) => i >= 1 && i <= BLOCKS - 1 && j >= 1 && j <= BLOCKS - 1;
    const push = (x: number, z: number, dx: number, dz: number) => {
      const n = ringsAt.length;
      const h = n % 5 === 3 ? 9 + r() * 4 : clamp(heightNear(x, z, 30) * (0.35 + r() * 0.3), 10, 58);
      ringsAt.push(new THREE.Vector3(x, h, z));
      quats.push(new THREE.Quaternion().setFromUnitVectors(FWD, _v.set(dx, 0, dz).normalize()));
    };
    while (ringsAt.length < def.rings) {
      const ni = gi + di;
      const nj = gj + dj;
      push((lineAt(gi) + lineAt(ni)) / 2, (lineAt(gj) + lineAt(nj)) / 2, di, dj);
      gi = ni;
      gj = nj;
      visited.add(gi * 100 + gj);
      if (ringsAt.length >= def.rings) break;
      const options = [[di, dj], [dj, -di], [-dj, di]].filter(([a, b]) => ok(gi + a, gj + b) && !visited.has((gi + a) * 100 + gj + b));
      const straight = options.find(([a, b]) => a === di && b === dj);
      const pick = straight && r() < 0.6 ? straight : (options[Math.floor(r() * options.length)] ?? [-di, -dj]);
      if (pick[0] !== di || pick[1] !== dj) {
        push(lineAt(gi), lineAt(gj), di + pick[0], dj + pick[1]);
        di = pick[0];
        dj = pick[1];
      }
    }
    const start = new THREE.Vector3(lineAt(def.i), 0, lineAt(def.j));
    let len = 0;
    let p = start.clone().setY(ringsAt[0].y);
    for (const q of ringsAt) {
      len += p.distanceTo(q);
      p = q;
    }
    const times = [len / 34 + 3, len / 27 + 3, len / 21 + 3].map(Math.round);
    return { name: def.name, start, rings: ringsAt, quats, times, limit: Math.round(len / 15 + 10), best: Infinity, done: false };
  });

  const crimes: Crime[] = Array.from({ length: SLOTS }, (_, i) => ({ state: "empty", kind: 0, center: new THREE.Vector3(), group: 0, noticed: false, respawnAt: i ? 35 : 10, farT: 0 }));
  const roofCandidates = city.roofSpots.filter((s) => s.y > 20 && s.y < 90).map(roofBox).filter((b): b is Box => !!b && b.maxX - b.minX > 14 && b.maxZ - b.minZ > 14);

  const bossSlots: BossSlot[] = BOSS_ORDER.map((name) => ({ name, pos: bossArena(city, name), state: "locked", id: 0 }));
  const hideoutSpots = (() => {
    const out: THREE.Vector3[] = [];
    const far = (s: THREE.Vector3) => out.every((o) => o.distanceTo(s) > 250) && races.every((q) => q.start.distanceTo(s) > 60) && bossSlots.every((b) => Math.hypot(b.pos.x - s.x, b.pos.z - s.z) > 80);
    for (const s of shuffled(streetSpots.filter((s) => s.y < 0.5 && !insideAny(s.x, 1, s.z, 1.5)))) {
      if (out.length >= 3) break;
      if (far(s)) out.push(s.clone());
    }
    return out;
  })();
  const hideouts: Hideout[] = hideoutSpots.map((pos) => ({ pos, state: "idle", wave: 0, group: 0, waitT: 0 }));

  const hideLines = () => {
    linePos.fill(-9999);
    lineGeo.attributes.position.needsUpdate = true;
  };
  const setLine = (i: number, a: THREE.Vector3, b: THREE.Vector3) => {
    a.toArray(linePos, i * 6);
    b.toArray(linePos, i * 6 + 3);
    lineGeo.attributes.position.needsUpdate = true;
  };

  const spawnCrime = (slot: number, avoid: THREE.Vector3) => {
    const c = crimes[slot];
    const kind = Math.floor(r() * CRIMES.length);
    const def = CRIMES[kind];
    let best: THREE.Vector3 | null = null;
    for (let n = 0; n < 60; n++) {
      const b = def.roof ? roofCandidates[Math.floor(r() * roofCandidates.length)] : null;
      if (def.roof && !b) break;
      const s = b ? _w.set((b.minX + b.maxX) / 2, b.maxY, (b.minZ + b.maxZ) / 2) : streetSpots[Math.floor(r() * streetSpots.length)];
      const d = Math.hypot(s.x - avoid.x, s.z - avoid.z);
      const clear =
        crimes.every((o) => o === c || o.state === "empty" || o.center.distanceTo(s) > 150) &&
        races.every((q) => q.start.distanceTo(s) > 40) &&
        hideouts.every((h) => h.pos.distanceTo(s) > 60) &&
        bossSlots.every((q) => Math.hypot(q.pos.x - s.x, q.pos.z - s.z) > 60);
      if (!best || (d > 90 && d < 450 && clear)) {
        best = s.clone();
        if (d > 90 && d < 450 && clear) break;
      }
    }
    if (!best) return;
    c.state = "active";
    c.kind = kind;
    c.center.copy(best);
    c.noticed = false;
    c.farT = 0;
    if (def.car) {
      const kx = Math.round((best.x + HALF) / PERIOD);
      const kz = Math.round((best.z + HALF) / PERIOD);
      const lx = lineAt(kx);
      const lz = lineAt(kz);
      const alongZ = Math.abs(best.x - lx) < Math.abs(best.z - lz);
      if (alongZ) c.center.x = lx + Math.sign(best.x - lx || 1) * 7.5;
      else c.center.z = lz + Math.sign(best.z - lz || 1) * 7.5;
      _e.set(0, alongZ ? 0 : Math.PI / 2, 0, "XYZ");
      _m.makeRotationFromEuler(_e).setPosition(c.center);
      cars.setMatrixAt(1 + slot, _m);
      carLights.setMatrixAt(1 + slot, _m);
      cars.setColorAt(1 + slot, _c.set(PAINT[Math.floor(r() * PAINT.length)]));
    }
    const n = def.min + Math.floor(r() * (def.max - def.min + 1));
    _v.copy(c.center);
    if (def.car) _v.x += 3.5;
    c.group = combat.spawnGroup(def.kind, _v, n, { mix: def.mix });
  };

  const clearCrime = (slot: number) => {
    const c = crimes[slot];
    if (c.group) combat.clearGroup(c.group);
    c.group = 0;
    c.state = "empty";
    cars.setMatrixAt(1 + slot, ZERO);
    carLights.setMatrixAt(1 + slot, ZERO);
    hazards.setMatrixAt(1 + slot, ZERO);
  };

  const chase = { state: "none" as "none" | "active" | "webbed", nextAt: 45, axis: 0, fixed: 0, nextK: 0, dir: 1, s: 0, speed: 0, yaw: 0, pos: new THREE.Vector3(), touched: false, hits: 0, farT: 0, doneT: 0, webbed: false };
  const carTarget = (out: THREE.Vector3) => {
    const line = lineAt(chase.fixed);
    return chase.axis === 0 ? out.set(chase.s, 0, line + 3.5 * chase.dir) : out.set(line - 3.5 * chase.dir, 0, chase.s);
  };
  const carYaw = () => (chase.axis === 0 ? (chase.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : chase.dir > 0 ? 0 : Math.PI);
  const spawnChase = (p: THREE.Vector3, out: GameEvent[]) => {
    let gi = 7;
    let gj = 7;
    for (let n = 0; n < 40; n++) {
      gi = 1 + Math.floor(r() * (BLOCKS - 1));
      gj = 1 + Math.floor(r() * (BLOCKS - 1));
      const d = Math.hypot(lineAt(gi) - p.x, lineAt(gj) - p.z);
      if (d > 180 && d < 380) break;
    }
    chase.axis = r() < 0.5 ? 0 : 1;
    const along = chase.axis === 0 ? gi : gj;
    chase.fixed = chase.axis === 0 ? gj : gi;
    chase.s = lineAt(along);
    const away = chase.axis === 0 ? lineAt(gi) - p.x : lineAt(gj) - p.z;
    chase.dir = away >= 0 ? 1 : -1;
    chase.nextK = along + chase.dir;
    chase.state = "active";
    chase.speed = 24;
    chase.touched = false;
    chase.hits = 0;
    chase.farT = 0;
    chase.yaw = carYaw();
    carTarget(chase.pos);
    cars.setColorAt(0, _c.set("#15171c"));
    out.push({ type: "sfx", name: "siren" }, { type: "toast", title: "GETAWAY CAR", text: "Chase down the fleeing car" });
  };
  const steer = () => {
    const ok = (k: number) => k >= 0 && k <= BLOCKS;
    const straight = ok(chase.nextK + chase.dir);
    const turnL = ok(chase.fixed - 1);
    const turnR = ok(chase.fixed + 1);
    if (straight && (r() < 0.55 || (!turnL && !turnR))) {
      chase.nextK += chase.dir;
      return;
    }
    const dir = turnL && turnR ? (r() < 0.5 ? -1 : 1) : turnL ? -1 : 1;
    const at = chase.nextK;
    chase.s = lineAt(chase.fixed);
    chase.nextK = chase.fixed + dir;
    chase.fixed = at;
    chase.axis = 1 - chase.axis;
    chase.dir = dir;
  };
  const webCar = () => {
    _e.set(0, chase.yaw, 0, "XYZ");
    _root.makeRotationFromEuler(_e).setPosition(chase.pos);
    let n = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        target.set(sx * 0.7, 1.5, sz * 1.2).applyMatrix4(_root);
        setLine(n++, target, _w.set(sx * 4, 0, sz * 2.8).applyMatrix4(_root));
        setLine(n++, target, _w.set(sx * 1.5, 0, sz * 5.5).applyMatrix4(_root));
      }
    }
  };

  let xp = 0;
  let level = 1;
  let levelXp = 0;
  let combo = 0;
  let now = 0;
  let started = false;
  const completed = { races: 0, crimes: 0, chases: 0, hideouts: 0, bosses: 0 };
  const award = (out: GameEvent[], amount: number, reason: string) => {
    xp = Math.max(0, xp + amount);
    levelXp = Math.max(0, levelXp + amount);
    out.push({ type: "xp", amount, reason });
    while (levelXp >= levelNeed(level)) {
      levelXp -= levelNeed(level);
      level++;
      out.push({ type: "sfx", name: "levelUp" }, { type: "toast", title: "LEVEL UP", text: `Level ${level}` });
    }
  };

  const race = { state: "idle" as "idle" | "countdown" | "running", idx: 0, t: 0, count: 0, next: 0, popI: -1, popT: 0, latch: -1 };
  const segDist = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    _v.subVectors(b, a);
    const l2 = _v.lengthSq();
    const k = l2 > 1e-9 ? clamp(_w.subVectors(c, a).dot(_v) / l2, 0, 1) : 0;
    return _w.copy(a).addScaledVector(_v, k).distanceTo(c);
  };
  const medalFor = (q: Race, time: number) => q.times.findIndex((m) => time <= m);

  const events: GameEvent[] = [];
  const busy = () => race.state !== "idle" || combat.bossActive() || hideouts.some((h) => h.state === "active");

  const updateRace = (p: Player, dt: number) => {
    if (race.latch >= 0 && Math.hypot(p.pos.x - races[race.latch].start.x, p.pos.z - races[race.latch].start.z) > 8) race.latch = -1;
    if (race.state === "idle") {
      if (chase.state === "active" || busy()) return;
      for (let i = 0; i < races.length; i++) {
        const s = races[i].start;
        if (i !== race.latch && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 5 && p.pos.y < 120) {
          race.state = "countdown";
          race.idx = i;
          race.t = 0;
          race.count = 3;
          race.next = 0;
          race.latch = i;
          events.push({ type: "sfx", name: "start" }, { type: "toast", title: races[i].name, text: "Swing race" }, { type: "sfx", name: "countdown" }, { type: "toast", title: "3" }, { type: "music", state: "race", duration: 3 });
          return;
        }
      }
      return;
    }
    const q = races[race.idx];
    race.t += dt;
    if (race.state === "countdown") {
      const step = 3 - Math.floor(race.t);
      if (step < race.count && step > 0) {
        race.count = step;
        events.push({ type: "sfx", name: "countdown" }, { type: "toast", title: String(step) });
      }
      if (race.t >= 3) {
        race.state = "running";
        race.t = 0;
        events.push({ type: "sfx", name: "go" }, { type: "toast", title: "GO!" });
      }
      return;
    }
    if (segDist(prev, p.pos, q.rings[race.next]) < M.RING_R + 1.5) {
      const ring = q.rings[race.next];
      burst(ring.x, ring.y, ring.z, 18, 14, 0.6, 1.6, 4);
      race.popI = race.next;
      race.popT = 0;
      race.next++;
      events.push({ type: "sfx", name: "checkpoint" });
      if (race.next >= q.rings.length) {
        const medal = medalFor(q, race.t);
        const best = race.t < q.best;
        q.best = Math.min(q.best, race.t);
        if (!q.done) completed.races++;
        q.done = true;
        race.state = "idle";
        events.push({ type: "sfx", name: "complete" }, { type: "toast", title: "RACE COMPLETE", text: `${medal >= 0 ? MEDALS[medal] + "  " : ""}${fmt(race.t)}${best ? "  New best" : ""}` });
        award(events, MEDAL_XP[medal >= 0 ? medal : 3], `${q.name} ${medal >= 0 ? MEDALS[medal].toLowerCase() : "finish"}`);
        return;
      }
    }
    if (race.t > q.limit) {
      race.state = "idle";
      events.push({ type: "sfx", name: "fail" }, { type: "toast", title: "RACE FAILED", text: "Out of time" });
    }
  };

  const carClear: { slot: number; at: number }[] = [];
  const updateCrimes = (p: Player, dt: number) => {
    for (let s = 0; s < SLOTS; s++) {
      const c = crimes[s];
      if (c.state === "empty") {
        if (now >= c.respawnAt && !combat.bossActive()) spawnCrime(s, p.pos);
        continue;
      }
      const d = c.center.distanceTo(p.pos);
      if (!c.noticed && d < 90) {
        c.noticed = true;
        events.push({ type: "sfx", name: "start" }, { type: "toast", title: "CRIME IN PROGRESS", text: CRIMES[c.kind].text });
      }
      c.farT = d > 600 ? c.farT + dt : 0;
      if (c.farT > 60) {
        clearCrime(s);
        c.respawnAt = now + 10;
        continue;
      }
      if (combat.groupDone(c.group)) {
        c.respawnAt = now + 45 + r() * 45;
        completed.crimes++;
        events.push({ type: "sfx", name: "complete" }, { type: "sfx", name: "cheer" }, { type: "toast", title: "CRIME STOPPED", text: CRIMES[c.kind].name });
        award(events, XP_CRIME, CRIMES[c.kind].name);
        c.group = 0;
        c.state = "empty";
        hazards.setMatrixAt(1 + s, ZERO);
        if (CRIMES[c.kind].car) carClear.push({ slot: s, at: now + 20 });
      }
    }
    for (let k = carClear.length - 1; k >= 0; k--) {
      const cc = carClear[k];
      if (now < cc.at || crimes[cc.slot].state === "active") {
        if (crimes[cc.slot].state === "active") carClear.splice(k, 1);
        continue;
      }
      cars.setMatrixAt(1 + cc.slot, ZERO);
      carLights.setMatrixAt(1 + cc.slot, ZERO);
      carClear.splice(k, 1);
    }
  };

  const updateHideouts = (p: Player, dt: number) => {
    for (const h of hideouts) {
      if (h.state === "done") continue;
      const d = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
      if (h.state === "idle") {
        if (d < 18 && p.pos.y < 8 && !busy()) {
          h.state = "active";
          h.wave = 0;
          h.waitT = 1.5;
          events.push({ type: "sfx", name: "start" }, { type: "toast", title: "HIDEOUT", text: "Survive three waves" }, { type: "music", state: "combat", duration: 4 });
        }
        continue;
      }
      if (d > 120) {
        if (h.group) combat.clearGroup(h.group);
        h.group = 0;
        h.state = "idle";
        events.push({ type: "sfx", name: "fail" }, { type: "toast", title: "HIDEOUT ABANDONED", text: "Come back to finish it" });
        continue;
      }
      if (h.group && !combat.groupDone(h.group)) continue;
      if (h.group) {
        h.group = 0;
        if (h.wave >= WAVES.length) {
          h.state = "done";
          completed.hideouts++;
          events.push({ type: "sfx", name: "complete" }, { type: "toast", title: "HIDEOUT CLEARED", text: `+${XP_HIDEOUT} XP` });
          award(events, XP_HIDEOUT, "Hideout cleared");
          continue;
        }
        h.waitT = 2;
      }
      h.waitT -= dt;
      if (h.waitT > 0) continue;
      const w = WAVES[h.wave];
      h.wave++;
      h.group = combat.spawnGroup(w.kind, h.pos, w.n, { mix: w.mix, aware: true, radius: 7 });
      events.push({ type: "sfx", name: "start" }, { type: "toast", title: `WAVE ${h.wave}`, text: h.wave === 3 ? "A brute is coming" : "Enemies incoming" });
    }
  };

  const updateBosses = (p: Player) => {
    for (const b of bossSlots) {
      if (b.state === "locked" && level >= BOSSES[b.name].level) {
        b.state = "open";
        events.push({ type: "sfx", name: "ping" }, { type: "toast", title: "NEW BOSS", text: `${BOSSES[b.name].name} at ${BOSSES[b.name].place}` });
      }
      if (b.state === "open" && !busy()) {
        if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < 30 && p.pos.y > b.pos.y - 4 && p.pos.y < b.pos.y + 40) {
          b.id = combat.spawnBoss(b.name, b.pos);
          b.state = "active";
        }
      }
      if (b.state === "active" && combat.bossDone(b.id)) {
        b.state = "done";
        completed.bosses++;
      }
    }
  };

  const updateChase = (p: Player, dt: number) => {
    if (chase.state === "none") {
      if (now >= chase.nextAt && !busy()) spawnChase(p.pos, events);
      return;
    }
    if (chase.state === "webbed") {
      chase.speed = Math.max(0, chase.speed - 30 * dt);
      if (chase.speed > 0) {
        chase.pos.x += Math.sin(chase.yaw) * chase.speed * dt;
        chase.pos.z += Math.cos(chase.yaw) * chase.speed * dt;
      } else if (!chase.webbed) {
        chase.webbed = true;
        webCar();
      }
      chase.doneT += dt;
      if (chase.doneT > 25) {
        chase.state = "none";
        chase.nextAt = now + 90;
        hideLines();
      }
      return;
    }
    const d = chase.pos.distanceTo(p.pos);
    const speed = (d < 40 ? 30 : 24) * (1 - 0.22 * chase.hits);
    let move = speed * dt;
    while (move > 0) {
      const remain = (lineAt(chase.nextK) - chase.s) * chase.dir;
      if (move < remain) {
        chase.s += move * chase.dir;
        break;
      }
      chase.s = lineAt(chase.nextK);
      move -= Math.max(remain, 0);
      steer();
      if (move < 0.01) break;
    }
    chase.speed = speed;
    carTarget(_v);
    chase.pos.lerp(_v, 1 - Math.exp(-10 * dt));
    chase.yaw = turn(chase.yaw, carYaw(), dt * 7);
    if (!chase.touched && _w.copy(chase.pos).setY(1).distanceTo(p.pos) < 4) {
      chase.touched = true;
      events.push({ type: "sfx", name: "hit" }, { type: "toast", title: "HANG ON!", text: `Land ${CHASE_HITS} web strikes` });
    }
    chase.farT = d > 400 ? chase.farT + dt : 0;
    if (chase.farT > 10) {
      chase.state = "none";
      chase.nextAt = now + 60;
      events.push({ type: "sfx", name: "fail" }, { type: "toast", title: "CAR ESCAPED", text: "The getaway car got away" });
    }
  };

  const updateSparks = (dt: number) => {
    if (!sparksAlive) return;
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
      sparkVel[k + 1] -= G * 0.6 * dt;
      sparkPos[k] += sparkVel[k] * dt;
      sparkPos[k + 1] += sparkVel[k + 1] * dt;
      sparkPos[k + 2] += sparkVel[k + 2] * dt;
      const f = Math.min(1, sparkLife[i] * 2);
      sparkCol[k] = sparkBase[k] * f;
      sparkCol[k + 1] = sparkBase[k + 1] * f;
      sparkCol[k + 2] = sparkBase[k + 2] * f;
    }
    sparksAlive = alive;
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;
  };

  const setBeam = (i: number, x: number, y: number, z: number, rad: number, h: number, rr: number, g: number, b: number) => {
    _m.makeScale(rad, h, rad).setPosition(x, y, z);
    beams.setMatrixAt(i, _m);
    setColor(beams, i, rr, g, b);
  };
  const setBase = (i: number, x: number, y: number, z: number, rad: number, spin: number, rr: number, g: number, b: number) => {
    _e.set(0, spin, 0, "XYZ");
    _m.makeRotationFromEuler(_e).scale(_s.setScalar(rad)).setPosition(x, y + 0.08, z);
    bases.setMatrixAt(i, _m);
    setColor(bases, i, rr, g, b);
  };
  const hideBeam = (i: number) => {
    beams.setMatrixAt(i, ZERO);
    bases.setMatrixAt(i, ZERO);
  };
  const pillar = (i: number, x: number, y: number, z: number, wide: number, k: number, rr: number, g: number, b: number, spin: number) => {
    setBeam(i, x, y, z, wide, 400, rr * 0.35 * k, g * 0.35 * k, b * 0.35 * k);
    setBeam(i + 1, x, y, z, wide * 0.28, 400, rr, g, b);
    setBase(i, x, y, z, wide * 1.4, spin, rr, g, b);
  };

  const render = (p: Player, dt: number, t: number) => {
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);
    p.camera.getWorldQuaternion(_q);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.got && it.popT > 0.4) {
        packs.setMatrixAt(i, ZERO);
        halos.setMatrixAt(i, ZERO);
        continue;
      }
      if (it.got) it.popT += dt;
      const pop = it.got ? 1 + it.popT * 4 : 1;
      _e.set(0, t * 2 + i, 0, "XYZ");
      _m.makeRotationFromEuler(_e).scale(_s.setScalar(1.3 * (it.got ? Math.max(0, 1 - it.popT * 2.5) : 1))).setPosition(it.pos.x, it.pos.y + Math.sin(t * 2 + i) * 0.3, it.pos.z);
      packs.setMatrixAt(i, _m);
      _m.compose(_v.set(it.pos.x, it.pos.y + Math.sin(t * 2 + i) * 0.3, it.pos.z), _q, _s.setScalar(1.8 * pop));
      halos.setMatrixAt(i, _m);
      const f = (it.got ? Math.max(0, 1 - it.popT * 2.5) : 1) * (0.8 + 0.2 * Math.sin(t * 3 + i));
      setColor(halos, i, 1.6 * f, 0.15 * f, 0.18 * f);
    }

    const racing = race.state !== "idle";
    for (let i = 0; i < races.length; i++) {
      const s = races[i].start;
      if (racing || busy()) {
        hideBeam(BEAM_RACE + i * 2);
        hideBeam(BEAM_RACE + i * 2 + 1);
        continue;
      }
      pillar(BEAM_RACE + i * 2, s.x, 0, s.z, 4.5, pulse, 0.4, 1.2, 4, t);
    }
    for (let s = 0; s < SLOTS; s++) {
      const c = crimes[s];
      if (CRIMES[c.kind].car && c.state === "active") {
        cars.getMatrixAt(1 + s, _m);
        hazards.setMatrixAt(1 + s, Math.sin(t * 9) > 0 ? _m : ZERO);
      }
      if (c.state !== "active" || combat.bossActive()) {
        hideBeam(BEAM_CRIME + s * 2);
        hideBeam(BEAM_CRIME + s * 2 + 1);
        continue;
      }
      const k = 0.6 + 0.4 * Math.sin(t * 6 + s);
      pillar(BEAM_CRIME + s * 2, c.center.x, c.center.y, c.center.z, 5, k, 4 * k, 0.3, 0.25, -t);
    }
    for (let i = 0; i < 2; i++) {
      const h = hideouts[i];
      if (!h || h.state !== "idle" || busy()) {
        hideBeam(BEAM_HIDEOUT + i * 2);
        hideBeam(BEAM_HIDEOUT + i * 2 + 1);
        continue;
      }
      pillar(BEAM_HIDEOUT + i * 2, h.pos.x, 0, h.pos.z, 5, pulse, 3.6, 0.9, 3.2, t * 0.7);
    }
    bossSlots.forEach((b, i) => {
      if (b.state !== "open" || busy()) {
        hideBeam(BEAM_BOSS + i * 2);
        hideBeam(BEAM_BOSS + i * 2 + 1);
        return;
      }
      pillar(BEAM_BOSS + i * 2, b.pos.x, b.pos.y, b.pos.z, 7, pulse, 4, 2.6, 0.5, -t * 0.5);
    });

    if (chase.state === "none") {
      cars.setMatrixAt(0, ZERO);
      carLights.setMatrixAt(0, ZERO);
      hazards.setMatrixAt(0, ZERO);
      cocoons.setMatrixAt(0, ZERO);
      hideBeam(BEAM_CHASE);
      hideBeam(BEAM_CHASE + 1);
    } else {
      _e.set(0, chase.yaw, 0, "XYZ");
      _m.makeRotationFromEuler(_e).setPosition(chase.pos);
      cars.setMatrixAt(0, _m);
      carLights.setMatrixAt(0, _m);
      hazards.setMatrixAt(0, Math.sin(t * 10) > 0 ? _m : ZERO);
      if (chase.state === "webbed") {
        _m3.makeScale(1.15, 0.4, 1.9).setPosition(0, 1.45, -0.2);
        cocoons.setMatrixAt(0, _m2.multiplyMatrices(_m, _m3));
        hideBeam(BEAM_CHASE);
        hideBeam(BEAM_CHASE + 1);
      } else {
        cocoons.setMatrixAt(0, ZERO);
        setBeam(BEAM_CHASE, chase.pos.x, 0, chase.pos.z, 3, 260, 1.6 * pulse, 0.6 * pulse, 0.05);
        setBeam(BEAM_CHASE + 1, chase.pos.x, 0, chase.pos.z, 0.8, 260, 4, 1.6, 0.2);
      }
    }

    const q = races[race.idx];
    for (let i = 0; i < 14; i++) {
      const ring = racing ? q.rings[i] : undefined;
      if (!ring) {
        rings.setMatrixAt(i, ZERO);
        continue;
      }
      let scale = 0;
      let k = 0;
      if (i === race.next) {
        scale = 1 + 0.06 * Math.sin(t * 6);
        k = 1;
      } else if (i === race.next + 1) {
        scale = 1;
        k = 0.25;
      } else if (i === race.popI && race.popT < 0.35) {
        scale = 1 + race.popT * 3;
        k = 1 - race.popT / 0.35;
      }
      rings.setMatrixAt(i, scale ? _m.compose(ring, q.quats[i], _s.setScalar(scale)) : ZERO);
      setColor(rings, i, 0.5 * k, 1.7 * k, 4.2 * k);
    }
    race.popT += dt;
    const next = racing ? q.rings[race.next] : undefined;
    if (next) {
      setBeam(BEAM_NEXT, next.x, 0, next.z, 0.6, 400, 0.3, 0.9, 2.6);
      _v.set(p.pos.x, p.pos.y + 2.4, p.pos.z);
      _m.lookAt(next, _v, UP).scale(_s.setScalar(1 + 0.15 * Math.sin(t * 8))).setPosition(_v);
      arrow.setMatrixAt(0, _m);
    } else {
      hideBeam(BEAM_NEXT);
      arrow.setMatrixAt(0, ZERO);
    }

    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  };

  const update = (dt: number, t: number, p: Player): GameEvent[] => {
    events.length = 0;
    now += dt;
    if (!started) {
      started = true;
      prev.copy(p.pos);
    }
    if (p.mode === "ground") combo = 0;
    for (const x of combat.takeXp()) award(events, x.amount, x.reason);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.got || segDist(prev, p.pos, it.pos) > 3.2) continue;
      it.got = true;
      it.popT = 0;
      burst(it.pos.x, it.pos.y, it.pos.z, 20, 8, 3, 0.3, 0.3);
      const n = items.filter((x) => x.got).length;
      events.push({ type: "sfx", name: "collect" }, { type: "toast", title: "BACKPACK FOUND", text: `${n}/${items.length}` });
      award(events, XP_ITEM, "Backpack");
    }
    updateRace(p, dt);
    updateCrimes(p, dt);
    updateHideouts(p, dt);
    updateBosses(p);
    updateChase(p, dt);
    updateSparks(dt);
    render(p, dt, t);
    prev.copy(p.pos);
    last.copy(p.pos);
    return events;
  };

  const strikeTarget = (pos: THREE.Vector3, range: number): THREE.Vector3 | null => {
    if (chase.state !== "active") return null;
    strikeOut.copy(chase.pos).setY(1);
    return strikeOut.distanceTo(pos) < range ? strikeOut : null;
  };

  const strike = (pos: THREE.Vector3, power: number): GameEvent[] => {
    const out: GameEvent[] = [];
    if (chase.state !== "active" || _v.copy(chase.pos).setY(1).distanceTo(pos) > (power >= 2 ? 6 : 3.5) + 2.5) return out;
    chase.touched = true;
    chase.hits++;
    burst(_v.x, _v.y + 0.6, _v.z, 26, 12, 4, 1.8, 0.4);
    out.push({ type: "sfx", name: "hit" }, { type: "shake", strength: 0.25 * power });
    if (chase.hits >= CHASE_HITS) {
      chase.state = "webbed";
      chase.webbed = false;
      chase.doneT = 0;
      completed.chases++;
      out.push({ type: "sfx", name: "complete" }, { type: "toast", title: "CHASE COMPLETE", text: `+${XP_CHASE} XP` });
      award(out, XP_CHASE, "Getaway car stopped");
    }
    return out;
  };

  const trick = (kind: "flip" | "spin", airTime: number): GameEvent[] => {
    const out: GameEvent[] = [];
    combo++;
    const mult = Math.min(combo, 5);
    award(out, Math.round((kind === "flip" ? 20 : 15) + airTime * 10) * mult, mult > 1 ? `Style x${mult}` : "Style");
    if (combo === 3 || combo === 5) out.push({ type: "toast", title: `STYLE x${mult}` });
    return out;
  };

  const districts = () => {
    const tally = new Map<string, [number, number]>();
    const add = (x: number, z: number, done: boolean) => {
      const k = district(x, z);
      const v = tally.get(k) ?? [0, 0];
      v[0] += done ? 1 : 0;
      v[1]++;
      tally.set(k, v);
    };
    for (const it of items) add(it.pos.x, it.pos.z, it.got);
    for (const q of races) add(q.start.x, q.start.z, q.done);
    for (const h of hideouts) add(h.pos.x, h.pos.z, h.state === "done");
    for (const b of bossSlots) add(b.pos.x, b.pos.z, b.state === "done");
    return ["Harlem", "Upper Manhattan", "Midtown", "Downtown"].filter((n) => tally.has(n)).map((name) => {
      const [d, n] = tally.get(name)!;
      return { name, pct: Math.round((100 * d) / n) };
    });
  };

  const hud = (): MissionHud => {
    const markers: Marker[] = [];
    const prompts: { key: string; label: string }[] = [];
    const near = (x: number, z: number, d: number) => Math.hypot(x - last.x, z - last.z) < d;
    let objective: Objective | null = null;
    if (race.state === "idle") {
      for (const q of races) {
        markers.push({ x: q.start.x, z: q.start.z, kind: "race" });
        if (!busy() && !prompts.length && near(q.start.x, q.start.z, 60)) prompts.push({ key: "", label: `Enter the beam: ${q.name}` });
      }
    } else {
      const q = races[race.idx];
      const n = q.rings[race.next];
      markers.push({ x: n.x, z: n.z, kind: "checkpoint" });
      const medal = race.state === "running" ? medalFor(q, race.t) : 0;
      objective = {
        title: q.name,
        text: race.state === "countdown" ? "Get ready" : "Swing through the rings",
        timer: race.state === "running" ? race.t : 0,
        progress: `${race.next}/${q.rings.length}`,
        medal: medal >= 0 ? `${MEDALS[medal]} ${fmt(q.times[medal])}` : `Limit ${fmt(q.limit)}`,
      };
    }
    for (const b of bossSlots) {
      if (b.state === "open") {
        markers.push({ x: b.pos.x, z: b.pos.z, kind: "boss" });
        if (!objective && near(b.pos.x, b.pos.z, 150)) objective = { title: BOSSES[b.name].name, text: `Reach ${BOSSES[b.name].place}` };
      }
      if (b.state === "active" && !objective) objective = { title: BOSSES[b.name].name, text: BOSSES[b.name].intro };
    }
    for (const h of hideouts) {
      if (h.state === "idle") {
        markers.push({ x: h.pos.x, z: h.pos.z, kind: "hideout" });
        if (!objective && near(h.pos.x, h.pos.z, 80)) objective = { title: "Hideout", text: "Step in to start the fight" };
      }
      if (h.state === "active") {
        objective = { title: "Hideout", text: h.group ? "Defeat every enemy" : "Next wave incoming", progress: `Wave ${Math.max(1, h.wave)}/${WAVES.length}` };
      }
    }
    let closest = Infinity;
    for (const c of crimes) {
      if (c.state !== "active") continue;
      markers.push({ x: c.center.x, z: c.center.z, kind: "crime" });
      const d = Math.hypot(c.center.x - last.x, c.center.z - last.z);
      if (!objective && d < 120 && d < closest) {
        closest = d;
        const left = combat.groupAlive(c.group);
        objective = { title: CRIMES[c.kind].name, text: CRIMES[c.kind].text, progress: `${left} left` };
      }
    }
    if (chase.state === "active") {
      markers.push({ x: chase.pos.x, z: chase.pos.z, kind: "chase" });
      if (race.state === "idle" && !combat.bossActive() && (chase.touched || closest > 60))
        objective = {
          title: "Getaway Car",
          text: chase.farT > 0 ? "The car is escaping" : chase.touched ? "Web-strike the car" : "Catch the car",
          progress: `${chase.hits}/${CHASE_HITS} hits`,
          timer: chase.farT > 0 ? 10 - chase.farT : undefined,
        };
    }
    for (const it of items) if (!it.got && near(it.pos.x, it.pos.z, 250)) markers.push({ x: it.pos.x, z: it.pos.z, kind: "collectible" });
    return {
      race: race.state !== "idle",
      xp,
      objective,
      markers,
      prompts: objective ? [] : prompts,
      combo: combo > 1 ? Math.min(combo, 5) : 0,
      progress: {
        level,
        levelProgress: levelXp / levelNeed(level),
        collected: items.filter((it) => it.got).length,
        totalCollectibles: items.length,
        completed: { ...completed },
        districts: districts(),
      },
    };
  };

  const setDetail = (lvl: 0 | 1 | 2) => {
    halos.visible = lvl > 0;
    bases.visible = lvl > 0;
    sparksOn = lvl > 0;
    sparks.visible = lvl > 0;
    webs.visible = lvl > 0;
  };

  const dispose = () => {
    scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  };

  const addXp = (amount: number, reason: string): GameEvent[] => {
    const out: GameEvent[] = [];
    award(out, amount, reason);
    return out;
  };

  return { update, hud, strikeTarget, strike, trick, addXp, setDetail, dispose, debug: { races, crimes, items, chase, hideouts, bossSlots } };
}

export type Missions = ReturnType<typeof createMissions>;
