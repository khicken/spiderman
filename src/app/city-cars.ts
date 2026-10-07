import * as THREE from "three";
import { Bucket, UNIT, blinkify, mat, type Blink } from "./city-kit";

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
const CYCLE = 24;

/** Signal state for traffic on `axis` at intersection group g: 0 green, 1 yellow, 2 red. */
export function signal(t: number, axis: number, g: number) {
  const T = (t + g * 12) % CYCLE;
  if (axis === 0) return T < 10 ? 0 : T < 12 ? 1 : 2;
  return T < 12 ? 2 : T < 22 ? 0 : 1;
}

type Car = { model: number; slot: number; road: number; dir: number; lane: number; s: number; v: number; vmax: number; len: number; next: number; g: number };

export function createTraffic(o: { r: () => number; roads: Road[]; lineAt: (k: number) => number; lines: number; max: number; time: { value: number } }) {
  const { r, roads, max } = o;
  const names: ModelName[] = ["sedan", "taxi", "police", "bus", "truck"];
  const weights = [0.42, 0.33, 0.07, 0.07, 0.11];
  const group = new THREE.Group();
  const counts = names.map(() => 0);
  const cars: Car[] = [];
  const lineAt = o.lineAt;
  const mid = (o.lines - 1) / 2;
  const rw = roads.map((rd) => 1 + 2.5 * Math.exp(-(((rd.line - lineAt(mid)) / (lineAt(3) - lineAt(0))) ** 2)));
  const rsum = rw.reduce((a, b) => a + b, 0);
  for (let g = 0; g < max; g++) {
    let x = r();
    let m = 0;
    while (x > weights[m] && m < names.length - 1) x -= weights[m++];
    let pickW = r() * rsum;
    let road = 0;
    while (road < roads.length - 1 && pickW > rw[road]) pickW -= rw[road++];
    const big = names[m] === "bus" || names[m] === "truck";
    const rd = roads[road];
    const vmax = big ? 8 + r() * 3 : 11 + r() * 6;
    cars.push({ model: m, slot: counts[m]++, road, dir: r() < 0.5 ? 1 : -1, lane: big || r() < 0.4 ? 1 : 0, s: rd.min + r() * (rd.max - rd.min), v: vmax, vmax, len: MODELS[names[m]].len, next: -1, g });
  }

  const rings = new Map<string, Car[]>();
  for (const c of cars) {
    const k = `${c.road}|${c.dir}|${c.lane}`;
    if (!rings.has(k)) rings.set(k, []);
    rings.get(k)!.push(c);
  }
  for (const ring of rings.values()) {
    ring.sort((a, b) => (a.s - b.s) * a.dir);
    const rd = roads[ring[0].road];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const need = (a.len + b.len) / 2 + 3;
      if ((b.s - a.s) * b.dir < need) b.s = a.s + need * b.dir;
      if (b.s > rd.max) b.s -= rd.max - rd.min;
      if (b.s < rd.min) b.s += rd.max - rd.min;
    }
    ring.forEach((c, i) => (c.next = cars.indexOf(ring[(i + 1) % ring.length])));
  }

  const meshes = names.map((n, m) => {
    const geos = modelGeos(n);
    const body = new THREE.InstancedMesh(geos.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.55 }), counts[m]);
    body.castShadow = true;
    body.receiveShadow = true;
    const cols = MODELS[n].colors;
    for (let i = 0; i < counts[m]; i++) body.setColorAt(i, tcol.setHex(cols[Math.floor(r() * cols.length)]));
    group.add(body);
    const light = geos.light ? new THREE.InstancedMesh(geos.light, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), counts[m]) : null;
    if (light) group.add(light);
    const bar = geos.bar ? new THREE.InstancedMesh(geos.bar, blinkify(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), o.time), counts[m]) : null;
    if (bar) group.add(bar);
    const ims: THREE.InstancedMesh[] = [];
    for (const x of [body, light, bar]) if (x) ims.push(x);
    for (const im of ims) im.frustumCulled = false;
    return { ims, ordered: cars.filter((c) => c.model === m).map((c) => c.g) };
  });

  let active = max;
  const P = lineAt(1) - lineAt(0);

  const update = (dt: number, t: number) => {
    dt = Math.min(dt, 0.1);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.g >= active) continue;
      const rd = roads[c.road];
      const span = rd.max - rd.min;
      let target = c.vmax;
      let j = c.next;
      while (j !== i && cars[j].g >= active) j = cars[j].next;
      if (j !== i) {
        const L = cars[j];
        let gap = (L.s - c.s) * c.dir;
        if (gap < 0) gap += span;
        const free = gap - (c.len + L.len) / 2 - 2.5;
        target = Math.min(target, Math.sqrt(Math.max(0, free) * 12));
      }
      const pos = (c.s - lineAt(0)) / P;
      const m = c.dir > 0 ? Math.ceil(pos + 13.5 / P) : Math.floor(pos - 13.5 / P);
      if (m >= 0 && m < o.lines) {
        const stop = lineAt(m) - c.dir * 13.5;
        const d = (stop - c.s) * c.dir;
        const lineIdx = Math.round((rd.line - lineAt(0)) / P);
        const st = signal(t, rd.axis, (m + lineIdx) & 1);
        if (d > -0.5 && d < 40 && st !== 0 && !(st === 1 && d < 5 && c.v > 6)) target = Math.min(target, Math.sqrt(Math.max(0, d - 0.3) * 10));
      }
      c.v = target > c.v ? Math.min(target, c.v + 5 * dt) : target;
      c.s += c.v * c.dir * dt;
      if (c.s > rd.max) c.s -= span;
      if (c.s < rd.min) c.s += span;
      const mesh = meshes[c.model];
      const off = LANES[c.lane];
      let x: number, z: number, cs: number, sn: number;
      if (rd.axis === 0) {
        x = c.s;
        z = rd.line + c.dir * off;
        cs = 0;
        sn = c.dir;
      } else {
        x = rd.line - c.dir * off;
        z = c.s;
        cs = c.dir;
        sn = 0;
      }
      for (let q = 0; q < mesh.ims.length; q++) {
        const im = mesh.ims[q];
        const e = im.instanceMatrix.array as Float32Array;
        const k = c.slot * 16;
        e[k] = cs; e[k + 1] = 0; e[k + 2] = -sn; e[k + 3] = 0;
        e[k + 4] = 0; e[k + 5] = 1; e[k + 6] = 0; e[k + 7] = 0;
        e[k + 8] = sn; e[k + 9] = 0; e[k + 10] = cs; e[k + 11] = 0;
        e[k + 12] = x; e[k + 13] = 0; e[k + 14] = z; e[k + 15] = 1;
      }
    }
    for (let m = 0; m < meshes.length; m++) for (let q = 0; q < meshes[m].ims.length; q++) meshes[m].ims[q].instanceMatrix.needsUpdate = true;
  };

  const setCount = (n: number) => {
    active = Math.max(0, Math.min(n, max));
    for (const mesh of meshes) {
      let k = 0;
      while (k < mesh.ordered.length && mesh.ordered[k] < active) k++;
      for (const im of mesh.ims) im.count = k;
    }
  };

  return { group, update, setCount };
}
