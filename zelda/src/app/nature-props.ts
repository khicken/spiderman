import * as THREE from "three";
import type { Look, QualityPreset } from "./contracts";
import { FOREST } from "./contracts";
import {
  GeoBuilder, InstLayer, ScatterSet, clamp01, composeMat, fbm2, hash2, inFlatZone, meshMat, riverEdge, sstep, vnoise, type PlaceEnv,
} from "./nature-util";

// Rocks and boulders, bushes, driftwood. All static, scattered at load, drawn with instancing by distance.

const ROCK_SHAPES = 3;

function rockGeometry(shape: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, shape === 1 ? 0 : 1);
  const P = g.getAttribute("position");
  const v = new THREE.Vector3();
  const sy = shape === 0 ? 0.78 : shape === 1 ? 1.35 : 0.46;
  const sxz = shape === 2 ? 1.35 : 1;
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const nz = vnoise(v.x * 1.7 + shape * 9, v.z * 1.7 + v.y * 1.3, 91 + shape);
    const k = (shape === 1 ? 0.7 : 0.78) + 0.5 * nz;
    v.multiplyScalar(k);
    v.x *= sxz; v.z *= sxz; v.y *= sy;
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const gb = new GeoBuilder();
  const c0 = new THREE.Color("#8d8473"), c1 = new THREE.Color("#b3a994");
  const tri = new THREE.Vector3();
  gb.add(g, new THREE.Matrix4(), (p, n, out) => {
    const face = hash2(Math.round(p.x * 40), Math.round(p.z * 40) + Math.round(p.y * 23), shape + 3);
    tri.copy(n);
    out.copy(c0).lerp(c1, clamp01(0.35 + n.y * 0.35 + (face - 0.5) * 0.25));
    out.multiplyScalar(0.62 + 0.38 * sstep(-0.5, 0.5, p.y));
  }, () => 0);
  return gb.build();
}

function bushGeometry(variant: number): THREE.BufferGeometry {
  const gb = new GeoBuilder();
  const lo = new THREE.Color(variant === 2 ? "#3d6a38" : "#44703a"), hi = new THREE.Color(variant === 2 ? "#79a24a" : "#8fb350");
  const blobs: [number, number, number, number][] = [[0, 0.55, 0, 0.7], [0.55, 0.42, 0.2, 0.52], [-0.5, 0.45, -0.15, 0.55], [0.1, 0.4, -0.55, 0.5], [-0.1, 0.8, 0.15, 0.45]];
  const m = new THREE.Matrix4();
  blobs.forEach(([x, y, z, r], i) => {
    m.makeScale(r, r * 0.85, r).setPosition(x, y, z);
    gb.add(new THREE.IcosahedronGeometry(1, 1), m, (p, n, out) => {
      out.copy(lo).lerp(hi, sstep(0.2, 0.9, 0.5 + 0.36 * n.y + 0.28 * (p.y - 0.3)));
      out.multiplyScalar(0.7 + 0.3 * sstep(0, 0.9, p.y));
    }, (p) => clamp01(p.y / 1.1) * 0.7, (p, n) => {
      const v = vnoise(p.x * 2.4 + i * 3, p.z * 2.4 + p.y, 5);
      p.multiplyScalar(0.86 + 0.28 * v);
      n.y += 0.25; n.normalize();
    });
  });
  if (variant > 0) {
    const cols = variant === 1 ? ["#f4ecd9", "#f0a8c0", "#fff0a0"] : ["#c8372b", "#d9482f", "#a82a2a"];
    const c = new THREE.Color();
    let s = 1234 + variant;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, e = Math.acos(rnd() * 0.9 + 0.1);
      const r = 0.74 + rnd() * 0.12;
      const x = Math.sin(e) * Math.cos(a) * r, y = 0.5 + Math.cos(e) * r * 0.78, z = Math.sin(e) * Math.sin(a) * r;
      c.set(cols[i % 3]);
      const rr = variant === 1 ? 0.1 : 0.065;
      m.makeScale(rr, rr * 0.8, rr).setPosition(x, y, z);
      gb.add(new THREE.IcosahedronGeometry(1, 0), m, (_p, _n, out) => out.copy(c), (p) => clamp01(p.y / 1.1) * 0.7);
    }
  }
  return gb.build();
}

function driftGeometry(variant: number): THREE.BufferGeometry {
  const gb = new THREE.Matrix4();
  const b = new GeoBuilder();
  const lo = new THREE.Color("#a99a7c"), hi = new THREE.Color("#d9ccaa"), dk = new THREE.Color("#7c6d55");
  const log = (len: number, r0: number, r1: number, x: number, y: number, z: number, rotZ: number, rotY: number) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, rotZ));
    gb.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
    const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
    g.translate(0, len / 2, 0);
    b.add(g, gb, (p, n, out) => {
      out.copy(lo).lerp(hi, 0.5 + 0.45 * n.y);
      if (hash2(Math.round(p.x * 9), Math.round(p.y * 9), 7) > 0.86) out.lerp(dk, 0.5);
    }, () => 0);
  };
  if (variant === 0) {
    log(2.6, 0.17, 0.12, -1.3, 0.16, 0, -Math.PI / 2, 0);
    log(0.7, 0.07, 0.03, -0.4, 0.2, 0.05, -0.5, 0.4);
  } else {
    log(2.0, 0.14, 0.09, -1.0, 0.14, 0, -Math.PI / 2, 0);
    log(1.2, 0.09, 0.04, -0.2, 0.15, 0, -0.9, 0.2);
    log(1.0, 0.08, 0.04, -1.3, 0.15, 0, -1.2, -0.5);
  }
  return b.build();
}

export class PropSystem {
  readonly rocks = new ScatterSet(2600);
  readonly bushes = new ScatterSet(4200);
  readonly wood = new ScatterSet(500);
  private rockMoss!: InstLayer;
  private rockBare!: InstLayer;
  private bushLayer!: InstLayer;
  private woodLayer!: InstLayer;
  private mats: THREE.Material[] = [];
  readonly boxes: number[] = [];
  private rockD2 = 0; private bushD2 = 0; private woodD2 = 0;

  constructor(private group: THREE.Group, private look: Look) {}

  place(env: PlaceEnv): void {
    const { world, rnd, nrm } = env;
    const seed = env.seed;
    const edge = { w: 0 };
    const tint = new THREE.Color();
    const R = 585;

    const rock = (x: number, z: number, h: number, s: number, bare: boolean, warm: number): void => {
      world.normalAt(x, z, nrm);
      const shape = Math.floor(rnd() * ROCK_SHAPES);
      const tx = Math.atan2(nrm.z, nrm.y) * 0.55, tz = -Math.atan2(nrm.x, nrm.y) * 0.55;
      const sink = s * (shape === 2 ? 0.1 : 0.28);
      const sx = s * (0.85 + rnd() * 0.4), sy = s * (0.8 + rnd() * 0.45);
      const yaw = rnd() * Math.PI * 2;
      const m = composeMat(x, h - sink, z, yaw, sx, sy, s * (0.85 + rnd() * 0.4), tx, tz);
      const k = 0.92 + rnd() * 0.16;
      if (bare) tint.setRGB(0.78 * k, 0.75 * k, 0.74 * k);
      else tint.setRGB(k * (1 + warm * 0.12), k, k * (1 - warm * 0.15));
      const idx = this.rocks.add(shape + (bare ? ROCK_SHAPES : 0), x, h, z, s, m, tint);
      if (idx >= 0 && s >= 1.5) {
        const r = Math.max(sx, s) * 0.72;
        this.boxes.push(world.addBox({ minX: x - r, minY: h - 1, minZ: z - r, maxX: x + r, maxY: h + sy * 0.95 * (shape === 1 ? 1.2 : shape === 2 ? 0.5 : 0.8), maxZ: z + r, tag: "solid", owner: "nature:rock" }));
      }
    };

    for (let gz = -R; gz < R; gz += 8.5) {
      for (let gx = -R; gx < R; gx += 8.5) {
        const x = gx + rnd() * 8.5, z = gz + rnd() * 8.5;
        const roll = rnd(), roll2 = rnd();
        if (x * x + z * z > R * R) continue;
        const h = world.heightAt(x, z);
        if (h < 0.15) continue;
        if (inFlatZone(x, z, 3)) continue;
        const w = world.waterAt(x, z);
        if (w !== -Infinity && h < w - 0.1) continue;
        if (riverEdge(x, z, edge) < -0.5) continue;
        world.normalAt(x, z, nrm);
        if (nrm.y < 0.5) continue;
        const biome = world.biomeAt(x, z);
        let dens = 0.05, bare = false, warm = 0, mul = 1;
        switch (biome) {
          case "ash": case "summit": dens = 0.55; bare = true; mul = 1.1; break;
          case "highland": dens = 0.3; bare = roll2 > 0.5; mul = 1.05; break;
          case "beach": dens = 0.22; warm = 1; mul = 0.8; break;
          case "forest": dens = 0.2; mul = 1.15; break;
          case "lakeshore": dens = 0.26; break;
          case "meadow": dens = 0.05 + 0.1 * sstep(0.55, 0.75, fbm2(x * 0.02, z * 0.02, seed + 5)); break;
          default: continue;
        }
        if (roll > dens) continue;
        const big = Math.pow(rnd(), 2.3);
        const s = (0.55 + big * 2.7) * mul;
        rock(x, z, h, s, bare, warm);
        const n = s > 1.4 ? 2 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, d = s * (1.2 + rnd() * 1.4);
          const nx = x + Math.cos(a) * d, nz2 = z + Math.sin(a) * d;
          const hh = world.heightAt(nx, nz2);
          const ww = world.waterAt(nx, nz2);
          if (hh < 0.15 || (ww !== -Infinity && hh < ww - 0.1)) continue;
          rock(nx, nz2, hh, 0.35 + rnd() * 0.5, bare, warm);
        }
      }
    }
    this.rocks.finalize();

    const bushTint = new THREE.Color();
    for (let gz = -R; gz < R; gz += 6.2) {
      for (let gx = -R; gx < R; gx += 6.2) {
        const x = gx + rnd() * 6.2, z = gz + rnd() * 6.2;
        const roll = rnd(), roll2 = rnd();
        if (x * x + z * z > R * R) continue;
        const h = env.dryHeight(x, z, 0.4);
        if (h !== h || h < 1.0) continue;
        if (inFlatZone(x, z, 3)) continue;
        if (riverEdge(x, z, edge) < 1.8) continue;
        const biome = world.biomeAt(x, z);
        let dens = 0;
        const clump = sstep(0.48, 0.7, fbm2(x * 0.03 + 40, z * 0.03, seed + 9));
        if (biome === "meadow") dens = 0.02 + 0.2 * clump;
        else if (biome === "forest") dens = 0.22 + 0.2 * clump;
        else if (biome === "lakeshore") dens = 0.12 + 0.22 * clump;
        else if (biome === "highland") dens = 0.03 + 0.08 * clump;
        else if (biome === "beach") dens = h > 2.2 ? 0.04 : 0;
        if (roll > dens) continue;
        world.normalAt(x, z, nrm);
        if (nrm.y < 0.72) continue;
        const variant = biome === "forest" ? (roll2 < 0.7 ? 0 : 2) : roll2 < 0.5 ? 0 : roll2 < 0.78 ? 1 : 2;
        const s = 0.8 + rnd() * 0.9;
        const k = 0.9 + rnd() * 0.2;
        bushTint.setRGB(k * (biome === "highland" ? 1.1 : 1), k, k * (biome === "forest" ? 1.05 : 0.95));
        this.bushes.add(variant, x, h, z, s, composeMat(x, h - 0.12 * s, z, rnd() * 6.28, s * (1 + (rnd() - 0.5) * 0.3), s, s * (1 + (rnd() - 0.5) * 0.3)), bushTint);
      }
    }
    this.bushes.finalize();

    const wt = new THREE.Color();
    for (let gz = -R; gz < R; gz += 7) {
      for (let gx = -R; gx < R; gx += 7) {
        const x = gx + rnd() * 7, z = gz + rnd() * 7;
        const roll = rnd();
        if (roll > 0.42) continue;
        if (x * x + z * z > R * R) continue;
        const h = world.heightAt(x, z);
        if (h < 0.35 || h > 2.4) continue;
        if (world.biomeAt(x, z) !== "beach") continue;
        const w = world.waterAt(x, z);
        if (w !== -Infinity && h < w + 0.2) continue;
        world.normalAt(x, z, nrm);
        if (nrm.y < 0.85) continue;
        const s = 0.8 + rnd() * 0.9;
        const k = 0.92 + rnd() * 0.14;
        wt.setRGB(k, k, k * 0.96);
        this.wood.add(rnd() < 0.55 ? 0 : 1, x, h, z, s, composeMat(x, h - 0.02, z, rnd() * 6.28, s, s, s, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15), wt);
      }
    }
    this.wood.finalize();
  }

  build(): void {
    const count = (s: ScatterSet, n: number) => {
      const c = new Array<number>(n).fill(0);
      for (let i = 0; i < s.count; i++) c[s.type[i]]++;
      return c;
    };
    const rockC = count(this.rocks, ROCK_SHAPES * 2);
    const mossMat = meshMat(this.look, { sway: 0, moss: 0.62, patch: 0.2, mossColor: "#6f8a4a" });
    const bareMat = meshMat(this.look, { sway: 0, moss: 0.0, patch: 0.2 });
    const bushMat = meshMat(this.look, { sway: 0.55, patch: 0.14 });
    const woodMat = meshMat(this.look, { sway: 0, patch: 0.1 });
    this.mats.push(mossMat, bareMat, bushMat, woodMat);
    this.rockMoss = new InstLayer(this.group, [0, 1, 2].map(rockGeometry), mossMat, rockC.slice(0, 3), true);
    this.rockBare = new InstLayer(this.group, [0, 1, 2].map(rockGeometry), bareMat, rockC.slice(3), true);
    this.bushLayer = new InstLayer(this.group, [0, 1, 2].map(bushGeometry), bushMat, count(this.bushes, 3), false);
    this.woodLayer = new InstLayer(this.group, [0, 1].map(driftGeometry), woodMat, count(this.wood, 2), false);
  }

  private onRock = (i: number, d2: number): void => {
    if (d2 > this.rockD2) return;
    const t = this.rocks.type[i];
    if (t < ROCK_SHAPES) this.rockMoss.push(t, this.rocks.mats, i, this.rocks.tint);
    else this.rockBare.push(t - ROCK_SHAPES, this.rocks.mats, i, this.rocks.tint);
  };
  private onBush = (i: number): void => { this.bushLayer.push(this.bushes.type[i], this.bushes.mats, i, this.bushes.tint); };
  private onWood = (i: number): void => { this.woodLayer.push(this.wood.type[i], this.wood.mats, i, this.wood.tint); };

  refresh(camX: number, camZ: number, fx: number, fz: number, q: QualityPreset): void {
    this.rockD2 = q.rockDist * q.rockDist;
    this.rockMoss.reset(); this.rockBare.reset(); this.bushLayer.reset(); this.woodLayer.reset();
    this.rocks.near(camX, camZ, fx, fz, q.rockDist, this.onRock);
    this.bushes.near(camX, camZ, fx, fz, Math.min(q.treeDist, q.treeDetailDist * 1.35), this.onBush);
    this.wood.near(camX, camZ, fx, fz, q.rockDist * 0.6, this.onWood);
    this.rockMoss.commit(); this.rockBare.commit(); this.bushLayer.commit(); this.woodLayer.commit();
  }

  dispose(world: { removeBox(id: number): void }): void {
    for (const id of this.boxes) world.removeBox(id);
    this.boxes.length = 0;
    this.rockMoss?.dispose(); this.rockBare?.dispose(); this.bushLayer?.dispose(); this.woodLayer?.dispose();
    for (const m of this.mats) m.dispose();
  }
}

export const FOREST_R = FOREST.r;
