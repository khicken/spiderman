import * as THREE from "three";
import { Bucket, UNIT, blinkify, mat, type Blink } from "./city-kit";
import { BRIDGES, ROADS, crossingsOf, streetZ, type GeoRoad } from "./city-geo";
import { SKY } from "./sky-state";

type Kind = "body" | "fixed" | "light" | "bar";
type Part = [Kind, number, number, number, number, number, number, number, number?, Blink?];

const CABIN = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setZ(i, p.getZ(i) * 0.62 - 0.04);
      p.setX(i, p.getX(i) * 0.86);
    }
  }
  g.computeVertexNormals();
  return g;
})();

const GLASS = 0x0b1017;
const TIRE = 0x111113;
const TRIM = 0x2a2c30;
const HEAD = 0xfff1d6;
const TAIL = 0xff1a12;

function wheels(r: number, w: number, x: number, zs: number[]): Part[] {
  return zs.flatMap((z) => [-x, x].map((xx) => ["fixed", xx, r, z, r, w, r, TIRE, 2] as Part));
}

function sedan(len: number): Part[] {
  const h = len / 2;
  return [
    ["body", 0, 0.64, 0, 1.86, 0.62, len, 0xffffff],
    ["fixed", 0, 1.25, -0.25, 1.68, 0.6, len * 0.54, GLASS, 1],
    ["body", 0, 1.57, -0.32, 1.42, 0.07, len * 0.3, 0xffffff],
    ["fixed", 0, 0.42, h + 0.03, 1.9, 0.24, 0.14, TRIM],
    ["fixed", 0, 0.42, -h - 0.03, 1.9, 0.24, 0.14, TRIM],
    ...wheels(0.34, 0.24, 0.84, [h - 1.05, -h + 1.05]),
    ["light", -0.62, 0.78, h + 0.01, 0.38, 0.14, 0.05, HEAD, 0, [0, 0]],
    ["light", 0.62, 0.78, h + 0.01, 0.38, 0.14, 0.05, HEAD, 0, [0, 0]],
    ["light", -0.66, 0.8, -h - 0.01, 0.34, 0.14, 0.05, TAIL, 0, [0, 0]],
    ["light", 0.66, 0.8, -h - 0.01, 0.34, 0.14, 0.05, TAIL, 0, [0, 0]],
  ];
}

export type ModelName = "sedan" | "taxi" | "police" | "bus" | "truck";

export const MODELS: Record<ModelName, { len: number; parts: Part[]; colors: number[] }> = {
  sedan: { len: 4.6, parts: sedan(4.6), colors: [0xb01c1c, 0xf2f2f2, 0x15171b, 0x2a4f8f, 0x7d8288, 0x3e5e46, 0x8a6a3a, 0x5c1f3c, 0xc9ccd1] },
  taxi: {
    len: 4.8,
    parts: [...sedan(4.8), ["fixed", 0, 0.86, 0, 1.88, 0.08, 2.4, 0x111111], ["light", 0, 1.72, -0.3, 0.75, 0.24, 0.28, 0xfff0b0, 0, [0, 0]]],
    colors: [0xf2b705],
  },
  police: {
    len: 4.9,
    parts: [...sedan(4.9), ["fixed", 0, 0.74, 0, 1.88, 0.14, 3.8, 0x1b3a8f], ["fixed", 0, 1.62, -0.3, 1.3, 0.06, 0.32, 0x1a1a1a], ["bar", -0.34, 1.71, -0.3, 0.58, 0.13, 0.28, 0xff1010, 0, [2.6, 0]], ["bar", 0.34, 1.71, -0.3, 0.58, 0.13, 0.28, 0x1030ff, 0, [2.6, 0.5]]],
    colors: [0xf4f4f4],
  },
  bus: {
    len: 12,
    parts: [
      ["body", 0, 1.75, 0, 2.55, 2.6, 12, 0xffffff],
      ["fixed", 0, 2.25, -0.2, 2.57, 1.0, 10.6, GLASS],
      ["fixed", 0, 2.1, 6.0, 2.3, 1.5, 0.06, GLASS],
      ["fixed", 0, 1.2, 0, 2.57, 0.3, 12.02, 0x1d4fb8],
      ["fixed", 0, 3.12, 0, 2.2, 0.24, 8.5, 0xb9bec6],
      ...wheels(0.52, 0.32, 1.1, [4.2, -3.6]),
      ["light", 0, 2.98, 6.02, 1.7, 0.26, 0.05, 0xffa020, 0, [0, 0]],
      ["light", -0.95, 0.8, 6.02, 0.36, 0.18, 0.05, HEAD, 0, [0, 0]],
      ["light", 0.95, 0.8, 6.02, 0.36, 0.18, 0.05, HEAD, 0, [0, 0]],
      ["light", -1.05, 1.05, -6.02, 0.25, 0.4, 0.05, TAIL, 0, [0, 0]],
      ["light", 1.05, 1.05, -6.02, 0.25, 0.4, 0.05, TAIL, 0, [0, 0]],
    ],
    colors: [0xf4f6f8],
  },
  truck: {
    len: 7.6,
    parts: [
      ["fixed", 0, 1.3, 2.75, 2.3, 1.5, 2.0, 0xd8dade],
      ["fixed", 0, 2.38, 2.6, 2.1, 0.7, 1.6, GLASS, 1],
      ["body", 0, 2.0, -1.0, 2.45, 2.8, 5.4, 0xffffff],
      ["fixed", 0, 0.5, 0, 1.6, 0.3, 7.4, TRIM],
      ...wheels(0.46, 0.3, 1.02, [2.75, -2.6]),
      ["light", -0.8, 0.85, 3.77, 0.36, 0.16, 0.05, HEAD, 0, [0, 0]],
      ["light", 0.8, 0.85, 3.77, 0.36, 0.16, 0.05, HEAD, 0, [0, 0]],
      ["light", -1.05, 0.8, -3.72, 0.22, 0.3, 0.05, TAIL, 0, [0, 0]],
      ["light", 1.05, 0.8, -3.72, 0.22, 0.3, 0.05, TAIL, 0, [0, 0]],
    ],
    colors: [0xf2f2f2, 0xc83a2a, 0x2f6fb0, 0xe0e0d0, 0x3a7a3a],
  },
};

const GLOW_K = { light: 2.6, bar: 5 };

function partGeo(p: Part) {
  const shape = p[8] ?? 0;
  if (shape === 2) return { geo: UNIT.cyl8, m: mat(p[1], p[2], p[3], p[4], p[5], p[6], 0, 0, Math.PI / 2) };
  return { geo: shape === 1 ? CABIN : UNIT.box, m: mat(p[1], p[2], p[3], p[4], p[5], p[6]) };
}

function modelGeos(name: ModelName) {
  const body = new Bucket();
  const light = new Bucket();
  const bar = new Bucket([0, 0], true);
  for (const p of MODELS[name].parts) {
    const { geo, m } = partGeo(p);
    if (p[0] === "light") light.add(geo, m, p[7], GLOW_K.light);
    else if (p[0] === "bar") bar.add(geo, m, p[7], GLOW_K.bar, p[9]);
    else body.add(geo, m, p[7]);
  }
  return { body: body.build(), light: light.tris ? light.build() : null, bar: bar.tris ? bar.build() : null };
}

const tmp = new THREE.Matrix4();
const tcol = new THREE.Color();

export function bakeCar(b: Bucket, name: ModelName, x: number, z: number, ry: number, color: number) {
  const base = mat(x, 0, z, 1, 1, 1, ry).clone();
  for (const p of MODELS[name].parts) {
    if (p[0] === "light" || p[0] === "bar" || p[7] === TRIM || (p[8] === 2 && p[1] < 0)) continue;
    if (p[8] === 2) {
      b.add(UNIT.box, tmp.multiplyMatrices(base, mat(0, p[2], p[3], p[1] * 2 + p[5], p[4] * 2, p[4] * 2)), TIRE);
      continue;
    }
    const { geo, m } = partGeo(p);
    tmp.multiplyMatrices(base, m);
    b.add(geo, tmp, p[0] === "body" ? color : p[7]);
  }
  if (name !== "truck") b.add(UNIT.box, tmp.multiplyMatrices(base, mat(0, 1.62, -0.3, 1.3, 0.05, 1.3)), 0xe9eef5);
}

export type Road = { axis: 0 | 1; line: number; min: number; max: number };
export const LANES = [2.4, 6.5] as const;
export const PARK_LANE = 9.7;
const CYCLE = 30;
const STOP = 13.5;

/** Signal state for traffic on `axis` at intersection group g: 0 green, 1 yellow, 2 red. */
export function signal(t: number, axis: number, g: number) {
  const T = (t + g * 15) % CYCLE;
  if (axis === 0) return T < 4 ? 2 : T < 13 ? 0 : T < 15 ? 1 : 2;
  return T < 19 ? 2 : T < 28 ? 0 : 1;
}

/** Signal group (0 or 1) of the intersection at road lines x and z. */
export const signalGroup = (x: number, z: number) => (Math.imul(Math.round(x), 73856093) ^ Math.imul(Math.round(z), 19349663)) & 1;

type Ring = { ax: number; az: number; ux: number; uz: number; len: number; off: number; y: number; road: GeoRoad | null; s0: number; cross: Float64Array; groups: Uint8Array; loop: number };
type Car = { model: number; slot: number; ring: number; u: number; v: number; vmax: number; len: number; next: number; g: number };
export type CarBox = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; vx: number; vz: number };
const SIZE: Record<ModelName, [number, number]> = { sedan: [1.9, 1.5], taxi: [1.9, 1.75], police: [1.9, 1.75], bus: [2.6, 3.2], truck: [2.5, 3.4] };

function roadRings(rd: GeoRoad): Ring[] {
  const cs = crossingsOf(rd);
  let lo = rd.min + 3, hi = rd.max - 3;
  if (cs.length && cs[0] - rd.min < 20) lo = Math.max(lo, cs[0] + STOP + 1);
  if (cs.length && rd.max - cs[cs.length - 1] < 20) hi = Math.min(hi, cs[cs.length - 1] - STOP - 1);
  const out: Ring[] = [];
  for (const off of LANES) {
    const tuck = off < 4 ? 6 : 0;
    const L = hi - lo - 2 * (off + tuck);
    if (L < 24) continue;
    const s0 = lo + off + tuck;
    const keep = cs.filter((c) => c > s0 - STOP + 2 && c < s0 + L + STOP - 2);
    const ax = rd.axis === 0 ? s0 : rd.line, az = rd.axis === 0 ? rd.line : s0;
    out.push({
      ax, az, ux: rd.axis === 0 ? 1 : 0, uz: rd.axis === 0 ? 0 : 1, len: L, off, y: 0, road: rd, s0,
      cross: Float64Array.from(keep), groups: Uint8Array.from(keep.map((c) => (rd.axis === 0 ? signalGroup(c, rd.line) : signalGroup(rd.line, c)))),
      loop: 2 * L + 2 * Math.PI * off,
    });
  }
  return out;
}

function bridgeRings(): Ring[] {
  const out: Ring[] = [];
  for (const br of BRIDGES) {
    const [ax, az] = br.a, [bx, bz] = br.b;
    const D = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / D, uz = (bz - az) / D;
    for (const off of LANES) {
      const tuck = off < 4 ? 6 : 0;
      const L = D - 16 - 2 * (off + tuck);
      if (L < 24) continue;
      const t = 8 + off + tuck;
      out.push({ ax: ax + ux * t, az: az + uz * t, ux, uz, len: L, off, y: br.deckY, road: null, s0: 0, cross: new Float64Array(0), groups: new Uint8Array(0), loop: 2 * L + 2 * Math.PI * off });
    }
  }
  return out;
}

const pose = { x: 0, z: 0, hx: 0, hz: 0, s: 0, dir: 0 };

function place(R: Ring, u: number) {
  const { ax, az, ux, uz, len: L, off } = R;
  const rx = -uz, rz = ux;
  const arc = Math.PI * off;
  pose.dir = 0;
  if (u < L) {
    pose.x = ax + ux * u + rx * off;
    pose.z = az + uz * u + rz * off;
    pose.hx = ux;
    pose.hz = uz;
    pose.s = u;
    pose.dir = 1;
    return pose;
  }
  if (u >= L + arc && u < 2 * L + arc) {
    const t = L - (u - L - arc);
    pose.x = ax + ux * t - rx * off;
    pose.z = az + uz * t - rz * off;
    pose.hx = -ux;
    pose.hz = -uz;
    pose.s = t;
    pose.dir = -1;
    return pose;
  }
  const end = u < 2 * L ? L : 0;
  const f = (u < 2 * L ? u - L : u - 2 * L - arc) / off;
  const cx = ax + ux * end, cz = az + uz * end;
  const k = end ? 1 : -1;
  const c = Math.cos(f), sn = Math.sin(f);
  pose.x = cx + k * (rx * off * c + ux * off * sn);
  pose.z = cz + k * (rz * off * c + uz * off * sn);
  pose.hx = k * (-rx * sn + ux * c);
  pose.hz = k * (-rz * sn + uz * c);
  pose.s = end;
  return pose;
}

const BUSY = { z0: streetZ(59), z1: streetZ(14) };

export function createTraffic(o: { r: () => number; max: number; time: { value: number } }) {
  const { r, max } = o;
  const names: ModelName[] = ["sedan", "taxi", "police", "bus", "truck"];
  const weights = [0.42, 0.33, 0.07, 0.07, 0.11];
  const group = new THREE.Group();
  const counts = names.map(() => 0);
  const cars: Car[] = [];
  const rings = [...ROADS.flatMap(roadRings), ...bridgeRings()];
  const rw = rings.map((R) => {
    const mz = R.az + R.uz * (R.len / 2);
    const busy = R.road && mz > BUSY.z0 && mz < BUSY.z1 ? 2.2 : 1;
    return R.loop * busy * (R.road ? 1 : 1.6);
  });
  const rsum = rw.reduce((a, b) => a + b, 0);
  const used = rings.map(() => 0);
  for (let g = 0; g < max; g++) {
    let x = r();
    let m = 0;
    while (x > weights[m] && m < names.length - 1) x -= weights[m++];
    const big = names[m] === "bus" || names[m] === "truck";
    let ring = -1;
    for (let tries = 0; tries < 20 && ring < 0; tries++) {
      let pickW = r() * rsum;
      let k = 0;
      while (k < rings.length - 1 && pickW > rw[k]) pickW -= rw[k++];
      if ((big && rings[k].off < 4) || used[k] + 1 > rings[k].loop / 16) continue;
      ring = k;
    }
    if (ring < 0) continue;
    used[ring]++;
    const vmax = big ? 8 + r() * 3 : 11 + r() * 6;
    cars.push({ model: m, slot: counts[m]++, ring, u: r() * rings[ring].loop, v: vmax, vmax, len: MODELS[names[m]].len, next: -1, g: cars.length });
  }

  const byRing = new Map<number, Car[]>();
  for (const c of cars) {
    if (!byRing.has(c.ring)) byRing.set(c.ring, []);
    byRing.get(c.ring)!.push(c);
  }
  for (const list of byRing.values()) {
    list.sort((a, b) => a.u - b.u);
    const loop = rings[list[0].ring].loop;
    for (let i = 1; i < list.length; i++) {
      const need = (list[i - 1].len + list[i].len) / 2 + 3;
      if (list[i].u - list[i - 1].u < need) list[i].u = list[i - 1].u + need;
    }
    for (const c of list) c.u %= loop;
    list.forEach((c, i) => (c.next = cars.indexOf(list[(i + 1) % list.length])));
  }

  const meshes = names.map((n, m) => {
    const geos = modelGeos(n);
    const body = new THREE.InstancedMesh(geos.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.55 }), Math.max(1, counts[m]));
    body.castShadow = true;
    body.receiveShadow = true;
    const cols = MODELS[n].colors;
    for (let i = 0; i < counts[m]; i++) body.setColorAt(i, tcol.setHex(cols[Math.floor(r() * cols.length)]));
    group.add(body);
    const light = geos.light ? new THREE.InstancedMesh(geos.light, Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { color: SKY.headlight }), Math.max(1, counts[m])) : null;
    if (light) group.add(light);
    const bar = geos.bar ? new THREE.InstancedMesh(geos.bar, blinkify(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), o.time), Math.max(1, counts[m])) : null;
    if (bar) group.add(bar);
    const ims: THREE.InstancedMesh[] = [];
    for (const x of [body, light, bar]) if (x) ims.push(x);
    for (const im of ims) {
      im.frustumCulled = false;
      im.count = counts[m];
    }
    return { ims, ordered: cars.filter((c) => c.model === m).map((c) => c.g) };
  });

  let active = cars.length;
  const boxes: CarBox[] = cars.map(() => ({ minX: 0, maxX: 0, minZ: 0, maxZ: 0, minY: 0, maxY: 0, vx: 0, vz: 0 }));
  const obstacle = { x: 0, z: 0, y: 0, on: false };

  const nextCross = (R: Ring, s: number, dir: number) => {
    const c = R.cross;
    if (dir > 0) {
      for (let k = 0; k < c.length; k++) if (c[k] - STOP - s > -0.5) return k;
    } else for (let k = c.length - 1; k >= 0; k--) if (s - (c[k] + STOP) > -0.5) return k;
    return -1;
  };

  const update = (dt: number, t: number) => {
    dt = Math.min(dt, 0.1);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.g >= active) continue;
      const R = rings[c.ring];
      let target = c.vmax;
      let j = c.next;
      while (j !== i && cars[j].g >= active) j = cars[j].next;
      if (j !== i) {
        const L = cars[j];
        let gap = L.u - c.u;
        if (gap < 0) gap += R.loop;
        const free = gap - (c.len + L.len) / 2 - 2.5;
        target = Math.min(target, Math.sqrt(Math.max(0, free) * 12));
      }
      let p = place(R, c.u);
      if (p.dir !== 0 && R.road) {
        const s = R.s0 + p.s;
        const k = nextCross(R, s, p.dir);
        if (k >= 0) {
          const d = (R.cross[k] - p.dir * STOP - s) * p.dir;
          const st = signal(t, R.road.axis, R.groups[k]);
          if (d > -0.5 && d < 40 && st !== 0 && !(st === 1 && d < 3 && c.v > 8)) target = Math.min(target, Math.sqrt(Math.max(0, d - 0.3) * 10));
        }
      }
      let soft = Infinity;
      if (obstacle.on && Math.abs(obstacle.y - R.y) < 3) {
        const rx = obstacle.x - p.x, rz = obstacle.z - p.z;
        const ahead = rx * p.hx + rz * p.hz - c.len / 2;
        const lat = -rx * p.hz + rz * p.hx;
        if (Math.abs(lat) < 1.8 && ahead > -1 && ahead < 14) soft = Math.sqrt(Math.max(0, ahead - 1.5) * 8);
      }
      if (p.dir === 0) target = Math.min(target, 3 + R.off);
      c.v = target > c.v ? Math.min(target, c.v + 5 * dt) : target;
      if (soft < c.v) c.v = Math.max(soft, c.v - 12 * dt);
      c.u += c.v * dt;
      if (c.u >= R.loop) c.u -= R.loop;
      p = place(R, c.u);
      const mesh = meshes[c.model];
      const [w, hgt] = SIZE[names[c.model]];
      const bx = boxes[i];
      const ex = (Math.abs(p.hx) * c.len + Math.abs(p.hz) * w) / 2;
      const ez = (Math.abs(p.hz) * c.len + Math.abs(p.hx) * w) / 2;
      bx.minX = p.x - ex;
      bx.maxX = p.x + ex;
      bx.minZ = p.z - ez;
      bx.maxZ = p.z + ez;
      bx.minY = R.y;
      bx.maxY = R.y + hgt;
      bx.vx = p.hx * c.v;
      bx.vz = p.hz * c.v;
      for (let q = 0; q < mesh.ims.length; q++) {
        const e = mesh.ims[q].instanceMatrix.array as Float32Array;
        const k = c.slot * 16;
        e[k] = p.hz; e[k + 1] = 0; e[k + 2] = -p.hx; e[k + 3] = 0;
        e[k + 4] = 0; e[k + 5] = 1; e[k + 6] = 0; e[k + 7] = 0;
        e[k + 8] = p.hx; e[k + 9] = 0; e[k + 10] = p.hz; e[k + 11] = 0;
        e[k + 12] = p.x; e[k + 13] = R.y; e[k + 14] = p.z; e[k + 15] = 1;
      }
    }
    for (let m = 0; m < meshes.length; m++) for (let q = 0; q < meshes[m].ims.length; q++) meshes[m].ims[q].instanceMatrix.needsUpdate = true;
  };

  const setCount = (n: number) => {
    active = Math.max(0, Math.min(n, cars.length));
    for (const mesh of meshes) {
      let k = 0;
      while (k < mesh.ordered.length && mesh.ordered[k] < active) k++;
      for (const im of mesh.ims) im.count = k;
    }
  };

  /** With y, returns cars that overlap y in height. Without y, returns street cars only. */
  const near = (x: number, z: number, r: number, out: CarBox[], y?: number) => {
    out.length = 0;
    for (let i = 0; i < cars.length; i++) {
      if (cars[i].g >= active) continue;
      const b = boxes[i];
      if (y === undefined ? b.minY > 0 : y < b.minY - r || y > b.maxY + r) continue;
      if (b.maxX > x - r && b.minX < x + r && b.maxZ > z - r && b.minZ < z + r) out.push(b);
    }
    return out;
  };
  const setObstacle = (x: number, z: number, on: boolean, y = 0) => {
    obstacle.x = x;
    obstacle.z = z;
    obstacle.y = y;
    obstacle.on = on;
  };

  return { group, update, setCount, near, setObstacle, rings: rings.length, cars: cars.length };
}
