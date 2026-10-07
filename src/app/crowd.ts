import * as THREE from "three";
import { BLOCKS, HALF, PERIOD, rng, type Box, type City } from "./city";
import { signal } from "./city-cars";
import { softDot } from "./city-textures";
import type { GameEvent, Marker, PlayerApi } from "./contracts";
import { ACC, RIG, cartGeometry, dogMesh, personMesh } from "./crowd-body";
import { buildNav, lateral } from "./crowd-nav";

const MAX = 560;
const MAX_DOGS = 40;
const MAX_CARTS = 16;
const MAX_FLASH = 48;
const STEAM = 8;
const LANE = [13.75, 14.45];
const CURB = 11.8;
const XWALK = 8.8;
const CART_LAT = 12.45;
const CART_ALONG = 17;
const SIDEWALK_PER_M2 = 0.0314;
const DETAIL = [
  { spacing: 8, groups: 4, radius: 90, steam: false },
  { spacing: 5.2, groups: 10, radius: 110, steam: true },
  { spacing: 3.9, groups: 16, radius: 120, steam: true },
];

const WALK = 0, FOLLOW = 1, STAND = 2;
const CHAT = 0, VENDOR = 1, CUSTOMER = 2;
const NONE = 0, WATCH = 1, CHEER = 2, FLEE = 3, COWER = 4, STUMBLE = 5, DODGE = 6, GREET = 7;
const LOOK = 0, POINT = 1, WAVE = 2, PHOTO = 3;
const BUMP = 0, FIVE = 1, SELFIE = 2;

const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x5c3a21, 0x3b2219, 0xa8714a, 0xd9a07a];
const COATS = [0x2b3a55, 0x7a1f2b, 0x1f1f24, 0x6b4f3a, 0x3d5a3c, 0xb8860b, 0xc0392b, 0x5d6d7e, 0x6c3483, 0x2e86c1, 0xe8e2d0, 0xd35400, 0x16a085, 0x3a3f47, 0xa04060];
const PANTS = [0x22252b, 0x2c3e50, 0x3b4f6b, 0x4a4a4a, 0x5b4636, 0x1b1b1b, 0x6d6152];
const BRIGHT = [0xc0392b, 0xf1c40f, 0x27ae60, 0xe67e22, 0xecf0f1, 0x2980b9, 0x9b59b6, 0xe84393, 0x1abc9c, 0x34495e, 0xd4ac0d];
const HAIR = [0x1a1110, 0x3b2314, 0x6a4e2e, 0xb8935a, 0x8c8c8c, 0x2b1b0f, 0xa0522d, 0x111111];
const SHOES = [0x1a1a1a, 0x3e2a1e, 0x5a3d2b, 0xdedede, 0x6b4a2f];
const BAGS = [0xc0392b, 0x1e8449, 0xf5f5f5, 0xd4ac0d, 0x7d3c98, 0xb03a2e, 0x1f6fb2];
const FUR = [0x3b2a1a, 0xc8a165, 0xf0e6d2, 0x1a1a1a, 0x8b5a2b, 0xd2b48c, 0x7a7a7a];

const rnd = Math.random;
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const lineAt = (k: number) => -HALF + k * PERIOD;
const okBlock = (i: number, j: number) => i >= -2 && i <= BLOCKS - 1 && j >= -2 && j <= BLOCKS + 1;
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const cx = (i: number, c: number, o: number) => (c === 0 || c === 3 ? lineAt(i) + o : lineAt(i + 1) - o);
const cz = (j: number, c: number, o: number) => (c < 2 ? lineAt(j) + o : lineAt(j + 1) - o);

function writeMatrix(e: Float32Array, n: number, yaw: number, w: number, h: number, x: number, y: number, z: number) {
  const k = n * 16;
  const cs = Math.cos(yaw) * w;
  const sn = Math.sin(yaw) * w;
  e[k] = cs;
  e[k + 1] = 0;
  e[k + 2] = -sn;
  e[k + 3] = 0;
  e[k + 4] = 0;
  e[k + 5] = h;
  e[k + 6] = 0;
  e[k + 7] = 0;
  e[k + 8] = sn;
  e[k + 9] = 0;
  e[k + 10] = cs;
  e[k + 11] = 0;
  e[k + 12] = x;
  e[k + 13] = y;
  e[k + 14] = z;
  e[k + 15] = 1;
}

class Ped {
  on = false;
  kind = WALK;
  sub = CHAT;
  x = 0;
  z = 0;
  yaw = 0;
  home = 0;
  speed = 1.3;
  moving = 0;
  phase = 0;
  seed = 0;
  bi = 0;
  bj = 0;
  c = 0;
  dir = 1;
  o = LANE[0];
  lat = 0;
  ek = -1;
  wn = 0;
  wi = 0;
  wx = [0, 0, 0];
  wz = [0, 0, 0];
  nbi = 0;
  nbj = 0;
  nc = 0;
  axis = 0;
  g = 0;
  waiting = false;
  delay = 0;
  crossed = false;
  re = NONE;
  reK = 0;
  reT = 0;
  reDur = 0;
  flashT = 0;
  vx = 0;
  vz = 0;
  gx = 0;
  gz = 0;
  hx = 0;
  hz = 0;
  gyaw = 0;
  lookX = 0;
  lookZ = 0;
  parent = -1;
  child = -1;
  dog = -1;
  cart = -1;
  greeted = false;
  w = 1;
  h = 1;
  head = 1;
  mask = 0;
  col = [0, 0, 0, 0, 0, 0, 0, 0];
  ang = new Float32Array(15);
  boxes: Box[] | null = null;
}

type Dog = { on: boolean; owner: number; x: number; z: number; yaw: number; phase: number; amp: number; wag: number; s: number; fur: number; ear: number; collar: number };
type Site = { key: number; x: number; z: number; yaw: number; type: number; vendor: number; customers: number[]; seen: boolean };
type Zone = { x: number; z: number; r: number };

export type Crowd = ReturnType<typeof createCrowd>;

export function createCrowd(scene: THREE.Scene, city: City) {
  const group = new THREE.Group();
  scene.add(group);
  const people = personMesh(MAX);
  const dogs = dogMesh(MAX_DOGS);
  group.add(people.mesh, dogs.mesh);
  const dot = softDot();

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: dot, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat, MAX + MAX_DOGS);
  shadows.frustumCulled = false;
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.count = 0;
  shadows.renderOrder = -1;
  group.add(shadows);

  const leash = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 3).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0x8a1f1f }), MAX_DOGS);
  leash.frustumCulled = false;
  leash.count = 0;
  group.add(leash);

  const cartMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
  const carts = (["hotdog", "pretzel", "coffee"] as const).map((k) => {
    const m = new THREE.InstancedMesh(cartGeometry(k), cartMat, MAX_CARTS);
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.count = 0;
    group.add(m);
    return m;
  });

  const steamPos = new Float32Array(MAX_CARTS * 2 * STEAM * 3);
  const steamGeo = new THREE.BufferGeometry();
  steamGeo.setAttribute("position", new THREE.BufferAttribute(steamPos, 3).setUsage(THREE.DynamicDrawUsage));
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({ size: 0.75, map: dot, color: 0xdfe6ee, transparent: true, opacity: 0.32, depthWrite: false }));
  steam.frustumCulled = false;
  group.add(steam);

  const flashPos = new Float32Array(MAX_FLASH * 3);
  const flashLife = new Float32Array(MAX_FLASH);
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute("position", new THREE.BufferAttribute(flashPos, 3).setUsage(THREE.DynamicDrawUsage));
  const flash = new THREE.Points(flashGeo, new THREE.PointsMaterial({ size: 1.6, map: dot, color: new THREE.Color(6, 6, 6.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  flash.frustumCulled = false;
  group.add(flash);

  const nav = buildNav(city.group);
  const peds = Array.from({ length: MAX }, () => new Ped());
  const pack: Dog[] = Array.from({ length: MAX_DOGS }, () => ({ on: false, owner: -1, x: 0, z: 0, yaw: 0, phase: 0, amp: 0, wag: 0, s: 1, fur: 0, ear: 0, collar: 0 }));
  const sites = new Map<number, Site>();
  const zones: Zone[] = [];
  const statics: number[] = [];

  let sigMeshes: THREE.Object3D[] | null = null;
  city.group.traverse((o) => {
    if (sigMeshes || !(o instanceof THREE.Group) || o.children.length !== 12) return;
    if (o.children.every((ch) => ch instanceof THREE.InstancedMesh && ch.geometry.type === "CircleGeometry")) sigMeshes = o.children;
  });
  const redNow = [false, false, false, false];
  const redStart = [-1e9, -1e9, -1e9, -1e9];

  let detail: 0 | 1 | 2 = 1;
  let clock = 0;
  let lastPx = 1e9;
  let lastPz = 1e9;
  let wasGrounded = true;
  let prevVy = 0;
  let cartsT = 0;
  let lastGasp = -9;
  let lastPhoto = -9;
  let lastPenalty = -9;
  let cand = -1;
  let player: PlayerApi | null = null;
  let cam: THREE.Camera | null = null;
  let freeHint = 0;
  const tmp = new Float32Array(15);
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  const alloc = () => {
    for (let n = 0; n < MAX; n++) {
      const i = (freeHint + n) % MAX;
      if (!peds[i].on) {
        freeHint = i + 1;
        return i;
      }
    }
    return -1;
  };

  const free = (i: number) => {
    const p = peds[i];
    if (!p.on) return;
    p.on = false;
    if (p.child >= 0) free(p.child);
    if (p.dog >= 0) pack[p.dog].on = false;
  };

  const dress = (p: Ped, kid: boolean) => {
    p.col[0] = pick(SKIN);
    p.col[1] = pick(COATS);
    p.col[2] = pick(PANTS);
    p.col[3] = pick(BRIGHT);
    p.col[4] = pick(BRIGHT);
    p.col[5] = pick(SHOES);
    p.col[6] = pick(HAIR);
    p.col[7] = pick(BAGS);
    let m = 0;
    const hr = rnd();
    if (hr < 0.42) m |= ACC.beanie;
    else if (hr < 0.54) m |= ACC.hat;
    else if (hr < 0.62) m |= ACC.earmuffs;
    if (rnd() < 0.55) m |= ACC.scarf;
    if (!kid && rnd() < 0.3) m |= ACC.longCoat;
    if (rnd() < 0.3) m |= ACC.longHair;
    if (rnd() < (kid ? 0.45 : 0.1)) m |= ACC.backpack;
    p.mask = m;
    p.h = kid ? 0.55 + rnd() * 0.12 : 0.92 + rnd() * 0.16;
    p.w = kid ? 0.95 : 0.88 + rnd() * rnd() * 0.45;
    p.head = kid ? 1.3 : 1;
    p.seed = rnd() * 100;
    p.phase = rnd() * 6;
    p.re = NONE;
    p.greeted = false;
    p.parent = p.child = p.dog = p.cart = -1;
    p.vx = p.vz = 0;
    p.wn = 0;
    p.waiting = false;
    p.crossed = false;
    p.boxes = null;
    p.ang.fill(0);
  };

  const setDir = (p: Ped, dir: number) => {
    p.dir = dir;
    p.o = LANE[dir > 0 ? 0 : 1] + (p.seed % 1 - 0.5) * 0.25;
  };

  const spawnWalker = (px: number, pz: number, rmin: number, rmax: number) => {
    for (let tries = 0; tries < 8; tries++) {
      const i = Math.floor((px - lineAt(0)) / PERIOD + (rnd() - 0.5) * 2 * (rmax / PERIOD));
      const j = Math.floor((pz - lineAt(0)) / PERIOD + (rnd() - 0.5) * 2 * (rmax / PERIOD));
      if (!okBlock(i, j)) continue;
      const e = Math.floor(rnd() * 4);
      const dir = rnd() < 0.5 ? 1 : -1;
      const o = LANE[dir > 0 ? 0 : 1];
      const t = rnd();
      const x = cx(i, e, o) + (cx(i, (e + 1) % 4, o) - cx(i, e, o)) * t;
      const z = cz(j, e, o) + (cz(j, (e + 1) % 4, o) - cz(j, e, o)) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < rmin || d > rmax || !free2(x, z)) continue;
      const k = alloc();
      if (k < 0) return false;
      const p = peds[k];
      dress(p, false);
      p.on = true;
      p.kind = WALK;
      p.bi = i;
      p.bj = j;
      setDir(p, dir);
      p.c = dir > 0 ? (e + 1) % 4 : e;
      p.x = x;
      p.z = z;
      p.lat = e % 2 ? x : z;
      p.speed = 1.15 + rnd() * 0.45;
      const roll = rnd();
      if (roll < 0.3) {
        p.mask |= rnd() < 0.5 ? ACC.bagL | ACC.bagR : rnd() < 0.5 ? ACC.bagL : ACC.bagR;
        p.speed -= 0.15;
      }
      p.yaw = Math.atan2(cx(i, p.c, p.o) - x, cz(j, p.c, p.o) - z);
      if (roll > 0.88) {
        const kk = alloc();
        if (kk >= 0) {
          const kid = peds[kk];
          dress(kid, true);
          kid.on = true;
          kid.kind = FOLLOW;
          kid.parent = k;
          kid.x = x + Math.cos(p.yaw) * 0.5;
          kid.z = z - Math.sin(p.yaw) * 0.5;
          kid.yaw = p.yaw;
          p.child = kk;
          p.mask &= ~ACC.bagL;
          p.speed = Math.min(p.speed, 1.2);
        }
      } else if (roll > 0.8) {
        const di = pack.findIndex((dg) => !dg.on);
        if (di >= 0) {
          const dg = pack[di];
          dg.on = true;
          dg.owner = k;
          dg.x = x + Math.sin(p.yaw) * 1.3;
          dg.z = z + Math.cos(p.yaw) * 1.3;
          dg.yaw = p.yaw;
          dg.s = 0.75 + rnd() * 0.55;
          dg.fur = pick(FUR);
          dg.ear = rnd() < 0.5 ? dg.fur : pick(FUR);
          dg.collar = pick(BRIGHT);
          p.dog = di;
          p.mask &= ~ACC.bagR;
        }
      }
      return true;
    }
    return false;
  };

  const spawnGroup = (px: number, pz: number, rmin: number, rmax: number) => {
    const spots = city.streetSpots;
    if (!spots.length) return false;
    for (let tries = 0; tries < 12; tries++) {
      const s = spots[Math.floor(rnd() * spots.length)];
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d < rmin || d > rmax) continue;
      let x = s.x;
      let z = s.z;
      const lx = (((x - lineAt(0)) % PERIOD) + PERIOD) % PERIOD;
      const lz = (((z - lineAt(0)) % PERIOD) + PERIOD) % PERIOD;
      const dx = Math.min(lx, PERIOD - lx);
      const dz = Math.min(lz, PERIOD - lz);
      if (dx > 10 && dx < 16.5) x += (lx < PERIOD / 2 ? 1 : -1) * (12.4 - dx);
      if (dz > 10 && dz < 16.5) z += (lz < PERIOD / 2 ? 1 : -1) * (12.4 - dz);
      const n = 2 + Math.floor(rnd() * rnd() * 3.2);
      const a0 = rnd() * Math.PI * 2;
      const rad = 0.5 + n * 0.05;
      let clear = free2(x, z);
      for (let m = 0; m < n && clear; m++) clear = free2(x + Math.sin(a0 + (m / n) * Math.PI * 2) * rad, z + Math.cos(a0 + (m / n) * Math.PI * 2) * rad);
      if (!clear) continue;
      for (let m = 0; m < n; m++) {
        const k = alloc();
        if (k < 0) return false;
        const p = peds[k];
        dress(p, rnd() < 0.12);
        p.on = true;
        p.kind = STAND;
        p.sub = CHAT;
        const a = a0 + (m / n) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
        p.x = p.hx = x + Math.sin(a) * rad;
        p.z = p.hz = z + Math.cos(a) * rad;
        p.yaw = p.home = a + Math.PI;
        p.lookX = x;
        p.lookZ = z;
        if (rnd() < 0.25) p.mask |= ACC.bagL;
      }
      return true;
    }
    return false;
  };

  const siteAt = (k: number, l: number): Site | null => {
    const r = rng(k * 7919 + l * 104729 + 17);
    if (r() > 0.5) return null;
    const sx = r() < 0.5 ? 1 : -1;
    const sz = r() < 0.5 ? 1 : -1;
    if (!okBlock(sx > 0 ? k : k - 1, sz > 0 ? l : l - 1)) return null;
    const X = lineAt(k);
    const Z = lineAt(l);
    const type = Math.floor(r() * 3);
    if (r() < 0.5) return { key: k * 1000 + l, x: X + sx * CART_ALONG, z: Z + sz * CART_LAT, yaw: sz > 0 ? 0 : Math.PI, type, vendor: -1, customers: [], seen: true };
    return { key: k * 1000 + l, x: X + sx * CART_LAT, z: Z + sz * CART_ALONG, yaw: (sx * Math.PI) / 2, type, vendor: -1, customers: [], seen: true };
  };

  const standAt = (x: number, z: number, yaw: number, sub: number) => {
    const k = alloc();
    if (k < 0) return -1;
    const p = peds[k];
    dress(p, sub === CUSTOMER && rnd() < 0.15);
    p.on = true;
    p.kind = STAND;
    p.sub = sub;
    p.x = p.hx = x;
    p.z = p.hz = z;
    p.yaw = p.home = yaw;
    return k;
  };

  const refreshCarts = (px: number, pz: number) => {
    const R = DETAIL[detail].radius + 10;
    for (const s of sites.values()) s.seen = false;
    const k0 = Math.max(0, Math.floor((px - R - lineAt(0)) / PERIOD));
    const k1 = Math.min(BLOCKS, Math.ceil((px + R - lineAt(0)) / PERIOD));
    const l0 = Math.max(-1, Math.floor((pz - R - lineAt(0)) / PERIOD));
    const l1 = Math.min(BLOCKS + 1, Math.ceil((pz + R - lineAt(0)) / PERIOD));
    for (let k = k0; k <= k1; k++) {
      for (let l = l0; l <= l1; l++) {
        const key = k * 1000 + l;
        const old = sites.get(key);
        if (old) {
          old.seen = Math.hypot(old.x - px, old.z - pz) < R;
          continue;
        }
        const s = siteAt(k, l);
        if (!s || Math.hypot(s.x - px, s.z - pz) > R || !free2(s.x, s.z)) continue;
        if ([...sites.values()].filter((o) => o.type === s.type).length >= MAX_CARTS) continue;
        const fx = Math.sin(s.yaw);
        const fz = Math.cos(s.yaw);
        s.vendor = standAt(s.x - fx * 0.75, s.z - fz * 0.75, s.yaw, VENDOR);
        const n = Math.floor(rnd() * 3);
        for (let m = 0; m < n; m++) {
          const lat = (m - (n - 1) / 2) * 0.75 + (rnd() - 0.5) * 0.2;
          const c = standAt(s.x + fx * 0.85 + fz * lat, s.z + fz * 0.85 - fx * lat, s.yaw + Math.PI + (rnd() - 0.5) * 0.4, CUSTOMER);
          if (c >= 0) s.customers.push(c);
        }
        for (const i of [s.vendor, ...s.customers]) if (i >= 0) peds[i].cart = key;
        sites.set(key, s);
      }
    }
    for (const [key, s] of sites) {
      if (s.seen) continue;
      for (const i of [s.vendor, ...s.customers]) if (i >= 0 && peds[i].cart === key) free(i);
      sites.delete(key);
    }
    const counts = [0, 0, 0];
    for (const s of sites.values()) {
      const n = counts[s.type]++;
      m4.makeRotationY(s.yaw).setPosition(s.x, 0, s.z);
      carts[s.type].setMatrixAt(n, m4);
    }
    carts.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  };

  const updateSignals = (dt: number) => {
    for (let g = 0; g < 2; g++) {
      for (let a = 0; a < 2; a++) {
        const q = g * 2 + a;
        const red = sigMeshes ? sigMeshes[q * 3 + 2].visible : signal(clock, a, g) === 2;
        if (red && !redNow[q]) redStart[q] = clock > dt * 1.5 ? clock : -1e9;
        redNow[q] = red;
      }
    }
  };
  const canGo = (p: Ped) => {
    const q = p.g * 2 + p.axis;
    return redNow[q] && clock - redStart[q] < 1.0 + p.delay;
  };

  const planCross = (p: Ped) => {
    const c = p.c;
    const left = c === 0 || c === 3;
    const k = left ? p.bi : p.bi + 1;
    const l = c < 2 ? p.bj : p.bj + 1;
    const sx = left ? 1 : -1;
    const sz = c < 2 ? 1 : -1;
    const X = lineAt(k);
    const Z = lineAt(l);
    let xRoad = rnd() < 0.5;
    if (xRoad && !okBlock(p.bi - sx, p.bj)) xRoad = false;
    if (!xRoad && !okBlock(p.bi, p.bj - sz)) {
      if (!okBlock(p.bi - sx, p.bj)) return false;
      xRoad = true;
    }
    const dir = rnd() < 0.5 ? 1 : -1;
    setDir(p, dir);
    const jit = (rnd() - 0.5) * 1.0;
    if (xRoad) {
      p.nbi = p.bi - sx;
      p.nbj = p.bj;
      p.nc = [1, 0, 3, 2][c];
      p.axis = 1;
      p.wx[0] = X + sx * (CURB + rnd() * 0.9);
      p.wz[0] = Z + sz * (XWALK + jit);
      p.wx[1] = X - sx * CURB;
      p.wz[1] = p.wz[0];
      p.wx[2] = X - sx * p.o;
      p.wz[2] = Z + sz * p.o;
    } else {
      p.nbi = p.bi;
      p.nbj = p.bj - sz;
      p.nc = [3, 2, 1, 0][c];
      p.axis = 0;
      p.wz[0] = Z + sz * (CURB + rnd() * 0.9);
      p.wx[0] = X + sx * (XWALK + jit);
      p.wz[1] = Z - sz * CURB;
      p.wx[1] = p.wx[0];
      p.wz[2] = Z - sz * p.o;
      p.wx[2] = X + sx * p.o;
    }
    p.g = (k + l) & 1;
    p.wn = 3;
    p.wi = 0;
    p.delay = rnd() * 1.2;
    return true;
  };

  let zd = Infinity;
  let zi = -1;
  const nearestZone = (x: number, z: number) => {
    zd = Infinity;
    zi = -1;
    for (let i = 0; i < zones.length; i++) {
      const d = Math.hypot(x - zones[i].x, z - zones[i].z) - zones[i].r;
      if (d < zd) {
        zd = d;
        zi = i;
      }
    }
  };

  const startFlee = (p: Ped, ev: GameEvent[]) => {
    p.re = FLEE;
    p.reT = 0;
    p.reDur = 999;
    p.waiting = false;
    p.boxes = null;
    if (clock - lastGasp > 2.5) {
      lastGasp = clock;
      ev.push({ type: "sfx", name: "gasp", volume: 0.8 });
    }
    if (p.kind !== WALK) return;
    if (p.wn > 0 && p.wi <= 1 && (p.wi === 0 || Math.hypot(p.x - p.wx[0], p.z - p.wz[0]) < 1.5)) p.wn = 0;
    if (p.wn > 0) return;
    const Zn = zones[zi];
    const prev = (p.c - p.dir + 4) % 4;
    const dc = Math.hypot(cx(p.bi, p.c, p.o) - Zn.x, cz(p.bj, p.c, p.o) - Zn.z);
    const dp = Math.hypot(cx(p.bi, prev, p.o) - Zn.x, cz(p.bj, prev, p.o) - Zn.z);
    if (dc < dp) {
      p.c = prev;
      setDir(p, -p.dir);
    }
  };

  const react = (p: Ped, re: number, dur: number, k = 0) => {
    p.re = re;
    p.reT = 0;
    p.reDur = dur;
    p.reK = k;
    p.flashT = 0.4 + rnd() * 1.2;
  };

  const calm = (p: Ped) => p.re === NONE || p.re === WATCH || p.re === DODGE;

  const watchKind = () => {
    const r = rnd();
    return r < 0.3 ? LOOK : r < 0.5 ? POINT : r < 0.72 ? WAVE : PHOTO;
  };

  const addFlash = (x: number, y: number, z: number) => {
    for (let i = 0; i < MAX_FLASH; i++) {
      if (flashLife[i] > 0) continue;
      flashLife[i] = 0.09;
      flashPos[i * 3] = x;
      flashPos[i * 3 + 1] = y;
      flashPos[i * 3 + 2] = z;
      return;
    }
  };

  const hand = (p: Ped, side: number, out: THREE.Vector3) => {
    const a = p.ang;
    const pitch = side > 0 ? a[4] : a[7];
    const roll = side > 0 ? a[5] : a[8];
    const fore = side > 0 ? a[6] : a[9];
    const L = RIG.elbY - RIG.handY;
    let x = 0;
    let y = -L * Math.cos(fore) + (RIG.elbY - RIG.shY);
    let z = L * Math.sin(fore);
    const zr = side * roll;
    [x, y] = [Math.cos(zr) * x - Math.sin(zr) * y, Math.sin(zr) * x + Math.cos(zr) * y];
    [y, z] = [Math.cos(pitch) * y + Math.sin(pitch) * z, -Math.sin(pitch) * y + Math.cos(pitch) * z];
    x += side * RIG.shX;
    y += RIG.shY - RIG.hipY;
    [x, y] = [Math.cos(a[3]) * x - Math.sin(a[3]) * y, Math.sin(a[3]) * x + Math.cos(a[3]) * y];
    const lean = -a[0];
    [y, z] = [Math.cos(lean) * y + Math.sin(lean) * z, -Math.sin(lean) * y + Math.cos(lean) * z];
    y += RIG.hipY + a[14];
    x *= p.w;
    y *= p.h;
    z = z * p.w + 0.06;
    const cs = Math.cos(p.yaw);
    const sn = Math.sin(p.yaw);
    return out.set(p.x + cs * x + sn * z, y, p.z - sn * x + cs * z);
  };

  const onLand = (px: number, pz: number, vy: number, ev: GameEvent[]) => {
    const hard = vy < -26;
    let nearest = Infinity;
    let close = 0;
    for (const p of peds) {
      if (!p.on) continue;
      const d = Math.hypot(p.x - px, p.z - pz);
      nearest = Math.min(nearest, d);
      if (hard && d < 6) {
        react(p, STUMBLE, 1.1 + rnd() * 0.5);
        close++;
      } else if (d < 24 && calm(p) && rnd() < 0.8) react(p, WATCH, 4 + rnd() * 5, watchKind());
    }
    if (hard && nearest < 2) {
      if (clock - lastPenalty > 2) {
        lastPenalty = clock;
        ev.push({ type: "penalty", reason: "Careful! Civilians nearby" });
      }
    }
    if (hard && close && clock - lastGasp > 1) {
      lastGasp = clock;
      ev.push({ type: "sfx", name: "gasp" });
    }
  };

  const pose = (p: Ped, t: number) => {
    const o = tmp;
    const ph = p.phase;
    const mv = p.moving;
    const run = sstep(2.4, 4, mv);
    const amp = Math.min(1, mv / 1.3) * (0.42 + run * 0.38);
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const sd = p.seed;
    o[0] = 0.04 + run * 0.28 + (p.h < 0.75 ? 0 : 0.02);
    o[1] = Math.sin(t * 0.3 + sd) * 0.25 * (mv > 0.2 ? 0.4 : 1);
    o[2] = 0;
    o[3] = Math.sin(t * 0.9 + sd) * 0.025;
    o[4] = -amp * s + 0.04;
    o[5] = 0.12;
    o[6] = 0.2 + amp * 0.3 + run * 1.1;
    o[7] = amp * s + 0.04;
    o[8] = 0.12;
    o[9] = o[6];
    o[10] = amp * s;
    o[11] = -amp * s;
    o[12] = 0.06 + amp * (1.5 + run) * Math.max(0, c);
    o[13] = 0.06 + amp * (1.5 + run) * Math.max(0, -c);
    o[14] = -amp * 0.07 * Math.abs(s) + run * 0.04 * Math.abs(c);
    if (p.mask & (ACC.bagL | ACC.bagR)) {
      if (p.mask & ACC.bagL) o[5] += 0.1;
      if (p.mask & ACC.bagR) o[8] += 0.1;
    }
    if (p.child >= 0) {
      o[4] = 0.15;
      o[5] = 0.3;
      o[6] = 0.3;
    }
    if (p.kind === FOLLOW) {
      o[7] = 0.35;
      o[8] = 0.55;
      o[9] = 0.2;
    }
    if (p.dog >= 0) {
      o[7] = 0.5 + amp * 0.1 * s;
      o[9] = 0.6;
    }
    let phone = false;
    if (p.kind === STAND && p.re === NONE) {
      if (p.sub === VENDOR) {
        const serve = Math.sin(t * 0.7 + sd) > 0.6;
        o[0] = 0.18;
        o[4] = 0.55;
        o[6] = 0.75;
        o[7] = serve ? 1.25 : 0.55;
        o[9] = serve ? 0.4 : 0.75;
      } else if (sd % 3 < 1) {
        o[4] = o[7] = 0.5;
        o[5] = o[8] = -0.35;
        o[6] = o[9] = 1.95;
      } else if (p.sub === CUSTOMER && sd % 2 < 1) {
        phone = true;
        o[7] = 0.45;
        o[9] = 1.5;
        o[2] = -0.45;
      } else if (Math.sin(t * 1.3 + sd) > 0.35) {
        o[7] = 0.55 + 0.2 * Math.sin(t * 6 + sd);
        o[8] = 0.2;
        o[9] = 1.2 + 0.25 * Math.sin(t * 4.3 + sd);
      }
    }
    if (p.kind === WALK && p.waiting && sd % 4 < 1) {
      phone = true;
      o[7] = 0.45;
      o[9] = 1.5;
      o[2] = -0.45;
    }
    const u = p.reDur > 0 ? p.reT / p.reDur : 0;
    switch (p.re) {
      case WATCH:
        if (p.reK === POINT) {
          o[7] = 1.5;
          o[8] = 0.05;
          o[9] = 0.05;
        } else if (p.reK === WAVE) {
          o[7] = 2.35;
          o[8] = 0.45 + 0.35 * Math.sin(t * 11 + sd);
          o[9] = 0.45;
        } else if (p.reK === PHOTO) {
          phone = true;
          o[4] = 1.3;
          o[5] = -0.3;
          o[6] = 0.75;
          o[7] = 1.35;
          o[8] = -0.25;
          o[9] = 0.6;
        }
        break;
      case CHEER: {
        const w = t * 10 + sd;
        if (sd % 2 < 1) {
          o[4] = o[7] = 2.75 + 0.2 * Math.sin(w);
          o[5] = o[8] = 0.35;
          o[6] = o[9] = 0.25 + 0.3 * Math.sin(w);
          o[14] = Math.max(0, Math.sin(w)) * 0.14;
        } else {
          o[4] = o[7] = 1.2;
          o[5] = o[8] = -0.5 + 0.22 * Math.sin(t * 16 + sd);
          o[6] = o[9] = 0.9;
        }
        o[2] = 0.25;
        break;
      }
      case COWER:
      case STUMBLE: {
        const k = p.re === COWER ? 1 : Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.75;
        o[14] = -0.42 * k;
        o[10] = o[11] = 1.5 * k;
        o[12] = o[13] = 2.2 * k;
        o[0] = 0.7 * k;
        o[4] = o[7] = 2.6 * k;
        o[5] = o[8] = 0.55 * k;
        o[6] = o[9] = 1.9 * k;
        o[2] = -0.5 * k;
        o[3] = 0.04 * Math.sin(t * 31 + sd) * k;
        break;
      }
      case DODGE:
        o[0] = -0.15;
        o[4] = o[7] = 0.9;
        o[5] = o[8] = 0.7;
        o[6] = o[9] = 1.3;
        break;
      case FLEE:
        o[6] = o[9] = 1.5;
        if (Math.sin(t * 1.7 + sd) > 0.6) o[1] = 1.1;
        break;
      case GREET: {
        const ext = sstep(0.08, 0.3, u) * (1 - sstep(0.78, 0.98, u));
        if (p.reK === BUMP) {
          o[7] = 1.45 * ext;
          o[9] = 0.15 + 0.5 * (1 - ext);
        } else if (p.reK === FIVE) {
          o[7] = 2.65 * ext;
          o[8] = 0.12;
          o[9] = 0.2;
        } else {
          phone = ext > 0.1;
          o[7] = 2.2 * ext;
          o[8] = 0.25 * ext;
          o[9] = 0.5 * ext;
          o[4] = 0.35 * ext;
          o[5] = 1.25 * ext;
          o[6] = 1.3 * ext;
          o[3] = 0.12 * ext;
          o[2] = 0.15;
        }
        break;
      }
    }
    return phone;
  };

  const steerToward = (p: Ped, tx: number, tz: number, spd: number, dt: number) => {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < spd * dt + 0.04) {
      p.x = tx;
      p.z = tz;
      return true;
    }
    p.x += (dx / d) * spd * dt;
    p.z += (dz / d) * spd * dt;
    if (spd > 0.05) p.yaw += wrap(Math.atan2(dx, dz) - p.yaw) * Math.min(1, dt * 8);
    return false;
  };

  const free2 = (x: number, z: number) => !nav.blocked(x, z) && !nav.blocked(x + 0.2, z) && !nav.blocked(x - 0.2, z) && !nav.blocked(x, z + 0.2) && !nav.blocked(x, z - 0.2);

  const walkEdge = (p: Ped, tx: number, tz: number, spd: number, dt: number) => {
    const prev = (p.c - p.dir + 4) % 4;
    const lo = Math.min(p.c, prev);
    const alongX = Math.max(p.c, prev) - lo === 1 && lo !== 1;
    const along = alongX ? tx - p.x : tz - p.z;
    const s = Math.sign(along) || 1;
    const step = Math.min(Math.abs(along), spd * dt);
    const pref = alongX ? tz : tx;
    const ek = ((p.bi * 64 + p.bj) * 4 + p.c) * 2 + (p.dir > 0 ? 1 : 0);
    if (ek !== p.ek) {
      p.ek = ek;
      p.lat = pref;
    }
    const cur = alongX ? p.z : p.x;
    const ahead = (alongX ? p.x : p.z) + s * 1.1;
    const ln = lineAt(Math.round((pref + HALF) / PERIOD));
    const side = pref >= ln ? 1 : -1;
    const ok = (lat: number) => {
      for (let d = -0.7; d <= 2.2; d += 0.7) if (alongX ? !free2(ahead + s * d, lat) : !free2(lat, ahead + s * d)) return false;
      return true;
    };
    if (ok(pref)) p.lat = pref;
    else if (!ok(p.lat)) {
      const l0 = Math.abs(pref - ln);
      p.lat = ln + side * 10.9;
      for (let k = 1; k <= 34; k++) {
        const l = l0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 0.25;
        if (l < 10.8 || l > 14.7) continue;
        if (ok(ln + side * l)) {
          p.lat = ln + side * l;
          break;
        }
      }
    }
    const dl = Math.max(-2.4 * dt, Math.min(2.4 * dt, p.lat - cur));
    if (alongX) {
      p.x += s * step;
      p.z += dl;
    } else {
      p.z += s * step;
      p.x += dl;
    }
    const mx = alongX ? s * step : dl;
    const mz = alongX ? dl : s * step;
    if (step > 1e-4) p.yaw += wrap(Math.atan2(mx, mz) - p.yaw) * Math.min(1, dt * 8);
    return Math.abs(along) <= spd * dt + 1e-3;
  };

  const stepWalker = (p: Ped, dt: number) => {
    const fleeing = p.re === FLEE;
    const frozen = p.re === WATCH || p.re === CHEER || p.re === COWER || p.re === STUMBLE || p.re === GREET;
    if (p.waiting) {
      p.moving = 0;
      p.yaw += wrap(Math.atan2(p.wx[1] - p.x, p.wz[1] - p.z) - p.yaw) * Math.min(1, dt * 5);
      if (fleeing || !canGo(p)) return;
      p.waiting = false;
    }
    let spd = frozen ? 0 : fleeing ? 4.6 : p.speed * (p.re === DODGE ? 0.6 : 1);
    const crossing = p.wn > 0 && p.wi === 1;
    if (crossing && !frozen) spd = fleeing ? 4.6 : redNow[p.g * 2 + p.axis] ? Math.max(2.25, p.speed) : 4;
    if (crossing && frozen) spd = 3.5;
    p.moving = spd;
    if (spd === 0) return;
    const tx = p.wn > 0 ? p.wx[p.wi] : cx(p.bi, p.c, p.o);
    const tz = p.wn > 0 ? p.wz[p.wi] : cz(p.bj, p.c, p.o);
    if (p.wn > 0 ? !steerToward(p, tx, tz, spd, dt) : !walkEdge(p, tx, tz, spd, dt)) return;
    if (p.wn > 0) {
      if (p.wi === 0) {
        p.wi = 1;
        p.waiting = !fleeing;
      } else if (p.wi === 1) p.wi = 2;
      else {
        p.wn = 0;
        p.bi = p.nbi;
        p.bj = p.nbj;
        p.c = (p.nc + p.dir + 4) % 4;
        p.crossed = true;
      }
      return;
    }
    if (fleeing && zi >= 0) {
      const Zn = zones[zi];
      const a = (p.c + 1) % 4;
      const b = (p.c + 3) % 4;
      const da = Math.hypot(cx(p.bi, a, p.o) - Zn.x, cz(p.bj, a, p.o) - Zn.z);
      const db = Math.hypot(cx(p.bi, b, p.o) - Zn.x, cz(p.bj, b, p.o) - Zn.z);
      setDir(p, da >= db ? 1 : -1);
      p.c = da >= db ? a : b;
      return;
    }
    if (!p.crossed && rnd() < 0.5 && planCross(p)) return;
    p.crossed = false;
    p.c = (p.c + p.dir + 4) % 4;
  };

  const blocked = (p: Ped, x: number, z: number) => {
    if (!p.boxes) p.boxes = city.near(p.x, p.z, 30);
    for (const b of p.boxes) if (x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4) return true;
    return false;
  };

  const stepFree = (p: Ped, dt: number) => {
    p.moving = 0;
    if (p.kind === FOLLOW && p.parent >= 0) {
      const q = peds[p.parent];
      const tx = q.x + Math.cos(q.yaw) * 0.5;
      const tz = q.z - Math.sin(q.yaw) * 0.5;
      const d = Math.hypot(tx - p.x, tz - p.z);
      const spd = Math.min(d * 3, 5.5);
      if (d > 0.03) {
        steerToward(p, tx, tz, spd, dt);
        p.moving = spd;
      }
      if (d < 0.3) p.yaw += wrap(q.yaw - p.yaw) * Math.min(1, dt * 4);
      if (p.re === NONE && q.re !== NONE && q.re !== GREET && q.re !== DODGE) react(p, q.re, q.reDur - q.reT, q.reK);
      else if (q.re === NONE && (p.re === COWER || p.re === FLEE)) p.re = NONE;
      return;
    }
    if (p.re === FLEE && zi >= 0) {
      const Zn = zones[zi];
      let dx = p.x - Zn.x;
      let dz = p.z - Zn.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      const spd = 4.2 * dt;
      for (const turn of [0, 1, -1]) {
        const ux = turn ? -dz * turn : dx;
        const uz = turn ? dx * turn : dz;
        if (blocked(p, p.x + ux * spd * 4, p.z + uz * spd * 4)) continue;
        p.x += ux * spd;
        p.z += uz * spd;
        p.yaw += wrap(Math.atan2(ux, uz) - p.yaw) * Math.min(1, dt * 8);
        p.moving = 4.2;
        return;
      }
      p.re = COWER;
      p.reT = 0;
      return;
    }
    if (p.re !== NONE || p.kind !== STAND) return;
    const back = Math.hypot(p.hx - p.x, p.hz - p.z);
    if (back > 0.05) {
      steerToward(p, p.hx, p.hz, Math.min(1.3, back * 3), dt);
      p.moving = Math.min(1.3, back * 3);
    } else p.yaw += wrap(p.home - p.yaw) * Math.min(1, dt * 3);
  };

  const updateDogs = (dt: number) => {
    let n = 0;
    const iA = dogs.attrs.iA.array as Float32Array;
    const iC = dogs.attrs.iCol0.array as Float32Array;
    const mat = dogs.mesh.instanceMatrix.array as Float32Array;
    let ln = 0;
    for (let i = 0; i < MAX_DOGS; i++) {
      const d = pack[i];
      if (!d.on) continue;
      const o = peds[d.owner];
      if (!o.on) {
        d.on = false;
        continue;
      }
      const fx = Math.sin(o.yaw);
      const fz = Math.cos(o.yaw);
      const tx = o.x + fx * 1.25 - fz * 0.45;
      const tz = o.z + fz * 1.25 + fx * 0.45;
      const dx = tx - d.x;
      const dz = tz - d.z;
      const dist = Math.hypot(dx, dz);
      const spd = dist < 0.05 ? 0 : Math.min(dist * 3, 7);
      if (spd > 0) {
        d.x += (dx / dist) * spd * dt;
        d.z += (dz / dist) * spd * dt;
        if (spd > 0.3) d.yaw += wrap(Math.atan2(dx, dz) - d.yaw) * Math.min(1, dt * 7);
      }
      d.phase += spd * dt * 10 / d.s;
      d.amp += (Math.min(1, spd / 1.2) * 0.55 - d.amp) * Math.min(1, dt * 8);
      d.wag += dt * (o.re === CHEER || o.re === GREET ? 22 : 9);
      iA[n * 4] = d.phase;
      iA[n * 4 + 1] = d.amp;
      iA[n * 4 + 2] = d.wag;
      iA[n * 4 + 3] = Math.sin(clock * 0.7 + i) * 0.4;
      iC[n * 4] = d.fur;
      iC[n * 4 + 1] = d.ear;
      iC[n * 4 + 2] = d.collar;
      writeMatrix(mat, n, d.yaw, d.s, d.s, d.x, 0, d.z);
      shadowAt(d.x, d.z, 0.7 * d.s);
      hand(o, -1, v3);
      v3b.set(d.x + Math.sin(d.yaw) * 0.3 * d.s, 0.42 * d.s, d.z + Math.cos(d.yaw) * 0.3 * d.s);
      const len = v3.distanceTo(v3b);
      if (len > 0.05) {
        m4.lookAt(v3b, v3, UP);
        m4.scale(v3b.set(1, 1, len)).setPosition(v3);
        leash.setMatrixAt(ln++, m4);
      }
      n++;
    }
    dogs.mesh.count = n;
    leash.count = ln;
    dogs.mesh.instanceMatrix.needsUpdate = true;
    leash.instanceMatrix.needsUpdate = true;
    dogs.attrs.iA.needsUpdate = true;
    dogs.attrs.iCol0.needsUpdate = true;
  };

  let shadowN = 0;
  const shadowArr = shadows.instanceMatrix.array as Float32Array;
  const shadowAt = (x: number, z: number, s: number) => writeMatrix(shadowArr, shadowN++, 0, s, 1, x, 0.025, z);

  const update = (dtIn: number, t: number, pl: PlayerApi, camera: THREE.Camera): GameEvent[] => {
    const ev: GameEvent[] = [];
    const dt = Math.min(dtIn, 0.1);
    clock += dt;
    player = pl;
    cam = camera;
    const cfg = DETAIL[detail];
    const px = pl.pos.x;
    const pz = pl.pos.z;
    const feet = pl.pos.y - 0.95;
    const jump = Math.hypot(px - lastPx, pz - lastPz) > 60;
    lastPx = px;
    lastPz = pz;
    updateSignals(dt);

    if (pl.grounded && !wasGrounded && feet < 2.5) onLand(px, pz, prevVy, ev);
    wasGrounded = pl.grounded;
    prevVy = pl.vel.y;

    cartsT -= dt;
    if (cartsT <= 0 || jump) {
      cartsT = 0.5;
      refreshCarts(px, pz);
    }

    const R = cfg.radius;
    let walkers = 0;
    let chatters = 0;
    let far = -1;
    let farD = 0;
    for (let i = 0; i < MAX; i++) {
      const p = peds[i];
      if (!p.on) continue;
      if (p.kind === FOLLOW) {
        if (p.parent < 0 || !peds[p.parent].on) p.on = false;
        continue;
      }
      if (p.cart >= 0) continue;
      if (Math.hypot(p.x - px, p.z - pz) > R + 15) {
        free(i);
        continue;
      }
      if (p.kind === WALK) {
        walkers++;
        const d = Math.hypot(p.x - px, p.z - pz);
        if (d > farD) {
          farD = d;
          far = i;
        }
      } else chatters++;
    }
    const target = Math.round((Math.PI * R * R * SIDEWALK_PER_M2) / cfg.spacing);
    if (far >= 0 && walkers > target * 1.1) free(far);
    const rmin = jump || clock < 0.5 ? 0 : R * 0.7;
    let budget = jump || clock < 0.5 ? 600 : 6;
    while (walkers < target && budget-- > 0) if (spawnWalker(px, pz, rmin, R)) walkers++;
    budget = jump || clock < 0.5 ? 60 : 1;
    while (chatters < cfg.groups * 3 && budget-- > 0) {
      if (!spawnGroup(px, pz, rmin, R)) break;
      chatters += 3;
    }

    statics.length = 0;
    for (let i = 0; i < MAX; i++) {
      const q = peds[i];
      if (q.on && (q.kind === STAND || q.waiting || q.re === WATCH || q.re === CHEER || q.re === COWER || q.re === GREET || q.re === STUMBLE)) statics.push(i);
    }

    const pvx = pl.vel.x;
    const pvz = pl.vel.z;
    const pspeed = Math.hypot(pvx, pvz);
    const onStreet = feet < 2.5;
    const lowFly = !pl.grounded && feet < 4 && pspeed > 10;
    const nearGround = pl.grounded && onStreet;
    cand = -1;
    let candD = 2.5;

    for (let i = 0; i < MAX; i++) {
      const p = peds[i];
      if (!p.on) continue;
      p.reT += dt;
      nearestZone(p.x, p.z);
      if (p.re !== GREET) {
        if (zd < 15 && p.re !== FLEE && p.re !== COWER) {
          if (p.kind === STAND && zd < 4) react(p, COWER, 999);
          else startFlee(p, ev);
        } else if (p.re === FLEE && zd >= 15) react(p, COWER, 999);
        else if (p.re === COWER) {
          if (zd < 25) p.reT = 0;
          else if (p.reT > 2.5) p.re = NONE;
        } else if (p.re !== NONE && p.reT > p.reDur) p.re = NONE;
      } else if (p.reT > p.reDur) p.re = NONE;

      const dx = p.x - px;
      const dz = p.z - pz;
      const dist = Math.hypot(dx, dz);
      if (onStreet && dist < 2.6 && pspeed > 4 && dx * pvx + dz * pvz > 0 && calm(p)) {
        const side = Math.sign(dx * -pvz + dz * pvx) || 1;
        p.vx = (-pvz / pspeed) * side * 3.2;
        p.vz = (pvx / pspeed) * side * 3.2;
        react(p, DODGE, 0.7);
      }
      if (lowFly && dist < 3.5 && calm(p)) react(p, STUMBLE, 1.0);
      if (nearGround && p.re === NONE && dist < 10 && rnd() < dt * 0.25) react(p, WATCH, 2.5 + rnd() * 2, rnd() < 0.5 ? WAVE : watchKind());
      if (!pl.grounded && feet > 3 && feet < 45 && p.re === NONE && dist < 20 && rnd() < dt * 0.08) react(p, WATCH, 2 + rnd() * 2, POINT);

      if (p.kind === WALK) stepWalker(p, dt);
      else stepFree(p, dt);

      if (p.re === WATCH || p.re === CHEER) {
        p.yaw += wrap(Math.atan2(-dx, -dz) - p.yaw) * Math.min(1, dt * 4);
      } else if (p.re === GREET) {
        steerToward(p, p.gx, p.gz, Math.min(3, Math.hypot(p.gx - p.x, p.gz - p.z) * 6), dt);
        p.yaw += wrap(p.gyaw - p.yaw) * Math.min(1, dt * 8);
        p.moving = 0;
        if (p.reK === SELFIE && p.reT > p.reDur * 0.55 && p.flashT > 0) {
          p.flashT = -1;
          hand(p, -1, v3);
          addFlash(v3.x, v3.y, v3.z);
        }
      }
      if (p.vx || p.vz) {
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        const k = Math.exp(-5 * dt);
        p.vx *= k;
        p.vz *= k;
        if (Math.abs(p.vx) + Math.abs(p.vz) < 0.02) p.vx = p.vz = 0;
      }
      if (p.kind === WALK && p.moving > 0 && !p.waiting) {
        for (const j of statics) {
          const q = peds[j];
          const ex = p.x - q.x;
          const ez = p.z - q.z;
          const e2 = ex * ex + ez * ez;
          if (e2 > 0.5 || e2 < 1e-6) continue;
          const e = Math.sqrt(e2);
          p.x += (ex / e) * (0.71 - e) * Math.min(1, dt * 6);
          p.z += (ez / e) * (0.71 - e) * Math.min(1, dt * 6);
        }
      }
      const sx = p.x - px;
      const sz = p.z - pz;
      const sd = Math.hypot(sx, sz);
      if (onStreet && sd < 0.8 && sd > 1e-4) {
        p.x = px + (sx / sd) * 0.8;
        p.z = pz + (sz / sd) * 0.8;
      }
      if (nearGround && pl.mode === "ground" && dist < candD && !p.greeted && (p.re === NONE || p.re === WATCH || p.re === CHEER)) {
        candD = dist;
        cand = i;
      }
      p.phase += p.moving * dt * (4.4 / p.h);

      if (p.re === WATCH && p.reK === PHOTO) {
        p.flashT -= dt;
        if (p.flashT < 0) {
          p.flashT = 0.8 + rnd() * 1.8;
          hand(p, -1, v3);
          addFlash(v3.x, v3.y, v3.z);
          if (dist < 30 && clock - lastPhoto > 0.7) {
            lastPhoto = clock;
            ev.push({ type: "sfx", name: "photo", volume: 0.35 });
          }
        }
      }
    }

    const iA = people.attrs.iA.array as Float32Array;
    const iB = people.attrs.iB.array as Float32Array;
    const iC = people.attrs.iC.array as Float32Array;
    const iD = people.attrs.iD.array as Float32Array;
    const c0 = people.attrs.iCol0.array as Float32Array;
    const c1 = people.attrs.iCol1.array as Float32Array;
    const mat = people.mesh.instanceMatrix.array as Float32Array;
    const ppx = pl.pos.x;
    const ppy = pl.pos.y;
    const ppz = pl.pos.z;
    let n = 0;
    shadowN = 0;
    for (let i = 0; i < MAX; i++) {
      const p = peds[i];
      if (!p.on) continue;
      const phone = pose(p, t);
      const dx = ppx - p.x;
      const dz = ppz - p.z;
      const dist = Math.hypot(dx, dz);
      const avoid = p.re === FLEE || p.re === COWER || p.re === STUMBLE || p.re === GREET;
      if (!avoid && dist < 28 && ppy < 60) {
        const cs = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        const lx = cs * dx - sn * dz;
        const lz = sn * dx + cs * dz;
        tmp[1] = Math.max(-1.25, Math.min(1.25, Math.atan2(lx, lz)));
        tmp[2] = Math.max(-0.4, Math.min(0.75, Math.atan2(ppy - 1.6 * p.h, Math.max(dist, 1))));
        if (p.re === WATCH && p.reK === POINT) tmp[7] = 1.5 + Math.min(1.1, Math.max(-0.3, tmp[2] * 1.3));
      } else if (p.kind === STAND && p.sub === CHAT && p.re === NONE) {
        const cs = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        const ox = p.lookX - p.x + Math.sin(t * 0.4 + p.seed) * 0.8;
        const oz = p.lookZ - p.z + Math.cos(t * 0.33 + p.seed) * 0.8;
        tmp[1] = Math.max(-1, Math.min(1, Math.atan2(cs * ox - sn * oz, sn * ox + cs * oz)));
      }
      const k = 1 - Math.exp(-(10 + p.moving * 6) * dt);
      const a = p.ang;
      for (let q = 0; q < 15; q++) a[q] += (tmp[q] - a[q]) * k;
      const b = n * 4;
      for (let q = 0; q < 4; q++) {
        iA[b + q] = a[q];
        iB[b + q] = a[4 + q];
        iC[b + q] = a[8 + q];
        c0[b + q] = p.col[q];
        c1[b + q] = p.col[4 + q];
      }
      iD[b] = a[12];
      iD[b + 1] = a[13];
      iD[b + 2] = phone ? p.mask | ACC.phone : p.mask;
      iD[b + 3] = p.head;
      writeMatrix(mat, n, p.yaw, p.w, p.h, p.x, a[14] * p.h, p.z);
      shadowAt(p.x, p.z, 0.85 * p.w * p.h);
      n++;
    }
    people.mesh.count = n;
    people.mesh.instanceMatrix.needsUpdate = true;
    for (const key in people.attrs) people.attrs[key].needsUpdate = true;
    updateDogs(dt);
    shadows.count = shadowN;
    shadows.instanceMatrix.needsUpdate = true;

    let fn = 0;
    for (let i = 0; i < MAX_FLASH; i++) {
      if (flashLife[i] <= 0) continue;
      flashLife[i] -= dt;
      flashPos.copyWithin(fn * 3, i * 3, i * 3 + 3);
      if (fn !== i) {
        flashLife[fn] = flashLife[i];
        flashLife[i] = 0;
      }
      fn++;
    }
    flashGeo.setDrawRange(0, fn);
    flashGeo.attributes.position.needsUpdate = true;

    if (steam.visible) {
      let sn = 0;
      for (const s of sites.values()) {
        if (s.type === 2 || sn >= MAX_CARTS * 2) continue;
        for (let q = 0; q < STEAM; q++) {
          const u = (clock * 0.45 + q / STEAM + s.key * 0.137) % 1;
          const o = (sn * STEAM + q) * 3;
          steamPos[o] = s.x + Math.sin(u * 7 + q) * 0.18 + (q % 3 - 1) * 0.3;
          steamPos[o + 1] = 1.3 + u * 1.3;
          steamPos[o + 2] = s.z + Math.cos(u * 5 + q) * 0.18;
        }
        sn++;
      }
      steamGeo.setDrawRange(0, sn * STEAM);
      steamGeo.attributes.position.needsUpdate = true;
    }
    return ev;
  };

  const setDanger = (zs: { pos: THREE.Vector3; radius: number }[]) => {
    zones.length = 0;
    for (const z of zs) zones.push({ x: z.pos.x, z: z.pos.z, r: z.radius });
  };

  const cheer = (pos: THREE.Vector3, radius: number): GameEvent[] => {
    let n = 0;
    for (const p of peds) {
      if (!p.on || p.re === GREET) continue;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > radius) continue;
      react(p, CHEER, 2.6 + rnd() * 0.9);
      p.waiting = p.waiting && p.kind === WALK;
      n++;
    }
    return n ? [{ type: "sfx", name: "cheer" }] : [];
  };

  const count = (pos: THREE.Vector3, r: number) => {
    let n = 0;
    for (const p of peds) if (p.on && Math.hypot(p.x - pos.x, p.z - pos.z) < r && pos.y < 6) n++;
    return n;
  };

  const startle = (pos: THREE.Vector3, r: number) => {
    let n = 0;
    for (const p of peds) {
      if (!p.on || Math.hypot(p.x - pos.x, p.z - pos.z) > r || pos.y > 6) continue;
      if (p.re !== FLEE && p.re !== COWER) react(p, STUMBLE, 1.2 + rnd() * 0.4);
      n++;
    }
    return n;
  };

  const prompt = () => (cand >= 0 ? { key: "E", label: "Greet" } : null);

  const interact = (): { events: GameEvent[]; pose: "fistBump" | "wave" | "selfie" } | null => {
    if (cand < 0 || !player) return null;
    const p = peds[cand];
    const pl = player;
    const r = rnd();
    const k = r < 0.36 ? BUMP : r < 0.68 ? FIVE : SELFIE;
    react(p, GREET, k === SELFIE ? 2.6 : 1.9, k);
    p.greeted = true;
    p.waiting = false;
    p.vx = p.vz = 0;
    const fx = p.x - pl.pos.x;
    const fz = p.z - pl.pos.z;
    const d = Math.hypot(fx, fz) || 1;
    if (k !== SELFIE || !cam) {
      p.gx = pl.pos.x + (fx / d) * 1.05;
      p.gz = pl.pos.z + (fz / d) * 1.05;
      p.gyaw = Math.atan2(-fx, -fz);
      pl.face(v3.set(fx / d, 0, fz / d));
    } else {
      let ux = cam.position.x - pl.pos.x;
      let uz = cam.position.z - pl.pos.z;
      const ud = Math.hypot(ux, uz) || 1;
      ux /= ud;
      uz /= ud;
      pl.face(v3.set(ux, 0, uz));
      p.gx = pl.pos.x - uz * 0.72;
      p.gz = pl.pos.z + ux * 0.72;
      p.gyaw = Math.atan2(ux, uz);
    }
    cand = -1;
    return {
      events: [
        { type: "sfx", name: k === SELFIE ? "photo" : "fistBump" },
        { type: "xp", amount: 10, reason: k === SELFIE ? "Selfie with a fan" : k === FIVE ? "High five" : "Fist bump" },
      ],
      pose: k === BUMP ? "fistBump" : k === FIVE ? "wave" : "selfie",
    };
  };

  const markers = (): Marker[] => [];

  const setDetail = (level: 0 | 1 | 2) => {
    detail = level;
    steam.visible = DETAIL[level].steam;
  };

  const dispose = () => {
    scene.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    dot.dispose();
  };

  return {
    update,
    setDanger,
    cheer,
    count,
    startle,
    prompt,
    interact,
    markers,
    setDetail,
    dispose,
  };
}
