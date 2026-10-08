import * as THREE from "three";
import { BLOCKS, HALF, PERIOD, rng, type City } from "./city";
import { signal } from "./city-cars";
import { softDot } from "./city-textures";
import type { GameEvent, HeroPose, Marker, PlayerApi } from "./contracts";
import { cartGeometry, dogMesh } from "./crowd-body";
import { EMO, createEmotes } from "./crowd-emote";
import { buildNav } from "./crowd-nav";
import { ACC, RIG, personMaterial, personMesh } from "./crowd-person";
import {
  ADULT, BLINK, BROW, BUMP, CH, CHAT, CHEER, COWER, CUSTOMER, DODGE, ELDER, FIVE, FLEE, FOLLOW, GREET, HUG, IDLE_CROSS, IDLE_PHONE,
  IDLE_POCKET, IDLE_SHIFT, JUMP, KID, LOOK, NONE, PHOTO, POINT, Ped, SELFIE, SHAKE, STAND, STUMBLE, SWAY, VENDOR, WALK, WATCH, WAVE, pose,
} from "./crowd-pose";

const MAX = 560;
const MAX_DOGS = 40;
const MAX_CARTS = 16;
const MAX_FLASH = 48;
const MAX_EMO = 40;
const STEAM = 8;
const LANE = [13.75, 14.45];
const CURB = 11.8;
const XWALK = 8.8;
const CART_LAT = 12.45;
const CART_ALONG = 17;
const SIDEWALK_PER_M2 = 0.0314;
const DETAIL = [
  { spacing: 8, groups: 4, radius: 90, steam: false, near: 14 },
  { spacing: 5.2, groups: 10, radius: 110, steam: true, near: 22 },
  { spacing: 3.9, groups: 16, radius: 120, steam: true, near: 30 },
];

const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x6a4228, 0x4e2f20, 0xa8714a, 0xd9a07a, 0xeac4a0];
const COAT_DARK = [0x2b3a55, 0x1f1f24, 0x3a3f47, 0x4a3b2e, 0x2f4a3a, 0x5d6d7e, 0x23324a];
const COAT_WARM = [0xb5835a, 0x8c6d4f, 0x7a1f2b, 0x9c8b70, 0x55606b, 0x6e2f3a, 0x3f4f3b];
const COAT_BRIGHT = [0xc0392b, 0xd35400, 0x2e86c1, 0x16a085, 0xe0b020, 0x8e44ad, 0xe84393, 0x27ae60, 0xe8e2d0, 0xf06a2a];
const PANTS = [0x22252b, 0x2c3e50, 0x3b4f6b, 0x4a4a4a, 0x5b4636, 0x1b1b1b, 0x6d6152, 0x4d6a8f];
const KNIT = [0xc0392b, 0xf1c40f, 0x27ae60, 0xe67e22, 0xecf0f1, 0x2980b9, 0x9b59b6, 0xe84393, 0x1abc9c, 0x34495e, 0xd4ac0d];
const HAIR = [0x1a1110, 0x3b2314, 0x6a4e2e, 0xb8935a, 0x2b1b0f, 0xa0522d, 0x111111, 0x4a2c1a];
const GRAY = [0x9a9a9a, 0xc8c8c8, 0xe6e2da, 0x7d7d7d];
const SHOES = [0x1a1a1a, 0x3e2a1e, 0x5a3d2b, 0xdedede, 0x6b4a2f];
const BAGS = [0xc0392b, 0x1e8449, 0xf5f5f5, 0xd4ac0d, 0x7d3c98, 0xb03a2e, 0x1f6fb2, 0x3b2a1e];
const GLOVES = [0x1a1a1a, 0x3b2a1e, 0x5a2a2a, 0x2c3e50];
const SHIRT = [0xf2f2f2, 0xd9d4c7, 0x1d1d1d, 0x8fa3b8, 0xc94f4f, 0x6b8e6b];
const FUR = [0x3b2a1a, 0xc8a165, 0xf0e6d2, 0x1a1a1a, 0x8b5a2b, 0xd2b48c, 0x7a7a7a];

const rnd = Math.random;
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const lineAt = (k: number) => -HALF + k * PERIOD;
const okBlock = (i: number, j: number) => i >= -2 && i <= BLOCKS - 1 && j >= -2 && j <= BLOCKS + 1;
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

type Dog = { on: boolean; owner: number; x: number; z: number; yaw: number; phase: number; amp: number; wag: number; s: number; fur: number; ear: number; collar: number };
type Site = { key: number; x: number; z: number; yaw: number; type: number; vendor: number; customers: number[]; seen: boolean };
type Zone = { x: number; z: number; r: number };

export type Crowd = ReturnType<typeof createCrowd>;

export function createCrowd(scene: THREE.Scene, city: City) {
  const group = new THREE.Group();
  scene.add(group);
  const pMat = personMaterial();
  const lods = [personMesh(MAX, false, pMat), personMesh(MAX, true, pMat)];
  const dogs = dogMesh(MAX_DOGS);
  const emotes = createEmotes(MAX_EMO);
  group.add(lods[0].mesh, lods[1].mesh, dogs.mesh, emotes.mesh);
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
  const tmp = new Float32Array(CH);
  const camQ = new THREE.Quaternion();
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

  const dress = (p: Ped, age: number) => {
    const kid = age === KID;
    const old = age === ELDER;
    const c = p.col;
    c[0] = pick(SKIN);
    c[2] = pick(PANTS);
    c[3] = pick(KNIT);
    c[4] = pick(KNIT);
    c[5] = pick(SHOES);
    c[6] = old ? pick(GRAY) : pick(HAIR);
    c[7] = pick(BAGS);
    c[8] = rnd() < 0.45 ? (rnd() < 0.6 ? pick(GLOVES) : c[4]) : c[0];
    c[9] = pick(SHIRT);
    c[11] = c[9];
    let m = 0;
    const st = rnd();
    if (old) {
      c[1] = pick(rnd() < 0.6 ? COAT_WARM : COAT_DARK);
      if (rnd() < 0.8) m |= ACC.longCoat;
      if (rnd() < 0.85) m |= ACC.cane;
      if (rnd() < 0.5) m |= ACC.glasses;
    } else if (st < (kid ? 0.6 : 0.28)) {
      c[1] = pick(rnd() < 0.6 ? COAT_BRIGHT : COAT_DARK);
      m |= ACC.puffer;
    } else if (!kid && st < 0.52) {
      c[1] = pick(rnd() < 0.7 ? COAT_WARM : COAT_DARK);
      m |= ACC.longCoat;
    } else if (st < 0.74) {
      c[1] = pick(rnd() < 0.5 ? COAT_BRIGHT : COAT_DARK);
      m |= ACC.hood;
    } else c[1] = pick(rnd() < 0.4 ? COAT_BRIGHT : rnd() < 0.5 ? COAT_WARM : COAT_DARK);
    c[10] = m & ACC.puffer ? c[1] : rnd() < 0.5 ? pick(COAT_DARK) : pick(KNIT);
    const hr = rnd();
    if (!kid && hr < 0.28) m |= ACC.longHair;
    else if (!kid && hr < 0.36) m |= ACC.afro;
    else {
      m |= ACC.shortHair;
      if (hr < 0.45) m |= ACC.ponytail;
      else if (hr < 0.5) m |= ACC.bun;
    }
    if (!kid && !old && !(m & ACC.longHair) && rnd() < 0.16) m |= ACC.beard;
    if (!kid && !old && rnd() < 0.14) m |= ACC.glasses;
    const hat = rnd();
    if (old) {
      if (hat < 0.45) m |= ACC.hat;
      else if (hat < 0.6) m |= ACC.cap;
    } else if (hat < (kid ? 0.6 : 0.34)) m |= ACC.beanie;
    else if (hat < (kid ? 0.62 : 0.42)) m |= m & ACC.longCoat ? ACC.hat : ACC.cap;
    else if (hat < 0.47) m |= ACC.earmuffs;
    if (m & (ACC.beanie | ACC.hat | ACC.cap)) m &= ~(ACC.afro | ACC.bun);
    if (!(m & ACC.puffer) && rnd() < (m & ACC.longCoat ? 0.6 : 0.4)) m |= ACC.scarf;
    if (rnd() < (kid ? 0.5 : m & ACC.hood ? 0.35 : 0.08)) m |= ACC.backpack;
    if (!kid && !old && !(m & (ACC.longCoat | ACC.backpack)) && rnd() < 0.14) m |= ACC.satchel;
    if (!kid && !old && !(m & ACC.longCoat) && rnd() < 0.12) {
      m |= ACC.skirt;
      c[10] = pick(rnd() < 0.5 ? COAT_WARM : KNIT);
      c[2] = rnd() < 0.6 ? 0x1b1b22 : 0x3a2a35;
    }
    p.h = kid ? 0.55 + rnd() * 0.13 : old ? 0.9 + rnd() * 0.08 : 0.93 + rnd() * 0.15;
    p.w = kid ? 0.95 : old ? 0.95 + rnd() * 0.1 : 0.9 + rnd() * rnd() * 0.42;
    if (!kid && p.w > 1.12 && rnd() < 0.7) m |= ACC.belly;
    p.mask = m;
    p.age = age;
    p.head = kid ? 1.3 : 1;
    const ir = rnd();
    p.idle = ir < 0.35 ? IDLE_SHIFT : ir < 0.55 ? IDLE_CROSS : ir < 0.8 ? IDLE_PHONE : IDLE_POCKET;
    p.seed = rnd() * 100;
    p.phase = rnd() * 6;
    p.re = NONE;
    p.greeted = false;
    p.noticed = -99;
    p.emo = -1;
    p.lod = 1;
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
      const age = rnd() < 0.1 ? ELDER : ADULT;
      dress(p, age);
      p.on = true;
      p.kind = WALK;
      p.bi = i;
      p.bj = j;
      setDir(p, dir);
      p.c = dir > 0 ? (e + 1) % 4 : e;
      p.x = x;
      p.z = z;
      p.lat = e % 2 ? x : z;
      p.speed = age === ELDER ? 0.75 + rnd() * 0.2 : 1.15 + rnd() * 0.45;
      const roll = age === ELDER ? 0.5 : rnd();
      if (roll < 0.3 && !(p.mask & ACC.satchel)) {
        p.mask |= rnd() < 0.5 ? ACC.bagL | ACC.bagR : rnd() < 0.5 ? ACC.bagL : ACC.bagR;
        p.speed -= 0.15;
      }
      p.yaw = Math.atan2(cx(i, p.c, p.o) - x, cz(j, p.c, p.o) - z);
      if (roll > 0.88) {
        const kk = alloc();
        if (kk >= 0) {
          const kid = peds[kk];
          dress(kid, KID);
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
          dg.collar = pick(KNIT);
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
        dress(p, rnd() < 0.12 ? KID : rnd() < 0.08 ? ELDER : ADULT);
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
    dress(p, sub === CUSTOMER && rnd() < 0.15 ? KID : ADULT);
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
    if (rnd() < 0.3) emote(p, EMO.alert, 1.4);
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

  const emote = (p: Ped, kind: number, life: number) => {
    p.emo = kind;
    p.emoT = 0;
    p.emoLife = life;
  };

  const notice = (p: Ped, dur: number, k: number) => {
    if (p.age === KID && rnd() < 0.75) k = JUMP;
    react(p, WATCH, dur, k);
    p.noticed = clock;
    const r = rnd();
    if (k === PHOTO) {
      if (r < 0.5) emote(p, EMO.camera, 1.6);
    } else if (k === JUMP) {
      if (r < 0.6) emote(p, EMO.star, 1.6);
    } else if (k === WAVE) {
      if (r < 0.2) emote(p, EMO.heart, 1.5);
    } else if (r < 0.4) emote(p, EMO.alert, 1.3);
  };

  const watchKind = () => {
    const r = rnd();
    return r < 0.25 ? LOOK : r < 0.45 ? POINT : r < 0.7 ? WAVE : PHOTO;
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
    [x, z] = [Math.cos(a[15]) * x + Math.sin(a[15]) * z, -Math.sin(a[15]) * x + Math.cos(a[15]) * z];
    [x, y] = [Math.cos(a[3]) * x - Math.sin(a[3]) * y, Math.sin(a[3]) * x + Math.cos(a[3]) * y];
    const lean = -a[0];
    [y, z] = [Math.cos(lean) * y + Math.sin(lean) * z, -Math.sin(lean) * y + Math.cos(lean) * z];
    y += RIG.hipY + a[14];
    x = x * p.w + a[SWAY];
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
      } else if (d < 24 && calm(p) && rnd() < 0.8) notice(p, 4 + rnd() * 5, watchKind());
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
    if (p.kind === FOLLOW && p.parent >= 0 && p.re !== GREET) {
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
      if (nearGround && p.re === NONE && dist < 10 && clock - p.noticed > 8 && rnd() < dt * 0.35) notice(p, 2.5 + rnd() * 2, rnd() < 0.45 ? WAVE : watchKind());
      if (!pl.grounded && feet > 3 && feet < 45 && p.re === NONE && dist < 20 && clock - p.noticed > 8 && rnd() < dt * 0.08) notice(p, 2 + rnd() * 2, rnd() < 0.7 ? POINT : PHOTO);

      if (p.kind === WALK) stepWalker(p, dt);
      else stepFree(p, dt);

      if (p.re === WATCH || p.re === CHEER) {
        p.yaw += wrap(Math.atan2(-dx, -dz) - p.yaw) * Math.min(1, dt * 4);
      } else if (p.re === GREET) {
        const gd = Math.hypot(p.gx - p.x, p.gz - p.z);
        const spd = Math.min(3.2, gd * 7);
        if (gd > 0.03) steerToward(p, p.gx, p.gz, spd, dt);
        p.moving = gd > 0.12 ? spd : 0;
        if (gd < 0.35) p.yaw += wrap(p.gyaw - p.yaw) * Math.min(1, dt * 10);
        const hitT = p.reK === SELFIE ? 0.85 : p.reK === HUG ? 0.4 : 0.5;
        if (!p.hit && p.reT > hitT) {
          p.hit = true;
          if (p.reK === SELFIE) {
            hand(p, -1, v3);
            addFlash(v3.x, v3.y, v3.z);
            ev.push({ type: "sfx", name: "photo" });
          } else if (p.reK !== HUG) ev.push({ type: "sfx", name: "fistBump", volume: p.reK === SHAKE ? 0.5 : 1 });
        }
        if (p.hit && p.emo < 0 && p.reT > hitT + 0.35) emote(p, p.reK === SELFIE ? EMO.camera : p.reK === FIVE ? EMO.star : EMO.heart, 1.6);
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
      if (nearGround && pl.mode === "ground" && dist < candD && !p.greeted && !(p.mask & (ACC.bagL | ACC.bagR)) && p.dog < 0 && p.cart < 0 && (p.re === NONE || p.re === WATCH || p.re === CHEER)) {
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

    const arr = lods.map((L) => ({
      a: L.attrs.iA.array as Float32Array,
      b: L.attrs.iB.array as Float32Array,
      c: L.attrs.iC.array as Float32Array,
      d: L.attrs.iD.array as Float32Array,
      e: L.attrs.iE.array as Float32Array,
      c0: L.attrs.iCol0.array as Float32Array,
      c1: L.attrs.iCol1.array as Float32Array,
      c2: L.attrs.iCol2.array as Float32Array,
      m: L.mesh.instanceMatrix.array as Float32Array,
      n: 0,
    }));
    const ppx = pl.pos.x;
    const ppy = pl.pos.y;
    const ppz = pl.pos.z;
    const ccx = camera.position.x;
    const ccz = camera.position.z;
    camera.getWorldQuaternion(camQ);
    emotes.begin();
    shadowN = 0;
    for (let i = 0; i < MAX; i++) {
      const p = peds[i];
      if (!p.on) continue;
      const phone = pose(p, t, tmp);
      const dx = ppx - p.x;
      const dz = ppz - p.z;
      const dist = Math.hypot(dx, dz);
      const avoid = p.re === FLEE || p.re === COWER || p.re === STUMBLE || p.re === GREET;
      if (!avoid && dist < 28 && ppy < 60) {
        const cs = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        const lx = cs * dx - sn * dz;
        const lz = sn * dx + cs * dz;
        const look = Math.atan2(lx, lz);
        tmp[1] = Math.max(-1.25, Math.min(1.25, look));
        tmp[15] += Math.max(-0.3, Math.min(0.3, look - tmp[1])) * (p.moving < 0.3 ? 1 : 0.3);
        tmp[2] = Math.max(-0.4, Math.min(0.75, Math.atan2(ppy + 0.6 - 1.6 * p.h, Math.max(dist, 1))));
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
      for (let q = 0; q < CH; q++) a[q] += (tmp[q] - a[q]) * k;
      a[BLINK] = tmp[BLINK];
      a[BROW] = tmp[BROW];
      const cd = Math.hypot(ccx - p.x, ccz - p.z);
      const near = DETAIL[detail].near;
      if (cd < near - 2) p.lod = 0;
      else if (cd > near + 2) p.lod = 1;
      const L = arr[p.lod];
      const b = L.n * 4;
      for (let q = 0; q < 4; q++) {
        L.a[b + q] = a[q];
        L.b[b + q] = a[4 + q];
        L.c[b + q] = a[8 + q];
        L.c0[b + q] = p.col[q];
        L.c1[b + q] = p.col[4 + q];
        L.c2[b + q] = p.col[8 + q];
      }
      L.d[b] = a[12];
      L.d[b + 1] = a[13];
      L.d[b + 2] = phone ? p.mask | ACC.phone : p.mask;
      L.d[b + 3] = p.head;
      L.e[b] = a[15];
      L.e[b + 1] = a[16];
      L.e[b + 2] = a[BLINK] + 2 * a[BROW];
      L.e[b + 3] = Math.max(0, a[18]);
      const cs = Math.cos(p.yaw);
      const sn = Math.sin(p.yaw);
      const sway = a[SWAY] * p.w;
      writeMatrix(L.m, L.n, p.yaw, p.w, p.h, p.x + cs * sway, a[14] * p.h, p.z - sn * sway);
      L.n++;
      shadowAt(p.x, p.z, 0.85 * p.w * p.h);
      if (p.emo >= 0) {
        p.emoT += dt;
        if (p.emoT > p.emoLife) p.emo = -1;
        else if (cd < 45) emotes.add(p.x, (RIG.headY + 0.2 * p.head + 0.32 + a[14]) * p.h + 0.12, p.z, p.emo, p.emoT, p.emoLife, camQ);
      }
    }
    lods.forEach((L, i) => {
      L.mesh.count = arr[i].n;
      L.mesh.instanceMatrix.needsUpdate = true;
      for (const key in L.attrs) L.attrs[key].needsUpdate = true;
    });
    emotes.end();
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
      if (rnd() < 0.2) emote(p, rnd() < 0.5 ? EMO.star : rnd() < 0.5 ? EMO.heart : EMO.note, 1.8);
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

  const interact = (): { events: GameEvent[]; pose: HeroPose } | null => {
    if (cand < 0 || !player) return null;
    const p = peds[cand];
    const pl = player;
    const r = rnd();
    const k = p.age === KID ? (r < 0.65 ? HUG : FIVE) : r < 0.3 ? BUMP : r < 0.55 ? FIVE : r < 0.8 ? SELFIE : SHAKE;
    react(p, GREET, 2.3, k);
    p.hit = false;
    p.emo = -1;
    p.greeted = true;
    p.waiting = false;
    p.vx = p.vz = 0;
    if (p.kind === FOLLOW && p.parent >= 0 && peds[p.parent].re === NONE) react(peds[p.parent], WATCH, 2.6, LOOK);
    const fx = p.x - pl.pos.x;
    const fz = p.z - pl.pos.z;
    const d = Math.hypot(fx, fz) || 1;
    if (k !== SELFIE || !cam) {
      const gap = k === HUG ? 0.45 : k === SHAKE ? 0.85 : 0.95;
      p.gx = pl.pos.x + (fx / d) * gap;
      p.gz = pl.pos.z + (fz / d) * gap;
      p.gyaw = Math.atan2(-fx, -fz);
      pl.face(v3.set(fx / d, 0, fz / d));
    } else {
      let ux = cam.position.x - pl.pos.x;
      let uz = cam.position.z - pl.pos.z;
      const ud = Math.hypot(ux, uz) || 1;
      ux /= ud;
      uz /= ud;
      pl.face(v3.set(ux, 0, uz));
      p.gx = pl.pos.x - uz * 0.7;
      p.gz = pl.pos.z + ux * 0.7;
      p.gyaw = Math.atan2(ux, uz);
    }
    cand = -1;
    const reason = ["Fist bump", "High five", "Selfie with a fan", "Handshake", "Hug from a little fan"][k];
    return {
      events: [{ type: "xp", amount: 10, reason }],
      pose: k === BUMP || k === SHAKE ? "fistBump" : k === FIVE ? "wave" : k === SELFIE ? "selfie" : "crouch",
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
    emotes.dispose();
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
