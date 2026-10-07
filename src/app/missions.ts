import * as THREE from "three";
import { BLOCKS, HALF, PERIOD, STREET, rng, type Box, type City } from "./city";
import * as M from "./missions-models";

export type MissionEvent =
  | { type: "sfx"; name: "collect" | "checkpoint" | "hit" | "ko" | "complete" | "fail" | "start" | "levelUp" | "countdown" | "go" | "siren" }
  | { type: "toast"; title: string; text?: string }
  | { type: "xp"; amount: number; reason: string }
  | { type: "shake"; strength: number };
export type Marker = { x: number; z: number; kind: "race" | "crime" | "chase" | "collectible" | "checkpoint" | "enemy" };
export type MissionHud = {
  xp: number;
  level: number;
  levelProgress: number;
  activity: null | { title: string; objective: string; timer?: number; progress?: string; medal?: string };
  collected: number;
  totalCollectibles: number;
  completed: { races: number; crimes: number; chases: number };
  markers: Marker[];
  nearPrompt?: string;
  combo?: number;
};
type Player = { pos: THREE.Vector3; vel: THREE.Vector3; mode: string; camera: THREE.Camera };

const G = 24;
const COLLECTIBLES = 30;
const SLOTS = 3;
const CREW = 6;
const MAX_THUGS = SLOTS * CREW;
const CAR_COCOON = MAX_THUGS;
const LINES_PER_THUG = 3;
const CAR_LINES = 8;
const LINES = MAX_THUGS * LINES_PER_THUG + CAR_LINES;
const SPARKS = 120;
const BEAM_RACE = 0;
const BEAM_CRIME = 6;
const BEAM_CHASE = 12;
const BEAM_NEXT = 14;
const BEAMS = 15;
const CHASE_HITS = 3;
const SIDEWALK = STREET / 2 + 1.5;
const XP_ITEM = 100;
const XP_TAKEDOWN = 25;
const XP_CRIME = 250;
const XP_CHASE = 400;
const MEDALS = ["GOLD", "SILVER", "BRONZE"] as const;
const MEDAL_XP = [600, 400, 250, 100];
const RACES = [
  { name: "Midtown Rush", i: 8, j: 9, di: 0, dj: -1, rings: 12 },
  { name: "Harlem Hustle", i: 3, j: 2, di: 1, dj: 0, rings: 13 },
  { name: "Skyline Sprint", i: 11, j: 6, di: 0, dj: -1, rings: 14 },
];
const CRIMES = [
  { name: "Car theft", roof: false, min: 3, max: 4, car: true },
  { name: "Robbery", roof: false, min: 3, max: 5, car: false },
  { name: "Armed thugs on a rooftop", roof: true, min: 4, max: 6, car: false },
];
const JACKETS = ["#2b2f3a", "#6a1f1f", "#2f4a2a", "#3a3d6b", "#6b4a1f", "#4a4a4a", "#5b2a5e"];
const BEANIES = ["#c62828", "#1d1d1f", "#1565c0", "#f9a825", "#2e7d32", "#e0e0e0"];
const SKINS = ["#e0b89a", "#a36f4f", "#6b4430", "#c99476"];
const PAINT = ["#b01c1c", "#f2f2f2", "#2a4f8f", "#e3b81f", "#7d8288"];

type ThugState = "idle" | "alert" | "punch" | "flee" | "flying" | "down";
type Thug = { active: boolean; state: ThugState; pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; tilt: number; phase: number; punchT: number; coward: boolean; fled: boolean };
type Crime = { state: "empty" | "active" | "cleared"; kind: number; center: THREE.Vector3; ground: number; count: number; noticed: boolean; near: Box[]; roof: Box | null; respawnAt: number };
type Race = { name: string; start: THREE.Vector3; rings: THREE.Vector3[]; quats: THREE.Quaternion[]; times: number[]; limit: number; best: number; done: boolean };

const lineAt = (k: number) => -HALF + k * PERIOD;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const inBox = (b: Box, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const turn = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, k);
const levelNeed = (level: number) => 300 + 200 * level;

export function createMissions(scene: THREE.Scene, city: City) {
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
  const _torso = new THREE.Matrix4();
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
  const tg = M.thugGeometries();
  const lit = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const torsos = inst(tg.torso, lit("#ffffff"), MAX_THUGS, true);
  const heads = inst(tg.head, lit("#ffffff", 0.6), MAX_THUGS, true);
  const beanies = inst(tg.beanie, lit("#ffffff", 0.9), MAX_THUGS, true);
  const legs = inst(tg.leg, lit("#24262c"), MAX_THUGS * 2);
  const arms = inst(tg.arm, lit("#ffffff"), MAX_THUGS * 2, true);
  const cocoons = inst(tg.cocoon, new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.55, emissive: "#9aa4b8", emissiveIntensity: 0.35, flatShading: true }), MAX_THUGS + 1);
  for (const m of [torsos, heads, beanies, legs, arms, cocoons]) m.castShadow = true;
  const cg = M.carGeometries();
  const cars = inst(cg.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 }), 1 + SLOTS, true);
  cars.castShadow = true;
  const carLights = inst(cg.lights, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 1 + SLOTS);
  const hazards = inst(cg.hazards, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff9a1a").multiplyScalar(6), toneMapped: false }), 1 + SLOTS);
  const meshes = [packs, halos, beams, bases, rings, arrow, torsos, heads, beanies, legs, arms, cocoons, cars, carLights, hazards];

  const linePos = new Float32Array(LINES * 6).fill(-9999);
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
  const streetSpots: THREE.Vector3[] = (city as unknown as { streetSpots?: THREE.Vector3[] }).streetSpots?.slice() ?? [];
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

  const thugs: Thug[] = Array.from({ length: MAX_THUGS }, () => ({ active: false, state: "idle", pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, tilt: 0, phase: 0, punchT: 0, coward: false, fled: false }));
  const crimes: Crime[] = Array.from({ length: SLOTS }, (_, i) => ({ state: "empty", kind: 0, center: new THREE.Vector3(), ground: 0, count: 0, noticed: false, near: [], roof: null, respawnAt: i < 2 ? 0 : 20 }));
  const roofCandidates = city.roofSpots.filter((s) => s.y > 20 && s.y < 90).map(roofBox).filter((b): b is Box => !!b && b.maxX - b.minX > 14 && b.maxZ - b.minZ > 14);

  const hideLines = (from: number, n: number) => {
    linePos.fill(-9999, from * 6, (from + n) * 6);
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
    let roof: Box | null = null;
    for (let n = 0; n < 60; n++) {
      const b = def.roof ? roofCandidates[Math.floor(r() * roofCandidates.length)] : null;
      const s = b ? _w.set((b.minX + b.maxX) / 2, b.maxY, (b.minZ + b.maxZ) / 2) : streetSpots[Math.floor(r() * streetSpots.length)];
      if (def.roof && !b) break;
      const d = Math.hypot(s.x - avoid.x, s.z - avoid.z);
      const clear = crimes.every((o) => o === c || o.state === "empty" || o.center.distanceTo(s) > 150) && races.every((q) => q.start.distanceTo(s) > 40);
      if (!best || (d > 90 && d < 450 && clear)) {
        best = s.clone();
        roof = b;
        if (d > 90 && d < 450 && clear) break;
      }
    }
    if (!best) return;
    c.state = "active";
    c.kind = kind;
    c.roof = roof;
    c.ground = best.y;
    c.center.copy(best);
    c.near = city.near(best.x, best.z, 60);
    c.noticed = false;
    c.count = def.min + Math.floor(r() * (def.max - def.min + 1));
    if (def.car) {
      const dx = Math.abs(best.x - lineAt(Math.round((best.x + HALF) / PERIOD)));
      const dz = Math.abs(best.z - lineAt(Math.round((best.z + HALF) / PERIOD)));
      const alongZ = dx < dz;
      const lx = lineAt(Math.round((best.x + HALF) / PERIOD));
      const lz = lineAt(Math.round((best.z + HALF) / PERIOD));
      if (alongZ) c.center.x = lx + Math.sign(best.x - lx || 1) * 7.5;
      else c.center.z = lz + Math.sign(best.z - lz || 1) * 7.5;
      _e.set(0, alongZ ? 0 : Math.PI / 2, 0, "XYZ");
      _m.makeRotationFromEuler(_e).setPosition(c.center);
      cars.setMatrixAt(1 + slot, _m);
      carLights.setMatrixAt(1 + slot, _m);
      const p = PAINT[Math.floor(r() * PAINT.length)];
      cars.setColorAt(1 + slot, _c.set(p));
    }
    for (let k = 0; k < CREW; k++) {
      const th = thugs[slot * CREW + k];
      th.active = k < c.count;
      if (!th.active) continue;
      th.state = "idle";
      th.tilt = 0;
      th.punchT = 0;
      th.fled = false;
      th.coward = r() < 0.45;
      th.phase = r() * 10;
      th.vel.set(0, 0, 0);
      for (let n = 0; n < 8; n++) {
        const a = (k / c.count) * Math.PI * 2 + r() * 0.6;
        const rad = def.car ? 3.2 + r() * 1.5 : 2 + r() * 3;
        if (roof) th.pos.set(clamp(c.center.x + Math.cos(a) * rad, roof.minX + 1.5, roof.maxX - 1.5), c.ground, clamp(c.center.z + Math.sin(a) * rad, roof.minZ + 1.5, roof.maxZ - 1.5));
        else th.pos.set(c.center.x + Math.cos(a) * rad, 0, c.center.z + Math.sin(a) * rad);
        if (roof || !insideAny(th.pos.x, 1, th.pos.z, 0.6)) break;
        th.pos.set(c.center.x + (r() - 0.5) * 2, 0, c.center.z + (r() - 0.5) * 2);
      }
      th.yaw = Math.atan2(c.center.x - th.pos.x, c.center.z - th.pos.z);
      const i = slot * CREW + k;
      torsos.setColorAt(i, _c.set(JACKETS[Math.floor(r() * JACKETS.length)]));
      arms.setColorAt(i * 2, _c);
      arms.setColorAt(i * 2 + 1, _c);
      heads.setColorAt(i, _c.set(SKINS[Math.floor(r() * SKINS.length)]));
      beanies.setColorAt(i, r() < 0.8 ? _c.set(BEANIES[Math.floor(r() * BEANIES.length)]) : _c.set(SKINS[0]).multiplyScalar(0));
    }
    hideLines(slot * CREW * LINES_PER_THUG, CREW * LINES_PER_THUG);
    for (const m of [torsos, arms, heads, beanies, cars]) m.instanceColor!.needsUpdate = true;
  };

  const clearCrime = (slot: number) => {
    const c = crimes[slot];
    c.state = "empty";
    for (let k = 0; k < CREW; k++) thugs[slot * CREW + k].active = false;
    cars.setMatrixAt(1 + slot, ZERO);
    carLights.setMatrixAt(1 + slot, ZERO);
    hazards.setMatrixAt(1 + slot, ZERO);
    hideLines(slot * CREW * LINES_PER_THUG, CREW * LINES_PER_THUG);
  };

  const rootMatrix = (th: Thug, bob: number, out: THREE.Matrix4) => {
    _e.set(th.tilt, th.yaw, 0, "YXZ");
    return out.makeRotationFromEuler(_e).setPosition(th.pos.x, th.pos.y + bob + (th.state === "down" ? 0.16 : 0), th.pos.z);
  };
  const part = (out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, ax: number, az: number) => {
    _e.set(ax, 0, az, "XYZ");
    _m3.makeRotationFromEuler(_e).setPosition(x, y, z);
    return out.multiplyMatrices(parent, _m3);
  };

  const webThug = (i: number, th: Thug, ground: number, near: Box[]) => {
    rootMatrix(th, 0, _root);
    const center = target.set(0, 0.95, 0).applyMatrix4(_root);
    let bestD = 10;
    _w.set(0, -9999, 0);
    for (const b of near) {
      if (b.maxY < ground + 3) continue;
      const cx = clamp(center.x, b.minX, b.maxX);
      const cz = clamp(center.z, b.minZ, b.maxZ);
      const d = Math.hypot(cx - center.x, cz - center.z);
      if (d > 0.01 && d < bestD) {
        bestD = d;
        _w.set(cx, ground + 2.5, cz);
      }
    }
    if (_w.y < -999) _w.set(0, 0, 3).applyMatrix4(_root).setY(ground);
    setLine(i * LINES_PER_THUG, center, _w);
    for (let s = 0; s < 2; s++) {
      _w.set(s ? 1.6 : -1.6, 0.6 + s * 0.4, 0).applyMatrix4(_root).setY(ground);
      setLine(i * LINES_PER_THUG + 1 + s, center, _w);
    }
  };

  const chase = { state: "none" as "none" | "active" | "webbed", nextAt: 45, axis: 0, fixed: 0, nextK: 0, dir: 1, s: 0, speed: 0, yaw: 0, pos: new THREE.Vector3(), touched: false, hits: 0, farT: 0, doneT: 0, webbed: false };
  const carTarget = (out: THREE.Vector3) => {
    const line = lineAt(chase.fixed);
    return chase.axis === 0 ? out.set(chase.s, 0, line + 3.5 * chase.dir) : out.set(line - 3.5 * chase.dir, 0, chase.s);
  };
  const carYaw = () => (chase.axis === 0 ? (chase.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : chase.dir > 0 ? 0 : Math.PI);
  const spawnChase = (p: THREE.Vector3, out: MissionEvent[]) => {
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
    cars.instanceColor!.needsUpdate = true;
    out.push({ type: "sfx", name: "siren" }, { type: "toast", title: "GETAWAY CAR", text: "Chase down the fleeing car" });
  };
  const steer = () => {
    const ok = (k: number) => k >= 0 && k <= BLOCKS;
    const straight = ok(chase.nextK + chase.dir);
    const turnL = ok(chase.fixed - 1);
    const turnR = ok(chase.fixed + 1);
    const roll = r();
    if (straight && (roll < 0.55 || (!turnL && !turnR))) {
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
    let n = MAX_THUGS * LINES_PER_THUG;
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
  let hitCooldown = 0;
  const completed = { races: 0, crimes: 0, chases: 0 };
  const award = (out: MissionEvent[], amount: number, reason: string) => {
    xp += amount;
    levelXp += amount;
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

  const events: MissionEvent[] = [];

  const updateRace = (p: Player, dt: number) => {
    if (race.latch >= 0 && Math.hypot(p.pos.x - races[race.latch].start.x, p.pos.z - races[race.latch].start.z) > 8) race.latch = -1;
    if (race.state === "idle") {
      if (chase.state === "active") return;
      for (let i = 0; i < races.length; i++) {
        const s = races[i].start;
        if (i !== race.latch && Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 5 && p.pos.y < 120) {
          race.state = "countdown";
          race.idx = i;
          race.t = 0;
          race.count = 3;
          race.next = 0;
          race.latch = i;
          events.push({ type: "sfx", name: "start" }, { type: "toast", title: races[i].name, text: "Swing race" }, { type: "sfx", name: "countdown" }, { type: "toast", title: "3" });
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

  const updateThug = (i: number, th: Thug, c: Crime, p: Player, dt: number) => {
    const dx = p.pos.x - th.pos.x;
    const dz = p.pos.z - th.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = p.pos.y - th.pos.y - 1;
    if (th.state === "down") return;
    if (th.state === "flying") {
      th.vel.y -= G * dt;
      const nx = th.pos.x + th.vel.x * dt;
      const nz = th.pos.z + th.vel.z * dt;
      let blocked = false;
      for (const b of c.near) if (inBox(b, nx, nz) && b.maxY > th.pos.y + 0.3) blocked = true;
      if (blocked) {
        th.vel.x *= -0.2;
        th.vel.z *= -0.2;
      } else {
        th.pos.x = nx;
        th.pos.z = nz;
      }
      th.pos.y += th.vel.y * dt;
      th.tilt = Math.max(-Math.PI / 2, th.tilt - dt * 5);
      let ground = 0;
      for (const b of c.near) if (inBox(b, th.pos.x, th.pos.z) && b.maxY <= th.pos.y + 1) ground = Math.max(ground, b.maxY);
      if (th.pos.y <= ground && th.vel.y < 0) {
        th.pos.y = ground;
        th.tilt = -Math.PI / 2;
        th.state = "down";
        webThug(i, th, ground, c.near);
        burst(th.pos.x, ground + 0.5, th.pos.z, 10, 5, 2.4, 2.4, 2.6);
      }
      return;
    }
    if (th.state === "flee") {
      const away = Math.atan2(-dx, -dz);
      th.yaw = turn(th.yaw, away, dt * 6);
      const nx = th.pos.x + Math.sin(th.yaw) * 5.5 * dt;
      const nz = th.pos.z + Math.cos(th.yaw) * 5.5 * dt;
      let blocked = false;
      for (const b of c.near) if (inBox(b, nx, nz, 0.4) && b.maxY > th.pos.y + 0.5) blocked = true;
      if (c.roof && !inBox(c.roof, nx, nz, -1.5)) blocked = true;
      if (blocked) th.yaw += Math.PI / 2;
      else th.pos.set(nx, th.pos.y, nz);
      if (Math.hypot(th.pos.x - c.center.x, th.pos.z - c.center.z) > 26 || dist > 40) th.state = "alert";
      return;
    }
    const close = dist < 24 && Math.abs(dy) < 14;
    if (!close) {
      th.state = "idle";
      return;
    }
    th.yaw = turn(th.yaw, Math.atan2(dx, dz), dt * 8);
    if (dist < 2.6 && Math.abs(dy) < 2.2) {
      th.state = "punch";
      th.punchT += dt;
      if (th.punchT > 1.2) {
        th.punchT = 0;
        if (hitCooldown <= 0) {
          hitCooldown = 0.9;
          events.push({ type: "sfx", name: "hit" }, { type: "shake", strength: 0.35 });
        }
      }
    } else {
      th.state = "alert";
      th.punchT = Math.max(0, th.punchT - dt);
    }
  };

  const updateCrimes = (p: Player, dt: number) => {
    for (let s = 0; s < SLOTS; s++) {
      const c = crimes[s];
      if (c.state !== "active") {
        if (now >= c.respawnAt) {
          clearCrime(s);
          spawnCrime(s, p.pos);
        }
        continue;
      }
      if (!c.noticed && c.center.distanceTo(p.pos) < 90) {
        c.noticed = true;
        events.push({ type: "sfx", name: "start" }, { type: "toast", title: "CRIME IN PROGRESS", text: CRIMES[c.kind].name });
      }
      let down = 0;
      let ko = 0;
      for (let k = 0; k < c.count; k++) {
        const th = thugs[s * CREW + k];
        updateThug(s * CREW + k, th, c, p, dt);
        if (th.state === "down") down++;
        if (th.state === "down" || th.state === "flying") ko++;
      }
      if (ko * 2 >= c.count) {
        for (let k = 0; k < c.count; k++) {
          const th = thugs[s * CREW + k];
          if (th.coward && !th.fled && (th.state === "idle" || th.state === "alert")) {
            th.fled = true;
            th.state = "flee";
          }
        }
      }
      if (down === c.count) {
        c.state = "cleared";
        c.respawnAt = now + 22 + r() * 12;
        completed.crimes++;
        events.push({ type: "sfx", name: "complete" }, { type: "toast", title: "CRIME STOPPED", text: `+${XP_CRIME} XP` });
        award(events, XP_CRIME, CRIMES[c.kind].name);
      }
    }
  };

  const updateChase = (p: Player, dt: number) => {
    if (chase.state === "none") {
      if (now >= chase.nextAt && race.state === "idle") spawnChase(p.pos, events);
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
        hideLines(MAX_THUGS * LINES_PER_THUG, CAR_LINES);
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

  const setBeam = (i: number, x: number, z: number, rad: number, h: number, rr: number, g: number, b: number) => {
    _m.makeScale(rad, h, rad).setPosition(x, 0, z);
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

  const drawThug = (i: number, t: number) => {
    const th = thugs[i];
    if (!th.active) {
      torsos.setMatrixAt(i, ZERO);
      heads.setMatrixAt(i, ZERO);
      beanies.setMatrixAt(i, ZERO);
      legs.setMatrixAt(i * 2, ZERO);
      legs.setMatrixAt(i * 2 + 1, ZERO);
      arms.setMatrixAt(i * 2, ZERO);
      arms.setMatrixAt(i * 2 + 1, ZERO);
      cocoons.setMatrixAt(i, ZERO);
      return;
    }
    const ph = t + th.phase;
    let legL = 0;
    let legR = 0;
    let armL = -0.05 + Math.sin(ph * 1.7) * 0.06;
    let armR = -0.05 - Math.sin(ph * 1.7) * 0.06;
    let spread = 0.12;
    let lean = 0.02;
    let bob = 0;
    if (th.state === "alert" || th.state === "punch") {
      legL = -0.28;
      legR = 0.22;
      armL = -1.35 + Math.sin(ph * 7) * 0.1;
      armR = -1.15 + Math.cos(ph * 7) * 0.1;
      spread = 0.35;
      lean = 0.18;
      bob = Math.abs(Math.sin(ph * 7)) * 0.05;
      if (th.state === "punch") {
        armR = -1.2 - 0.5 * Math.max(0, Math.sin((th.punchT / 1.2) * Math.PI * 4));
        lean = 0.28;
      }
    } else if (th.state === "flee") {
      const s = Math.sin(ph * 12);
      legL = s * 0.9;
      legR = -s * 0.9;
      armL = -s * 0.8;
      armR = s * 0.8;
      spread = 0.15;
      lean = 0.32;
      bob = Math.abs(s) * 0.08;
    } else if (th.state === "flying") {
      legL = 0.5;
      legR = -0.3;
      armL = -2.6 + Math.sin(ph * 20) * 0.3;
      armR = -2.4;
      spread = 0.6;
      lean = -0.2;
    } else if (th.state === "down") {
      legL = 0.05;
      legR = -0.05;
      armL = armR = -0.1;
      spread = 0.08;
      lean = 0;
    }
    rootMatrix(th, bob, _root);
    legs.setMatrixAt(i * 2, part(_m, _root, M.HIP_X, M.HIP_Y, 0, legL, 0));
    legs.setMatrixAt(i * 2 + 1, part(_m, _root, -M.HIP_X, M.HIP_Y, 0, legR, 0));
    torsos.setMatrixAt(i, part(_torso, _root, 0, M.HIP_Y, 0, lean, 0));
    arms.setMatrixAt(i * 2, part(_m, _torso, M.SHOULDER_X, M.SHOULDER_Y, 0, armL, spread));
    arms.setMatrixAt(i * 2 + 1, part(_m, _torso, -M.SHOULDER_X, M.SHOULDER_Y, 0, armR, -spread));
    part(_m, _torso, 0, M.HEAD_Y, 0, -lean * 0.5, 0);
    heads.setMatrixAt(i, _m);
    beanies.setMatrixAt(i, _m);
    if (th.state === "down") {
      _m3.makeScale(0.42, 1.05, 0.34).setPosition(0, 0.95, 0);
      cocoons.setMatrixAt(i, _m.multiplyMatrices(_root, _m3));
    } else cocoons.setMatrixAt(i, ZERO);
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
      if (racing) {
        hideBeam(BEAM_RACE + i);
        hideBeam(BEAM_RACE + 3 + i);
        continue;
      }
      setBeam(BEAM_RACE + i, s.x, s.z, 4.5, 420, 0.12, 0.35, 1.3 * pulse);
      setBeam(BEAM_RACE + 3 + i, s.x, s.z, 1.3, 420, 0.4, 1.1, 4);
      setBase(BEAM_RACE + i, s.x, 0, s.z, 6 + Math.sin(t * 3) * 0.4, t, 0.4, 1.2, 4);
    }
    for (let s = 0; s < SLOTS; s++) {
      const c = crimes[s];
      const hz = c.state === "active" && CRIMES[c.kind].car && Math.sin(t * 9) > 0;
      if (CRIMES[c.kind].car && c.state !== "empty") {
        cars.getMatrixAt(1 + s, _m);
        hazards.setMatrixAt(1 + s, hz ? _m : ZERO);
      }
      if (c.state !== "active") {
        hideBeam(BEAM_CRIME + s);
        hideBeam(BEAM_CRIME + 3 + s);
        continue;
      }
      const k = 0.6 + 0.4 * Math.sin(t * 6 + s);
      setBeam(BEAM_CRIME + s, c.center.x, c.center.z, 5, 360, 1.4 * k, 0.08 * k, 0.06 * k);
      setBeam(BEAM_CRIME + 3 + s, c.center.x, c.center.z, 1.4, 360, 4 * k, 0.3, 0.25);
      setBase(BEAM_CRIME + s, c.center.x, c.ground, c.center.z, 7 + k, -t, 4 * k, 0.3, 0.25);
    }
    for (let i = 0; i < MAX_THUGS; i++) drawThug(i, t);

    if (chase.state === "none") {
      cars.setMatrixAt(0, ZERO);
      carLights.setMatrixAt(0, ZERO);
      hazards.setMatrixAt(0, ZERO);
      cocoons.setMatrixAt(CAR_COCOON, ZERO);
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
        cocoons.setMatrixAt(CAR_COCOON, _m2.multiplyMatrices(_m, _m3));
        hideBeam(BEAM_CHASE);
        hideBeam(BEAM_CHASE + 1);
      } else {
        cocoons.setMatrixAt(CAR_COCOON, ZERO);
        setBeam(BEAM_CHASE, chase.pos.x, chase.pos.z, 3, 260, 1.6 * pulse, 0.6 * pulse, 0.05);
        setBeam(BEAM_CHASE + 1, chase.pos.x, chase.pos.z, 0.8, 260, 4, 1.6, 0.2);
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
      setBeam(BEAM_NEXT, next.x, next.z, 0.6, 400, 0.3, 0.9, 2.6);
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

  const update = (dt: number, t: number, p: Player): MissionEvent[] => {
    events.length = 0;
    now += dt;
    hitCooldown -= dt;
    if (!started) {
      started = true;
      prev.copy(p.pos);
    }
    if (p.mode === "ground") combo = 0;
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
    updateChase(p, dt);
    updateSparks(dt);
    render(p, dt, t);
    prev.copy(p.pos);
    last.copy(p.pos);
    return events;
  };

  const strikeTarget = (pos: THREE.Vector3, range: number): THREE.Vector3 | null => {
    let best = range;
    let found = false;
    for (const th of thugs) {
      if (!th.active || th.state === "flying" || th.state === "down") continue;
      const d = _v.set(th.pos.x, th.pos.y + 1, th.pos.z).distanceTo(pos);
      if (d < best) {
        best = d;
        strikeOut.copy(_v);
        found = true;
      }
    }
    if (chase.state === "active") {
      const d = _v.copy(chase.pos).setY(1).distanceTo(pos);
      if (d < best) {
        strikeOut.copy(_v);
        found = true;
      }
    }
    return found ? strikeOut : null;
  };

  const strike = (pos: THREE.Vector3, power: number): MissionEvent[] => {
    const out: MissionEvent[] = [];
    const radius = power >= 2 ? 6 : 3.5;
    let hits = 0;
    for (const th of thugs) {
      if (!th.active || th.state === "flying" || th.state === "down") continue;
      _v.set(th.pos.x, th.pos.y + 1, th.pos.z);
      if (_v.distanceTo(pos) > radius) continue;
      const away = Math.atan2(th.pos.x - pos.x, th.pos.z - pos.z);
      th.yaw = away + Math.PI;
      th.state = "flying";
      th.vel.set(Math.sin(away) * (7 + 3 * power), 5 + 2 * power, Math.cos(away) * (7 + 3 * power));
      burst(_v.x, _v.y, _v.z, 14, 9, 3, 2.4, 1.2);
      hits++;
      out.push({ type: "sfx", name: "ko" });
      award(out, XP_TAKEDOWN, "Takedown");
    }
    if (chase.state === "active" && _v.copy(chase.pos).setY(1).distanceTo(pos) < radius + 2.5) {
      chase.touched = true;
      chase.hits++;
      hits++;
      burst(_v.x, _v.y + 0.6, _v.z, 26, 12, 4, 1.8, 0.4);
      out.push({ type: "sfx", name: "hit" }, { type: "shake", strength: 0.5 });
      if (chase.hits >= CHASE_HITS) {
        chase.state = "webbed";
        chase.webbed = false;
        chase.doneT = 0;
        completed.chases++;
        out.push({ type: "sfx", name: "complete" }, { type: "toast", title: "CHASE COMPLETE", text: `+${XP_CHASE} XP` });
        award(out, XP_CHASE, "Getaway car stopped");
      }
    }
    if (hits) out.push({ type: "shake", strength: 0.25 * power });
    return out;
  };

  const trick = (kind: "flip" | "spin", airTime: number): MissionEvent[] => {
    const out: MissionEvent[] = [];
    combo++;
    const mult = Math.min(combo, 5);
    award(out, Math.round((kind === "flip" ? 20 : 15) + airTime * 10) * mult, mult > 1 ? `Style x${mult}` : "Style");
    if (combo === 3 || combo === 5) out.push({ type: "toast", title: `STYLE x${mult}` });
    return out;
  };

  const hud = (): MissionHud => {
    const markers: Marker[] = [];
    const near = (x: number, z: number, d: number) => Math.hypot(x - last.x, z - last.z) < d;
    let activity: MissionHud["activity"] = null;
    let nearPrompt: string | undefined;
    if (race.state === "idle") {
      for (const q of races) {
        markers.push({ x: q.start.x, z: q.start.z, kind: "race" });
        if (!nearPrompt && near(q.start.x, q.start.z, 60)) nearPrompt = `Enter the beam to start: ${q.name}`;
      }
    } else {
      const q = races[race.idx];
      const n = q.rings[race.next];
      markers.push({ x: n.x, z: n.z, kind: "checkpoint" });
      const medal = race.state === "running" ? medalFor(q, race.t) : 0;
      activity = {
        title: q.name,
        objective: race.state === "countdown" ? "Get ready" : "Swing through the rings",
        timer: race.state === "running" ? race.t : 0,
        progress: `${race.next}/${q.rings.length}`,
        medal: medal >= 0 ? `${MEDALS[medal]} ${fmt(q.times[medal])}` : `Limit ${fmt(q.limit)}`,
      };
    }
    let closest = Infinity;
    crimes.forEach((c, s) => {
      if (c.state !== "active") return;
      markers.push({ x: c.center.x, z: c.center.z, kind: "crime" });
      const d = Math.hypot(c.center.x - last.x, c.center.z - last.z);
      let standing = 0;
      for (let k = 0; k < c.count; k++) {
        const th = thugs[s * CREW + k];
        if (th.state === "down" || th.state === "flying") continue;
        standing++;
        if (d < 200) markers.push({ x: th.pos.x, z: th.pos.z, kind: "enemy" });
      }
      if (!activity && d < 120 && d < closest) {
        closest = d;
        activity = { title: CRIMES[c.kind].name, objective: "Take down the thugs", progress: `${c.count - standing}/${c.count}` };
      }
    });
    if (chase.state === "active") {
      markers.push({ x: chase.pos.x, z: chase.pos.z, kind: "chase" });
      if (race.state === "idle" && (chase.touched || closest > 60))
        activity = {
          title: "Getaway Car",
          objective: chase.farT > 0 ? "The car is escaping" : chase.touched ? "Web-strike the car" : "Catch the car",
          progress: `${chase.hits}/${CHASE_HITS} hits`,
          timer: chase.farT > 0 ? 10 - chase.farT : undefined,
        };
    }
    for (const it of items) if (!it.got && near(it.pos.x, it.pos.z, 250)) markers.push({ x: it.pos.x, z: it.pos.z, kind: "collectible" });
    return {
      xp,
      level,
      levelProgress: levelXp / levelNeed(level),
      activity,
      collected: items.filter((it) => it.got).length,
      totalCollectibles: items.length,
      completed: { ...completed },
      markers,
      nearPrompt: activity ? undefined : nearPrompt,
      combo: combo > 1 ? Math.min(combo, 5) : undefined,
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

  return { update, hud, strikeTarget, strike, trick, setDetail, dispose, debug: { races, crimes, thugs, items, chase } };
}

export type Missions = ReturnType<typeof createMissions>;
