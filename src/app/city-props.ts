import * as THREE from "three";
import { Bucket, UNIT, beam, box, cyl, mat } from "./city-kit";
import { IRON, SNOW, face, fbox, fquad, type Block, type Ctx, type Face } from "./city-build";
import { bakeCar, signal, type ModelName } from "./city-cars";

const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)];
const LUMP = new THREE.SphereGeometry(1, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2);
const LAMP = 0xffd59a;

export type District = "harlem" | "upper" | "cps" | "park" | "midtown" | "times" | "downtown" | "industrial" | "plaza" | "site" | "landmark";

function lamp(c: Ctx, F: Face, a: number, o: number, wreath: boolean) {
  const x = F.ox + F.dx * a + F.nx * o, z = F.oz + F.dz * a + F.nz * o;
  cyl(c.small, UNIT.tube, x, 0, z, 0.11, 8.2, 0x26292d);
  const hx = x + F.nx * 1.7, hz = z + F.nz * 1.7;
  beam(c.small, x, 8.0, z, hx, 8.25, hz, 0.1, 0x26292d);
  box(c.small, hx, 8.25, hz, 0.55, 0.22, 0.55, 0x26292d, F.ry);
  box(c.glow, hx, 8.11, hz, 0.42, 0.06, 0.42, LAMP, F.ry, 5);
  if (wreath) {
    c.small.add(UNIT.torus, mat(x + F.nx * 0.14, 4.4, z + F.nz * 0.14, 0.42, 0.42, 0.42, F.ry), 0x1f5a26);
    box(c.glowSmall, x + F.nx * 0.2, 4.0, z + F.nz * 0.2, 0.22, 0.18, 0.08, 0xd81a1a, F.ry, 1.4);
  }
}

function hydrant(c: Ctx, x: number, z: number) {
  cyl(c.small, UNIT.cyl6, x, 0, z, 0.2, 0.72, 0xb3221c);
  c.small.add(UNIT.cone6, mat(x, 0.8, z, 0.2, 0.16, 0.2), 0xd8dde4);
  box(c.small, x, 0.45, z, 0.6, 0.12, 0.12, 0xb3221c);
}

function mailbox(c: Ctx, F: Face, a: number, o: number) {
  const x = F.ox + F.dx * a + F.nx * o, z = F.oz + F.dz * a + F.nz * o;
  box(c.small, x, 0.7, z, 0.55, 1.0, 0.5, 0x1d3f8f, F.ry);
  c.small.add(UNIT.cyl8, mat(x, 1.2, z, 0.275, 0.55, 0.25, F.ry + Math.PI / 2, 0, Math.PI / 2), 0x1d3f8f);
  for (const s of [-0.22, 0.22]) box(c.small, x + F.dx * s, 0.1, z + F.dz * s, 0.08, 0.2, 0.4, 0x15171a, F.ry);
  box(c.small, x, 1.48, z, 0.5, 0.06, 0.45, SNOW, F.ry);
}

function newsboxes(c: Ctx, F: Face, a: number, o: number) {
  const n = 2 + Math.floor(c.r() * 3);
  for (let k = 0; k < n; k++) {
    fbox(c.small, F, a + k * 0.6, 0.55, o, 0.5, 1.1, 0.45, pick(c.r, [0xc8102e, 0x1d4fb8, 0xf2b705, 0x2a8a3a, 0xf2f2f2, 0x6a2a8a]));
    fbox(c.small, F, a + k * 0.6, 1.12, o, 0.5, 0.04, 0.45, SNOW);
  }
}

function bench(c: Bucket, x: number, z: number, ry: number) {
  for (const s of [-0.7, 0.7]) box(c, x + Math.cos(ry) * s, 0.22, z - Math.sin(ry) * s, 0.08, 0.44, 0.5, IRON, ry);
  box(c, x, 0.46, z, 1.8, 0.06, 0.5, 0x5a3c26, ry);
  box(c, x - Math.sin(ry) * 0.24, 0.75, z - Math.cos(ry) * 0.24, 1.8, 0.4, 0.05, 0x5a3c26, ry);
  box(c, x, 0.5, z, 1.7, 0.03, 0.45, SNOW, ry);
}

function trashCan(c: Ctx, x: number, z: number) {
  cyl(c.small, UNIT.cyl8, x, 0, z, 0.3, 0.9, 0x2f5b3a);
  cyl(c.small, UNIT.cyl8, x, 0.9, z, 0.3, 0.04, SNOW);
}

function busStop(c: Ctx, F: Face, a: number, o: number) {
  const len = 4.2;
  for (const s of [-1, 1]) fbox(c.small, F, a + (s * len) / 2, 1.3, o, 0.08, 2.6, 0.08, 0x8a9096);
  fbox(c.small, F, a, 2.65, o - 0.4, len + 0.3, 0.1, 1.6, 0x8a9096);
  fbox(c.small, F, a, 2.73, o - 0.4, len + 0.2, 0.06, 1.5, SNOW);
  fbox(c.small, F, a, 1.4, o - 1.15, len, 1.9, 0.04, 0x6f8fa8);
  fquad(c.glow, F, a + len / 2 - 0.1, a + len / 2 + 1.2, 0.4, 2.4, o - 0.4, pick(c.r, c.atlas.tall), 0xffffff, 1.1);
  bench(c.small, F.ox + F.dx * a + F.nx * (o - 0.8), F.oz + F.dz * a + F.nz * (o - 0.8), F.ry + Math.PI);
}

function subway(c: Ctx, F: Face, a: number, o: number) {
  const L = 4.6, W = 1.8;
  const x = F.ox + F.dx * a + F.nx * o, z = F.oz + F.dz * a + F.nz * o;
  c.small.quad(
    x - F.dx * L / 2 - F.nx * W / 2, 0.03, z - F.dz * L / 2 - F.nz * W / 2,
    x - F.dx * L / 2 + F.nx * W / 2, 0.03, z - F.dz * L / 2 + F.nz * W / 2,
    x + F.dx * L / 2 + F.nx * W / 2, 0.03, z + F.dz * L / 2 + F.nz * W / 2,
    x + F.dx * L / 2 - F.nx * W / 2, 0.03, z + F.dz * L / 2 - F.nz * W / 2,
    [0, 0, 1, 1], 0x050506,
  );
  const green = 0x1f4d2e;
  for (const s of [-1, 1]) {
    fbox(c.small, F, a, 1.0, o + (s * W) / 2, L, 0.06, 0.06, green);
    fbox(c.small, F, a, 0.5, o + (s * W) / 2, L, 0.04, 0.04, green);
    for (let k = 0; k < 4; k++) fbox(c.small, F, a - L / 2 + (k * L) / 3, 0.5, o + (s * W) / 2, 0.06, 1.0, 0.06, green);
  }
  fbox(c.small, F, a + L / 2, 0.5, o, 0.06, 1.0, W, green);
  for (const s of [-1, 1]) {
    const px = x + F.dx * (L / 2) + F.nx * (s * W) / 2, pz = z + F.dz * (L / 2) + F.nz * (s * W) / 2;
    cyl(c.small, UNIT.cyl6, px, 0, pz, 0.06, 2.3, green);
    c.glow.add(UNIT.sphere, mat(px, 2.5, pz, 0.24, 0.24, 0.24), 0x3bff6e, 3.2);
  }
}

function snowbank(c: Ctx, F: Face, a0: number, a1: number, o: number) {
  const L = a1 - a0;
  if (L < 2) return;
  const x = F.ox + F.dx * (a0 + L / 2) + F.nx * o, z = F.oz + F.dz * (a0 + L / 2) + F.nz * o;
  c.small.add(LUMP, mat(x, 0, z, L / 2, 0.38 + c.r() * 0.25, 0.55, F.ry), 0xe4e9f0);
}

function strand(c: Ctx, F: Face, a: number) {
  const r = c.r;
  const x0 = F.ox + F.dx * a, z0 = F.oz + F.dz * a;
  const span = 30;
  const n = 34;
  const y0 = 9 + r() * 2;
  const sag = 1.4 + r() * 0.8;
  const warm = r() < 0.4;
  const chase = r() < 0.5;
  const cols = warm ? [0xffd38a] : [0xff3030, 0x30ff60, 0x3080ff, 0xffd030, 0xff60e0];
  let px = x0, py = y0, pz = z0;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + F.nx * span * t, z = z0 + F.nz * span * t;
    const y = y0 - Math.sin(t * Math.PI) * sag;
    if (k > 0 && k % 3 === 0) beam(c.small, px, py + 0.05, pz, x, y + 0.05, z, 0.03, 0x111111, 1, undefined, UNIT.prism);
    if (k > 0 && k < n) c.bulbs.add(x, y - 0.08, z, cols[k % cols.length], 3.5, 0.24, chase ? [1.2, -k * 0.12] : [-0.6, r()]);
    if (k % 3 === 0) {
      px = x;
      py = y;
      pz = z;
    }
  }
  box(c.small, x0, y0, z0, 0.15, 0.15, 0.15, IRON);
  if (r() < 0.35) {
    const mx = x0 + F.nx * span * 0.5, mz = z0 + F.nz * span * 0.5, my = y0 - sag - 1.1;
    const s = 1.1;
    const ax = F.dx * s, az = F.dz * s;
    for (const k of [1, -1]) c.glowSmall.quad(mx - ax * k, my - s, mz - az * k, mx + ax * k, my - s, mz + az * k, mx + ax * k, my + s, mz + az * k, mx - ax * k, my + s, mz - az * k, c.atlas.flake, 0xcfe8ff, 3, [-0.3, r()]);
  }
}

type Signals = { mesh: THREE.InstancedMesh[][][]; update: (t: number) => void };

export function signals(c: Ctx, lineAt: (k: number) => number, lines: number, group: THREE.Group): Signals {
  const cols = [0x20ff60, 0xffb020, 0xff2020];
  const spots: THREE.Matrix4[][][][] = [0, 1].map(() => [0, 1].map(() => [0, 1, 2].map(() => [] as THREE.Matrix4[])));
  const H = 6.6;
  const pole = (px: number, pz: number, hx: number, hz: number, ry: number, axis: number, g: number) => {
    cyl(c.small, UNIT.tube, px, 0, pz, 0.16, H + 0.6, 0x2a2d31);
    beam(c.small, px, H + 0.4, pz, hx, H + 0.4, hz, 0.12, 0x2a2d31);
    box(c.small, hx, H - 0.25, hz, 0.46, 1.25, 0.34, 0x2b2a1e, ry);
    box(c.small, hx, H + 0.38, hz, 0.5, 0.04, 0.38, SNOW, ry);
    const fx = Math.sin(ry) * 0.18, fz = Math.cos(ry) * 0.18;
    for (let k = 0; k < 3; k++) spots[g][axis][k].push(mat(hx + fx, H - 0.25 + (k - 1) * 0.38, hz + fz, 1, 1, 1, ry).clone());
  };
  for (let k = 0; k < lines; k++) {
    for (let l = 0; l < lines; l++) {
      const X = lineAt(k), Z = lineAt(l);
      const g = (k + l) & 1;
      const d = 12.3;
      pole(X + d, Z + d, X + 4.5, Z + d, 0, 1, g);
      pole(X - d, Z - d, X - 4.5, Z - d, Math.PI, 1, g);
      pole(X - d, Z + d, X - d, Z + 4.5, -Math.PI / 2, 0, g);
      pole(X + d, Z - d, X + d, Z - 4.5, Math.PI / 2, 0, g);
    }
  }
  const disc = new THREE.CircleGeometry(0.15, 8);
  const mesh = spots.map((ga) =>
    ga.map((aa) =>
      aa.map((list, k) => {
        const m = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[k]).multiplyScalar(6), toneMapped: false }), list.length);
        list.forEach((mm, i) => m.setMatrixAt(i, mm));
        m.computeBoundingSphere();
        group.add(m);
        return m;
      }),
    ),
  );
  const update = (t: number) => {
    for (let g = 0; g < 2; g++)
      for (let a = 0; a < 2; a++) {
        const st = signal(t, a, g);
        for (let k = 0; k < 3; k++) mesh[g][a][k].visible = (k === 0 && st === 0) || (k === 1 && st === 1) || (k === 2 && st === 2);
      }
  };
  return { mesh, update };
}

const CAR_COLORS = [0xb01c1c, 0xf2f2f2, 0x15171b, 0x2a4f8f, 0x7d8288, 0x3e5e46, 0x8a6a3a, 0xc9ccd1, 0x5c1f3c];

export function blockStreet(c: Ctx, b: Block, d: District, vents: { x: number; z: number; stack: boolean }[]) {
  const r = c.r;
  const leafy = d === "harlem" || d === "upper" || d === "cps" || d === "park";
  const busy = d === "midtown" || d === "times" || d === "downtown" || d === "plaza" || d === "landmark";
  const parks = d === "harlem" || d === "upper" || d === "industrial";
  for (let f = 0; f < 4; f++) {
    const F = face(f, b.x0, b.x1, b.z0, b.z1);
    const L = F.len;
    const lamps = [3.5, L / 2, L - 3.5];
    lamps.forEach((a) => lamp(c, F, a, 3.4, (d === "harlem" || d === "upper") && r() < 0.5));
    if (leafy && d !== "park") {
      for (let a = 8; a < L - 6; a += 8 + r() * 2) {
        if (Math.abs(a - L / 2) < 2.5) continue;
        c.trees.push({ x: F.ox + F.dx * a + F.nx * 3.0, z: F.oz + F.dz * a + F.nz * 3.0, s: 0.75 + r() * 0.35, lit: r() < 0.35 });
      }
    } else if (busy && r() < 0.4) {
      for (let a = 10; a < L - 8; a += 14) if (Math.abs(a - L / 2) > 3) c.trees.push({ x: F.ox + F.dx * a + F.nx * 3.0, z: F.oz + F.dz * a + F.nz * 3.0, s: 0.6 + r() * 0.2, lit: r() < 0.7 });
    }
    const hy = 10 + r() * (L - 20);
    if (r() < 0.6) hydrant(c, F.ox + F.dx * hy + F.nx * 3.5, F.oz + F.dz * hy + F.nz * 3.5);
    if (r() < 0.25) mailbox(c, F, 6, 3.2);
    if (r() < 0.5) trashCan(c, F.ox + F.dx * (L - 5.5) + F.nx * 3.3, F.oz + F.dz * (L - 5.5) + F.nz * 3.3);
    if (busy && r() < 0.4) newsboxes(c, F, L - 9, 2.9);
    let stopAt = -100;
    if ((f === 1 || f === 3) && r() < 0.18 && d !== "park") {
      stopAt = L / 2 + 6;
      busStop(c, F, stopAt, 3.1);
    }
    if ((busy || d === "harlem") && r() < 0.14) subway(c, F, 13, 1.3);
    let a = 6;
    while (a < L - 6) {
      const len = 4 + r() * 12;
      const a1 = Math.min(L - 6, a + len);
      if (Math.abs(hy - (a + a1) / 2) > len / 2 + 1 && Math.abs(stopAt - (a + a1) / 2) > len / 2 + 3) snowbank(c, F, a, a1, 4.45);
      a = a1 + 2 + r() * 6;
    }
    if (parks) {
      const ry = Math.atan2(-F.nz, F.nx);
      for (let a = 9; a < L - 9; a += 6.2) {
        if (r() > 0.42 || Math.abs(a - hy) < 3 || Math.abs(a - stopAt) < 4) continue;
        const name: ModelName = d === "industrial" && r() < 0.5 ? "truck" : r() < 0.15 ? "taxi" : "sedan";
        const x = F.ox + F.dx * a + F.nx * 5.6, z = F.oz + F.dz * a + F.nz * 5.6;
        bakeCar(c.small, name, x, z, ry, name === "taxi" ? 0xf2b705 : pick(r, CAR_COLORS));
        if (name === "truck") a += 3;
      }
    }
    if ((f === 1 || f === 2) && (d === "harlem" || busy || d === "upper") && r() < 0.32) strand(c, F, L * (0.3 + r() * 0.4));
    for (let a = 5; a < L - 4; a += 9) c.streetSpots.push(new THREE.Vector3(F.ox + F.dx * a + F.nx * 1.8, 0, F.oz + F.dz * a + F.nz * 1.8));
    if (r() < (busy ? 0.35 : 0.15)) {
      const s = 4 + r() * (L - 8);
      vents.push({ x: F.ox + F.dx * s + F.nx * 15, z: F.oz + F.dz * s + F.nz * 15, stack: r() < 0.35 });
    }
  }
}

export function treeMeshes(c: Ctx, tile: number, origin: number) {
  const r = c.r;
  const geo = new Bucket();
  const lights: number[] = [];
  const bark = 0x2e2420;
  const branch = (x: number, y: number, z: number, dx: number, dy: number, dz: number, len: number, rad: number, depth: number) => {
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    beam(geo, x, y, z, ex, ey, ez, rad, bark, 1, undefined, depth === 0 ? UNIT.tube : UNIT.prism);
    if (depth < 2) beam(geo, x, y + rad * 0.9, z, ex, ey + rad * 0.7, ez, rad * 0.6, SNOW, 1, undefined, UNIT.prism);
    if (depth >= 1) {
      for (let k = 0; k < 5; k++) {
        const t = 0.2 + (k / 5) * 0.8;
        lights.push(x + dx * len * t + (r() - 0.5) * 0.5, y + dy * len * t - 0.1, z + dz * len * t + (r() - 0.5) * 0.5);
      }
    }
    if (depth >= 2) return;
    const n = depth === 0 ? 4 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.8;
      const up = depth === 0 ? 0.75 : 0.6;
      const h = Math.sqrt(1 - up * up);
      const nx = dx * 0.4 + Math.cos(a) * h, nz = dz * 0.4 + Math.sin(a) * h, ny = up;
      const l = Math.hypot(nx, ny, nz);
      branch(ex, ey, ez, nx / l, ny / l, nz / l, len * 0.62, rad * 0.6, depth + 1);
    }
  };
  branch(0, 0, 0, 0, 1, 0, 3.4, 0.36, 0);
  const tree = geo.build();
  const all = c.trees;
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const tiles = new Map<number, typeof all>();
  for (const t of [...all].sort(() => r() - 0.5)) {
    const k = Math.floor((t.x - origin) / tile) * 1000 + Math.floor((t.z - origin) / tile);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k)!.push(t);
  }
  const v = new THREE.Vector3();
  const meshes = [...tiles.values()].map((list) => {
    const mesh = new THREE.InstancedMesh(tree, treeMat, list.length);
    list.forEach((t, i) => {
      const m = mat(t.x, 0, t.z, t.s, t.s * (0.9 + r() * 0.3), t.s, r() * Math.PI * 2);
      mesh.setMatrixAt(i, m);
      if (!t.lit) return;
      const multi = r() < 0.4;
      for (let k = 0; k < lights.length; k += 3) {
        v.set(lights[k], lights[k + 1], lights[k + 2]).applyMatrix4(m);
        c.bulbs.add(v.x, v.y, v.z, multi ? pick(r, [0xff4040, 0x40ff70, 0x4080ff, 0xffd040]) : 0xffd8a0, 3, 0.17, [-0.4 - r() * 0.8, r()]);
      }
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  });
  const pine = new Bucket();
  for (let k = 0; k < 4; k++) {
    const y = 1.2 + k * 1.5;
    const rad = 2.4 - k * 0.5;
    pine.add(UNIT.cone8, mat(0, y + 1.3, 0, rad, 2.6, rad, k * 0.5), 0x1d3d26);
    pine.add(UNIT.cone8, mat(0, y + 2.0, 0, rad * 0.62, 1.2, rad * 0.62, k * 0.5 + 0.3), 0xe2eaee);
  }
  pine.add(UNIT.cyl6, mat(0, 0.7, 0, 0.25, 1.4, 0.25), bark);
  const pines = new THREE.InstancedMesh(pine.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), Math.max(1, c.pines.length));
  c.pines.forEach((p, i) => pines.setMatrixAt(i, mat(p.x, 0, p.z, p.s, p.s * (0.9 + r() * 0.4), p.s, r() * 6)));
  pines.count = c.pines.length;
  pines.castShadow = true;
  pines.receiveShadow = true;
  pines.computeBoundingSphere();
  return { meshes, pines };
}

export function parkBlock(c: Ctx, b: Block, park: Bucket, pond: boolean) {
  const r = c.r;
  park.quad(b.x0, 0.04, b.z1, b.x1, 0.04, b.z1, b.x1, 0.04, b.z0, b.x0, 0.04, b.z0, [0, 0, 1, 1], 0xffffff);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const W = b.x1 - b.x0;
  for (let f = 0; f < 4; f++) {
    const F = face(f, b.x0, b.x1, b.z0, b.z1);
    for (const [a0, a1] of [[0, W / 2 - 2.5], [W / 2 + 2.5, W]]) {
      fbox(c.solid, F, (a0 + a1) / 2, 0.45, -0.25, a1 - a0, 0.9, 0.5, 0x6f6a62);
      fbox(c.solid, F, (a0 + a1) / 2, 0.92, -0.25, a1 - a0, 0.06, 0.55, SNOW);
    }
    for (const s of [-1, 1]) {
      const a = W / 2 + s * 2.7;
      const x = F.ox + F.dx * a - F.nx * 0.25, z = F.oz + F.dz * a - F.nz * 0.25;
      box(c.solid, x, 0.8, z, 0.7, 1.6, 0.7, 0x6f6a62);
      c.glow.add(UNIT.sphere, mat(x, 1.95, z, 0.28, 0.28, 0.28), LAMP, 3.5);
    }
  }
  const ring = 18;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const x = cx + Math.cos(a) * (ring + 2.2), z = cz + Math.sin(a) * (ring + 2.2);
    cyl(c.small, UNIT.cyl6, x, 0, z, 0.09, 3.6, 0x1d2622);
    c.glow.add(UNIT.sphere, mat(x, 3.85, z, 0.3, 0.3, 0.3), LAMP, 4);
    const bx = cx + Math.cos(a + 0.2) * (ring + 2.4), bz = cz + Math.sin(a + 0.2) * (ring + 2.4);
    bench(c.small, bx, bz, -a - Math.PI / 2 - 0.2);
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    c.streetSpots.push(new THREE.Vector3(cx + Math.cos(a) * ring, 0, cz + Math.sin(a) * ring));
  }
  for (let t = 4; t < W - 4; t += 6) {
    c.streetSpots.push(new THREE.Vector3(b.x0 + t, 0, cz), new THREE.Vector3(cx, 0, b.z0 + t));
  }
  if (pond) {
    const pr = 15;
    const seg = 28;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const rx = 1;
      c.ice.quad(cx, 0.08, cz, cx + Math.cos(a1) * pr * rx, 0.08, cz + Math.sin(a1) * pr, cx + Math.cos(a0) * pr * rx, 0.08, cz + Math.sin(a0) * pr, cx + Math.cos(a0) * pr * rx, 0.08, cz + Math.sin(a0) * pr, [0.5, 0.5, 0.5, 0.5], 0xffffff);
      const mx = cx + Math.cos((a0 + a1) / 2) * pr * rx, mz = cz + Math.sin((a0 + a1) / 2) * pr;
      box(c.solid, mx, 0.2, mz, 0.9, 0.4, (pr * Math.PI * 2 * 1.08) / seg + 0.3, 0x77726a, -(a0 + a1) / 2);
    }
    c.landmarks.push({ name: "Frozen Pond", pos: new THREE.Vector3(cx, 0, cz + pr + 2) });
  }
  const spotsFree = (x: number, z: number) => {
    const dx = x - cx, dz = z - cz;
    const rr = Math.hypot(dx, dz);
    if (Math.abs(rr - ring) < 3) return false;
    if (pond && rr < 19) return false;
    if (Math.abs(dx) < 3.5 || Math.abs(dz) < 3.5) return false;
    return true;
  };
  for (let k = 0; k < 70; k++) {
    const x = b.x0 + 2.5 + r() * (W - 5), z = b.z0 + 2.5 + r() * (W - 5);
    if (!spotsFree(x, z)) continue;
    if (r() < 0.6) c.trees.push({ x, z, s: 0.9 + r() * 0.6, lit: r() < 0.25 });
    else c.pines.push({ x, z, s: 0.7 + r() * 0.6 });
  }
}

export function steam(c: Ctx, vents: { x: number; z: number; stack: boolean }[], dot: THREE.Texture) {
  const N = 20;
  const pos = new Float32Array(vents.length * N * 3);
  const seed = new Float32Array(vents.length * N * 2);
  vents.forEach((v, i) => {
    const base = v.stack ? 3.1 : 0.1;
    if (v.stack) {
      for (let k = 0; k < 4; k++) cyl(c.small, UNIT.cyl8, v.x, k * 0.75, v.z, 0.42, 0.75, k % 2 ? 0xf2f2f2 : 0xe8661a);
      cyl(c.small, UNIT.cyl8, v.x, 0, v.z, 0.6, 0.3, 0xe8661a);
    } else cyl(c.small, UNIT.cyl8, v.x, 0, v.z, 0.6, 0.06, 0x1a1a1c);
    for (let k = 0; k < N; k++) {
      const j = i * N + k;
      pos.set([v.x, base, v.z], j * 3);
      seed.set([k / N + c.r() * 0.05, 0.12 + c.r() * 0.08], j * 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: dot }, uScale: { value: 400 } }]),
    vertexShader: `
      attribute vec2 seed;
      uniform float uTime;
      uniform float uScale;
      varying float vA;
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime * seed.y + seed.x);
        vec3 p = position;
        float ph = seed.x * 40.0;
        p.x += sin(ph + uTime * 0.7) * age * 1.6 + age * age * 3.0;
        p.z += cos(ph * 1.3 + uTime * 0.5) * age * 1.6;
        p.y += age * 11.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = (1.2 + age * 6.0) * uScale / -mvPosition.z;
        vA = smoothstep(0.0, 0.12, age) * (1.0 - age) * 0.5;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying float vA;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.86, 0.85, 0.9), a);
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer, _s, camera) => {
    renderer.getDrawingBufferSize(size);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    mat.uniforms.uScale.value = size.y / (2 * Math.tan((fov * Math.PI) / 360));
  };
  return { points, time: mat.uniforms.uTime as { value: number } };
}
