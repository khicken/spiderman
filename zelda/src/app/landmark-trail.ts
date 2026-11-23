import * as THREE from "three";
import type { ThreadAnchor } from "./contracts";
import { BEACON_COLOR, EMBER_PATHS, PROLOGUE } from "./contracts";
import type { Emit, SiteEnv } from "./landmark-kit";
import { Mesher, PAL, glowMat, groundMax, groundMin, haloSprite, solidBox } from "./landmark-kit";
import { GATE_ANCHOR } from "./landmark-prologue";
import { PROLOGUE_LINE, pathAt, pathLength } from "./landmark-paths";
import { RILL } from "./world";

// Ember stones along the four ember paths and the prologue route, plus the prologue set pieces: the gate brazier,
// stepping stones over the rill, the ledge, the climb rock and the two thread knots.

export const STONE_GAP = 8; // meters between ember stones

export interface EmberTrails {
  /** Brighten the stones of one ember path (the tracked one); -1 dims all. */
  setTracked(i: number): void;
}

export function buildEmberTrails(env: SiteEnv): EmberTrails {
  const { world, look, group } = env;
  const geo = env.own(new THREE.BoxGeometry(0.55, 0.14, 0.55).translate(0, 0.07, 0));
  const meshes: { m: THREE.InstancedMesh; dim: THREE.Material; bright: THREE.Material }[] = [];
  const dummy = new THREE.Object3D();
  const make = (pts: { x: number; z: number; ry: number }[], color: string) => {
    const dim = env.own(glowMat(look, color, 0.45) as THREE.Material & { dispose(): void });
    const bright = env.own(glowMat(look, color, 1.6) as THREE.Material & { dispose(): void });
    const m = new THREE.InstancedMesh(geo, dim, pts.length);
    for (let i = 0; i < pts.length; i++) {
      dummy.position.set(pts[i].x, world.heightAt(pts[i].x, pts[i].z) - 0.02, pts[i].z);
      dummy.rotation.set(0, pts[i].ry, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.castShadow = false;
    group.add(m);
    meshes.push({ m, dim, bright });
  };
  for (let p = 0; p < EMBER_PATHS.length; p++) {
    const pts: { x: number; z: number; ry: number }[] = [];
    const L = pathLength(p);
    for (let s = STONE_GAP; s < L; s += STONE_GAP) {
      const a = pathAt(p, s);
      if (world.waterAt(a.x, a.z) > world.heightAt(a.x, a.z) - 0.1) continue;
      pts.push({ x: a.x + a.tz * Math.sin(s * 1.7) * 0.6, z: a.z - a.tx * Math.sin(s * 1.7) * 0.6, ry: Math.atan2(a.tx, a.tz) + Math.sin(s) * 0.25 });
    }
    make(pts, BEACON_COLOR[p]);
  }
  // prologue row: gold, always bright, leads gate -> stones -> ledge -> rock -> knot B -> Glade
  const pro: { x: number; z: number; ry: number }[] = [];
  for (let i = 0; i < PROLOGUE_LINE.length - 1; i++) {
    const a = PROLOGUE_LINE[i], b = PROLOGUE_LINE[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 6; s < len - 3; s += STONE_GAP) {
      const x = a.x + ((b.x - a.x) * s) / len, z = a.z + ((b.z - a.z) * s) / len;
      if (world.waterAt(x, z) > world.heightAt(x, z) - 0.1) continue;
      pro.push({ x, z, ry: Math.atan2(b.x - a.x, b.z - a.z) });
    }
  }
  make(pro, PAL.goldHi);
  const pm = meshes[meshes.length - 1];
  pm.m.material = pm.bright;
  return {
    setTracked(i) {
      for (let k = 0; k < EMBER_PATHS.length; k++) meshes[k].m.material = k === i ? meshes[k].bright : meshes[k].dim;
    },
  };
}

export interface PrologueSite {
  gateLit: boolean;
  setGateLit(on: boolean): void;
  readonly anchors: readonly ThreadAnchor[];
  readonly gate: ThreadAnchor;
}

/** Gate brazier, stepping stones, ledge, climb rock and the two knots. Geometry only; T6 runs the beats. */
export function buildPrologueSite(env: SiteEnv): PrologueSite {
  const { world, look, group, reg } = env;
  const g = (x: number, z: number) => world.heightAt(x, z);
  const stone = new Mesher(5101);
  const gold = new Mesher(5102);
  const grip = new Mesher(5104);
  const bramble = new Mesher(5105);

  // gate brazier
  const gx = PROLOGUE.gateBrazier.x, gz = PROLOGUE.gateBrazier.z, gg = g(gx, gz);
  stone.cyl(gx, gg - 0.4, gz, 0.9, 0.7, 1.3, PAL.rock, 8);
  stone.cyl(gx, gg + 0.8, gz, 0.55, 0.95, 0.4, PAL.ashLo, 8);
  gold.cyl(gx, gg + 1.15, gz, 0.98, 0.98, 0.1, PAL.goldHi, 8, 0, { ao: 0 });
  // The collider covers the bowl rim (0.98 m) and runs up through the fire: at 1.2 m Wren auto-vaulted onto the bowl.
  // 4.3 m tops a full jump plus a mantle reach, so she can neither vault, mantle nor climb onto it.
  world.addBox({ minX: gx - 1.0, maxX: gx + 1.0, minZ: gz - 1.0, maxZ: gz + 1.0, minY: gg - 0.4, maxY: gg + 4.3, tag: "decor", owner: "landmarks:gate-brazier" });
  const gateAnchor = reg.anchor({ id: GATE_ANCHOR, kind: "brazier", pos: { x: gx, y: gg + 1.5, z: gz }, weight: 0, lit: false, enabled: true });

  // stepping stones over the rill: tops sit 0.25 m above the water
  const sx = PROLOGUE.stones.x, sz0 = PROLOGUE.stones.z;
  for (let k = 0; k < PROLOGUE.stones.count; k++) {
    const z = sz0 - k * PROLOGUE.stones.gap;
    const top = RILL.surf + 0.25;
    stone.cyl(sx + (k % 2 ? 0.25 : -0.25), RILL.surf - 0.9, z, 0.95, 0.8, top - RILL.surf + 0.9, k % 2 ? PAL.rock : PAL.rockHi, 7, k);
    solidBox(world, null, `landmarks:rill-stone-${k}`, sx + (k % 2 ? 0.25 : -0.25), z, 1.5, 1.5, top, PAL.rock, "solid", { y0: RILL.surf - 0.9 });
  }

  // ledge: a terrace 3 m deep and 1.2 m tall across the path. Its foot reaches the lowest ground under it, so the
  // ends never float where the slope drops away.
  const lz = PROLOGUE.ledge.z, lx = PROLOGUE.ledge.x - 4.5, lg = g(PROLOGUE.ledge.x, lz);
  const lTop = lg + PROLOGUE.ledge.h;
  solidBox(world, stone, "landmarks:prologue-ledge", lx, lz, 45, 3, lTop, PAL.rockHi, "solid", { y0: groundMin(world, lx, lz, 22.5, 1.5) - 0.6 });
  stone.box(lx, lTop, lz, 44.4, 0.05, 2.6, PAL.mossHi, 0, { jit: 0.1 });

  // climb rock: 6 m tall. The collider is the same 3.4 m climbable box; only the mesh changed.
  const rx = PROLOGUE.climbRock.x, rz = PROLOGUE.climbRock.z, rg = g(rx, rz);
  const rTop = rg + PROLOGUE.climbRock.h;
  solidBox(world, null, "landmarks:climb-rock", rx, rz, 3.4, 3.4, rTop, PAL.rock, "climbable", { y0: rg - 1 });
  // A five-sided core gives the climb wall (one face south, on the collider wall, leaning in 0.12 m over its height).
  // Faceted boulders, squashed on z and pushed north so they never bulge past the wall, shape the outline. The cap is
  // 2 cm above rTop, so it does not z-fight the core top.
  const coreH = rTop - rg + 1, lean = 0.93;
  const wallZ = (y: number) => rz + 1.7 * (1 - (1 - lean) * (y - (rg - 1)) / coreH) + 0.02;
  stone.cyl(rx, rg - 1, rz, 2.1, 2.1 * lean, coreH, PAL.rockHi, 5, Math.PI / 5, { sx: 0.8 });
  stone.ball(rx - 0.9, rg + 0.5, rz - 0.6, 2.45, PAL.rock, 0.62, 0, 0.3, { sz: 0.85 });
  stone.ball(rx + 0.9, rg + 2.4, rz - 0.6, 2.3, PAL.rockHi, 0.6, 0, 1.2, { sz: 0.88, rz: 0.15 });
  stone.ball(rx - 0.6, rg + 4.4, rz - 0.6, 2.1, "#bdb4a0", 0.6, 0, 2.1, { sz: 0.9, rz: -0.12 });
  stone.ball(rx + 1.0, rg + 5.2, rz - 0.9, 1.3, PAL.rock, 0.6, 0, 0.7);
  stone.cyl(rx, rTop - 0.3, rz - 0.1, 1.95, 1.6, 0.32, "#bdb4a0", 6, 0.5);
  stone.ball(rx + 2.3, rg - 0.2, rz + 1.0, 0.8, PAL.rockLo, 0.6, 0, 0.4);
  stone.ball(rx - 2.4, rg - 0.2, rz + 0.5, 0.7, PAL.rock, 0.55, 0, 1.1);
  stone.ball(rx - 1.1, rTop - 0.08, rz - 1.1, 0.5, PAL.moss, 0.25, 1, 0.3);
  stone.ball(rx + 1.2, rTop - 0.08, rz + 0.8, 0.4, PAL.mossHi, 0.25, 1, 2.0);
  // grips: worn knobs on the south face, each with a faint warm rim on its upper lip so the route reads at dusk
  for (let k = 0; k < 6; k++) {
    const gx = rx + (k % 2 ? 0.5 : -0.5) + Math.sin(k * 2.3) * 0.12, gy = rg + 0.8 + k * 0.85, tilt = Math.sin(k * 1.7) * 0.15;
    const wz = wallZ(gy);
    stone.ball(gx, gy, wz, 0.34, "#c4bba6", 0.38, 0, tilt, { sx: 1.1, sz: 0.55, jit: 0.08 });
    grip.box(gx, gy + 0.1, wz + 0.12, 0.34, 0.02, 0.03, PAL.goldLo, tilt, { ao: 0, jit: 0 });
  }
  // knot A rides on a rock spur so the line leaves at hand height above the top
  const knotA = reg.anchor({ id: "prologue:knot-a", kind: "knot", pos: { x: rx, y: rg + PROLOGUE.climbRock.knotY, z: rz - 0.5 }, weight: 0, lit: false, enabled: true });
  stone.cyl(rx, rTop - 0.1, rz - 0.5, 0.42, 0.15, knotA.pos.y - 0.3 - (rTop - 0.1), PAL.rockLo, 5, 0.4, { rx: 0.03 });
  gold.torus(rx, knotA.pos.y, rz - 0.5, 0.34, 0.07, PAL.goldHi, 0, 0.6, 0);

  // Bramble thicket behind the rock, under the ride line. The ride clears it (Wren's feet stay 0.2 m or more above it); on
  // foot it is a long walk round either end, never a hard block. 4.3 m tops a jump plus a mantle reach; "barrier" is
  // never climbable. Its visible top matches the collider top.
  const T = PROLOGUE.thicket, seg = 4;
  for (let x0 = T.x0; x0 < T.x1 - 0.01; x0 += seg) {
    const cx = x0 + seg / 2, hw = seg / 2, hd = T.depth / 2;
    const lo = groundMin(world, cx, T.z, hw, hd) - 0.5;
    const top = groundMax(world, cx, T.z, hw, hd) + T.h;
    world.addBox({ minX: x0, maxX: x0 + seg, minZ: T.z - hd, maxZ: T.z + hd, minY: lo, maxY: top, tag: "barrier", owner: "landmarks:prologue-thicket" });
    const k = Math.round(cx * 7.3);
    for (let i = 0; i < 3; i++) {
      const bx = x0 + 0.7 + i * 1.3 + Math.sin(k + i * 2.1) * 0.3;
      const r = 1.45 + Math.sin(k * 0.7 + i) * 0.2;
      bramble.ball(bx, lo + 0.5 + r * 0.8, T.z, r, i % 2 ? PAL.mossLo : PAL.leaf, 0.85, 1, k + i, { sz: 0.55 });
      bramble.ball(bx + 0.4, top - 1.25, T.z + Math.sin(k + i) * 0.15, 1.25, i % 2 ? PAL.leaf : PAL.mossLo, 1, 1, k - i, { sz: 0.62 });
    }
    // thorny canes poking out of the mass, gloam-dark like the bramblings
    for (let i = 0; i < 5; i++) {
      const a = k * 1.7 + i * 2.39, y = lo + 1.2 + ((i * 0.37 + Math.abs(Math.sin(k))) % 1) * (top - lo - 1.6);
      const bx = x0 + 0.4 + (i / 5) * (seg - 0.8), side = i % 2 ? 1 : -1;
      bramble.beam(bx, y, T.z + side * 0.5, bx + Math.cos(a) * 0.5, y + 0.35 + Math.sin(a) * 0.2, T.z + side * 1.1, 0.08, PAL.gloamLo);
    }
  }

  // knot B: a stump 26 m away and 5 m lower
  const bx = PROLOGUE.knotB.x, bz = PROLOGUE.knotB.z, bg = g(bx, bz);
  const knotB = reg.anchor({ id: "prologue:knot-b", kind: "knot", pos: { x: bx, y: bg + PROLOGUE.knotB.y, z: bz }, weight: 0, lit: false, enabled: true });
  stone.cyl(bx, bg - 0.3, bz, 0.7, 0.5, PROLOGUE.knotB.y + 0.1, PAL.woodLo, 7);
  gold.torus(bx, knotB.pos.y, bz, 0.34, 0.07, PAL.goldHi, 0, 0.6, 0);
  world.addBox({ minX: bx - 0.7, maxX: bx + 0.7, minZ: bz - 0.7, maxZ: bz + 0.7, minY: bg - 0.3, maxY: bg + PROLOGUE.knotB.y, tag: "knot", owner: "landmarks:knot-b" });

  const ms = stone.build(look, undefined, "prologue-stone");
  const mg = gold.build(look, glowMat(look, PAL.goldHi, 1.0), "prologue-gold");
  const mr = grip.build(look, glowMat(look, PAL.goldLo, 0.35), "prologue-grip");
  const mb = bramble.build(look, undefined, "prologue-thicket");
  env.own(ms.geometry); env.own(mg.geometry); env.own(mr.geometry); env.own(mb.geometry);
  group.add(ms, mg, mr, mb);

  // gate flame
  const flame = new Mesher(5103);
  flame.cone(gx, gg + 1.2, gz, 0.5, 1.2, PAL.ember, 7, 0, { jit: 0, ao: 0 });
  flame.cone(gx, gg + 1.2, gz, 0.3, 1.7, PAL.emberHi, 6, 0, { jit: 0, ao: 0 });
  const mf = flame.build(look, glowMat(look, PAL.ember, 1.7), "gate-flame");
  mf.castShadow = false;
  mf.visible = false;
  env.own(mf.geometry);
  group.add(mf);
  const halo = haloSprite(env.glow, PAL.ember, 8);
  halo.position.set(gx, gg + 2, gz);
  halo.visible = false;
  group.add(halo);
  // unlit, the cold bowl carries a small gold spark so the first goal reads on the title card
  const spark = haloSprite(env.glow, "#f6d98a", 3.5);
  spark.position.set(gx, gg + 1.6, gz);
  group.add(spark);

  let emit: Emit = () => {};
  void emit;
  const site: PrologueSite = {
    gateLit: false,
    anchors: [gateAnchor, knotA, knotB],
    gate: gateAnchor,
    setGateLit(on) {
      site.gateLit = on;
      gateAnchor.lit = on;
      mf.visible = on;
      halo.visible = on;
      spark.visible = !on;
    },
  };
  reg.anim((c) => {
    emit = c.emit;
    if (gateAnchor.lit !== site.gateLit) site.setGateLit(gateAnchor.lit); // landmark-prologue.ts lights the anchor
    if (!site.gateLit) return;
    const s = 1 + Math.sin(c.time * 9) * 0.08;
    mf.scale.set(1, s, 1);
    const k = 8 + Math.sin(c.time * 2.2) * 0.6;
    halo.scale.set(k, k, 1);
  });
  return site;
}
