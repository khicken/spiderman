import * as THREE from "three";
import type { BeaconId, Fx, V3 } from "./contracts";
import { BEACON_COLOR, BEACON_LANDMARK, LANDMARKS } from "./contracts";
import type { Mesher as MesherT, SiteEnv } from "./landmark-kit";
import { Mesher, PAL, col, glowMat, groundMin, haloSprite, rng, smooth, solidBox } from "./landmark-kit";


export interface BeaconTower {
  index: BeaconId;
  cx: number; cz: number; gy: number;
  flame: V3;
  height: number;
  pedestal: V3 & { yaw: number };
  front: V3;
  lit: boolean;
  setLit(on: boolean, animated: boolean): void;
  /** call while the tower is within draw distance, or while it is lit (halo and column stay visible far away) */
  tick(dt: number, time: number, near: boolean, px: number, pz: number, fx: Fx): void;
}

export interface BeaconOpts {
  pedestal?: { x: number; z: number; yaw: number };
}

const A8 = Math.PI / 8;
const flameGeo = new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
const columnGeo = (() => {
  const g = new THREE.CylinderGeometry(1.1, 2.0, 260, 14, 1, true).translate(0, 130, 0);
  return g;
})();

function runeBand(m: MesherT, cx: number, cz: number, y: number, apo: number, color: string) {
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    m.boxc(cx + dx * (apo + 0.04), y, cz + dz * (apo + 0.04), k % 2 === 0 ? 0.5 : 0.12, 1.5, k % 2 === 0 ? 0.12 : 0.5, color, 0, { ao: 0 });
  }
}

function plinth(m: MesherT, env: SiteEnv, owner: string, cx: number, cz: number, R: number, gy: number) {
  const g0 = groundMin(env.world, cx, cz, R, R) - 0.9;
  m.cyl(cx, g0, cz, R, R * 0.95, gy + 0.45 - g0, PAL.rockLo, 8, A8);
  m.cyl(cx, gy + 0.4, cz, R * 0.82, R * 0.78, 0.5, PAL.rock, 8, A8);
  m.cyl(cx, gy + 0.85, cz, R * 0.62, R * 0.58, 0.5, PAL.rockHi, 8, A8);
  const ap = 0.92;
  env.world.addBox({ minX: cx - R * ap, maxX: cx + R * ap, minZ: cz - R * ap, maxZ: cz + R * ap, minY: g0, maxY: gy + 0.45, tag: "solid", owner });
}

export function buildBeacon(env: SiteEnv, sky: THREE.Group, index: BeaconId, opts: BeaconOpts = {}): BeaconTower {
  const { world, look, group } = env;
  const lm = LANDMARKS.find((l) => l.id === BEACON_LANDMARK[index])!;
  const cx = lm.x, cz = lm.z;
  const gy = world.heightAt(cx, cz);
  const color = BEACON_COLOR[index];
  const owner = `landmarks:beacon-${index}`;
  const stone = new Mesher(40 + index);
  const dimRunes = new Mesher(50 + index);
  const litRunes = new Mesher(60 + index);
  const accents = new Mesher(70 + index);
  const cloth = new Mesher(80 + index);
  const r = rng(900 + index);
  let H = 26;
  let spinMesh: THREE.Object3D | null = null;
  let crystals: THREE.Mesh[] = [];

  if (index === 0) {
    H = 31;
    plinth(stone, env, owner + "-base", cx, cz, 6.6, gy);
    const seg: [number, number, number][] = [[3.5, 3.1, 7], [3.1, 2.6, 6.5], [2.6, 2.1, 6], [2.1, 1.7, 5]];
    let y = gy + 1.3;
    for (const [rb, rt, h] of seg) {
      stone.cyl(cx, y, cz, rb, rt, h, PAL.rock, 8, A8);
      accents.cyl(cx, y + h - 0.2, cz, rb * 0.97, rb * 0.97, 0.45, PAL.gold, 8, A8, { ao: 0 });
      runeBand(dimRunes, cx, cz, y + h * 0.5, rb * 0.92, PAL.rune);
      runeBand(litRunes, cx, cz, y + h * 0.5, rb * 0.92, color);
      y += h;
    }
    const top = y;
    stone.cyl(cx, top - 0.1, cz, 3.1, 2.6, 0.7, PAL.rockHi, 8, A8);
    accents.cyl(cx, top + 0.6, cz, 2.7, 2.7, 0.2, PAL.goldHi, 8, A8, { ao: 0 });
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      stone.box(cx + Math.sin(a) * 2.6, top + 0.6, cz + Math.cos(a) * 2.6, 0.22, 1.0, 0.22, PAL.woodLo);
    }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + A8 * 2;
      stone.beam(cx + Math.sin(a) * 1.6, top + 0.5, cz + Math.cos(a) * 1.6, cx + Math.sin(a) * 2.6, top + 4.6, cz + Math.cos(a) * 2.6, 0.34, PAL.rockLo);
    }
    stone.cyl(cx, top + 4.0, cz, 2.1, 2.9, 0.7, PAL.rockHi, 8, A8);
    accents.cyl(cx, top + 4.6, cz, 2.95, 2.95, 0.16, PAL.goldHi, 8, A8, { ao: 0 });
    stone.cone(cx, top + 5.3, cz, 0.4, 1.0, PAL.rockLo, 5);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3 + 0.4;
      cloth.beam(cx + Math.sin(a) * 1.8, top + 3.2, cz + Math.cos(a) * 1.8, cx + Math.sin(a) * 5.6, top - 2.6, cz + Math.cos(a) * 5.6, 0.12, PAL.emberLo);
      for (let s = 0; s < 4; s++) {
        const t = (s + 0.5) / 4;
        cloth.boxc(cx + Math.sin(a) * (1.8 + t * 3.8), top + 3.2 - t * 5.8, cz + Math.cos(a) * (1.8 + t * 3.8), 0.9, 1.6, 0.08, s % 2 ? PAL.ember : PAL.emberHi, a);
      }
    }
    world.addBox({ minX: cx - 2.6, maxX: cx + 2.6, minZ: cz - 2.6, maxZ: cz + 2.6, minY: gy, maxY: top, tag: "climbable", owner: owner + "-shaft" });
    H = top + 5.3 - gy;
  } else if (index === 1) {
    H = 20;
    plinth(stone, env, owner + "-base", cx, cz, 5.2, gy);
    let y = gy + 1.3;
    const parts: [number, number, number][] = [[2.5, 2.2, 5], [2.2, 1.9, 4.6], [1.95, 1.7, 4.4], [1.7, 1.5, 3.6]];
    for (let i = 0; i < parts.length; i++) {
      const [rb, rt, h] = parts[i];
      stone.cyl(cx + (i % 2 ? 0.15 : -0.1), y, cz + (i % 2 ? -0.1 : 0.15), rb, rt, h, i % 2 ? PAL.rock : PAL.ash, 7, i * 0.4, { rx: (r() - 0.5) * 0.06 });
      runeBand(dimRunes, cx, cz, y + h * 0.5, rb * 0.85, PAL.rune);
      runeBand(litRunes, cx, cz, y + h * 0.5, rb * 0.85, color);
      y += h - 0.2;
    }
    const top = y;
    for (let k = 0; k < 56; k++) {
      const t = k / 56;
      const a = t * Math.PI * 7;
      const rr = 2.45 - t * 0.8;
      const yy = gy + 1.6 + t * (top - gy - 3);
      stone.ball(cx + Math.sin(a) * rr, yy, cz + Math.cos(a) * rr, 0.24 + (k % 3) * 0.03, PAL.woodLo, 1, 0);
      if (k % 2 === 0) stone.cone(cx + Math.sin(a) * (rr + 0.2), yy, cz + Math.cos(a) * (rr + 0.2), 0.12, 0.8, PAL.rubric, 4, 0, { rx: Math.cos(a) * 1.1, rz: -Math.sin(a) * 1.1 });
    }
    stone.cyl(cx, top - 0.2, cz, 1.8, 2.5, 0.8, PAL.rockHi, 7, 0.2);
    for (let k = 0; k < 5; k++) {
      const a = k * Math.PI * 2 / 5 + 0.3;
      stone.beam(cx + Math.sin(a) * 1.6, top + 0.4, cz + Math.cos(a) * 1.6, cx + Math.sin(a) * 2.8, top + 4.2 + (k % 2) * 0.8, cz + Math.cos(a) * 2.8, 0.42, PAL.woodLo);
      stone.cone(cx + Math.sin(a) * 2.8, top + 4.1 + (k % 2) * 0.8, cz + Math.cos(a) * 2.8, 0.26, 1.1, PAL.rubric, 5);
    }
    accents.cyl(cx, top + 0.55, cz, 2.2, 2.2, 0.15, PAL.goldHi, 8, 0, { ao: 0 });
    world.addBox({ minX: cx - 2.2, maxX: cx + 2.2, minZ: cz - 2.2, maxZ: cz + 2.2, minY: gy, maxY: top, tag: "climbable", owner: owner + "-shaft" });
    H = top + 1.4 - gy;
  } else if (index === 2) {
    H = 27;
    plinth(stone, env, owner + "-base", cx, cz, 6.0, gy);
    let y = gy + 1.3;
    const widths = [5.2, 4.5, 3.9, 3.3, 2.7];
    for (let i = 0; i < widths.length; i++) {
      const w0 = widths[i], w1 = i + 1 < widths.length ? widths[i + 1] : 2.1;
      const h = 4.4;
      stone.box(cx, y, cz, w0, h * 0.55, w0, i % 2 ? PAL.mist : PAL.rockHi);
      stone.box(cx, y + h * 0.55, cz, (w0 + w1) / 2, h * 0.45, (w0 + w1) / 2, PAL.rock);
      accents.box(cx, y + h * 0.5, cz, w0 + 0.12, 0.2, w0 + 0.12, PAL.gold, 0, { ao: 0 });
      runeBand(dimRunes, cx, cz, y + h * 0.3, w0 / 2, PAL.rune);
      runeBand(litRunes, cx, cz, y + h * 0.3, w0 / 2, color);
      y += h;
    }
    stone.prism(cx, y, cz, 2.5, 3.2, 2.5, PAL.mist, 0);
    stone.prism(cx, y, cz, 2.5, 3.2, 2.5, PAL.mist, Math.PI / 2);
    const top = y;
    accents.box(cx, y - 0.1, cz, 2.8, 0.25, 2.8, PAL.goldHi, 0, { ao: 0 });
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      const cr = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.7, 0).scale(0.8, 1.7, 0.8),
        glowMat(look, color, 0.9),
      );
      cr.userData.a = a;
      cr.position.set(cx + Math.sin(a) * 3.0, top + 3.5, cz + Math.cos(a) * 3.0);
      env.own(cr.geometry);
      group.add(cr);
      crystals.push(cr);
    }
    world.addBox({ minX: cx - 2.5, maxX: cx + 2.5, minZ: cz - 2.5, maxZ: cz + 2.5, minY: gy, maxY: top - 2, tag: "climbable", owner: owner + "-shaft" });
    H = top + 3.4 - gy;
  } else {
    H = 29;
    plinth(stone, env, owner + "-base", cx, cz, 6.0, gy);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const bx = cx + Math.sin(a) * 2.6, bz = cz + Math.cos(a) * 2.6;
      stone.beam(bx, gy + 1.3, bz, cx + Math.sin(a) * 0.7, gy + 14, cz + Math.cos(a) * 0.7, 1.15, PAL.rock);
      accents.beam(bx * 0.82 + cx * 0.18, gy + 5.2, bz * 0.82 + cz * 0.18, cx + Math.sin(a) * 0.3, gy + 5.3, cz + Math.cos(a) * 0.3, 0.2, PAL.gold);
    }
    stone.box(cx, gy + 1.3, cz, 2.4, 13, 2.4, PAL.rockHi);
    let y = gy + 14;
    stone.cyl(cx, y, cz, 1.7, 1.2, 1.0, PAL.rockLo, 8, A8);
    accents.cyl(cx, y + 0.9, cz, 1.3, 1.3, 0.14, PAL.goldHi, 8, A8, { ao: 0 });
    stone.cyl(cx, y + 1.0, cz, 0.8, 0.5, 9.5, PAL.rock, 8, A8);
    runeBand(dimRunes, cx, cz, gy + 8, 1.0, PAL.rune);
    runeBand(litRunes, cx, cz, gy + 8, 1.0, color);
    y = gy + 24.5;
    stone.cyl(cx, y, cz, 1.9, 2.4, 0.8, PAL.rockHi, 8, A8);
    accents.cyl(cx, y + 0.75, cz, 2.5, 2.5, 0.15, PAL.goldHi, 8, A8, { ao: 0 });
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      stone.beam(cx + Math.sin(a) * 1.5, y + 0.4, cz + Math.cos(a) * 1.5, cx + Math.sin(a) * 2.6, y + 3.8, cz + Math.cos(a) * 2.6, 0.36, PAL.rockLo);
    }
    const vane = new Mesher(95);
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      vane.beam(0, 0, 0, Math.sin(a) * 6.2, 0, Math.cos(a) * 6.2, 0.2, PAL.woodLo);
      for (let s = 0; s < 5; s++) {
        const t = 0.35 + s * 0.12;
        vane.boxc(Math.sin(a) * 6.2 * t, -0.8 - s * 0.05, Math.cos(a) * 6.2 * t, 0.1, 1.5 - s * 0.2, 0.9, s % 2 ? PAL.gloamHi : PAL.gloam, a + Math.PI / 2);
      }
    }
    vane.cyl(0, -0.5, 0, 0.35, 0.2, 1.4, PAL.gold, 6);
    const vm = vane.build(look, undefined, "vane");
    vm.position.set(cx, gy + 31.4, cz);
    env.own(vm.geometry);
    group.add(vm);
    spinMesh = vm;
    world.addBox({ minX: cx - 1.4, maxX: cx + 1.4, minZ: cz - 1.4, maxZ: cz + 1.4, minY: gy, maxY: gy + 23, tag: "climbable", owner: owner + "-shaft" });
    H = 29.4;
  }

  const pd = opts.pedestal ?? { x: cx, z: cz + 8.2, yaw: Math.PI };
  const pg = world.heightAt(pd.x, pd.z);
  {
    const s = Math.sin(pd.yaw), c = Math.cos(pd.yaw);
    solidBox(world, stone, owner + "-pedestal", pd.x, pd.z, 1.5, 1.5, pg + 1.0, PAL.rockHi, "solid", { y0: pg - 0.5, o: { ao: 0.2 } });
    stone.box(pd.x, pg + 1.0, pd.z, 1.9, 0.18, 1.9, PAL.rockLo);
    accents.box(pd.x, pg + 1.16, pd.z, 1.6, 0.08, 1.6, PAL.gold, 0, { ao: 0 });
    for (let k = -1; k <= 1; k += 2) {
      stone.box(pd.x - c * 0.95 * k, pg - 0.3, pd.z + s * 0.95 * k, 0.5, 1.6, 0.5, PAL.rock, pd.yaw);
    }
  }
  const pedestal = { x: pd.x, y: pg + 1.2, z: pd.z, yaw: pd.yaw };
  const front = { x: pd.x + Math.sin(pd.yaw) * 3.0, y: world.heightAt(pd.x + Math.sin(pd.yaw) * 3.0, pd.z + Math.cos(pd.yaw) * 3.0), z: pd.z + Math.cos(pd.yaw) * 3.0 };

  const socketDim = new Mesher(1);
  socketDim.cyl(pd.x, pg + 1.2, pd.z, 0.4, 0.4, 0.06, PAL.rune, 8, 0, { ao: 0 });
  const socketLit = new Mesher(2);
  socketLit.cyl(pd.x, pg + 1.2, pd.z, 0.4, 0.4, 0.1, color, 8, 0, { ao: 0 });

  const add = (m: MesherT, mat?: THREE.Material, name?: string) => {
    if (m.empty) return null;
    const mesh = m.build(look, mat, name);
    env.own(mesh.geometry);
    group.add(mesh);
    return mesh;
  };
  add(stone, undefined, "beacon-stone");
  add(accents, undefined, "beacon-gold");
  add(cloth, look.toon({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide }), "beacon-cloth");
  const dimMat = glowMat(look, PAL.rune, 0.35);
  const litMat = glowMat(look, color, 1.2);
  const dimM = add(dimRunes, dimMat, "runes-dim");
  const litM = add(litRunes, litMat, "runes-lit");
  const sockD = add(socketDim, dimMat, "socket-dim");
  const sockL = add(socketLit, litMat, "socket-lit");
  if (litM) litM.visible = false;
  if (sockL) sockL.visible = false;

  const flameY = gy + H;
  const flameGroup = new THREE.Group();
  flameGroup.position.set(cx, flameY - 0.5, cz);
  const outer = new THREE.Mesh(flameGeo, glowMat(look, color, 1.3));
  outer.scale.set(1.15, 3.0, 1.15);
  const mid = new THREE.Mesh(flameGeo, glowMat(look, PAL.emberHi, 1.4));
  mid.scale.set(0.75, 2.2, 0.75);
  const core = new THREE.Mesh(flameGeo, glowMat(look, "#fff6dc", 1.6));
  core.scale.set(0.4, 1.4, 0.4);
  flameGroup.add(outer, mid, core);
  flameGroup.visible = false;
  group.add(flameGroup);

  const sigilMat = glowMat(look, PAL.rune, 0.4);
  const sigilLit = glowMat(look, color, 1.2);
  const sigil = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.07, 5, 28), sigilMat);
  sigil.position.set(cx, flameY + 2.4, cz);
  sigil.rotation.x = Math.PI / 2;
  env.own(sigil.geometry);
  group.add(sigil);

  const halo = haloSprite(env.glow, color, 14);
  halo.position.set(cx, flameY + 1.2, cz);
  halo.visible = false;
  sky.add(halo);

  const cc = col(color);
  const colArr = new Float32Array(columnGeo.attributes.position.count * 3);
  const colG = columnGeo.clone();
  const pos = colG.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, pos.getY(i) / 260);
    const k = Math.pow(1 - t, 1.6) * smooth(Math.min(1, pos.getY(i) / 22));
    colArr[i * 3] = cc.r * k;
    colArr[i * 3 + 1] = cc.g * k;
    colArr[i * 3 + 2] = cc.b * k;
  }
  colG.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
  env.own(colG);
  const colMat = env.own(new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  const column = new THREE.Mesh(colG, colMat);
  column.position.set(cx, flameY + 0.6, cz);
  column.frustumCulled = false;
  column.visible = false;
  sky.add(column);

  let litT = 0;
  let target = 0;
  let acc = 0;
  let flick = r() * 10;
  const tmp: V3 = { x: 0, y: 0, z: 0 };
  const up: V3 = { x: 0, y: 1, z: 0 };

  const tower: BeaconTower = {
    index, cx, cz, gy, height: H,
    flame: { x: cx, y: flameY, z: cz },
    pedestal, front, lit: false,
    setLit(on, animated) {
      tower.lit = on;
      target = on ? 1 : 0;
      if (!animated) litT = target;
      if (dimM) dimM.visible = !on;
      if (litM) litM.visible = on;
      if (sockD) sockD.visible = !on;
      if (sockL) sockL.visible = on;
      sigil.material = on ? sigilLit : sigilMat;
      if (on && animated) litT = 0;
      if (!on) { flameGroup.visible = false; halo.visible = false; column.visible = false; }
    },
    tick(dt, time, near, px, pz, fx) {
      if (litT !== target) litT = target > litT ? Math.min(target, litT + dt * 0.4) : Math.max(target, litT - dt * 0.8);
      if (near) {
        sigil.rotation.z += dt * (0.3 + litT * 0.9);
        sigil.position.y = flameY + 2.4 + Math.sin(time * 0.9 + index) * 0.15;
        if (spinMesh) spinMesh.rotation.y += dt * (0.25 + litT * 0.35);
        for (let i = 0; i < crystals.length; i++) {
          const a = (crystals[i].userData.a as number) + time * (0.35 + litT * 0.4);
          crystals[i].position.set(cx + Math.sin(a) * 3.0, flameY + 1.5 + Math.sin(time * 1.3 + i * 2) * 0.5, cz + Math.cos(a) * 3.0);
          crystals[i].rotation.y = a * 2;
        }
      }
      if (litT <= 0) return;
      const ig = smooth(Math.min(1, litT * 1.6));
      flick += dt * 9;
      const f = 1 + Math.sin(flick) * 0.1 + Math.sin(flick * 2.3 + 1) * 0.06;
      flameGroup.visible = near;
      halo.visible = true;
      column.visible = true;
      flameGroup.scale.set(ig, ig * f, ig);
      flameGroup.rotation.y += dt * 1.2;
      const hs = 14 * ig * (1 + Math.sin(time * 2.2 + index) * 0.07);
      halo.scale.set(hs, hs, 1);
      colMat.opacity = 0.5 + Math.sin(time * 1.4 + index) * 0.06;
      const grow = smooth(Math.min(1, Math.max(0, litT * 1.25 - 0.1)));
      column.scale.set(1, Math.max(0.001, grow), 1);
      if (near) {
        const dx = px - cx, dz = pz - cz;
        if (dx * dx + dz * dz < 140 * 140) {
          acc += dt;
          if (acc > 0.11) {
            acc = 0;
            tmp.x = cx + (Math.random() - 0.5) * 1.2;
            tmp.y = flameY + 0.2;
            tmp.z = cz + (Math.random() - 0.5) * 1.2;
            fx.burst("beacon", tmp, 2, up, 3.5);
            if (Math.random() < 0.35) fx.burst("ember", tmp, 1, up, 2.2);
          }
        }
      }
    },
  };
  tower.setLit(false, false);
  return tower;
}
