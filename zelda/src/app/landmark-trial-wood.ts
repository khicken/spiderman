import * as THREE from "three";
import type { BeaconId, FrameCtx, GameEvent, Prop, Quality, V3 } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { Mesher, PAL, glowMat, groundMin, rng, smooth, solidBox, type Emit, type SiteEnv, type TrialHandle } from "./landmark-kit";

const BEACON: BeaconId = 1;
const GROUP = "trial-1";
const RING_R = 26;
const TOTAL = 3;
const WAVE_DELAY = 2.5;
const TAU = Math.PI * 2;
const GAPS = [0.35, 1.92, 3.5, 5.07];
const GAP_HALF = 0.2;
const THORN = "#617f3d";
const THORN_HI = "#8c5f3b";

type Kind = "brambling" | "mossback" | "wisp";
const WAVES: readonly (readonly Kind[])[] = [
  ["brambling", "brambling", "brambling", "brambling"],
  ["brambling", "brambling", "mossback", "wisp"],
  ["mossback", "mossback", "wisp", "wisp"],
];

const outTilt = (a: number, t: number) => ({ rx: Math.cos(a) * t, rz: -Math.sin(a) * t });

function inGap(a: number, pad = 0): boolean {
  const k = ((a % TAU) + TAU) % TAU;
  for (const g of GAPS) {
    let d = Math.abs(k - g);
    if (d > Math.PI) d = TAU - d;
    if (d < GAP_HALF + pad) return true;
  }
  return false;
}

export function buildWoodTrial(env: SiteEnv, tower: BeaconTower, sky: THREE.Group): TrialHandle {
  void sky;
  const { world, look, group } = env;
  const cx = tower.cx, cz = tower.cz, gy = tower.gy;
  const owner = "landmarks:trial-wood";
  const rnd = rng(7719);
  const hAt = (a: number, r: number) => world.heightAt(cx + Math.sin(a) * r, cz + Math.cos(a) * r);

  const wood = new Mesher(101);
  const runes = new Mesher(102);
  const closing = new Mesher(103);
  const glow = new Mesher(104);

  const N = 52;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + (rnd() - 0.5) * 0.04;
    if (inGap(a, 0.02)) continue;
    const r = RING_R + (rnd() - 0.5) * 2.4;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const y = world.heightAt(x, z);
    const big = 0.9 + rnd() * 0.9;
    for (let k = 0; k < 3; k++) {
      const o = (k - 1) * 0.9 * big;
      const bx = x + Math.cos(a) * o, bz = z - Math.sin(a) * o;
      wood.ball(bx, y + 0.9 * big + rnd() * 0.5, bz, 0.8 * big, k === 1 ? THORN_HI : THORN, 0.85, 1);
    }
    for (let k = 0; k < 7; k++) {
      const o = (rnd() - 0.5) * 2.8 * big;
      const t = outTilt(a + (rnd() - 0.5) * 1.2, 0.9 + rnd() * 0.7);
      const bx = x + Math.cos(a) * o, bz = z - Math.sin(a) * o;
      wood.cone(bx, y + 0.5 + rnd() * 1.5, bz, 0.1, 0.9 + rnd() * 0.7, k % 3 ? PAL.parchment : PAL.rubric, 4, 0, t);
    }
    const ax = x + Math.cos(a) * 1.4, az = z - Math.sin(a) * 1.4;
    wood.beam(x - Math.cos(a) * 1.4, y + 0.6, z + Math.sin(a) * 1.4, ax, y + 1.2 + rnd() * 1.6, az, 0.14, THORN_HI);
  }

  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.3 + (rnd() - 0.5) * 0.3;
    if (inGap(a, 0.12)) continue;
    const r = RING_R + 2.5 + rnd() * 3;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const y = groundMin(world, x, z, 0.8, 0.8) - 0.3;
    const h = 5 + rnd() * 3;
    const lean = (rnd() - 0.5) * 0.18;
    wood.cyl(x, y, z, 0.7, 0.28, h, PAL.woodLo, 6, rnd() * 3, { rx: lean, rz: lean * 0.6 });
    for (let b = 0; b < 4; b++) {
      const ba = rnd() * TAU, by = y + h * (0.45 + b * 0.13);
      wood.beam(x, by, z, x + Math.sin(ba) * (1.2 + rnd() * 1.2), by + 0.8 + rnd() * 1.2, z + Math.cos(ba) * (1.2 + rnd() * 1.2), 0.16, PAL.woodLo);
    }
    wood.cone(x, y + h - 0.2, z, 0.2, 1.2, THORN_HI, 4);
  }

  for (const g of GAPS) {
    for (const s of [-1, 1]) {
      const a = g + s * (GAP_HALF + 0.07);
      const x = cx + Math.sin(a) * RING_R, z = cz + Math.cos(a) * RING_R;
      const y = world.heightAt(x, z);
      const lean = outTilt(a, 0);
      wood.cyl(x, y - 0.4, z, 0.5, 0.3, 5.2, PAL.woodLo, 6, 0, lean);
      for (let k = 0; k < 4; k++) {
        const t = outTilt(a + (k - 1.5) * 0.5, 1.0);
        wood.cone(x, y + 1.2 + k * 1.0, z, 0.09, 0.8, PAL.rubric, 4, 0, t);
      }
    }
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const a = g + (t - 0.5) * 2 * (GAP_HALF + 0.07);
      const x = cx + Math.sin(a) * RING_R, z = cz + Math.cos(a) * RING_R;
      const y = world.heightAt(x, z) + 4.6 + Math.sin(t * Math.PI) * 1.3;
      if (k > 0) wood.beam(px, py, pz, x, y, z, 0.26, k % 2 ? PAL.woodLo : THORN_HI);
      if (k > 0 && k < 6) wood.cone(x, y - 0.1, z, 0.1, 0.9, PAL.parchment, 4, 0, { rx: Math.PI });
      px = x; py = y; pz = z;
    }
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.75;
    if (inGap(a, 0.15)) continue;
    const r = 23;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const g = groundMin(world, x, z, 0.8, 0.5);
    const y = world.heightAt(x, z);
    const yaw = a + Math.PI;
    wood.box(x, g - 0.5, z, 1.9, y - g + 0.7, 1.1, PAL.rockLo, yaw);
    wood.box(x, y + 0.2, z, 1.3, 2.4 + (i % 2) * 0.5, 0.5, PAL.rock, yaw);
    wood.prism(x, y + 2.6 + (i % 2) * 0.5, z, 1.3, 0.5, 0.5, PAL.rock, yaw);
    for (let k = 0; k < 4; k++) {
      runes.box(x - Math.sin(yaw) * 0.27, y + 0.8 + k * 0.45, z - Math.cos(yaw) * 0.27, 0.8 - (k & 1) * 0.35, 0.07, 0.04, PAL.rune, yaw, { jit: 0, ao: 0 });
    }
  }

  for (let i = 0; i < 3; i++) {
    const a = i * (TAU / 3) + 1.1;
    const r = 12.5;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const top = world.heightAt(x, z) + 1.9;
    solidBox(world, wood, owner + "-cover" + i, x, z, 2.6, 1.8, top, i % 2 ? PAL.rock : PAL.ash, "solid", { ry: 0 });
    wood.cone(x + 0.4, top - 0.1, z, 0.3, 0.9, THORN_HI, 5);
  }

  const SEG = 7;
  for (const g of GAPS) {
    for (let k = 0; k < SEG; k++) {
      const t = k / (SEG - 1);
      const a = g + (t - 0.5) * 2 * (GAP_HALF + 0.03);
      const r = RING_R;
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const y = world.heightAt(x, z) - gy;
      const h = 4.2 + rnd() * 1.4;
      closing.cyl(x, y - 0.2, z, 0.7, 0.2, h, THORN, 5, rnd() * 3, { rx: (rnd() - 0.5) * 0.15, rz: (rnd() - 0.5) * 0.15 });
      closing.ball(x, y + 0.9, z, 1.1, THORN_HI, 0.9, 1);
      for (let s = 0; s < 4; s++) {
        const t2 = outTilt(a + (s - 1.5) * 0.7, 0.9);
        closing.cone(x, y + 0.8 + s * 1.0 + rnd() * 0.5, z, 0.11, 1.0, PAL.rubric, 4, 0, t2);
      }
      if (k > 0) {
        const pa = g + ((k - 1) / (SEG - 1) - 0.5) * 2 * (GAP_HALF + 0.03);
        const px = cx + Math.sin(pa) * r, pz = cz + Math.cos(pa) * r;
        const py = world.heightAt(px, pz) - gy;
        for (let b = 0; b < 3; b++) closing.beam(px, py + 1.0 + b * 1.3, pz, x, y + 1.4 + b * 1.3, z, 0.12, b === 1 ? PAL.woodLo : THORN_HI);
      }
    }
  }

  const GN = 72;
  for (let i = 0; i < GN; i++) {
    const a = ((i + 0.5) / GN) * TAU;
    const x = cx + Math.sin(a) * RING_R, z = cz + Math.cos(a) * RING_R;
    const y = world.heightAt(x, z) + 0.15;
    glow.boxc(x, y, z, 2.7, 0.1 + (i % 3) * 0.05, 0.22, "#ffffff", a, { jit: 0, ao: 0 });
    if (i % 3 === 0) glow.cone(x, y, z, 0.12, 0.9 + (i % 2) * 0.6, "#ffffff", 4, 0, { jit: 0, ao: 0 });
  }

  const addMesh = (m: Mesher, name: string, mat?: THREE.Material, shadow = true) => {
    const mesh = m.build(look, mat, name);
    mesh.castShadow = shadow;
    env.own(mesh.geometry);
    group.add(mesh);
    return mesh;
  };
  addMesh(wood, "thorn-ring");
  addMesh(runes, "thorn-runes", glowMat(look, PAL.rune, 0.9), false);
  const closeMesh = addMesh(closing, "thorn-closing");
  closeMesh.position.y = gy;
  closeMesh.scale.y = 0.001;
  closeMesh.visible = false;
  closeMesh.frustumCulled = false;
  const glowMatl = env.own(new THREE.MeshBasicMaterial({
    color: "#b6ff7a", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }));
  const glowMesh = addMesh(glow, "thorn-glow", glowMatl, false);
  glowMesh.visible = false;
  glowMesh.receiveShadow = false;

  const spawnPts: V3[][] = WAVES.map((w, wi) => w.map((kind, i) => {
    const a = (i / w.length) * TAU + wi * 0.9 + 0.5 + (rnd() - 0.5) * 0.3;
    const r = 18 + rnd() * 4;
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    return { x, y: world.heightAt(x, z) + (kind === "wisp" ? 2.5 : 0), z };
  }));

  const props: Prop[] = [];
  let active = false;
  let wave = 0;
  let dead = 0;
  let delay = 0;
  let isSolved = false;
  let closeT = 0;
  let closeTarget = 0;
  let lastTime = 0;

  const applyClose = () => {
    const k = smooth(closeT);
    closeMesh.visible = k > 0.01;
    closeMesh.scale.y = Math.max(0.001, k);
    glowMesh.visible = k > 0.01;
  };

  const spawnWave = (emit: Emit) => {
    const pts = spawnPts[wave];
    const kinds = WAVES[wave];
    for (let i = 0; i < kinds.length; i++) {
      const p = pts[i];
      emit({ type: "spawn", kind: kinds[i], pos: { x: p.x, y: p.y, z: p.z }, group: GROUP });
    }
    dead = 0;
  };

  const reset = () => {
    active = false;
    wave = 0;
    dead = 0;
    delay = 0;
    closeTarget = 0;
  };

  return {
    beacon: BEACON,
    get active() { return active; },
    props,
    timeLeft: null,
    canStart(_ctx: FrameCtx) { return null; },
    start(_ctx: FrameCtx, emit: Emit) {
      if (active || isSolved) return;
      active = true;
      wave = 0;
      dead = 0;
      delay = 0;
      closeTarget = 1;
      emit({ type: "trialStart", beacon: BEACON });
      emit({ type: "toast", text: "Wave 1 of 3" });
      spawnWave(emit);
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      if (!active && !near && closeT <= 0.001) return;
      const dt = ctx.dt;
      lastTime = ctx.time;
      if (closeT !== closeTarget) {
        const step = dt / (closeTarget > closeT ? 2.2 : 3.5);
        closeT = closeTarget > closeT ? Math.min(closeTarget, closeT + step) : Math.max(closeTarget, closeT - step);
        applyClose();
      }
      if (closeT > 0.01) {
        const f = 0.5 + 0.3 * Math.sin(lastTime * 3.1) + 0.2 * Math.sin(lastTime * 7.3);
        glowMatl.opacity = smooth(closeT) * (active ? 0.55 + 0.25 * f : 0.25);
      }
      if (!active) return;
      const dx = ctx.player.pos.x - cx, dz = ctx.player.pos.z - cz;
      if (dx * dx + dz * dz > RING_R * RING_R) {
        emit({ type: "despawnGroup", group: GROUP });
        emit({ type: "trialFail", beacon: BEACON });
        reset();
        return;
      }
      if (delay > 0) {
        delay -= dt;
        if (delay <= 0) {
          delay = 0;
          spawnWave(emit);
        }
      }
    },
    handle(e: GameEvent, emit: Emit) {
      if (!active) return;
      if (e.type === "enemyDied") {
        if (e.group !== GROUP || delay > 0) return;
        dead++;
        if (dead < WAVES[wave].length) return;
        wave++;
        emit({ type: "trialProgress", beacon: BEACON, value: wave, total: TOTAL });
        if (wave >= TOTAL) {
          active = false;
          isSolved = true;
          closeTarget = 0;
          emit({ type: "trialDone", beacon: BEACON });
        } else {
          delay = WAVE_DELAY;
          dead = 0;
          emit({ type: "toast", text: `Wave ${wave + 1} of ${TOTAL}` });
        }
      } else if (e.type === "died") {
        emit({ type: "despawnGroup", group: GROUP });
        reset();
      } else if (e.type === "trialFail" && e.beacon === BEACON) {
        emit({ type: "despawnGroup", group: GROUP });
        reset();
      }
    },
    abort() {
      reset();
      closeT = 0;
      applyClose();
    },
    solved(animated: boolean) {
      isSolved = true;
      active = false;
      closeTarget = 0;
      if (!animated) {
        closeT = 0;
        applyClose();
      }
    },
    setQuality(_q: Quality) {},
  };
}
