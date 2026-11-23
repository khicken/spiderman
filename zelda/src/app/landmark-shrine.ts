import * as THREE from "three";
import { LANDMARKS } from "./contracts";
import { PAL, Mesher, rng, groundMin, groundMax, solidBox, glowMat, haloSprite, vcMat2 } from "./landmark-kit";
import type { SiteEnv, SiteInfo } from "./landmark-kit";

const OWNER = "landmarks:shrine";

// Hollow Shrine: standing-stone ring around an ember dais, a broken gateway north, and the spring-house waterfall south.
export function buildShrine(env: SiteEnv): SiteInfo {
  const { world, look, group, reg } = env;
  const L = LANDMARKS.find((l) => l.id === "shrine")!;
  const cx = L.x, cz = L.z;
  const R = rng(4471);
  const H = (x: number, z: number) => world.heightAt(x, z);

  const stone = new Mesher(11);
  const rune = new Mesher(12);
  const ember = new Mesher(13);
  const cloth = new Mesher(14);

  const rockCols = [PAL.rock, PAL.rockHi, PAL.rockLo, PAL.ashHi];
  const pick = () => rockCols[(R() * rockCols.length) | 0];
  const moss = (x: number, z: number, r: number) =>
    stone.cyl(x, H(x, z) - 0.02, z, r, r * 0.85, 0.09, R() < 0.5 ? PAL.moss : PAL.mossHi, 9, R() * 3, { sx: 1 + R() * 0.4, jit: 0.08, ao: 0 });
  const chunk = (x: number, y: number, z: number, r: number) =>
    stone.ball(x, y, z, r, pick(), 0.7 + R() * 0.4, 1, R() * 6, { sx: 1 + R() * 0.4, sz: 0.8 + R() * 0.4, jit: 0.07 });

  // North gap keeps the glade exit and spawn clear.
  const N = 9;
  let glimmerStone = { x: cx, y: 0, z: cz };
  for (let i = 0; i < N; i++) {
    const th = Math.PI + 0.7 + (i * (2 * Math.PI - 1.4)) / (N - 1);
    const rad = 13 + (R() - 0.5) * 1.2;
    const x = cx + Math.sin(th) * rad, z = cz + Math.cos(th) * rad;
    const h = 3.5 + R() * 1.5;
    const y0 = groundMin(world, x, z, 0.8, 0.8) - 0.35;
    const len = h + 0.35;
    const rb = 0.85 + R() * 0.3, rt = rb * (0.55 + R() * 0.15);
    const lean = 0.03 + R() * 0.07;
    const al = th + (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.8;
    const rx = lean * Math.cos(al), rz = -lean * Math.sin(al);
    const ox = -Math.sin(rz) * len, oy = Math.cos(rz) * Math.cos(rx) * len, oz = Math.cos(rz) * Math.sin(rx) * len;
    const sz = 0.8 + R() * 0.3;
    const col = pick();
    stone.cyl(x, y0, z, rb, rt, len, col, 5, 0, { rx, rz, sz });
    if (i % 2 === 0) stone.cone(x + ox, y0 + oy - 0.02, z + oz, rt * 1.05, 0.75, col, 5, 0, { rx, rz, sz });
    else stone.ball(x + ox, y0 + oy, z + oz, rt * 0.95, PAL.mossLo, 0.5, 1);
    const inx = cx - x, inz = cz - z, il = Math.hypot(inx, inz);
    const dx = inx / il, dz = inz / il, ang = Math.atan2(dx, dz);
    for (const s of [0.3, 0.52, 0.74]) {
      const rr = (rb + (rt - rb) * s) * 1.04;
      rune.cyl(x + ox * s, y0 + oy * s, z + oz * s, rr, rr, 0.1, PAL.rune, 5, 0, { rx, rz, sz, jit: 0, ao: 0 });
    }
    const gs = 0.42, gr = (rb + (rt - rb) * gs) * 0.88;
    rune.box(x + ox * gs + dx * gr, y0 + oy * gs - 0.3, z + oz * gs + dz * gr, 0.2, 0.7, 0.16, PAL.rune, ang, { jit: 0, ao: 0 });
    rune.box(x + ox * 0.62 + dx * gr * 0.9, y0 + oy * 0.62 - 0.12, z + oz * 0.62 + dz * gr * 0.9, 0.3, 0.3, 0.14, PAL.rune, ang, { rz: 0.785, jit: 0, ao: 0 });
    for (let k = 0; k < 3; k++) {
      const a = R() * 6.28, d = 0.6 + R() * 0.5;
      stone.ball(x + Math.cos(a) * d, y0 + 0.45, z + Math.sin(a) * d, 0.5 + R() * 0.4, R() < 0.5 ? PAL.mossLo : PAL.moss, 0.4, 1);
    }
    moss(x + dx * 1.4, z + dz * 1.4, 0.9 + R() * 0.5);
    world.addBox({ minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7, minY: y0, maxY: y0 + h * 0.95, tag: "solid", owner: OWNER });
    if (i === 3) glimmerStone = { x: x + ox, y: y0 + oy + 0.9, z: z + oz };
  }
  reg.cluster({ x: glimmerStone.x, y: glimmerStone.y, z: glimmerStone.z, n: 4, spread: 0.6 });
  reg.cluster({ x: cx + 8, y: H(cx + 8, cz + 7) + 0.6, z: cz + 7, n: 4 });

  const gc = groundMax(world, cx, cz, 4.4, 4.4);
  const dy0 = groundMin(world, cx, cz, 4.4, 4.4) - 0.5;
  const T = gc + 0.64;
  const oct = Math.PI / 8;
  stone.cyl(cx, dy0, cz, 4.4, 4.2, gc + 0.3 - dy0, PAL.rockHi, 8, oct);
  stone.cyl(cx, gc + 0.3, cz, 3.1, 3.0, 0.34, PAL.rock, 8, oct);
  stone.cyl(cx, T - 0.03, cz, 3.12, 3.12, 0.05, PAL.gold, 8, oct, { jit: 0.02, ao: 0 });
  rune.torus(cx, gc + 0.33, cz, 3.6, 0.04, PAL.rune, Math.PI / 2);
  for (let k = 0; k < 8; k++) {
    const a = k * (Math.PI / 4) + oct;
    rune.box(cx + Math.sin(a) * 3.6, gc + 0.3, cz + Math.cos(a) * 3.6, 0.16, 0.06, 0.5, PAL.rune, a, { jit: 0, ao: 0 });
  }

  const az = cz + 1.0;
  stone.box(cx, T, az, 2.2, 0.7, 1.1, PAL.rockHi);
  stone.box(cx, T + 0.7, az, 2.5, 0.18, 1.3, PAL.rock);
  stone.box(cx, T + 0.3, az - 0.57, 1.7, 0.08, 0.04, PAL.gold, 0, { jit: 0.02, ao: 0 });
  rune.box(cx, T + 0.38, az - 0.58, 0.7, 0.2, 0.03, PAL.rune, 0, { jit: 0, ao: 0 });
  world.addBox({ minX: cx - 1.25, maxX: cx + 1.25, minZ: az - 0.65, maxZ: az + 0.65, minY: T, maxY: T + 0.88, tag: "solid", owner: OWNER });
  reg.rest("rest-shrine", cx, T + 0.88, az, 3.6);

  const bz = cz - 1.6;
  stone.cyl(cx, T, bz, 0.5, 0.32, 1.05, PAL.rockLo, 8);
  stone.cyl(cx, T + 1.05, bz, 0.35, 0.78, 0.38, PAL.goldLo, 8);
  stone.cyl(cx, T + 1.4, bz, 0.82, 0.82, 0.06, PAL.gold, 8, 0, { ao: 0 });
  ember.cyl(cx, T + 1.38, bz, 0.7, 0.68, 0.05, PAL.emberLo, 8, 0, { jit: 0, ao: 0 });
  world.addBox({ minX: cx - 0.5, maxX: cx + 0.5, minZ: bz - 0.5, maxZ: bz + 0.5, minY: T, maxY: T + 1.45, tag: "solid", owner: OWNER });

  const fy = T + 1.42;
  const flames: THREE.Mesh[] = [];
  for (const [r, h, c, it] of [[0.58, 1.7, PAL.ember, 0.9], [0.4, 1.3, PAL.emberHi, 1.1], [0.2, 0.85, "#fff3d6", 1.3]] as const) {
    const g = env.own(new THREE.ConeGeometry(r, h, 7));
    g.translate(0, h / 2, 0);
    const f = new THREE.Mesh(g, glowMat(look, c, it, { transparent: true, opacity: 0.92 }));
    f.position.set(cx, fy, bz);
    f.castShadow = false;
    group.add(f);
    flames.push(f);
  }
  const halo = haloSprite(env.glow, PAL.ember, 7);
  halo.position.set(cx, fy + 0.9, bz);
  env.own(halo.material);
  group.add(halo);

  const sx = cx - 2.2, sz = cz + 0.3;
  stone.box(sx, T, sz, 1.1, 0.35, 1.1, PAL.rockLo);
  stone.cyl(sx, T + 0.35, sz, 0.58, 0.28, 1.5, PAL.rockHi, 7);
  stone.ball(sx, T + 1.9, sz, 0.42, PAL.rockHi, 0.55, 1, 0, { sx: 1.35 });
  stone.ball(sx, T + 2.2, sz - 0.02, 0.3, PAL.rockHi, 1.15);
  stone.cone(sx, T + 2.4, sz + 0.1, 0.28, 0.55, PAL.rockHi, 6, 0, { rx: 0.55 });
  stone.ball(sx, T + 2.16, sz - 0.2, 0.17, PAL.ink, 1, 0);
  stone.beam(sx - 0.35, T + 1.85, sz - 0.1, sx - 0.4, T + 1.55, sz - 0.85, 0.2, PAL.rockHi);
  stone.beam(sx + 0.4, T + 1.85, sz, sx + 0.38, T + 1.0, sz - 0.15, 0.2, PAL.rockHi);
  stone.ball(sx - 0.4, T + 1.5, sz - 0.88, 0.12, PAL.rockHi);
  stone.beam(sx - 0.4, T + 1.5, sz - 0.88, sx - 0.4, T + 1.2, sz - 0.88, 0.03, PAL.goldLo);
  stone.box(sx - 0.4, T + 1.17, sz - 0.88, 0.32, 0.06, 0.32, PAL.gold, 0, { ao: 0 });
  stone.box(sx - 0.4, T + 0.77, sz - 0.88, 0.32, 0.06, 0.32, PAL.gold, 0, { ao: 0 });
  ember.box(sx - 0.4, T + 0.83, sz - 0.88, 0.24, 0.34, 0.24, PAL.emberHi, 0, { jit: 0, ao: 0 });
  world.addBox({ minX: sx - 0.55, maxX: sx + 0.55, minZ: sz - 0.55, maxZ: sz + 0.55, minY: T, maxY: T + 2.7, tag: "solid", owner: OWNER });
  const lh = haloSprite(env.glow, PAL.emberHi, 2.8);
  lh.position.set(sx - 0.4, T + 1.0, sz - 0.88);
  env.own(lh.material);
  group.add(lh);

  const gz = cz - 20;
  for (const [sd, ph] of [[-1, 6.0], [1, 3.4]] as const) {
    const px = cx + sd * 3.1;
    const y0 = groundMin(world, px, gz, 0.65, 0.65) - 0.5;
    const g0 = H(px, gz);
    stone.box(px, y0, gz, 1.45, g0 + 0.5 - y0, 1.45, PAL.rockLo);
    stone.box(px, g0 + 0.5, gz, 1.0, ph - 0.5, 1.0, PAL.rock);
    stone.box(px - sd * 0.5, g0 + 0.5, gz, 0.04, ph - 0.7, 0.2, PAL.gold, 0, { jit: 0.02, ao: 0 });
    for (const hh of [1.4, 2.4]) rune.box(px, g0 + hh, gz, 1.04, 0.1, 1.04, PAL.rune, 0, { jit: 0, ao: 0 });
    if (sd < 0) {
      stone.box(px, g0 + ph, gz, 1.5, 0.4, 1.5, PAL.rockHi);
      stone.box(px + 0.9, g0 + ph + 0.4 - 0.8, gz, 1.2, 0.8, 1.1, PAL.rock, 0, { rz: 0.04 });
    } else {
      stone.box(px - 0.25, g0 + ph, gz + 0.1, 0.6, 0.55, 0.7, PAL.rock, 0.4, { rz: 0.2 });
      stone.box(px + 0.3, g0 + ph, gz - 0.1, 0.5, 0.35, 0.6, PAL.rockHi, -0.3);
    }
    stone.ball(px, g0 + 0.25, gz + sd * 1.0 * 0.0 + 0.9, 0.45, PAL.mossLo, 0.5);
    world.addBox({ minX: px - 0.65, maxX: px + 0.65, minZ: gz - 0.65, maxZ: gz + 0.65, minY: y0, maxY: g0 + ph, tag: "solid", owner: OWNER });
  }
  const lx = cx + 7.4, lz = gz + 1.6, lg = H(lx, lz);
  stone.box(lx, lg + 0.25, lz, 6.4, 0.9, 1.0, PAL.rockHi, 0.22, { rz: 0.07 });
  stone.box(lx, lg + 1.15, lz, 5.2, 0.04, 0.12, PAL.gold, 0.22, { rz: 0.07, jit: 0.02, ao: 0 });
  for (let k = 0; k < 7; k++) chunk(lx + (R() - 0.5) * 9, lg + 0.15, lz + (R() - 0.5) * 3.4, 0.25 + R() * 0.3);
  stone.ball(lx - 3.2, lg + 0.2, lz - 0.5, 0.55, PAL.rock, 0.6);
  world.addBox({ minX: lx - 3.1, maxX: lx + 3.1, minZ: lz - 1.2, maxZ: lz + 1.2, minY: lg - 0.3, maxY: lg + 1.1, tag: "solid", owner: OWNER });
  moss(cx - 5.5, gz + 1, 1.3);
  moss(cx + 3, gz - 1.5, 1.0);

  const pathX = (z: number) => cx + 1.1 * Math.sin((cz - z) * 0.3);
  for (let z = cz - 4.6; z > gz + 0.4; z -= 0.85) {
    const x = pathX(z) + (R() - 0.5) * 0.9;
    stone.cyl(x, H(x, z) - 0.03, z, 0.55 + R() * 0.45, 0.5, 0.1, R() < 0.5 ? PAL.dirt : PAL.rockHi, 7, R() * 3, { ao: 0, jit: 0.07 });
  }
  const lanternMat = new THREE.SpriteMaterial({ map: env.glow, color: PAL.ember, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  env.own(lanternMat);
  for (let i = 0; i < 6; i++) {
    const z = cz - 6.5 - i * 2.3;
    const side = i % 2 ? 1 : -1;
    const x = pathX(z) + side * 2.1;
    const y0 = groundMin(world, x, z, 0.1, 0.1) - 0.1;
    // v2: every path lamp is lit; a dark lamp by the gate reads as "light this", and the gate brazier is the one goal
    stone.box(x, y0, z, 0.16, 2.6, 0.16, PAL.wood, 0, { jit: 0.04 });
    stone.box(x, y0, z, 0.34, 0.25, 0.34, PAL.rockLo);
    const ax = x - side * 0.45;
    stone.beam(x, y0 + 2.5, z, ax, y0 + 2.5, z, 0.08, PAL.woodLo);
    stone.beam(ax, y0 + 2.5, z, ax, y0 + 2.35, z, 0.025, PAL.goldLo);
    stone.box(ax, y0 + 2.0 + 0.3, z, 0.26, 0.05, 0.26, PAL.gold, 0, { ao: 0 });
    stone.box(ax, y0 + 1.9, z, 0.26, 0.05, 0.26, PAL.gold, 0, { ao: 0 });
    ember.box(ax, y0 + 1.95, z, 0.2, 0.35, 0.2, PAL.emberHi, 0, { jit: 0, ao: 0 });
    const s = new THREE.Sprite(lanternMat);
    s.scale.set(2.4, 2.4, 1);
    s.position.set(ax, y0 + 2.12, z);
    group.add(s);
    world.addBox({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12, minY: y0, maxY: y0 + 2.6, tag: "solid", owner: OWNER });
  }

  const bpx = cx + 8.2, bpz = cz - 5.6;
  const bpy = H(bpx, bpz);
  stone.box(bpx, bpy - 0.4, bpz, 0.16, 4.8, 0.16, PAL.woodLo, 0, { rz: 0.05 });
  const topY = bpy + 4.2;
  stone.beam(bpx - 1.0, topY - 0.3, bpz, bpx + 1.0, topY - 0.3, bpz, 0.1, PAL.wood);
  stone.ball(bpx - 0.2, topY + 0.55, bpz, 0.14, PAL.gold, 1, 1, 0, { ao: 0 });
  cloth.box(0, -1.9, 0, 1.9, 0.08, 0.05, PAL.gold, 0, { jit: 0.02, ao: 0 });
  const strips: [number, number, number][] = [[-0.7, 1.6, 0.03], [-0.25, 2.2, -0.04], [0.2, 1.1, 0.06], [0.62, 1.9, -0.02]];
  for (const [ux, ul, tilt] of strips) cloth.box(ux, -0.1 - ul, 0, 0.42, ul, 0.04, ux < 0 ? PAL.rubric : PAL.cloth, 0, { rz: tilt, jit: 0.06, ao: 0.05 });
  const flag = cloth.build(look, vcMat2(look), "shrine-banner");
  flag.position.set(bpx, topY - 0.3, bpz);
  flag.castShadow = false;
  world.addBox({ minX: bpx - 0.1, maxX: bpx + 0.1, minZ: bpz - 0.1, maxZ: bpz + 0.1, minY: bpy, maxY: bpy + 4, tag: "solid", owner: OWNER });

  for (let k = 0; k < 7; k++) {
    const a = R() * 6.28, d = 5 + R() * 6;
    moss(cx + Math.sin(a) * d, cz + Math.cos(a) * d, 0.8 + R() * 0.9);
  }

  const fz = cz + 24;
  const gB = H(cx, fz - 1.5);
  const top = gB + 9;
  const yN = Math.max(H(cx, fz + 0.4), H(cx, fz + 2.6), H(cx, fz - 1.2)) + 0.08;
  solidBox(world, stone, OWNER, cx - 5.5, fz + 3.5, 7, 7, top, PAL.rockLo);
  solidBox(world, stone, OWNER, cx + 5.5, fz + 3.5, 7, 7, top, PAL.rockLo);
  solidBox(world, stone, OWNER, cx, fz + 5, 4, 4, top, PAL.rockLo);
  solidBox(world, stone, OWNER, cx - 11.5, fz + 3, 5, 6, top - 3.2, PAL.rockLo);
  solidBox(world, stone, OWNER, cx + 11.5, fz + 3, 5, 6, top - 4.4, PAL.rockLo);
  solidBox(world, stone, OWNER, cx, fz + 1.5, 4, 3, yN, PAL.rockHi, "solid", { y0: groundMin(world, cx, fz + 1.5, 2, 1.5) - 0.6 });
  stone.box(cx, yN + 3.2, fz + 1.5, 4, top - yN - 3.2, 3, PAL.rockLo);
  world.addBox({ minX: cx - 2, maxX: cx + 2, minZ: fz, maxZ: fz + 3, minY: yN + 3.2, maxY: top, tag: "solid", owner: OWNER });
  stone.box(cx, top - 0.4, fz - 0.4, 4, 0.35, 0.5, PAL.rockHi);

  for (const sd of [-1, 1]) {
    for (let yy = gB; yy < top - 0.6; yy += 1.3) {
      for (let xx = 2.9; xx < 9.4; xx += 1.7) {
        chunk(cx + sd * (xx + (R() - 0.5) * 0.7), yy + 0.5 + R() * 0.4, fz - 0.15 + R() * 0.35, 0.95 + R() * 0.5);
      }
    }
    for (let yy = gB; yy < top - 3.3 - (sd > 0 ? 1.2 : 0); yy += 1.3) {
      for (let zz = 0.5; zz < 6; zz += 1.8) chunk(cx + sd * (9.8 + R() * 0.3), yy + 0.5, fz + zz, 0.95 + R() * 0.4);
    }
    stone.box(cx + sd * 5.5, top - 0.05, fz + 3.5, 7.2, 0.25, 7.2, PAL.moss, 0, { jit: 0.06 });
    for (let k = 0; k < 3; k++) stone.ball(cx + sd * (3 + R() * 5.5), top + 0.3, fz + 1 + R() * 5, 0.7 + R() * 0.6, PAL.leaf, 0.8, 1);
  }
  stone.box(cx, top - 0.02, fz + 3.3, 3.8, 0.12, 6.6, PAL.water, 0, { ao: 0, jit: 0.02 });
  stone.box(cx - 11.5, top - 3.45, fz + 3, 5.2, 0.25, 6.2, PAL.moss);
  stone.box(cx + 11.5, top - 4.65, fz + 3, 5.2, 0.25, 6.2, PAL.moss);

  stone.cyl(cx, yN, fz + 2.2, 0.5, 0.4, 0.55, PAL.rockHi, 8);
  stone.cyl(cx, yN + 0.53, fz + 2.2, 0.52, 0.52, 0.05, PAL.gold, 8, 0, { ao: 0 });
  rune.box(cx, yN + 0.6, fz + 2.94, 0.12, 1.6, 0.06, PAL.rune, 0, { jit: 0, ao: 0 });
  rune.boxc(cx, yN + 2.2, fz + 2.94, 0.5, 0.5, 0.06, PAL.rune, 0, { rz: 0.785, jit: 0, ao: 0 });
  for (const [ux, uz, uh] of [[-1.6, 2.6, 0.6], [1.5, 2.7, 0.8], [1.7, 0.5, 0.4]] as const) rune.cone(cx + ux, yN, fz + uz, 0.14, uh, PAL.rune, 5, 0, { jit: 0, ao: 0 });
  reg.shard({ id: "shard-waterfall", x: cx, y: yN + 1.1, z: fz + 2.2 });
  reg.cluster({ x: cx - 1.2, y: yN + 0.5, z: fz + 1.4, n: 3, spread: 0.6 });

  const pz = fz - 3.6, gP = H(cx, pz);
  stone.cyl(cx, gP - 0.02, pz, 2.4, 2.4, 0.14, PAL.water, 14, 0, { ao: 0, jit: 0.02 });
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    chunk(cx + Math.sin(a) * 2.75, gP + 0.1, pz + Math.cos(a) * 2.75, 0.4 + R() * 0.25);
    stone.ball(cx + Math.sin(a + 0.2) * 2.2, gP + 0.13, pz + Math.cos(a + 0.2) * 2.2, 0.22, PAL.foam, 0.3, 1, 0, { sx: 1.6, ao: 0, jit: 0.02 });
  }
  for (let k = -2; k <= 2; k++) stone.ball(cx + k * 0.75, gP + 0.14, fz - 1.55 + (R() - 0.5) * 0.3, 0.38, PAL.foam, 0.3, 1, 0, { sx: 1.5, ao: 0, jit: 0.02 });
  reg.cluster({ x: cx + 3.4, y: gP + 0.5, z: pz - 0.8, n: 3, spread: 0.7 });
  moss(cx - 4.2, pz - 1, 1.2);
  moss(cx + 4.6, pz, 1.0);

  const cvs = document.createElement("canvas");
  cvs.width = 64;
  cvs.height = 256;
  const c2 = cvs.getContext("2d")!;
  c2.fillStyle = "#d8f0ec";
  c2.fillRect(0, 0, 64, 256);
  for (let k = 0; k < 28; k++) {
    const x = R() * 64, w = 1 + R() * 3, y = R() * 256, ln = 40 + R() * 140;
    c2.fillStyle = `rgba(255,255,255,${0.5 + R() * 0.5})`;
    c2.fillRect(x, y, w, ln);
    c2.fillRect(x, y - 256, w, ln);
  }
  const tex = env.own(new THREE.CanvasTexture(cvs));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ROWS = 14;
  const wp = new Float32Array((ROWS + 1) * 2 * 3), wu = new Float32Array((ROWS + 1) * 2 * 2), wi: number[] = [];
  const yB = gP + 0.12;
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS, hw = 1.9 + 0.5 * t;
    const y = top - 0.1 - (top - 0.1 - yB) * t, z = fz - 0.45 - 1.1 * Math.pow(t, 1.8);
    wp.set([cx - hw, y, z, cx + hw, y, z], r * 6);
    wu.set([0, t, 1, t], r * 4);
    if (r < ROWS) { const a = r * 2; wi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const wg = env.own(new THREE.BufferGeometry());
  wg.setAttribute("position", new THREE.BufferAttribute(wp, 3));
  wg.setAttribute("uv", new THREE.BufferAttribute(wu, 2));
  wg.setIndex(wi);
  wg.computeVertexNormals();
  const sheet = new THREE.Mesh(wg, look.toon({ color: "#bfe6e0", transparent: true, opacity: 0.6, map: tex, side: THREE.DoubleSide }));
  sheet.name = "shrine-waterfall";
  const mist = haloSprite(env.glow, "#dff3ee", 6);
  mist.position.set(cx, gP + 1.3, fz - 1.9);
  mist.material.opacity = 0.35;
  env.own(mist.material);
  group.add(mist);

  const solid = stone.build(look, undefined, "shrine-stone");
  const runeMesh = rune.build(look, glowMat(look, PAL.rune, 1.0371), "shrine-runes");
  const emberMesh = ember.build(look, glowMat(look, PAL.emberHi, 1.0), "shrine-embers");
  for (const m of [solid, runeMesh, emberMesh, flag]) {
    env.own(m.geometry);
    group.add(m);
  }
  runeMesh.castShadow = emberMesh.castShadow = false;
  const runeMat = runeMesh.material as THREE.MeshBasicMaterial & { emissiveIntensity: number };
  group.add(sheet);

  reg.anim(({ time, dt }) => {
    for (let i = 0; i < 3; i++) {
      const f = flames[i], ph = i * 1.7;
      const s = 1 + 0.12 * Math.sin(time * 9 + ph) + 0.06 * Math.sin(time * 23 + ph * 2);
      f.scale.set(1 + 0.08 * Math.sin(time * 11 + ph), s, 1 + 0.08 * Math.cos(time * 13 + ph));
      f.rotation.y = time * (1 + i);
    }
    const hs = 7 * (1 + 0.07 * Math.sin(time * 8) + 0.04 * Math.sin(time * 19));
    halo.scale.set(hs, hs, 1);
    lanternMat.opacity = 0.8 + 0.15 * Math.sin(time * 3.1);
    runeMat.emissiveIntensity = 1.0371 + 0.3 * Math.sin(time * 1.6);
    tex.offset.y -= dt * 0.9;
    flag.rotation.z = 0.05 * Math.sin(time * 1.3);
    flag.rotation.x = 0.04 * Math.sin(time * 1.7 + 1);
  });

  return { x: cx, z: cz + 8, radius: 40 };
}
