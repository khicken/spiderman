import * as THREE from "three";
import { HALF, PERIOD, STREET, rng, type Box, type City } from "./city";
import type { GameEvent, Input, Marker, Objective, PlayerApi } from "./contracts";
import * as A from "./activities-models";

export type District = { name: string; minX: number; maxX: number; minZ: number; maxZ: number };
type Kind = "photo" | "cache" | "request" | "pigeon" | "challenge";
type Item = { kind: Kind; district: number; done: boolean };
type Photo = { name: string; target: THREE.Vector3; item: Item };
type Cache = { box: THREE.Vector3; off: THREE.Vector3; item: Item };
type Req = { type: number; giver: THREE.Vector3; yaw: number; dest: THREE.Vector3; pts: THREE.Vector3[]; drift: THREE.Vector3; item: Item };
type Bird = { caught: boolean; a0: number; r0: number; w: number; h0: number; phase: number; dx: number; dz: number };
type Flock = { home: THREE.Vector3; birds: Bird[]; item: Item };
type Chal = { name: string; kind: number; start: THREE.Vector3; pts: THREE.Vector3[]; tower: Box | null; medals: number[]; limit: number; best: number; item: Item };
type Active = { kind: Kind; i: number; t0: number } | null;

const lineAt = (k: number) => -HALF + k * PERIOD;
const BIG = 1e4;
const DEFAULT_DISTRICTS: District[] = [
  { name: "Harlem", minX: -BIG, maxX: BIG, minZ: -BIG, maxZ: lineAt(2) },
  { name: "Upper West Side", minX: -BIG, maxX: lineAt(7), minZ: lineAt(2), maxZ: lineAt(6) },
  { name: "Upper East Side", minX: lineAt(7), maxX: BIG, minZ: lineAt(2), maxZ: lineAt(6) },
  { name: "Hell's Kitchen", minX: -BIG, maxX: lineAt(7), minZ: lineAt(6), maxZ: lineAt(11) },
  { name: "Midtown", minX: lineAt(7), maxX: BIG, minZ: lineAt(6), maxZ: lineAt(11) },
  { name: "Financial District", minX: -BIG, maxX: BIG, minZ: lineAt(11), maxZ: BIG },
];
const SIDEWALK = STREET / 2 + 1.5;
const PHOTO_RANGE = 60;
const CACHE_R = 110;
const CACHES_PER_DISTRICT = 2;
const FLOCK_SIZE = 5;
const FLOCK_WINDOW = 30;
const DRONES = 10;
const FALL_RINGS = 8;
const MEDALS = ["GOLD", "SILVER", "BRONZE"] as const;
const MEDAL_XP = [500, 350, 200];
const REQUESTS = [
  { title: "Lost Cat", text: "A cat is stuck on a roof. Bring it home.", xp: 250 },
  { title: "Pizza Run", text: "Deliver the pizza before it gets cold.", xp: 250 },
  { title: "Runaway Balloon", text: "Catch the balloon before it is gone.", xp: 200 },
  { title: "Purse Snatcher", text: "Tag the thief before he escapes.", xp: 300 },
  { title: "Holiday Lights", text: "Fix the 3 broken fuses.", xp: 250 },
];
const LIGHT_SEG = 14;
const LOCK_DIST = 7;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _cq = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _cq2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const flat = (a: THREE.Vector3, x: number, z: number) => Math.hypot(a.x - x, a.z - z);
const inBox = (b: Box, x: number, z: number, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
const sagAt = (f: number, d: number) => Math.sin(f * Math.PI) * Math.min(6, d * 0.08);
const fmt = (s: number) => `${Math.floor(s / 60)}:${(Math.max(0, s) % 60).toFixed(1).padStart(4, "0")}`;

class Pool {
  n = 0;
  constructor(readonly mesh: THREE.InstancedMesh) {}
  begin() {
    this.n = 0;
  }
  add(m: THREE.Matrix4, r = 1, g = 1, b = 1) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.mesh.setMatrixAt(this.n, m);
    if (this.mesh.instanceColor) this.mesh.setColorAt(this.n, _c.setRGB(r, g, b));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export function createActivities(scene: THREE.Scene, city: City) {
  const r = rng(9191);
  const group = new THREE.Group();
  group.name = "activities";
  scene.add(group);

  const districts = (city as unknown as { districts?: District[] }).districts ?? DEFAULT_DISTRICTS;
  const districtOf = (x: number, z: number) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < districts.length; i++) {
      const d = districts[i];
      if (x >= d.minX && x < d.maxX && z >= d.minZ && z < d.maxZ) return i;
      const dd = Math.hypot(x - clamp(x, d.minX, d.maxX), z - clamp(z, d.minZ, d.maxZ));
      if (dd < bd) [bd, best] = [dd, i];
    }
    return best;
  };
  const items: Item[] = [];
  const item = (kind: Kind, x: number, z: number) => {
    const it = { kind, district: districtOf(x, z), done: false };
    items.push(it);
    return it;
  };

  const topAt = (x: number, z: number) => {
    let h = 0;
    for (const b of city.near(x, z, 4)) if (inBox(b, x, z)) h = Math.max(h, b.maxY);
    return h;
  };
  const clearAt = (x: number, y: number, z: number, m: number) => {
    for (const b of city.near(x, z, m + 4)) if (inBox(b, x, z, m) && b.maxY > y - m) return false;
    return true;
  };
  const inCity = (x: number, z: number, m = 0) => Math.abs(x) < HALF - m && Math.abs(z) < HALF - m;
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const big = city.boxes.filter((b) => b.maxX - b.minX >= 9 && b.maxZ - b.minZ >= 9 && inCity((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, 10));
  const boxDistrict = (b: Box) => districtOf((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  const roofCorner = (b: Box, inset: number) => {
    const k0 = Math.floor(r() * 4);
    for (let k = 0; k < 4; k++) {
      const c = (k0 + k) % 4;
      const x = c & 1 ? b.maxX - inset : b.minX + inset;
      const z = c & 2 ? b.maxZ - inset : b.minZ + inset;
      if (topAt(x, z) <= b.maxY + 0.01) return new THREE.Vector3(x, b.maxY, z);
    }
    return null;
  };
  const roofIn = (d: number, minY: number, maxY: number, inset: number, near?: THREE.Vector3, minD = 0, maxD = Infinity) => {
    const list = big.filter((b) => {
      if (b.maxY < minY || b.maxY > maxY) return false;
      if (d >= 0 && boxDistrict(b) !== d) return false;
      if (!near) return true;
      const dd = flat(near, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      return dd >= minD && dd <= maxD;
    });
    for (let tries = 0; tries < 30 && list.length; tries++) {
      const p = roofCorner(pick(list), inset);
      if (p) return p;
    }
    return null;
  };
  const corners: THREE.Vector3[] = [];
  for (let i = 1; i < 14; i++) {
    for (let j = 1; j < 14; j++) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x = lineAt(i) + sx * SIDEWALK;
          const z = lineAt(j) + sz * SIDEWALK;
          if (topAt(x, z) === 0) corners.push(new THREE.Vector3(x, 0, z));
        }
      }
    }
  }
  const cornerIn = (d: number) => {
    const list = corners.filter((c) => districtOf(c.x, c.z) === d);
    return (list.length ? pick(list) : pick(corners)).clone();
  };

  const photos: Photo[] = city.landmarks.map((l) => {
    const target = l.pos.clone();
    if (target.y < 1) target.y = 12;
    return { name: l.name, target, item: item("photo", target.x, target.z) };
  });
  districts.forEach((d, di) => {
    const list = big.filter((b) => boxDistrict(b) === di).sort((a, b) => b.maxY - a.maxY);
    for (const b of list.slice(0, 6)) {
      const t = new THREE.Vector3((b.minX + b.maxX) / 2, b.maxY + 4, (b.minZ + b.maxZ) / 2);
      if (photos.some((p) => flat(p.target, t.x, t.z) < 90)) continue;
      photos.push({ name: `${d.name} Skyline`, target: t, item: item("photo", t.x, t.z) });
      break;
    }
  });

  const caches: Cache[] = [];
  districts.forEach((_, di) => {
    for (let k = 0; k < CACHES_PER_DISTRICT; k++) {
      let p: THREE.Vector3 | null = null;
      const style = (di + k) % 3;
      if (style === 0) p = roofIn(di, 20, 140, 1.4);
      else if (style === 1) p = roofIn(di, 6, 30, 1.2);
      if (!p) {
        const c = cornerIn(di);
        p = c.clone();
        for (let tries = 0; tries < 16; tries++) {
          const ax = tries % 2;
          const sg = (tries >> 1) % 2 ? 1 : -1;
          const step = 3 + (tries >> 2) * 2;
          const x = c.x + (ax ? 0 : sg * step);
          const z = c.z + (ax ? sg * step : 0);
          if (topAt(x, z) === 0 && topAt(x + (ax ? 0 : sg * 1.2), z + (ax ? sg * 1.2 : 0)) > 0) {
            p.set(x, 0, z);
            break;
          }
        }
      }
      const a = r() * Math.PI * 2;
      const off = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(CACHE_R * 0.55);
      caches.push({ box: p, off, item: item("cache", p.x, p.z) });
    }
  });

  const reqs: Req[] = [];
  for (let n = 0; n < REQUESTS.length * 2; n++) {
    const type = n % REQUESTS.length;
    const di = n % districts.length;
    const giver = cornerIn(di);
    const lx = Math.round((giver.x + HALF) / PERIOD) * PERIOD - HALF;
    const lz = Math.round((giver.z + HALF) / PERIOD) * PERIOD - HALF;
    const yaw = Math.atan2(lx - giver.x, lz - giver.z);
    const dest = giver.clone();
    const pts: THREE.Vector3[] = [];
    const a = r() * Math.PI * 2;
    const drift = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    if (type === 0) dest.copy(roofIn(-1, 15, 70, 2, giver, 70, 260) ?? roofIn(-1, 10, 120, 2) ?? giver);
    else if (type === 1) {
      const far = corners.filter((c) => c.distanceTo(giver) > 380 && c.distanceTo(giver) < 760);
      dest.copy(far.length ? pick(far) : pick(corners));
    } else if (type === 4) {
      const cands: THREE.Vector3[] = [];
      for (const b of big) {
        if (b.maxY < 6 || b.maxY > 90 || flat(giver, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2) > 90) continue;
        const p = roofCorner(b, 0.8);
        if (p) cands.push(p);
      }
      const wireClear = (a: THREE.Vector3, b: THREE.Vector3) => {
        const d = a.distanceTo(b);
        if (d < 8 || d > 60) return false;
        for (let f = 0.1; f < 0.95; f += 0.1) {
          _p.lerpVectors(a, b, f);
          if (!clearAt(_p.x, _p.y + 0.6 - sagAt(f, d), _p.z, 0.4)) return false;
        }
        return true;
      };
      for (let tries = 0; tries < 1500 && cands.length >= 3; tries++) {
        const [a, b, c] = [pick(cands), pick(cands), pick(cands)];
        if (wireClear(a, b) && wireClear(b, c) && wireClear(c, a)) {
          pts.push(a, b, c);
          break;
        }
      }
      for (let k = pts.length; k < 3; k++) pts.push(giver.clone().add(_v.set(Math.cos(k * 2.1) * 14, 7, Math.sin(k * 2.1) * 14)));
    }
    reqs.push({ type, giver, yaw, dest, pts, drift, item: item("request", giver.x, giver.z) });
  }

  const flocks: Flock[] = [];
  districts.forEach((_, di) => {
    const home = roofIn(di, 12, 60, 3.5) ?? roofIn(di, 6, 160, 3) ?? cornerIn(di);
    const birds: Bird[] = [];
    for (let k = 0; k < FLOCK_SIZE; k++) {
      const a = (k / FLOCK_SIZE) * Math.PI * 2;
      birds.push({ caught: false, a0: a + r() * 0.6, r0: 4 + r() * 4, w: (0.32 + r() * 0.18) * (k % 2 ? 1 : -1), h0: r() * 14, phase: r() * 6, dx: Math.cos(a) * 1.4, dz: Math.sin(a) * 1.4 });
    }
    flocks.push({ home, birds, item: item("pigeon", home.x, home.z) });
  });

  const chals: Chal[] = [];
  {
    const plaza = city.landmarks.find((l) => l.name === "Holiday Plaza") ?? city.landmarks.find((l) => l.name === "Times Square");
    const start = plaza ? new THREE.Vector3(plaza.pos.x, 0, plaza.pos.z) : new THREE.Vector3(0, 0, 0);
    if (topAt(start.x, start.z) > 0) start.copy(cornerIn(districtOf(start.x, start.z)));
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < DRONES; k++) {
      for (let tries = 0; tries < 60; tries++) {
        const a = k * 2.4 + r() * 0.8;
        const rad = 22 + r() * 48;
        const y = 18 + k * 5 + r() * 8;
        const p = new THREE.Vector3(start.x + Math.cos(a) * rad, y, start.z + Math.sin(a) * rad);
        if (clearAt(p.x, p.y, p.z, 3.5) || tries === 59) {
          pts.push(p);
          break;
        }
      }
    }
    chals.push({ name: "Point Launch Gauntlet", kind: 0, start, pts, tower: null, medals: [24, 31, 40], limit: 40, best: 3, item: item("challenge", start.x, start.z) });
  }
  const towers = big.filter((b) => b.maxX - b.minX >= 12 && b.maxZ - b.minZ >= 12).sort((a, b) => b.maxY - a.maxY);
  {
    let fall = towers[0];
    let bestPts: THREE.Vector3[] = [];
    for (const b of towers.slice(0, 8)) {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      if (topAt(cx, cz) > b.maxY + 0.01) continue;
      for (let d = 0; d < 4; d++) {
        for (const gap of [12, 15, 19]) {
          const nx = d === 0 ? 1 : d === 1 ? -1 : 0;
          const nz = d === 2 ? 1 : d === 3 ? -1 : 0;
          const ox = nx ? (nx > 0 ? b.maxX : b.minX) + nx * gap : cx;
          const oz = nz ? (nz > 0 ? b.maxZ : b.minZ) + nz * gap : cz;
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k < FALL_RINGS; k++) {
            const y = b.maxY - 24 - (k * (b.maxY - 45)) / (FALL_RINGS - 1);
            const side = Math.sin(k * 1.7) * 4;
            const p = new THREE.Vector3(ox + nz * side, y, oz + nx * side);
            if (clearAt(p.x, p.y, p.z, A.RING_R + 1)) pts.push(p);
          }
          if (pts.length > bestPts.length || (pts.length === bestPts.length && b.maxY > fall.maxY)) [bestPts, fall] = [pts, b];
        }
      }
    }
    const cx = (fall.minX + fall.maxX) / 2;
    const cz = (fall.minZ + fall.maxZ) / 2;
    const start = new THREE.Vector3(cx, fall.maxY, cz);
    const n = bestPts.length;
    chals.push({ name: "Free Fall", kind: 2, start, pts: bestPts, tower: fall, medals: [n, Math.max(1, n - 2), Math.max(1, Math.ceil(n / 2))], limit: 60, best: 3, item: item("challenge", cx, cz) });
  }
  {
    const fallD = boxDistrict(chals[1].tower ?? towers[0]);
    let start: THREE.Vector3 | null = null;
    let tower: Box | null = null;
    for (const b of towers) {
      if (b.maxY < 100 || b.maxY > 210 || boxDistrict(b) === fallD) continue;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      for (const [x, z] of [[b.maxX + 3, cz], [b.minX - 3, cz], [cx, b.maxZ + 3], [cx, b.minZ - 3]]) {
        if (topAt(x, z) === 0) {
          start = new THREE.Vector3(x, 0, z);
          break;
        }
      }
      if (start) {
        tower = b;
        break;
      }
    }
    if (!start || !tower) {
      tower = towers[1];
      start = new THREE.Vector3(tower.maxX + 3, 0, (tower.minZ + tower.maxZ) / 2);
    }
    const h = tower.maxY;
    const medals = [Math.round(h / 18 + 3), Math.round(h / 12 + 4), Math.round(h / 8 + 6)];
    chals.push({ name: "Wall Run Sprint", kind: 1, start, pts: [], tower, medals, limit: medals[2], best: 3, item: item("challenge", start.x, start.z) });
  }
  chals.sort((a, b) => a.kind - b.kind);

  const nodes: number[] = [];
  for (let k = 0; k <= 14; k++) nodes.push(lineAt(k) - SIDEWALK, lineAt(k) + SIDEWALK);
  nodes.sort((a, b) => a - b);
  const nearestNode = (v: number) => {
    let best = 1;
    for (let k = 1; k < nodes.length - 1; k++) if (Math.abs(nodes[k] - v) < Math.abs(nodes[best] - v)) best = k;
    return best;
  };

  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, colors = true, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow;
    if (colors) for (let i = 0; i < n; i++) m.setColorAt(i, _c.setRGB(1, 1, 1));
    m.count = 0;
    m.visible = false;
    group.add(m);
    return new Pool(m);
  };
  const lit = (rough = 0.7) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough });
  const basic = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const beams = inst(A.beamGeometry(), A.glowMaterial(true, THREE.DoubleSide), 24);
  const bases = inst(A.baseRingGeometry(), A.glowMaterial(true, THREE.DoubleSide), 24);
  const halos = inst(A.haloGeometry(), A.glowMaterial(true), 40);
  const icons = inst(A.photoIconGeometry(), A.glowMaterial(true, THREE.DoubleSide), photos.length);
  const bangs = inst(A.bangIconGeometry(), A.glowMaterial(true, THREE.DoubleSide), reqs.length);
  const people = inst(A.personGeometry(), lit(0.8), reqs.length + 2, true, true);
  const cats = inst(A.catGeometry(), lit(0.9), 1, false, true);
  const pizzas = inst(A.pizzaGeometry(), lit(0.8), 1, false, true);
  const balloons = inst(A.balloonGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: "#ff2050", emissiveIntensity: 0.25 }), 1, false);
  const birdsMesh = inst(A.pigeonBodyGeometry(), lit(0.85), flocks.length * FLOCK_SIZE, false);
  const wings = inst(A.pigeonWingGeometry(), lit(0.85), flocks.length * FLOCK_SIZE * 2, false);
  const drones = inst(A.droneGeometry(), lit(0.5), DRONES, false, true);
  const boxes = inst(A.cacheBoxGeometry(), basic(), caches.length, false);
  const fuses = inst(A.junctionGeometry(), basic(), 3);
  const rings = inst(A.ringGeometry(), A.glowMaterial(false), FALL_RINGS);
  const pools = [beams, bases, halos, icons, bangs, people, cats, pizzas, balloons, birdsMesh, wings, drones, boxes, fuses, rings];

  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * LIGHT_SEG * 2 * 3), 3));
  const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: "#1a1a1a" }));
  wire.frustumCulled = false;
  wire.visible = false;
  const bulbGeo = new THREE.BufferGeometry();
  bulbGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * LIGHT_SEG * 3), 3));
  bulbGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3 * LIGHT_SEG * 3), 3));
  const dot = A.dotTexture();
  const bulbs = new THREE.Points(bulbGeo, new THREE.PointsMaterial({ size: 2.2, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  bulbs.frustumCulled = false;
  bulbs.visible = false;
  group.add(wire, bulbs);
  const BULB_COLORS = [[4, 0.4, 0.3], [0.4, 3.5, 0.8], [3.5, 2.6, 0.4], [0.6, 1.4, 4.5]];

  let act: Active = null;
  let ended = -Infinity;
  let lock: THREE.Vector3 | null = null;
  let stillT = 0;
  let pingT = 0;
  let pingText = "";
  let range = 280;
  let photoNear = -1;
  let photoFacing = false;
  const rq = { stage: 0, timer: 0, carried: false, item: new THREE.Vector3(), fixed: 0, nx: 0, nz: 0, ix: 0, iz: 0, prevX: 0, prevZ: 0 };
  const ch = { t: 0, hit: 0, next: 0, prevY: 0, started: false };
  let flockT = 0;
  let zoneR = CACHE_R;
  let lastY = 0;
  const ev: GameEvent[] = [];
  const toast = (title: string, text?: string) => ev.push(text ? { type: "toast", title, text } : { type: "toast", title });
  const xp = (amount: number, reason: string) => ev.push({ type: "xp", amount, reason });
  const sfx = (name: Extract<GameEvent, { type: "sfx" }>["name"], pan = 0, volume = 1) => ev.push({ type: "sfx", name, pan, volume });

  const begin = (kind: Kind, i: number, t: number) => {
    act = { kind, i, t0: t };
  };
  const finish = (t: number, at: THREE.Vector3 | null) => {
    act = null;
    ended = t;
    lock = at;
  };

  const startRequest = (i: number, t: number) => {
    const q = reqs[i];
    begin("request", i, t);
    rq.stage = 0;
    rq.carried = false;
    rq.fixed = 0;
    rq.timer = 0;
    if (q.type === 0) rq.item.copy(q.dest);
    if (q.type === 1) {
      rq.carried = true;
      rq.timer = q.giver.distanceTo(q.dest) / 17 + 20;
    }
    if (q.type === 2) {
      rq.item.copy(q.giver).y = 26;
      rq.timer = (230 - rq.item.y) / 1.6;
    }
    if (q.type === 3) {
      rq.ix = clamp(nearestNode(q.giver.x) + (q.giver.x > 0 ? -3 : 3), 1, nodes.length - 2);
      rq.iz = nearestNode(q.giver.z);
      rq.nx = rq.ix;
      rq.nz = rq.iz;
      rq.item.set(nodes[rq.ix], 0, nodes[rq.iz]);
      rq.prevX = rq.ix;
      rq.prevZ = rq.iz;
      rq.timer = 60;
    }
    if (q.type === 4) {
      const pos = wireGeo.attributes.position as THREE.BufferAttribute;
      const bp = bulbGeo.attributes.position as THREE.BufferAttribute;
      for (let s = 0; s < 3; s++) {
        const a = q.pts[s];
        const b = q.pts[(s + 1) % 3];
        for (let k = 0; k < LIGHT_SEG; k++) {
          for (let e = 0; e < 2; e++) {
            const f = (k + e) / LIGHT_SEG;
            const sag = sagAt(f, a.distanceTo(b));
            pos.setXYZ((s * LIGHT_SEG + k) * 2 + e, a.x + (b.x - a.x) * f, a.y + 0.6 + (b.y - a.y) * f - sag, a.z + (b.z - a.z) * f);
          }
          const f = (k + 0.5) / LIGHT_SEG;
          const sag = sagAt(f, a.distanceTo(b));
          bp.setXYZ(s * LIGHT_SEG + k, a.x + (b.x - a.x) * f, a.y + 0.45 + (b.y - a.y) * f - sag, a.z + (b.z - a.z) * f);
        }
      }
      pos.needsUpdate = true;
      bp.needsUpdate = true;
    }
    sfx("start");
    toast(REQUESTS[q.type].title.toUpperCase(), REQUESTS[q.type].text);
  };

  const completeRequest = (t: number) => {
    if (!act) return;
    const q = reqs[act.i];
    q.item.done = true;
    sfx("complete");
    sfx("cheer", 0, 0.6);
    toast("REQUEST COMPLETE", REQUESTS[q.type].title);
    xp(REQUESTS[q.type].xp, REQUESTS[q.type].title);
    finish(t, null);
  };
  const failRequest = (t: number, why: string) => {
    if (!act) return;
    sfx("fail");
    toast("REQUEST FAILED", why);
    finish(t, reqs[act.i].giver);
  };

  const medalOf = (c: Chal, v: number, higherBetter: boolean) => {
    for (let k = 0; k < 3; k++) if (higherBetter ? v >= c.medals[k] : v <= c.medals[k]) return k;
    return 3;
  };
  const endChallenge = (t: number, medal: number, detail: string) => {
    if (!act) return;
    const c = chals[act.i];
    if (medal < 3) {
      const first = !c.item.done;
      c.item.done = true;
      sfx("complete");
      toast(`${MEDALS[medal]} MEDAL`, `${c.name}: ${detail}`);
      ev.push({ type: "music", state: "victory", duration: 4 });
      if (medal < c.best) {
        xp(MEDAL_XP[medal] - (c.best < 3 ? MEDAL_XP[c.best] : 0), `${c.name} ${MEDALS[medal].toLowerCase()}`);
        c.best = medal;
      } else if (first) xp(100, c.name);
    } else {
      sfx("fail");
      toast("CHALLENGE FAILED", `${c.name}: ${detail}`);
    }
    finish(t, c.kind === 2 ? null : c.start);
  };

  const birdPos = (f: Flock, b: Bird, t: number, out: THREE.Vector3) => {
    if (act?.kind !== "pigeon" || flocks[act.i] !== f) return out.set(f.home.x + b.dx, f.home.y + 0.12, f.home.z + b.dz);
    const tau = t - act.t0;
    const a = b.a0 + b.w * tau;
    const R = Math.min(b.r0 + tau * 1.3, 42);
    const y = f.home.y + 1 + Math.min(tau * 5, 16 + b.h0) + 3 * Math.sin(tau * 0.9 + b.phase);
    return out.set(f.home.x + Math.cos(a) * R, y, f.home.z + Math.sin(a) * R);
  };

  const update = (dt: number, t: number, input: Input, player: PlayerApi, camera: THREE.Camera): GameEvent[] => {
    ev.length = 0;
    const P = player.pos;
    camera.getWorldPosition(_cam);
    camera.getWorldDirection(_dir);
    camera.getWorldQuaternion(_cq);
    const scan = input.pressed.has("scan");
    pingT = Math.max(0, pingT - dt);
    if (lock && flat(lock, P.x, P.z) > LOCK_DIST + 20) lock = null;
    lastY = P.y;
    const free = t - ended > 1.5 && (!act || act.kind === "cache");

    photoNear = -1;
    let bestFacing = 0.93;
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      if (ph.item.done) continue;
      const d = _cam.distanceTo(ph.target);
      if (d > PHOTO_RANGE) continue;
      const facing = _v.subVectors(ph.target, _cam).divideScalar(Math.max(d, 0.01)).dot(_dir);
      if (facing > bestFacing) [bestFacing, photoNear] = [facing, i];
    }
    photoFacing = photoNear >= 0;
    stillT = photoFacing && player.vel.lengthSq() < 0.36 ? stillT + dt : 0;
    if (photoFacing && (scan || stillT >= 1)) {
      const ph = photos[photoNear];
      ph.item.done = true;
      sfx("photo");
      toast("PHOTO OP", ph.name);
      xp(150, `Photo: ${ph.name}`);
      photoNear = -1;
      photoFacing = false;
      stillT = 0;
    }

    if (free) {
      for (let i = 0; i < caches.length && !act; i++) {
        const c = caches[i];
        if (!c.item.done && P.distanceTo(c.box) < CACHE_R * 0.9 && !(lock && lock === c.box)) {
          begin("cache", i, t);
          zoneR = CACHE_R;
          sfx("spiderSense");
          toast("SIGNAL DETECTED", "Track the signal to the hidden cache");
          pingText = "Press V to ping the signal";
        }
      }
      const idle = () => !act || act.kind === "cache";
      for (let i = 0; i < reqs.length && idle(); i++) {
        const q = reqs[i];
        if (!q.item.done && lock !== q.giver && flat(q.giver, P.x, P.z) < 3 && P.y < 5) startRequest(i, t);
      }
      for (let i = 0; i < flocks.length && idle(); i++) {
        const f = flocks[i];
        if (!f.item.done && lock !== f.home && P.distanceTo(f.home) < 16) {
          begin("pigeon", i, t);
          flockT = FLOCK_WINDOW;
          sfx("whoosh");
          toast("PIGEONS", "Catch them before they fly away");
        }
      }
      for (let i = 0; i < chals.length && idle(); i++) {
        const c = chals[i];
        if (lock === c.start || flat(c.start, P.x, P.z) > 3.5 || Math.abs(P.y - 0.95 - c.start.y) > 3) continue;
        begin("challenge", i, t);
        ch.t = 0;
        ch.hit = 0;
        ch.next = 0;
        ch.prevY = P.y;
        ch.started = c.kind !== 2;
        sfx("go");
        const goal = c.kind === 0 ? `Touch all ${DRONES} drones` : c.kind === 1 ? "Climb to the roof" : "Dive through the rings";
        toast(c.name.toUpperCase(), goal);
        ev.push({ type: "music", state: "race", duration: c.limit + 5 });
      }
    }

    const a = act as Active;
    if (a?.kind === "cache") {
      const c = caches[a.i];
      const d = P.distanceTo(c.box);
      zoneR = clamp(Math.min(zoneR, d * 1.25 + 8), 14, CACHE_R);
      if (scan) {
        _v.subVectors(c.box, P);
        _right.crossVectors(_dir, _up).normalize();
        const pan = clamp(_v.dot(_right) / Math.max(d, 1), -1, 1);
        sfx("ping", pan, clamp(1.2 - d / CACHE_R, 0.35, 1));
        pingT = 1.6;
        const fwd = _v.dot(_dir) / Math.max(d, 1);
        const up = _v.y / Math.max(d, 1);
        pingText = `Ping: ${up > 0.6 ? "above you" : up < -0.6 ? "below you" : fwd > 0.7 ? "ahead" : fwd < -0.7 ? "behind you" : pan > 0 ? "to the right" : "to the left"}, ${Math.round(d)} m`;
      }
      if (d < 2.2) {
        c.item.done = true;
        sfx("collect");
        sfx("complete");
        toast("CACHE FOUND", "Signal hunt complete");
        xp(200, "Signal cache");
        finish(t, null);
      } else if (d > CACHE_R * 1.6) {
        sfx("fail");
        toast("SIGNAL LOST");
        finish(t, c.box);
      }
    } else if (a?.kind === "request") {
      const q = reqs[a.i];
      if (rq.timer > 0) {
        rq.timer -= dt;
        if (rq.timer <= 0) failRequest(t, q.type === 1 ? "The pizza got cold" : q.type === 2 ? "The balloon floated away" : "He got away");
      }
      if (act && q.type === 0) {
        if (!rq.carried && P.distanceTo(rq.item) < 2.2) {
          rq.carried = true;
          sfx("collect");
          toast("GOT THE CAT", "Bring it back to its owner");
        }
        if (rq.carried && flat(q.giver, P.x, P.z) < 4 && P.y < 6) completeRequest(t);
      } else if (act && q.type === 1) {
        if (flat(q.dest, P.x, P.z) < 4 && P.y < 6) completeRequest(t);
      } else if (act && q.type === 2) {
        if (!rq.carried) {
          rq.item.addScaledVector(q.drift, dt * 1.1);
          rq.item.y += dt * 1.6;
          if (P.distanceTo(rq.item) < 2.6) {
            rq.carried = true;
            rq.timer = 0;
            sfx("collect");
            toast("GOT THE BALLOON", "Bring it back to the kid");
          }
        } else if (flat(q.giver, P.x, P.z) < 4 && P.y < 6) completeRequest(t);
      } else if (act && q.type === 3) {
        const tx = nodes[rq.nx];
        const tz = nodes[rq.nz];
        _v.set(tx - rq.item.x, 0, tz - rq.item.z);
        const left = _v.length();
        const step = 8.5 * dt;
        if (left <= step) {
          rq.item.x = tx;
          rq.item.z = tz;
          rq.prevX = rq.ix;
          rq.prevZ = rq.iz;
          rq.ix = rq.nx;
          rq.iz = rq.nz;
          let best = -Infinity;
          for (let k = 0; k < 4; k++) {
            const ix = rq.ix + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const iz = rq.iz + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (ix < 1 || iz < 1 || ix >= nodes.length - 1 || iz >= nodes.length - 1) continue;
            if (ix === rq.prevX && iz === rq.prevZ) continue;
            const s = Math.hypot(nodes[ix] - P.x, nodes[iz] - P.z) + r() * 25;
            if (s > best) [best, rq.nx, rq.nz] = [s, ix, iz];
          }
        } else rq.item.addScaledVector(_v, step / left);
        if (t - a.t0 > 0.5 && P.distanceTo(_p.set(rq.item.x, 1, rq.item.z)) < 2.5) {
          sfx("hit");
          ev.push({ type: "shake", strength: 0.3 });
          completeRequest(t);
        }
      } else if (act && q.type === 4) {
        for (let k = 0; k < 3; k++) {
          if (rq.fixed & (1 << k)) continue;
          if (P.distanceTo(_p.copy(q.pts[k]).setY(q.pts[k].y + 0.6)) < 2.4) {
            rq.fixed |= 1 << k;
            sfx("shock");
            const n = (rq.fixed & 1) + ((rq.fixed >> 1) & 1) + ((rq.fixed >> 2) & 1);
            if (n < 3) toast("FUSE FIXED", `${n}/3`);
            else {
              sfx("cheer");
              completeRequest(t);
            }
          }
        }
      }
      if (act && q.type !== 1 && q.type !== 3 && flat(q.giver, P.x, P.z) > 700) failRequest(t, "You left the area");
    } else if (a?.kind === "pigeon") {
      const f = flocks[a.i];
      flockT -= dt;
      let left = 0;
      for (const b of f.birds) {
        if (b.caught) continue;
        if (P.distanceTo(birdPos(f, b, t, _p)) < 2.2) {
          b.caught = true;
          sfx("collect");
          xp(25, "Pigeon");
        } else left++;
      }
      if (left === 0) {
        f.item.done = true;
        sfx("complete");
        toast("FLOCK CAUGHT", "All pigeons are safe");
        xp(200, "Pigeons");
        finish(t, null);
      } else if (flockT <= 0) {
        sfx("fail");
        toast("THEY GOT AWAY", `${FLOCK_SIZE - left}/${FLOCK_SIZE} caught. Try again later`);
        finish(t, f.home);
      }
    } else if (a?.kind === "challenge") {
      const c = chals[a.i];
      if (c.kind === 2 && !ch.started) {
        if (P.y < c.start.y - 1) ch.started = true;
        else if (t - a.t0 > 20 || flat(c.start, P.x, P.z) > 80) endChallenge(t, 3, "Jump off the roof to start");
      }
      if (act && ch.started) {
        ch.t += dt;
        if (c.kind === 0) {
          for (let k = 0; k < c.pts.length; k++) {
            if (ch.hit & (1 << k)) continue;
            if (P.distanceTo(c.pts[k]) < 3) {
              ch.hit |= 1 << k;
              ch.next++;
              sfx("checkpoint");
            }
          }
          if (ch.next >= c.pts.length) {
            const m = medalOf(c, ch.t, false);
            endChallenge(t, m, fmt(ch.t));
          } else if (ch.t > c.limit) endChallenge(t, 3, `Time up, ${ch.next}/${c.pts.length} drones`);
        } else if (c.kind === 1 && c.tower) {
          if (P.y >= c.tower.maxY + 0.4 && inBox(c.tower, P.x, P.z, 1.5)) endChallenge(t, medalOf(c, ch.t, false), fmt(ch.t));
          else if (ch.t > c.limit) endChallenge(t, 3, "Time up");
        } else if (c.kind === 2) {
          while (ch.next < c.pts.length && ch.prevY >= c.pts[ch.next].y && P.y < c.pts[ch.next].y) {
            const ring = c.pts[ch.next];
            if (flat(ring, P.x, P.z) < A.RING_R) {
              ch.hit++;
              sfx("checkpoint");
            } else sfx("whiff");
            ch.next++;
          }
          ch.prevY = P.y;
          const landed = P.y < 6 || (player.grounded && P.y < c.start.y - 10);
          if (landed || ch.t > c.limit) {
            const m = medalOf(c, ch.hit, true);
            endChallenge(t, m, `${ch.hit}/${c.pts.length} rings`);
          }
        }
      }
    }

    draw(t, P, player);
    return ev;
  };

  const billboard = (x: number, y: number, z: number, s: number) => _m.compose(_p.set(x, y, z), _cq, _s.setScalar(s));
  const placeYaw = (x: number, y: number, z: number, yaw: number, s = 1, pitch = 0, roll = 0) => {
    _e.set(pitch, yaw, roll, "YXZ");
    return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.setScalar(s));
  };
  const beam = (x: number, y: number, z: number, rad: number, rr: number, g: number, b: number, t: number) => {
    const fade = clamp((Math.hypot(x - _cam.x, z - _cam.z) - rad - 2) / 60, 0, 1) ** 2;
    rr *= fade;
    g *= fade;
    b *= fade;
    _m.makeScale(rad, 320, rad).setPosition(x, y, z);
    beams.add(_m, rr * 0.35, g * 0.35, b * 0.35);
    _m.makeScale(rad * 0.3, 320, rad * 0.3).setPosition(x, y, z);
    beams.add(_m, rr, g, b);
    _e.set(0, t * 0.8, 0);
    _m.compose(_p.set(x, y + 0.08, z), _q.setFromEuler(_e), _s.setScalar(rad * 1.3));
    bases.add(_m, rr, g, b);
  };
  const near = (v: THREE.Vector3, P: THREE.Vector3, d: number) => Math.abs(v.x - P.x) < d && Math.abs(v.z - P.z) < d;

  const draw = (t: number, P: THREE.Vector3, player: PlayerApi) => {
    for (const p of pools) p.begin();
    const a = act;
    const pulse = 0.75 + 0.25 * Math.sin(t * 4);

    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      if (ph.item.done || !near(ph.target, _cam, 320)) continue;
      const d = _cam.distanceTo(ph.target);
      const hot = i === photoNear && photoFacing;
      const k = hot ? 3 : 1.4 * pulse;
      icons.add(billboard(ph.target.x, ph.target.y + Math.sin(t * 1.6 + i) * 0.4, ph.target.z, clamp(d * 0.05, 2.2, 10)), k * (hot ? 1.2 : 0.75), k * (hot ? 1 : 0.95), k * (hot ? 0.5 : 1.3));
    }

    for (let i = 0; i < caches.length; i++) {
      const c = caches[i];
      if (c.item.done || !near(c.box, P, Math.min(range, 160))) continue;
      boxes.add(placeYaw(c.box.x, c.box.y, c.box.z, i * 1.3));
      const hot = a?.kind === "cache" && a.i === i;
      const k = (hot ? 0.8 : 0.5) * (0.6 + 0.4 * Math.sin(t * 3 + i)) + (hot ? pingT * 0.6 : 0);
      halos.add(billboard(c.box.x, c.box.y + 0.4, c.box.z, 1.4 + (hot ? pingT * 0.8 : 0)), k * 1.6, k * 0.9, k * 0.2);
      if (hot && pingT > 0) beam(c.box.x, c.box.y, c.box.z, 1.2, 3 * pingT, 1.8 * pingT, 0.3 * pingT, t);
    }

    const busy = a !== null;
    for (let i = 0; i < reqs.length; i++) {
      const q = reqs[i];
      const mine = a?.kind === "request" && a.i === i;
      if (q.item.done && !mine) continue;
      if (!near(q.giver, P, range) && !mine) continue;
      people.add(placeYaw(q.giver.x, q.giver.y + Math.abs(Math.sin(t * 2 + i)) * 0.03, q.giver.z, q.yaw), 0.6 + (i % 3) * 0.2, 0.7 + ((i + 1) % 3) * 0.15, 0.9 - (i % 2) * 0.3);
      if (!mine) {
        _e.set(0, t * 1.5, 0);
        bangs.add(_m.compose(_p.set(q.giver.x, 2.6 + Math.sin(t * 3 + i) * 0.12, q.giver.z), _q.setFromEuler(_e), _s.setScalar(0.9)), 3 * pulse, 2.4 * pulse, 0.3);
        if (!busy && lock !== q.giver) beam(q.giver.x, 0, q.giver.z, 2.4, 0.4, 2.6, 0.9, t);
      }
    }

    if (a?.kind === "request") {
      const q = reqs[a.i];
      const hold = _v.copy(P).addScaledVector(player.facing, 0.5).addScaledVector(_right.set(player.facing.z, 0, -player.facing.x), 0.3);
      if (q.type === 0) {
        const at = rq.carried ? hold.setY(P.y + 0.15) : rq.item;
        cats.add(placeYaw(at.x, at.y, at.z, rq.carried ? Math.atan2(player.facing.x, player.facing.z) : t * 0.3));
        if (!rq.carried) {
          halos.add(billboard(at.x, at.y + 0.4, at.z, 1.5), 1.2 * pulse, 0.9 * pulse, 0.3 * pulse);
          beam(at.x, at.y, at.z, 1, 0.5, 2.4, 3, t);
        } else beam(q.giver.x, 0, q.giver.z, 2.4, 0.4, 2.6, 0.9, t);
      } else if (q.type === 1) {
        hold.setY(P.y + 0.1);
        pizzas.add(placeYaw(hold.x, hold.y, hold.z, Math.atan2(player.facing.x, player.facing.z)));
        people.add(placeYaw(q.dest.x, 0, q.dest.z, t * 0.5), 1, 0.5, 0.4);
        beam(q.dest.x, 0, q.dest.z, 2.4, 0.5, 2.4, 3, t);
      } else if (q.type === 2) {
        const at = rq.carried ? hold.setY(P.y + 1.8) : rq.item;
        balloons.add(placeYaw(at.x, at.y, at.z, 0, 1.4, Math.sin(t * 1.3) * 0.12, Math.cos(t * 1.1) * 0.12));
        if (!rq.carried) halos.add(billboard(at.x, at.y + 0.9, at.z, 1.8), 0.7 * pulse, 0.15 * pulse, 0.25 * pulse);
        else beam(q.giver.x, 0, q.giver.z, 2.4, 0.4, 2.6, 0.9, t);
      } else if (q.type === 3) {
        const tx = nodes[rq.nx] - rq.item.x;
        const tz = nodes[rq.nz] - rq.item.z;
        const bob = Math.abs(Math.sin(t * 11)) * 0.12;
        people.add(placeYaw(rq.item.x, bob, rq.item.z, Math.atan2(tx, tz), 1, 0.25), 0.25, 0.25, 0.3);
        beam(rq.item.x, 0, rq.item.z, 1, 3 * pulse, 0.3, 0.2, t);
      } else if (q.type === 4) {
        for (let k = 0; k < 3; k++) {
          const p = q.pts[k];
          const ok = (rq.fixed >> k) & 1;
          fuses.add(placeYaw(p.x, p.y, p.z, k, 1.8), ok ? 0.3 : 4, ok ? 3 : 1.6, ok ? 0.6 : 0.2);
          if (!ok) {
            const fl = Math.random() < 0.3 ? 2 : 0.6;
            halos.add(billboard(p.x, p.y + 0.5, p.z, 1.2 + fl * 0.4), 3 * fl, 1.8 * fl, 0.4 * fl);
            beam(p.x, p.y, p.z, 0.9, 3, 1.8, 0.3, t);
          }
        }
        const col = bulbGeo.attributes.color as THREE.BufferAttribute;
        for (let s = 0; s < 3; s++) {
          const on = (rq.fixed >> s) & 1 && (rq.fixed >> ((s + 1) % 3)) & 1;
          for (let k = 0; k < LIGHT_SEG; k++) {
            const c = BULB_COLORS[(s * LIGHT_SEG + k) % 4];
            const tw = on ? 0.8 + 0.2 * Math.sin(t * 5 + k) : 0.04;
            col.setXYZ(s * LIGHT_SEG + k, c[0] * tw, c[1] * tw, c[2] * tw);
          }
        }
        col.needsUpdate = true;
      }
    }
    const lights = a?.kind === "request" && reqs[a.i].type === 4;
    wire.visible = lights;
    bulbs.visible = lights;

    for (let fi = 0; fi < flocks.length; fi++) {
      const f = flocks[fi];
      if (f.item.done || !near(f.home, P, range)) continue;
      const flying = a?.kind === "pigeon" && a.i === fi;
      for (let k = 0; k < f.birds.length; k++) {
        const b = f.birds[k];
        if (b.caught) continue;
        birdPos(f, b, t, _v);
        let yaw: number;
        let flap: number;
        let fold: number;
        let pitch = 0;
        if (flying) {
          const tau = t - (a as { t0: number }).t0;
          const ang = b.a0 + b.w * tau;
          yaw = Math.atan2(-Math.sin(ang) * Math.sign(b.w), Math.cos(ang) * Math.sign(b.w));
          flap = Math.sin(t * 22 + k) * 0.9;
          fold = 0;
          pitch = -0.15;
        } else {
          yaw = Math.atan2(b.dx, b.dz) + Math.sin(t * 0.7 + k * 2) * 0.6;
          flap = -0.15;
          fold = Math.PI / 2 - 0.2;
          pitch = Math.max(0, Math.sin(t * 2.3 + k * 1.7)) ** 8 * 0.6;
        }
        const s = flying ? 2.8 : 1.4;
        birdsMesh.add(placeYaw(_v.x, _v.y + 0.1, _v.z, yaw, s, pitch));
        _e.set(pitch, yaw, 0, "YXZ");
        _q.setFromEuler(_e);
        for (const side of [1, -1]) {
          _p.set(0.06 * side * s, 0.05 * s, 0).applyQuaternion(_q).add(_v);
          _p.y += 0.1;
          _e.set(0, (side < 0 ? Math.PI : 0) + fold * side, flap, "YXZ");
          _m.compose(_p, _q2.copy(_q).multiply(_cq2.setFromEuler(_e)), _s.setScalar(s));
          wings.add(_m);
        }
        if (flying) halos.add(billboard(_v.x, _v.y + 0.1, _v.z, 0.45), 0.25 * pulse, 0.35 * pulse, 0.5 * pulse);
      }
    }

    for (let i = 0; i < chals.length; i++) {
      const c = chals[i];
      const mine = a?.kind === "challenge" && a.i === i;
      if (!busy && lock !== c.start) {
        const g = c.best === 0 ? 0.6 : 1;
        beam(c.start.x, c.start.y, c.start.z, 2.6, 2.2 * g, 0.3 * g, 3.2 * g, t);
      }
      if (c.kind === 0 && (mine || near(c.start, P, 160))) {
        for (let k = 0; k < c.pts.length; k++) {
          if (mine && ch.hit & (1 << k)) continue;
          const p = c.pts[k];
          const y = p.y + Math.sin(t * 2 + k) * 0.4;
          drones.add(placeYaw(p.x, y, p.z, t * 0.6 + k, 1.6, Math.sin(t * 1.7 + k) * 0.08));
          if (mine) halos.add(billboard(p.x, y, p.z, 2.2), 1.5 * pulse, 0.3 * pulse, 2.2 * pulse);
        }
      }
      if (c.kind === 1 && mine && c.tower) {
        const tw = c.tower;
        beam((tw.minX + tw.maxX) / 2, tw.maxY, (tw.minZ + tw.maxZ) / 2, 3, 2.2, 0.3, 3.2, t);
      }
      if (c.kind === 2 && (mine || near(c.start, P, 200))) {
        for (let k = 0; k < c.pts.length; k++) {
          const p = c.pts[k];
          const passed = mine && k < ch.next;
          if (passed) continue;
          const next = mine && k === ch.next;
          const kk = next ? 2.5 * pulse : 1;
          _e.set(0, t * 0.3 + k, 0);
          rings.add(_m.compose(_p.copy(p), _q.setFromEuler(_e), _s.setScalar(1)), 1.6 * kk, 0.35 * kk, 2.4 * kk);
        }
      }
    }
    for (const p of pools) p.end();
  };

  const hud = () => {
    const markers: Marker[] = [];
    for (const ph of photos) if (!ph.item.done) markers.push({ x: ph.target.x, z: ph.target.z, kind: "photo" });
    for (let i = 0; i < caches.length; i++) {
      const c = caches[i];
      if (c.item.done) continue;
      const k = act?.kind === "cache" && act.i === i ? zoneR / CACHE_R : 1;
      markers.push({ x: c.box.x + c.off.x * k, z: c.box.z + c.off.z * k, kind: "cache" });
    }
    for (const q of reqs) if (!q.item.done) markers.push({ x: q.giver.x, z: q.giver.z, kind: "request" });
    for (const f of flocks) if (!f.item.done) markers.push({ x: f.home.x, z: f.home.z, kind: "pigeon" });
    for (const c of chals) markers.push({ x: c.start.x, z: c.start.z, kind: "challenge" });

    let objective: Objective | null = null;
    const prompts: { key: string; label: string }[] = [];
    const a = act;
    if (a?.kind === "cache") {
      const c = caches[a.i];
      objective = { title: "SIGNAL HUNT", text: pingText || "Find the hidden cache", progress: `Signal radius ${Math.round(zoneR)} m` };
      prompts.push({ key: "V", label: "Ping the signal" });
    } else if (a?.kind === "request") {
      const q = reqs[a.i];
      const R = REQUESTS[q.type];
      const text =
        q.type === 0 ? (rq.carried ? "Bring the cat back to its owner" : "Find the cat on the rooftop")
        : q.type === 1 ? "Deliver the pizza to the customer"
        : q.type === 2 ? (rq.carried ? "Bring the balloon back to the kid" : "Catch the floating balloon")
        : q.type === 3 ? "Tag the purse snatcher"
        : "Touch the 3 broken fuses";
      objective = { title: R.title.toUpperCase(), text };
      if (rq.timer > 0) objective.timer = rq.timer;
      if (q.type === 4) objective.progress = `${(rq.fixed & 1) + ((rq.fixed >> 1) & 1) + ((rq.fixed >> 2) & 1)}/3 fuses`;
      const target = q.type === 0 ? (rq.carried ? q.giver : rq.item) : q.type === 1 ? q.dest : q.type === 2 ? (rq.carried ? q.giver : rq.item) : q.type === 3 ? rq.item : null;
      if (target) markers.push({ x: target.x, z: target.z, kind: "checkpoint" });
      if (q.type === 4) for (let k = 0; k < 3; k++) if (!((rq.fixed >> k) & 1)) markers.push({ x: q.pts[k].x, z: q.pts[k].z, kind: "checkpoint" });
    } else if (a?.kind === "pigeon") {
      const f = flocks[a.i];
      const n = f.birds.filter((b) => b.caught).length;
      objective = { title: "PIGEONS", text: "Catch the pigeons in mid-air", timer: Math.max(0, flockT), progress: `${n}/${FLOCK_SIZE}` };
    } else if (a?.kind === "challenge") {
      const c = chals[a.i];
      const next = c.kind === 2 ? (ch.hit >= c.medals[0] - (c.pts.length - ch.next) ? 0 : 1) : medalOf(c, ch.t, false);
      if (c.kind === 0) {
        objective = { title: c.name.toUpperCase(), text: "Touch every drone", timer: c.limit - ch.t, progress: `${ch.next}/${c.pts.length} drones`, medal: next < 3 ? `${MEDALS[next]} ${fmt(c.medals[next])}` : undefined };
        for (let k = 0; k < c.pts.length; k++) if (!(ch.hit & (1 << k))) markers.push({ x: c.pts[k].x, z: c.pts[k].z, kind: "checkpoint" });
      } else if (c.kind === 1) {
        objective = { title: c.name.toUpperCase(), text: "Climb to the roof", timer: c.limit - ch.t, progress: `${Math.max(0, Math.round((c.tower?.maxY ?? 0) - lastY))} m to go`, medal: next < 3 ? `${MEDALS[next]} ${fmt(c.medals[next])}` : undefined };
      } else {
        objective = { title: c.name.toUpperCase(), text: ch.started ? "Dive through the rings" : "Jump off the roof", progress: `${ch.hit}/${c.pts.length} rings`, medal: `GOLD ${c.medals[0]} rings` };
        if (ch.started) objective.timer = c.limit - ch.t;
        if (ch.next < c.pts.length) markers.push({ x: c.pts[ch.next].x, z: c.pts[ch.next].z, kind: "checkpoint" });
      }
    }
    if (photoNear >= 0 && photoFacing) prompts.push({ key: "V", label: `Photo: ${photos[photoNear].name}` });

    const done = districts.map(() => [0, 0]);
    const completed: Record<string, number> = { photos: 0, caches: 0, requests: 0, pigeons: 0, challenges: 0 };
    for (const it of items) {
      done[it.district][1]++;
      if (!it.done) continue;
      done[it.district][0]++;
      completed[it.kind === "pigeon" ? "pigeons" : it.kind === "cache" ? "caches" : `${it.kind}s`]++;
    }
    return {
      objective,
      markers,
      prompts,
      districts: districts.map((d, i) => ({ name: d.name, pct: done[i][1] ? Math.round((100 * done[i][0]) / done[i][1]) : 100 })),
      completed,
    };
  };

  const setDetail = (level: 0 | 1 | 2) => {
    range = [180, 280, 420][level] ?? 280;
  };

  const dispose = () => {
    scene.remove(group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    dot.dispose();
  };

  return {
    update,
    hud,
    setDetail,
    dispose,
    activeSince: () => (act ? act.t0 : null),
    debug: { photos, caches, reqs, flocks, chals, items, districts, group, birdPos, state: () => ({ act, rq, ch }) },
  };
}

export type Activities = ReturnType<typeof createActivities>;
