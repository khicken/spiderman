import * as THREE from "three";
import { CLIFFS, LAKE, SEA_LEVEL } from "./contracts";
import {
  Mesher, PAL, glowMat, groundMin, haloSprite, lerp, rng, smooth,
  type SiteEnv, type SiteInfo,
} from "./landmark-kit";

// Hand-made secret places: each builder is its own culling site (own env, own group).

const TAU = Math.PI * 2;
// local +z faces the center, local x runs along the tangent, for a point at angle a around a ring
const rotRadial = (a: number) => -a - Math.PI / 2;

function commit(env: SiteEnv, m: Mesher, name: string, mat?: THREE.Material, shadow = true): THREE.Mesh {
  const mesh = m.build(env.look, mat, name);
  mesh.castShadow = shadow;
  env.own(mesh.geometry);
  env.group.add(mesh);
  return mesh;
}

function halo(env: SiteEnv, x: number, y: number, z: number, color: string, size: number, opacity = 1): THREE.Sprite {
  const s = haloSprite(env.glow, color, size);
  s.position.set(x, y, z);
  s.material.opacity = opacity;
  env.own(s.material);
  env.group.add(s);
  return s;
}

/** AABB half extents of a box (w along local x, d along local z) rotated by ry. */
function rotHalf(w: number, d: number, ry: number): [number, number] {
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  return [c * w / 2 + s * d / 2, s * w / 2 + c * d / 2];
}

function loreStone(m: Mesher, glow: Mesher, env: SiteEnv, x: number, z: number, yaw: number, owner: string, slab: string, rune: string) {
  const g = groundMin(env.world, x, z, 0.9, 0.5);
  const gy = env.world.heightAt(x, z);
  m.box(x, g - 0.5, z, 2.1, gy - g + 0.9, 1.2, PAL.rockLo, yaw);
  m.box(x, gy + 0.3, z, 1.4, 2.2, 0.5, slab, yaw);
  m.prism(x, gy + 2.5, z, 1.4, 0.55, 0.5, slab, yaw);
  const sx = Math.sin(yaw), cx = Math.cos(yaw);
  for (let k = 0; k < 4; k++) {
    const o = 0.27;
    glow.box(x + sx * o, gy + 0.85 + k * 0.4, z + cx * o, 0.9 - (k & 1) * 0.4, 0.07, 0.04, rune, yaw, { jit: 0, ao: 0 });
  }
  const [hx, hz] = rotHalf(2.1, 1.2, yaw);
  env.world.addBox({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: g - 0.5, maxY: gy + 2.4, tag: "solid", owner });
}

// =====================================================================================================================
// 1. Hollow oak
// =====================================================================================================================
export function buildHollowOak(env: SiteEnv): SiteInfo {
  const { world, reg } = env;
  const X = -352, Z = -98;
  const g = world.heightAt(X, Z);
  const rnd = rng(4411);
  const m = new Mesher(31);
  const glow = new Mesher(32);
  const g0 = groundMin(world, X, Z, 2.2, 2.2) - 0.7;

  // lower trunk: two piers and a back wall leave a tall arched opening facing south
  for (const sx of [-1, 1]) m.cyl(X + sx * 1.55, g0, Z + 0.1, 0.8, 0.7, g + 3.5 - g0, PAL.woodLo, 6, 0, { sz: 1.5 });
  m.cyl(X, g0, Z - 1.0, 1.5, 1.4, g + 3.6 - g0, PAL.wood, 7, 0, { sx: 1.6 });
  for (let k = 0; k < 7; k++) { // arch ring
    const a0 = Math.PI * k / 7, a1 = Math.PI * (k + 1) / 7;
    m.beam(X + Math.cos(a0) * 0.95, g + 2.7 + Math.sin(a0) * 0.75, Z + 1.0, X + Math.cos(a1) * 0.95, g + 2.7 + Math.sin(a1) * 0.75, Z + 1.0, 0.5, PAL.woodHi, { ao: 0.05 });
  }
  m.box(X, g + 0.05, Z + 0.2, 1.7, 0.12, 1.9, PAL.mossLo, 0, { jit: 0.03 }); // mossy floor
  m.box(X, g0 + 0.2, Z - 0.65, 1.7, g + 2.6 - g0, 0.15, PAL.ink); // dark back lining

  // upper trunk: stacked, tilted frusta along a gentle curve
  const off = (y: number) => ({ x: Math.sin(y * 0.31 + 0.6) * 0.8 * smooth(y / 10), z: Math.cos(y * 0.23) * 0.5 * smooth(y / 10) });
  const segH = 2.4, segN = 8;
  for (let i = 0; i < segN; i++) {
    const y = 3.4 + i * segH, o0 = off(y), o1 = off(y + segH);
    const rb = lerp(1.9, 1.15, i / segN), rt = lerp(1.9, 1.15, (i + 1) / segN);
    m.cyl(X + o0.x, g + y - 0.1, Z + o0.z, rb, rt, segH * 1.2, i % 2 ? PAL.wood : PAL.woodLo, 8, 0,
      { rz: -Math.atan2(o1.x - o0.x, segH), rx: Math.atan2(o1.z - o0.z, segH), sx: 1.05 });
  }
  const topO = off(3.4 + segN * segH);
  // flared roots (skip the doorway side)
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * TAU + 0.3;
    if (Math.sin(a) > 0.55 && Math.abs(Math.cos(a)) < 0.7) continue;
    const dx = Math.cos(a), dz = Math.sin(a), len = 3.4 + rnd() * 2.6;
    m.beam(X + dx * 1.5, g + 2.0, Z + dz * 1.5, X + dx * (1.5 + len), g - 0.4, Z + dz * (1.5 + len), 1.1 - rnd() * 0.3, PAL.woodLo);
    m.beam(X + dx * 1.5, g + 2.0, Z + dz * 1.5, X + dx * (1.5 + len * 0.55), g + 0.2, Z + dz * (1.5 + len * 0.55), 1.6, PAL.wood);
  }
  // branches and canopy
  const canopyC = [PAL.birch, PAL.leaf, PAL.birch, PAL.leafHi];
  let ci = 0;
  const blob = (x: number, y: number, z: number, r: number, hiEdge = false) => {
    m.ball(x, y, z, r, hiEdge ? PAL.leafHi : canopyC[ci++ % 3], 0.78, 2, rnd() * 3, { jit: 0.06 });
  };
  const branches: [number, number, number][] = [[1.0, 12.2, 8.5], [3.3, 14.8, 9.5], [5.2, 17.0, 7.5]];
  for (const [a, y, len] of branches) {
    const o = off(y - 3.4 + 3.4), dx = Math.cos(a), dz = Math.sin(a);
    const p0 = [X + o.x, g + y, Z + o.z], p1 = [p0[0] + dx * len * 0.5, p0[1] + 2.0, p0[2] + dz * len * 0.5], p2 = [p0[0] + dx * len, p0[1] + 3.4, p0[2] + dz * len];
    m.beam(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 1.3, PAL.wood);
    m.beam(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], 0.85, PAL.woodLo);
    m.beam(p1[0], p1[1], p1[2], p1[0] + dz * 3, p1[1] + 2.5, p1[2] - dx * 3, 0.5, PAL.woodLo);
    blob(p2[0], p2[1] + 3.2, p2[2], 5.2 + rnd() * 1.2);
    blob(p1[0] + dz * 2.5, p1[1] + 4.2, p1[2] - dx * 2.5, 3.8);
    // moss strands under the branch
    for (let k = 0; k < 4; k++) {
      const t = 0.35 + k * 0.2, len2 = 1.2 + rnd() * 1.4;
      const sx = lerp(p0[0], p2[0], t), sy = lerp(p0[1], p2[1], t) - 0.5, sz = lerp(p0[2], p2[2], t);
      m.box(sx, sy - len2, sz, 0.1, len2, 0.1, PAL.mossHi, 0, { jit: 0.08 });
      m.ball(sx, sy - len2, sz, 0.2, PAL.moss, 1.4, 0);
    }
  }
  const ty = g + 3.4 + segN * segH;
  blob(X + topO.x, ty + 3.2, Z + topO.z, 8.2);
  blob(X + topO.x + 4.5, ty + 0.8, Z + topO.z - 2, 5.6);
  blob(X + topO.x - 4.8, ty + 0.4, Z + topO.z + 2.5, 5.8);
  blob(X + topO.x + 1.5, ty + 6.5, Z + topO.z + 2, 4.6, true);
  blob(X + topO.x - 2.5, ty + 5.4, Z + topO.z - 3.5, 4.2, true);

  // hanging lanterns at the doorway
  for (const sx of [-1, 1]) {
    const lx = X + sx * 1.05;
    m.beam(lx, g + 3.65, Z + 1.0, lx, g + 3.65, Z + 1.8, 0.13, PAL.woodLo);
    m.beam(lx, g + 3.5, Z + 1.7, lx, g + 3.0, Z + 1.7, 0.04, PAL.ink);
    m.box(lx, g + 2.62, Z + 1.7, 0.34, 0.07, 0.34, PAL.ink);
    glow.box(lx, g + 2.7, Z + 1.7, 0.24, 0.34, 0.24, PAL.emberHi, 0, { jit: 0, ao: 0 });
  }
  glow.ball(X, g + 2.1, Z - 0.15, 0.3, PAL.emberHi, 1.2, 1, 0, { jit: 0, ao: 0 });
  m.beam(X, g + 3.4, Z - 0.15, X, g + 2.4, Z - 0.15, 0.04, PAL.ink);

  // toadstool ring in front of the doorway
  const rc = { x: X + 0.3, z: Z + 5.6 };
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * TAU + rnd() * 0.3, r = 2.1 + rnd() * 0.25;
    const x = rc.x + Math.cos(a) * r, z = rc.z + Math.sin(a) * r, h = 0.3 + rnd() * 0.35, gh = world.heightAt(x, z);
    m.cyl(x, gh - 0.05, z, 0.1, 0.08, h, PAL.parchment, 5);
    m.ball(x, gh + h, z, 0.28 + rnd() * 0.12, PAL.rubric, 0.55, 1);
    m.ball(x + 0.08, gh + h + 0.11, z, 0.05, PAL.foam, 0.6, 0, 0, { jit: 0 });
    if (k % 3 === 0) glow.ball(x, gh + h + 0.04, z, 0.14, PAL.rune, 0.5, 0, 0, { jit: 0, ao: 0 });
  }

  // colliders: two piers, back, and the trunk above the doorway lintel
  const owner = "landmarks:oak";
  world.addBox({ minX: X - 2.3, maxX: X - 0.8, minZ: Z - 1.0, maxZ: Z + 1.2, minY: g0, maxY: g + 3.6, tag: "solid", owner: owner + "-l" });
  world.addBox({ minX: X + 0.8, maxX: X + 2.3, minZ: Z - 1.0, maxZ: Z + 1.2, minY: g0, maxY: g + 3.6, tag: "solid", owner: owner + "-r" });
  world.addBox({ minX: X - 2.4, maxX: X + 2.4, minZ: Z - 2.4, maxZ: Z - 0.7, minY: g0, maxY: g + 3.6, tag: "solid", owner: owner + "-b" });
  world.addBox({ minX: X - 1.6, maxX: X + 1.6, minZ: Z - 1.6, maxZ: Z + 1.6, minY: g + 2.9, maxY: g + 12, tag: "solid", owner: owner + "-t" });

  reg.shard({ id: "shard-oak", x: X, y: g + 1.1, z: Z + 0.1 });
  reg.cluster({ x: X + 3.4, y: g + 0.9, z: Z + 3.2, n: 4, spread: 1.2 });
  reg.cluster({ x: X - 4.2, y: g + 1.0, z: Z + 1.5, n: 4, spread: 1.4 });
  reg.cluster({ x: X + 2.0, y: g + 1.0, z: Z - 4.2, n: 3, spread: 1.2 });
  loreStone(m, glow, env, X - 6.2, Z + 8.0, 0.2, owner + "-lore", PAL.rockHi, PAL.rune);
  reg.lore({
    id: "lore-oak", x: X - 6.0, z: Z + 8.6, y: world.heightAt(X - 6.2, Z + 8.0), yaw: 0.2, title: "The Listening Oak",
    text: "The old oak keeps what the wood forgets. Lean into its hollow on a still night and you can hear the first keepers counting their flames. One flame is still uncounted, Wren, and the tree has been waiting for you to bring it.",
  });

  commit(env, m, "oak-wood");
  const gm = commit(env, glow, "oak-glow", glowMat(env.look, PAL.emberHi, 1.3), false);
  gm.receiveShadow = false;
  halo(env, X, g + 1.7, Z + 0.1, "#ffc07a", 7, 0.8);
  return { x: X, z: Z, radius: 26 };
}

// =====================================================================================================================
// 2. Cliff ledge
// =====================================================================================================================
export function buildCliffLedge(env: SiteEnv): SiteInfo {
  const { world, reg } = env;
  const t = 0.45;
  const px = lerp(CLIFFS.x0, CLIFFS.x1, t), pz = lerp(CLIFFS.z0, CLIFFS.z1, t);
  const dl = Math.hypot(CLIFFS.x1 - CLIFFS.x0, CLIFFS.z1 - CLIFFS.z0);
  const wx = (CLIFFS.x1 - CLIFFS.x0) / dl, wz = (CLIFFS.z1 - CLIFFS.z0) / dl; // along the wall
  const nx = wz, nz = -wx; // horizontal normal
  const TARGET = 60;

  let fx = px, fz = pz, found = false, up = 1; // up = side on which the ground rises
  for (const s of [1, -1]) {
    let prev = world.heightAt(px, pz);
    for (let k = 1; k <= 40 && !found; k++) {
      const x = px + nx * s * k, z = pz + nz * s * k, h = world.heightAt(x, z);
      if (prev < TARGET && h >= TARGET) {
        const f = (TARGET - prev) / (h - prev);
        fx = px + nx * s * (k - 1 + f); fz = pz + nz * s * (k - 1 + f);
        found = true; up = s;
      }
      prev = h;
    }
    if (found) break;
  }
  const hAt = world.heightAt(fx, fz);
  const top = found ? TARGET : hAt + 1.4;
  // out = direction away from the rock, into the air
  const ox = -nx * up, oz = -nz * up;
  const ry = Math.atan2(ox, oz);
  const cxl = fx + ox * 0.5, czl = fz + oz * 0.5; // slab center: one third in the rock, two thirds out
  const tx = wx, tz = wz; // tangent
  const m = new Mesher(41);
  const glow = new Mesher(42);

  m.box(cxl, top - 0.7, czl, 3, 0.7, 3, PAL.ashHi, ry, { ao: 0.05 });
  m.box(cxl + ox * 1.42, top, czl + oz * 1.42, 3.1, 0.22, 0.3, PAL.rockHi, ry, { jit: 0.02 }); // carved lip
  m.box(cxl + ox * 1.52, top - 0.55, czl + oz * 1.52, 2.7, 0.12, 0.12, PAL.ashLo, ry); // groove under the lip
  for (const s of [-1, 0, 1]) { // corbels
    const bx = cxl + tx * s * 0.95, bz = czl + tz * s * 0.95;
    m.beam(bx + ox * 1.1, top - 0.7, bz + oz * 1.1, bx - ox * 0.9, top - 2.3, bz - oz * 0.9, 0.55, PAL.ash);
    m.box(bx + ox * 1.1, top - 1.05, bz + oz * 1.1, 0.7, 0.35, 0.7, PAL.rockHi, ry);
  }
  // carved panel and frame in the face above the ledge
  const fcx = fx + ox * 0.15, fcz = fz + oz * 0.15;
  m.box(fcx, top, fcz, 2.9, 3.4, 0.55, PAL.ashLo, ry);
  m.box(fcx + ox * 0.18, top + 0.35, fcz + oz * 0.18, 2.1, 2.7, 0.2, PAL.ash, ry);
  for (const s of [-1, 1]) m.box(fcx + tx * s * 1.4, top, fcz + tz * s * 1.4, 0.35, 3.6, 0.7, PAL.rockHi, ry);
  m.box(fcx, top + 3.4, fcz, 3.4, 0.4, 0.7, PAL.rockHi, ry);
  glow.box(fcx + ox * 0.3, top + 1.5, fcz + oz * 0.3, 0.14, 1.6, 0.05, PAL.goldHi, ry, { jit: 0, ao: 0 });
  glow.box(fcx + ox * 0.3, top + 2.0, fcz + oz * 0.3, 0.9, 0.14, 0.05, PAL.goldHi, ry, { jit: 0, ao: 0 });

  // rope and pegs
  const pegY = top + 1.6;
  for (const s of [-1.1, 0.2, 1.2]) {
    const bx = fx + tx * s + ox * 0.15, bz = fz + tz * s + oz * 0.15;
    m.beam(bx - ox * 0.5, pegY + s * 0.15, bz - oz * 0.5, bx + ox * 0.55, pegY + s * 0.15 - 0.08, bz + oz * 0.55, 0.14, PAL.woodLo);
  }
  const rx = fx + tx * 0.2 + ox * 0.7, rz = fz + tz * 0.2 + oz * 0.7;
  m.beam(rx, pegY - 0.1, rz, rx + ox * 0.9, top - 0.2, rz + oz * 0.9, 0.07, PAL.sand);
  m.beam(rx + ox * 0.9, top - 0.2, rz + oz * 0.9, rx + ox * 1.9, top - 3.6, rz + oz * 1.9, 0.07, PAL.sand);
  m.torus(cxl - tx * 0.9 - ox * 0.5, top + 0.1, czl - tz * 0.9 - oz * 0.5, 0.32, 0.07, PAL.sand, Math.PI / 2, 0, 0, 14, 5);
  m.torus(cxl - tx * 0.9 - ox * 0.5, top + 0.2, czl - tz * 0.9 - oz * 0.5, 0.24, 0.07, PAL.sand, Math.PI / 2, 0, 0, 12, 5);

  // lantern: gold, lit
  const lx = cxl + tx * 1.15 - ox * 0.2, lz = czl + tz * 1.15 - oz * 0.2;
  m.cyl(lx, top, lz, 0.2, 0.17, 0.12, PAL.ink, 6);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box(lx + a * 0.14, top + 0.1, lz + b * 0.14, 0.04, 0.46, 0.04, PAL.ink);
  m.cone(lx, top + 0.56, lz, 0.26, 0.2, PAL.goldLo, 6);
  glow.box(lx, top + 0.15, lz, 0.2, 0.34, 0.2, PAL.goldHi, 0, { jit: 0, ao: 0 });

  const [hx, hz] = rotHalf(3, 3, ry);
  world.addBox({ minX: cxl - hx, maxX: cxl + hx, minZ: czl - hz, maxZ: czl + hz, minY: top - 0.7, maxY: top, tag: "climbable", owner: "landmarks:ledge" });

  reg.shard({ id: "shard-ledge", x: cxl + ox * 0.3, y: top + 1.1, z: czl + oz * 0.3 });
  reg.cluster({ x: cxl - tx * 0.9 + ox * 0.6, y: top + 0.8, z: czl - tz * 0.9 + oz * 0.6, n: 5, spread: 0.9 });

  commit(env, m, "ledge-stone");
  const gm = commit(env, glow, "ledge-glow", glowMat(env.look, PAL.goldHi, 1.2), false);
  gm.receiveShadow = false;
  halo(env, lx, top + 0.35, lz, "#ffc46a", 5, 0.8);
  return { x: fx, z: fz, radius: 16 };
}

// =====================================================================================================================
// 3. Sea stack at the river mouth
// =====================================================================================================================
export function buildRiverStack(env: SiteEnv): SiteInfo {
  const { world, reg } = env;
  const X = -545, Z = 445;
  const g = world.heightAt(X, Z);
  const base = Math.min(g - 0.5, -8);
  const TOP = 16;
  const rnd = rng(7771);
  const m = new Mesher(51);
  const owner = "landmarks:seastack";

  const widths = [10.5, 9.0, 7.6, 6.4, 5.4, 4.5, 3.8];
  const share = [0.2, 0.17, 0.15, 0.14, 0.13, 0.11, 0.1];
  const colors = [PAL.ashLo, PAL.ash, PAL.rock, PAL.ashHi, PAL.rockLo, PAL.rockHi, PAL.ashHi];
  let y = base, cxp = X, czp = Z;
  const tops: { y: number; x: number; z: number; w: number }[] = [];
  for (let i = 0; i < widths.length; i++) {
    const h = (TOP - 0.5 - base) * share[i] / 0.99;
    const w = widths[i], d = w * (0.8 + rnd() * 0.25);
    if (i > 0) { cxp += (rnd() - 0.5) * 0.9; czp += (rnd() - 0.5) * 0.9; }
    const top = i === widths.length - 1 ? TOP - 0.5 : y + h;
    m.box(cxp, y - (i ? 0.4 : 0), czp, w, top - y + (i ? 0.4 : 0), d, colors[i], 0, { ao: 0.2 });
    world.addBox({ minX: cxp - w / 2, maxX: cxp + w / 2, minZ: czp - d / 2, maxZ: czp + d / 2, minY: y - (i ? 0.4 : 0), maxY: top, tag: "climbable", owner: `${owner}-${i}` });
    // strata line and outcrops that break the block outline
    m.box(cxp, y + (top - y) * 0.55, czp, w + 0.15, 0.14, d + 0.15, PAL.sand, 0, { jit: 0.02, ao: 0, });
    for (let k = 0; k < 3; k++) {
      const a = rnd() * TAU, rr = Math.min(w, d) * 0.5;
      m.cyl(cxp + Math.cos(a) * rr * 0.95, y + (top - y) * 0.15, czp + Math.sin(a) * rr * 0.95, 0.9 + rnd() * 0.7, 0.55 + rnd() * 0.3, (top - y) * (0.6 + rnd() * 0.3), colors[(i + k) % colors.length], 5, rnd() * 3,
        { rx: (rnd() - 0.5) * 0.18, rz: (rnd() - 0.5) * 0.18 });
    }
    tops.push({ y: top, x: cxp, z: czp, w });
    y = top;
  }
  const topL = tops[tops.length - 1];
  m.box(topL.x, TOP - 0.5, topL.z, topL.w + 0.4, 0.5, topL.w * 0.85 + 0.4, PAL.ashHi, 0, { ao: 0.05 });
  // top cairn, shard beside it
  const cy = TOP;
  for (let k = 0; k < 4; k++) m.ball(topL.x - 0.7, cy + 0.12 + k * 0.28, topL.z - 0.5, 0.52 - k * 0.1, k % 2 ? PAL.rock : PAL.rockHi, 0.6, 1, rnd() * 3);
  reg.shard({ id: "shard-seastack", x: topL.x + 0.7, y: TOP + 1.1, z: topL.z + 0.5 });

  // guano streaks: flat discs on ledges and flat plates down the faces
  const GU = "#ece6d4";
  for (let i = 1; i < tops.length; i++) {
    const p = tops[i - 1], q = tops[i];
    for (let k = 0; k < 2; k++) {
      const a = rnd() * TAU, rr = p.w * 0.38 * Math.sqrt(rnd());
      if (Math.abs(p.x + Math.cos(a) * rr - q.x) < q.w * 0.5 && Math.abs(p.z + Math.sin(a) * rr - q.z) < q.w * 0.5) continue;
      m.cyl(p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr, 0.4 + rnd() * 0.9, 0.35 + rnd() * 0.8, 0.06, GU, 7, rnd() * 3, { jit: 0.02, ao: 0, sx: 1.3 });
    }
    const side = rnd() < 0.5 ? -1 : 1;
    m.box(q.x + side * q.w * 0.3, q.y - (q.y - p.y) * 0.75, q.z + q.w * 0.5 + 0.01, 0.28 + rnd() * 0.2, (q.y - p.y) * 0.7, 0.05, GU, 0, { jit: 0.02, ao: 0 });
  }
  m.cyl(topL.x + 1.0, TOP, topL.z - 0.9, 0.55, 0.5, 0.05, GU, 7, 0, { jit: 0.02, ao: 0 });
  m.torus(X, SEA_LEVEL + 0.12, Z, 6.0, 0.4, PAL.foam, Math.PI / 2, 0, 0, 28, 5); // foam skirt

  const half = tops[Math.min(3, tops.length - 1)];
  reg.cluster({ x: half.x + half.w * 0.25, y: half.y + 0.9, z: half.z + half.w * 0.1, n: 5, spread: 1.2 });

  commit(env, m, "seastack");
  return { x: X, z: Z, radius: 24 };
}

// =====================================================================================================================
// 4. Mt. Cinder flank ruin
// =====================================================================================================================
export function buildFlankRuin(env: SiteEnv): SiteInfo {
  const { world, reg } = env;
  const X = -110, Z = -30;
  const rnd = rng(2203);
  const m = new Mesher(61);
  const glow = new Mesher(62);
  const gY = world.heightAt(X, Z);
  const R = 7;

  // broken circular wall, entrance gap to the south (+z), arch to the north
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = i / N * TAU;
    const dz = Math.sin(a), dx = Math.cos(a);
    if (dz > 0.8) continue; // south gap
    if (dz < -0.93) continue; // arch bay
    if (rnd() < 0.18) continue;
    const x = X + dx * R, z = Z + dz * R;
    const len = TAU * R / N * 0.98, th = 1.1;
    const ry = rotRadial(a);
    const [hx, hz] = rotHalf(len, th, ry);
    const top = world.heightAt(x, z) + 1.0 + rnd() * 2.2;
    const y0 = groundMin(world, x, z, hx, hz) - 0.6;
    m.box(x, y0, z, len, top - y0, th, i & 1 ? PAL.ashHi : PAL.ash, ry, { ao: 0.2 });
    m.box(x, top - 0.15, z, len * 1.02, 0.18, th * 1.12, PAL.rockHi, ry, { jit: 0.02, ao: 0 }); // cap course
    if (rnd() < 0.5) m.box(x + dx * 0.1, top, z + dz * 0.1, len * 0.45, 0.5 + rnd() * 0.5, th * 0.8, PAL.ashLo, ry + (rnd() - 0.5) * 0.4); // broken stones
    if (rnd() < 0.6) m.ball(x - dx * 0.3, top + 0.05, z - dz * 0.3, 0.5, PAL.moss, 0.35, 1);
    world.addBox({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: y0, maxY: top, tag: "solid", owner: `landmarks:flank-wall-${i}` });
  }

  // arch on the north side
  const az = Z - R;
  for (const sx of [-1, 1]) {
    const ax = X + sx * 1.65;
    const y0 = groundMin(world, ax, az, 0.6, 0.6) - 0.6;
    m.box(ax, y0, az, 1.2, world.heightAt(ax, az) + 3.6 - y0, 1.3, PAL.ashHi, 0, { ao: 0.2 });
    m.box(ax, world.heightAt(ax, az) + 3.6, az, 1.5, 0.3, 1.6, PAL.rockHi, 0, { ao: 0 });
    world.addBox({ minX: ax - 0.6, maxX: ax + 0.6, minZ: az - 0.65, maxZ: az + 0.65, minY: y0, maxY: world.heightAt(ax, az) + 3.9, tag: "solid", owner: `landmarks:flank-pier-${sx}` });
  }
  const aBase = world.heightAt(X, az) + 3.9;
  for (let k = 0; k < 6; k++) { // left three-quarters of an arch, the right side fell
    const a0 = Math.PI * k / 7, a1 = Math.PI * (k + 1) / 7;
    m.beam(X + Math.cos(a0) * 1.65, aBase + Math.sin(a0) * 1.5, az, X + Math.cos(a1) * 1.65, aBase + Math.sin(a1) * 1.5, az, 0.8, k & 1 ? PAL.ash : PAL.ashHi);
  }
  m.box(X - 0.4, aBase + 1.5, az, 1.0, 0.7, 1.0, PAL.rockHi, 0.2); // keystone, slipped
  world.addBox({ minX: X - 2.3, maxX: X + 2.3, minZ: az - 0.65, maxZ: az + 0.65, minY: aBase - 0.4, maxY: aBase + 1.8, tag: "solid", owner: "landmarks:flank-lintel" });
  m.box(X + 2.6, world.heightAt(X + 2.6, az + 1.4) - 0.2, az + 1.4, 1.5, 0.6, 0.9, PAL.ashLo, 0.5, { rz: 0.15 }); // fallen voussoirs
  m.box(X + 3.4, world.heightAt(X + 3.4, az + 2.2) - 0.2, az + 2.2, 1.0, 0.5, 0.8, PAL.ash, 1.1);

  // altar
  const ag = groundMin(world, X, Z - 1.5, 1.2, 0.8);
  m.box(X, ag - 0.5, Z - 1.5, 2.4, 0.5 + 0.5 + (world.heightAt(X, Z - 1.5) - ag), 1.5, PAL.ashLo, 0, { ao: 0.2 });
  const at = world.heightAt(X, Z - 1.5) + 0.5;
  m.box(X, at, Z - 1.5, 2.0, 0.45, 1.1, PAL.rockHi, 0, { ao: 0.05 });
  world.addBox({ minX: X - 1.2, maxX: X + 1.2, minZ: Z - 2.25, maxZ: Z - 0.75, minY: ag - 0.5, maxY: at + 0.45, tag: "solid", owner: "landmarks:flank-altar" });
  const crestY = at - 0.2, crestZ = Z - 0.74;
  glow.torus(X, crestY, crestZ + 0.02, 0.3, 0.045, PAL.goldHi, 0, 0, 0, 20, 4);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    glow.beam(X + Math.cos(a) * 0.12, crestY + Math.sin(a) * 0.12, crestZ + 0.03, X + Math.cos(a) * 0.52, crestY + Math.sin(a) * 0.52, crestZ + 0.03, 0.045, PAL.goldHi, { jit: 0, ao: 0 });
  }
  glow.box(X, at + 0.45, Z - 1.5, 0.9, 0.04, 0.5, PAL.gold, 0, { jit: 0, ao: 0 });
  reg.shard({ id: "shard-ruin", x: X, y: at + 0.45 + 1.1, z: Z - 1.5 });

  // fallen drums, moss, rubble
  for (let k = 0; k < 3; k++) {
    const a = 0.6 + k * 2.1, r = 2.5 + rnd() * 2.2;
    const x = X + Math.cos(a) * r, z = Z + Math.sin(a) * r + 1.0, gh = world.heightAt(x, z);
    m.cyl(x, gh + 0.45, z, 0.7, 0.62, 1.4, PAL.ash, 8, 0, { rz: Math.PI / 2, rx: 0.1 * k });
    m.ball(x, gh + 0.9, z, 0.6, PAL.mossLo, 0.3, 1);
  }
  for (let k = 0; k < 6; k++) {
    const a = rnd() * TAU, r = 1 + rnd() * 4.5;
    const x = X + Math.cos(a) * r, z = Z + Math.sin(a) * r, gh = world.heightAt(x, z);
    m.ball(x, gh + 0.05, z, 0.6 + rnd() * 0.8, k & 1 ? PAL.moss : PAL.mossLo, 0.12, 1, 0, { jit: 0.06 });
  }
  m.cyl(X, groundMin(world, X, Z, 3, 3) - 0.2, Z, 4.3, 4.4, 0.35 + (gY - groundMin(world, X, Z, 3, 3)), PAL.ashLo, 14, 0, { ao: 0.1 }); // worn floor disc

  loreStone(m, glow, env, X - 3.6, Z + 11, 0.15, "landmarks:flank-lore", PAL.ashHi, PAL.goldHi);
  reg.lore({
    id: "lore-flank", x: X - 3.4, z: Z + 11.7, y: world.heightAt(X - 3.6, Z + 11), yaw: 0.15, title: "The Ring of Keepers",
    text: "Before the beacons there were keepers, and before the keepers a ring on this slope. They took the first flame from the mountain's own warmth and taught it to walk the hills. The ring is broken now, but the altar still remembers the shape of a flame.",
  });
  reg.cluster({ x: X + 2.6, y: gY + 0.9, z: Z + 3.4, n: 5, spread: 1.3 });
  reg.cluster({ x: X, y: aBase + 2.5, z: az, n: 4, spread: 1.0 });

  commit(env, m, "flank-stone");
  const gm = commit(env, glow, "flank-glow", glowMat(env.look, PAL.goldHi, 1.25), false);
  gm.receiveShadow = false;
  halo(env, X, at + 0.9, Z - 1.5, "#e8c766", 5, 0.7);
  return { x: X, z: Z, radius: 22 };
}

// =====================================================================================================================
// 5. Drowned ruins
// =====================================================================================================================
export function buildDrownedRuins(env: SiteEnv): SiteInfo {
  const { world, reg } = env;
  const cx = LAKE.x, cz = LAKE.z, WL = LAKE.level;
  const rnd = rng(9009);
  const m = new Mesher(71);
  const glow = new Mesher(72);

  const excluded = (x: number, z: number, pad: number) =>
    Math.hypot(x - 250, z + 330) < 30 + pad || (x > 240 - pad && x < 260 + pad && z > -310 - pad);
  const spots: { x: number; z: number }[] = [];
  const pick = (): { x: number; z: number } => {
    for (let n = 0; n < 200; n++) {
      const a = rnd() * TAU, r = 35 + rnd() * 50;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (excluded(x, z, 3)) continue;
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 9)) continue;
      spots.push({ x, z });
      return { x, z };
    }
    const a = rnd() * TAU;
    return { x: cx + Math.cos(a) * 60, z: cz - Math.abs(Math.sin(a)) * 60 };
  };
  const loc = (px: number, pz: number, ry: number, lx: number, lz: number): [number, number] =>
    [px + lx * Math.cos(ry) + lz * Math.sin(ry), pz - lx * Math.sin(ry) + lz * Math.cos(ry)];
  const stoneC = [PAL.rock, PAL.rockLo, PAL.rockHi, PAL.ash];

  const runePlate = (x: number, y: number, z: number, ry: number) =>
    glow.box(x, y, z, 0.42, 0.62, 0.06, PAL.rune, ry, { jit: 0.02, ao: 0 });
  const mossBand = (x: number, z: number, r: number, tilt = 0) =>
    m.cyl(x, WL - 0.35, z, r * 1.08, r * 1.05, 0.55, PAL.mossLo, 8, 0, { rz: tilt, jit: 0.06 });

  // tall columns (solid above water)
  for (let i = 0; i < 3; i++) {
    const p = pick(), fl = world.heightAt(p.x, p.z) - 0.5, up = WL + 2.5 + rnd() * 4.5;
    const lean = i === 1 ? 0.14 : (rnd() - 0.5) * 0.05;
    const c = stoneC[i % 4];
    m.cyl(p.x, fl, p.z, 1.15, 1.0, 1.0, PAL.rockLo, 8);
    m.cyl(p.x, fl + 0.8, p.z, 0.82, 0.74, up - fl - 0.8, c, 8, 0, { rz: lean });
    m.cyl(p.x, WL - 2.2, p.z, 0.88, 0.88, 0.3, PAL.rockHi, 8, 0, { rz: lean });
    m.cyl(p.x, up - 1.5, p.z, 0.88, 0.86, 0.3, PAL.rockHi, 8, 0, { rz: lean });
    mossBand(p.x, p.z, 0.8, lean);
    m.box(p.x - lean * 3, up - 0.05, p.z, 1.9, 0.5, 1.9, PAL.rockHi, rnd(), { rz: lean });
    m.ball(p.x, up + 0.45, p.z + 0.2, 0.7, PAL.moss, 0.35, 1);
    runePlate(p.x + 0.8, WL - 1.7, p.z, Math.PI / 2);
    world.addBox({ minX: p.x - 1.0, maxX: p.x + 1.0, minZ: p.z - 1.0, maxZ: p.z + 1.0, minY: fl, maxY: up, tag: "solid", owner: `landmarks:drowned-col-${i}` });
  }

  // half-sunk arch (two solid piers)
  {
    const p = pick(), ry = rnd() * Math.PI, span = 2.7;
    const fl = world.heightAt(p.x, p.z) - 0.5, ph = WL + 4.4;
    for (const s of [-1, 1]) {
      const [x, z] = loc(p.x, p.z, ry, s * span, 0);
      m.box(x, fl, z, 1.5, ph - fl, 1.5, PAL.rock, ry, { ao: 0.25 });
      m.box(x, ph, z, 1.8, 0.35, 1.8, PAL.rockHi, ry, { ao: 0 });
      mossBand(x, z, 0.85);
      const [hx, hz] = rotHalf(1.5, 1.5, ry);
      world.addBox({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, minY: fl, maxY: ph, tag: "solid", owner: `landmarks:drowned-arch-${s}` });
    }
    for (let k = 0; k < 5; k++) { // left side of the curve only; the keystone is gone
      const a0 = Math.PI - Math.PI * k / 8, a1 = Math.PI - Math.PI * (k + 1) / 8;
      const [x0, z0] = loc(p.x, p.z, ry, Math.cos(a0) * span, 0), [x1, z1] = loc(p.x, p.z, ry, Math.cos(a1) * span, 0);
      m.beam(x0, ph + 0.35 + Math.sin(a0) * 2.2, z0, x1, ph + 0.35 + Math.sin(a1) * 2.2, z1, 0.8, k & 1 ? PAL.rockHi : PAL.rock);
    }
    const [bx, bz] = loc(p.x, p.z, ry, span + 2.4, 1.6);
    m.box(bx, world.heightAt(bx, bz) - 0.2, bz, 1.4, 0.8, 0.9, PAL.rockLo, ry + 0.6, { rz: 0.2 });
    const [rx0, rz0] = loc(p.x, p.z, ry, -span, 0.77);
    runePlate(rx0, WL - 1.5, rz0, ry);
  }

  // toppled statue head, half sunk
  {
    const p = pick(), fl = world.heightAt(p.x, p.z) - 0.5, ry = rnd() * TAU;
    const cy = WL + 0.4;
    const [nx, nz] = loc(p.x, p.z, ry, 0, 2.1);
    m.box(p.x, fl, p.z, 3.6, cy - fl - 0.6, 3.0, PAL.rockLo, ry, { ao: 0.25 }); // rubble pedestal
    m.ball(p.x, cy + 0.9, p.z, 2.0, PAL.rockHi, 1.2, 2, ry, { sx: 0.85, rx: 0.5, rz: 0.2 });
    m.box(nx, cy + 0.4, nz, 0.7, 1.6, 0.9, PAL.rockHi, ry, { rx: 0.5 });
    for (const s of [-1, 1]) {
      const [ex, ez] = loc(p.x, p.z, ry, s * 0.8, 1.7);
      m.box(ex, cy + 1.3, ez, 0.8, 0.12, 0.3, PAL.rockLo, ry, { rx: 0.5 });
      m.ball(ex, cy + 0.9, ez, 0.17, PAL.moss, 0.6, 0);
    }
    const [bx, bz] = loc(p.x, p.z, ry, 0, -0.7);
    m.cyl(bx, cy + 1.7, bz, 1.5, 1.7, 0.7, PAL.gold, 8, ry, { rx: 0.5, jit: 0.02 });
    m.ball(p.x, cy + 1.1, p.z + 0.3, 1.1, PAL.moss, 0.25, 1);
    glow.box(nx, cy + 2.35, nz, 0.5, 0.4, 0.05, PAL.rune, ry, { jit: 0, ao: 0 });
    world.addBox({ minX: p.x - 2.0, maxX: p.x + 2.0, minZ: p.z - 2.0, maxZ: p.z + 2.0, minY: fl, maxY: WL + 2.2, tag: "solid", owner: "landmarks:drowned-head" });
  }

  // submerged columns, some fallen
  for (let i = 0; i < 6; i++) {
    const p = pick(), fl = world.heightAt(p.x, p.z) - 0.5, top = WL - 0.5 - rnd() * 3.2;
    if (i < 4) {
      m.cyl(p.x, fl, p.z, 1.0, 0.85, top - fl, stoneC[i % 4], 8, 0, { rz: (rnd() - 0.5) * 0.25, rx: (rnd() - 0.5) * 0.15 });
      m.box(p.x, top - 0.3, p.z, 1.7, 0.4, 1.7, PAL.rockHi, rnd() * 3, { rz: (rnd() - 0.5) * 0.3 });
      if (i < 2) runePlate(p.x + 0.88, fl + 1.4, p.z, Math.PI / 2);
    } else {
      const ry = rnd() * Math.PI;
      m.cyl(p.x, fl + 0.7, p.z, 0.8, 0.72, 5.5, PAL.rock, 8, ry, { rz: Math.PI / 2 - 0.1, rx: 0.05 });
      m.cyl(p.x + 2.5, fl + 0.2, p.z + 1, 0.9, 0.85, 1.4, PAL.rockLo, 8);
    }
  }
  // stair fragments
  for (let i = 0; i < 3; i++) {
    const p = pick(), ry = rnd() * TAU, fl = world.heightAt(p.x, p.z) - 0.4;
    const steps = 5, rise = 0.45;
    const topY = i === 0 ? WL + 0.2 : WL - 1.2 - rnd() * 1.5;
    for (let k = 0; k < steps; k++) {
      const [x, z] = loc(p.x, p.z, ry, 0, k * 0.95);
      const h = Math.min(topY - fl, rise * (steps - k) + 0.3 + (topY - fl - rise * steps) * 0.0);
      m.box(x, fl, z, 3.2, Math.max(0.5, h), 1.0, k & 1 ? PAL.rock : PAL.rockHi, ry, { ao: 0.2 });
    }
    m.ball(p.x, fl + 0.5, p.z, 0.6, PAL.mossLo, 0.3, 1);
  }
  // ring of low walls
  {
    const p = pick(), rr = 5.5, fl = world.heightAt(p.x, p.z);
    for (let k = 0; k < 10; k++) {
      if (k === 3 || k === 7) continue;
      const a = k / 10 * TAU;
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      m.box(x, fl - 0.5, z, 3.4, WL - 0.5 - rnd() * 1.1 - fl + 0.5, 0.9, k & 1 ? PAL.rockLo : PAL.rock, rotRadial(a), { ao: 0.25 });
    }
    glow.torus(p.x, fl + 0.12, p.z, 3.4, 0.08, PAL.rune, Math.PI / 2, 0, 0, 36, 4);
    glow.torus(p.x, fl + 0.12, p.z, 1.6, 0.06, PAL.rune, Math.PI / 2, 0, 0, 24, 4);
  }

  // chest: deepest point of the lake bowl, clear of the island ruin and the causeway
  let floorY = Infinity, chx = cx - 20, chz = cz + 5;
  for (let r = 6; r <= 60; r += 6) {
    const steps = Math.round(r / 6) * 6;
    for (let k = 0; k < steps; k++) {
      const a = k / steps * TAU, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (excluded(x, z, 8) || spots.some((s) => Math.hypot(s.x - x, s.z - z) < 6)) continue;
      const h = world.heightAt(x, z);
      if (h < floorY) { floorY = h; chx = x; chz = z; }
    }
  }
  if (!isFinite(floorY)) floorY = LAKE.level - 8;
  const chYaw = Math.atan2(cx - chx, cz - chz);
  reg.chest({ id: "chest-lake", x: chx, y: floorY, z: chz, yaw: chYaw, reward: { kind: "shard", amount: 1 }, rewardId: "shard-lake" });
  for (let k = 0; k < 7; k++) { // rubble ring around the chest, open toward its front
    const a = chYaw + 1.2 + k * 0.62, r = 2.1 + rnd() * 0.6;
    const x = chx + Math.cos(a) * r, z = chz + Math.sin(a) * r, gh = world.heightAt(x, z);
    m.ball(x, gh + 0.1, z, 0.35 + rnd() * 0.45, stoneC[k % 4], 0.7, 1, rnd() * 3);
  }
  glow.torus(chx, floorY + 0.1, chz, 1.6, 0.05, PAL.rune, Math.PI / 2, 0, 0, 24, 4);
  reg.cluster({ x: chx + 1.8, y: floorY + 0.9, z: chz + 1.2, n: 4, spread: 1.0 });
  reg.cluster({ x: chx - 1.6, y: floorY + 1.1, z: chz - 1.4, n: 4, spread: 1.0 });

  // lore stone on the south shore
  loreStone(m, glow, env, 232, -205, 0, "landmarks:lake-lore", PAL.rockHi, PAL.rune);
  reg.lore({
    id: "lore-lake", x: 232, z: -203.4, y: world.heightAt(232, -205), yaw: 0, title: "The Lamps Below",
    text: "Hollowmere's old quarter sank when the waters rose to hide it. The drowned keepers left their lamps burning, and the glimmers still gather round them. Dive where the rune light runs brightest, Wren. Something small was left there on purpose.",
  });

  commit(env, m, "drowned-stone");
  const gm = commit(env, glow, "drowned-runes", glowMat(env.look, PAL.rune, 1.1), false);
  gm.receiveShadow = false;
  halo(env, chx, floorY + 0.9, chz, "#7fe0d0", 5.5, 0.45);
  return { x: cx, z: cz, radius: 112 };
}
