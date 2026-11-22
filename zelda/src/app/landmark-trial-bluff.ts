import * as THREE from "three";
import type { BeaconId, FrameCtx, GameEvent, Prop, Quality } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { Mesher, PAL, glowMat, groundMin, solidBox, vcMat, type Emit, type SiteEnv, type TrialHandle } from "./landmark-kit";

const BEACON: BeaconId = 3;
const TOTAL = 8;
const TIME_LIMIT = 60;
const SPIN_TIME = 0.8;
const TAU = Math.PI * 2;
const DISK_R = 1.0;
const HANG_KNOB = 1.1;

type Kind = "pole" | "swing" | "tall" | "stack";
interface Def { dx: number; dz: number; kind: Kind; up: number; hang?: number; phase?: number; w?: number; stackTop?: number }

const DEFS: readonly Def[] = [
  { dx: -8, dz: -30, kind: "swing", up: 2.2, hang: 3.4, phase: 0.4, w: 1.15 },
  { dx: 16, dz: -42, kind: "pole", up: 2.2 },
  { dx: -12, dz: -49, kind: "swing", up: 2.4, hang: 3.7, phase: 2.1, w: 0.95 },
  { dx: 22, dz: -46, kind: "pole", up: 2.6 },
  { dx: -1, dz: -67, kind: "tall", up: 6.5 },
  { dx: 19, dz: -70, kind: "tall", up: 7.6 },
  { dx: -26, dz: -132, kind: "stack", up: 4.4, stackTop: 30 },
  { dx: 28, dz: -148, kind: "stack", up: 4.4, stackTop: 28 }, // -136 sat on the bluff slope (ground 64 m) and buried the target
];

const FACE_DORMANT = 0, FACE_LIVE = 1, FACE_HIT = 2, FACE_GOLD = 3;

export function buildBluffTrial(env: SiteEnv, tower: BeaconTower, _sky: THREE.Group): TrialHandle {
  const { world, look, group } = env;
  const owner = "landmarks:trial-bluff";
  const flx = tower.cx + 5, flz = tower.cz - 22;
  const fg = world.heightAt(flx, flz);

  const stone = new Mesher(901);
  const glow = new Mesher(902);
  const chainM = new Mesher(903);
  const faceM = new Mesher(404);
  {
    const o = { rx: Math.PI / 2, jit: 0, ao: 0 };
    faceM.cyl(0, 0, -0.2, DISK_R + 0.08, DISK_R + 0.08, 0.2, PAL.woodLo, 24, 0, o);
    faceM.cyl(0, 0, 0, DISK_R + 0.04, DISK_R + 0.04, 0.1, PAL.sand, 24, 0, o);
    faceM.cyl(0, 0, 0, 0.96, 0.96, 0.12, PAL.parchment, 24, 0, o);
    faceM.cyl(0, 0, 0, 0.76, 0.76, 0.14, PAL.ink, 24, 0, o);
    faceM.cyl(0, 0, 0, 0.58, 0.58, 0.16, "#3a6aa0", 24, 0, o);
    faceM.cyl(0, 0, 0, 0.4, 0.4, 0.18, PAL.rubric, 24, 0, o);
    faceM.cyl(0, 0, 0, 0.2, 0.2, 0.2, PAL.goldHi, 20, 0, o);
    faceM.torus(0, 0, 0.08, DISK_R + 0.02, 0.07, PAL.woodHi, 0, 0, 0, 24, 5);
    faceM.boxc(0, 0, -0.24, 0.16, 2.2, 0.08, PAL.woodLo);
    faceM.boxc(0, 0, -0.24, 2.2, 0.16, 0.08, PAL.woodLo);
    faceM.boxc(0, DISK_R + 0.1, -0.1, 0.18, 0.2, 0.12, PAL.gold);
  }
  chainM.box(0, 0, 0, 0.05, 1, 0.05, "#4a4640", 0, { jit: 0, ao: 0 });

  {
    const w = 8, d = 3.6, top = fg + 0.7;
    const y0 = groundMin(world, flx, flz, w / 2, d / 2) - 0.6;
    stone.box(flx, y0, flz, w, top - 0.08 - y0, d, PAL.woodLo);
    stone.box(flx, top - 0.08, flz, w - 0.2, 0.08, d - 0.2, PAL.woodHi, 0, { ao: 0.05 });
    for (let k = -3; k <= 3; k++) stone.box(flx + k * 1.1, top - 0.085, flz, 0.04, 0.01, d - 0.2, PAL.woodLo, 0, { ao: 0, jit: 0 });
    solidBox(world, null, owner + "-line", flx, flz, w, d, top, PAL.woodLo, "solid", { y0 });
    const sz = flz + d / 2 + 0.5;
    const sTop = fg + 0.35;
    const sy0 = groundMin(world, flx, sz, 1.2, 0.5) - 0.4;
    stone.box(flx, sy0, sz, 2.4, sTop - sy0, 1.0, PAL.woodLo);
    solidBox(world, null, owner + "-step", flx, sz, 2.4, 1.0, sTop, PAL.woodLo, "solid", { y0: sy0 });
    const rh = 1.05;
    const post = (x: number, z: number) => stone.box(x, top, z, 0.14, rh, 0.14, PAL.woodHi);
    const hx = w / 2 - 0.1, hz = d / 2 - 0.1;
    for (let z = -hz; z <= hz + 0.01; z += hz) { post(flx - hx, flz + z); post(flx + hx, flz + z); }
    stone.boxc(flx - hx, top + rh - 0.05, flz, 0.1, 0.1, d - 0.2, PAL.woodHi);
    stone.boxc(flx + hx, top + rh - 0.05, flz, 0.1, 0.1, d - 0.2, PAL.woodHi);
    stone.boxc(flx - hx, top + rh * 0.5, flz, 0.08, 0.08, d - 0.2, PAL.woodLo);
    stone.boxc(flx + hx, top + rh * 0.5, flz, 0.08, 0.08, d - 0.2, PAL.woodLo);
    for (const s of [-1, 1]) {
      const x0 = flx + s * 1.4, x1 = flx + s * hx;
      post(x0, flz + hz);
      post((x0 + x1) / 2, flz + hz);
      stone.boxc((x0 + x1) / 2, top + rh - 0.05, flz + hz, Math.abs(x1 - x0), 0.1, 0.1, PAL.woodHi);
      stone.boxc((x0 + x1) / 2, top + rh * 0.5, flz + hz, Math.abs(x1 - x0), 0.08, 0.08, PAL.woodLo);
    }
    const rx = flx + hx - 0.7, rz = flz - 0.2;
    stone.box(rx, top, rz, 1.5, 0.12, 0.7, PAL.woodLo);
    stone.box(rx - 0.65, top, rz, 0.12, 1.5, 0.12, PAL.woodHi);
    stone.box(rx + 0.65, top, rz, 0.12, 1.5, 0.12, PAL.woodHi);
    stone.boxc(rx, top + 1.35, rz, 1.5, 0.1, 0.1, PAL.woodHi);
    stone.boxc(rx, top + 0.7, rz, 1.4, 0.08, 0.08, PAL.woodLo);
    for (let k = 0; k < 3; k++) {
      const qx = rx - 0.42 + k * 0.42;
      stone.cyl(qx, top + 0.12, rz + 0.02, 0.15, 0.12, 0.85, k === 1 ? PAL.gloam : PAL.rubric, 7, 0, { rx: 0.08 * (k - 1) });
      for (let a = 0; a < 4; a++) {
        const ax = qx + (a - 1.5) * 0.045;
        stone.beam(ax, top + 0.9, rz, ax + (a - 1.5) * 0.04, top + 1.35, rz + (a - 1.5) * 0.02, 0.025, PAL.woodHi, { jit: 0, ao: 0 });
        stone.box(ax + (a - 1.5) * 0.04 - 0.02, top + 1.22, rz - 0.01, 0.04, 0.14, 0.04, a % 2 ? PAL.foam : PAL.ember, 0, { jit: 0, ao: 0 });
      }
    }
    const mz = flz - d / 2 - 1.5;
    const mg = world.heightAt(flx, mz);
    stone.box(flx, mg - 0.5, mz, 1.5, 0.95, 0.9, PAL.rockHi);
    stone.box(flx, mg + 0.45, mz, 1.0, 0.1, 0.62, PAL.rock);
    glow.box(flx, mg + 0.55, mz, 0.1, 0.04, 0.46, PAL.goldHi, 0, { jit: 0, ao: 0 });
    glow.box(flx - 0.12, mg + 0.55, mz - 0.17, 0.1, 0.04, 0.2, PAL.goldHi, Math.PI / 4, { jit: 0, ao: 0 });
    glow.box(flx + 0.12, mg + 0.55, mz - 0.17, 0.1, 0.04, 0.2, PAL.goldHi, -Math.PI / 4, { jit: 0, ao: 0 });
  }

  const props: Prop[] = [];
  const pivots: (THREE.Group | null)[] = [];
  const tgs: THREE.Group[] = [];
  const meshes: THREE.Mesh[] = [];
  const hang = new Float32Array(TOTAL);
  const phase = new Float32Array(TOTAL);
  const sw = new Float32Array(TOTAL);
  const pvx = new Float32Array(TOTAL), pvy = new Float32Array(TOTAL), pvz = new Float32Array(TOTAL);
  const amp = new Float32Array(TOTAL);
  const spinT = new Float32Array(TOTAL).fill(2);
  const pendingFace = new Int8Array(TOTAL).fill(-1);
  const burstQ = new Uint8Array(TOTAL);
  const hit = new Uint8Array(TOTAL);

  const faceGeo = env.own(faceM.build(look).geometry);
  const chainGeo = env.own(chainM.build(look).geometry);
  const mats = [
    look.toon({ color: "#8d8a82", vertexColors: true, transparent: true, opacity: 0.5 }),
    vcMat(look),
    look.toon({ color: "#ffffff", vertexColors: true, emissive: "#ffb84a", emissiveIntensity: 0.8, rim: 0 }),
    glowMat(look, PAL.goldHi, 0.95),
  ];
  const chainMat = vcMat(look);

  for (let i = 0; i < TOTAL; i++) {
    const df = DEFS[i];
    const px = tower.cx + df.dx, pz = tower.cz + df.dz;
    const gy = world.heightAt(px, pz);
    const baseY = df.kind === "stack" ? df.stackTop! : gy;
    const cy = baseY + df.up;

    if (df.kind === "stack") {
      const top = df.stackTop!;
      const g0 = groundMin(world, px, pz, 6, 6) - 1;
      const n = 5;
      for (let k = 0; k < n; k++) {
        const y0 = g0 + ((top - g0) * k) / n;
        const rb = 6.4 - (1.9 * k) / (n - 1);
        const rt = 6.4 - (1.9 * (k + 1)) / n;
        stone.cyl(px, y0, pz, rb, rt, (top - g0) / n + 0.05, k < 2 ? PAL.rockLo : k < 4 ? PAL.rock : PAL.rockHi, 12, k * 0.3, { ao: 0.1 });
      }
      stone.cyl(px, top - 0.1, pz, 4.5, 4.5, 0.25, PAL.mossLo, 12, 0, { ao: 0.05 });
      stone.cyl(px, top + 0.1, pz, 3.6, 3.6, 0.12, PAL.moss, 12, 0, { ao: 0.05 });
      world.addBox({ minX: px - 3.2, maxX: px + 3.2, minZ: pz - 3.2, maxZ: pz + 3.2, minY: g0, maxY: top + 0.15, tag: "solid", owner: owner + "-stack" });
      stone.cyl(px, top + 0.2, pz - 0.34, 0.14, 0.11, df.up - 0.1, PAL.woodLo, 6);
      stone.cyl(px, top + df.up + 0.3, pz - 0.34, 0.16, 0.16, 0.14, PAL.gold, 6);
      stone.box(px + 0.5, top + df.up + 1.2, pz - 0.34, 1.0, 0.4, 0.04, PAL.rubric, 0, { ao: 0 });
      stone.cyl(px, top + df.up + 0.25, pz - 0.34, 0.07, 0.07, 1.4, PAL.woodHi, 5);
    } else if (df.kind === "swing") {
      const H = df.hang!;
      const armY = cy + H;
      const hx = 2.7;
      for (const s of [-1, 1]) {
        stone.cyl(px + s * hx, gy - 0.7, pz - 0.2, 0.2, 0.17, armY - gy + 0.95, PAL.woodHi, 6);
        stone.beam(px + s * hx, armY - 1.2, pz - 0.2, px + s * (hx - 1.3), armY + 0.05, pz - 0.2, 0.12, PAL.woodLo);
      }
      stone.boxc(px, armY + 0.12, pz - 0.2, hx * 2 + 0.6, 0.26, 0.26, PAL.woodHi);
      stone.cyl(px, armY - 0.14, pz - 0.2, 0.09, 0.09, 0.1, PAL.gold, 6);
      pvx[i] = px; pvy[i] = armY; pvz[i] = pz - 0.18;
      hang[i] = H;
      phase[i] = df.phase!;
      sw[i] = df.w!;
    } else {
      const poleTop = cy + 0.6;
      stone.cyl(px, gy - 0.9, pz - 0.34, 0.6, 0.45, 1.3, PAL.rock, 8);
      stone.cyl(px, gy + 0.3, pz - 0.34, 0.14, 0.11, poleTop - gy - 0.3, PAL.woodLo, 6);
      stone.cyl(px, poleTop, pz - 0.34, 0.16, 0.16, 0.14, PAL.gold, 6);
      if (df.kind === "tall") {
        stone.cyl(px, poleTop + 0.1, pz - 0.34, 0.06, 0.06, 1.3, PAL.woodHi, 5);
        stone.box(px + 0.48, poleTop + 0.75, pz - 0.34, 0.96, 0.38, 0.04, df.dx < 10 ? PAL.rubric : PAL.gloamHi, 0, { ao: 0 });
      }
    }

    const tg = new THREE.Group();
    const mesh = new THREE.Mesh(faceGeo, mats[FACE_DORMANT]);
    mesh.castShadow = true;
    tg.add(mesh);
    meshes.push(mesh);
    tgs.push(tg);
    if (df.kind === "swing") {
      const pv = new THREE.Group();
      pv.position.set(pvx[i], pvy[i], pvz[i]);
      const len = df.hang! - HANG_KNOB;
      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.y = -len;
      chain.scale.y = len;
      tg.position.set(0, -df.hang!, 0.18);
      pv.add(chain, tg);
      group.add(pv);
      pivots.push(pv);
    } else {
      tg.position.set(px, cy, pz);
      group.add(tg);
      pivots.push(null);
    }
    props.push({ id: `target-${i}`, pos: { x: px, y: cy, z: pz }, radius: 0.9, active: false });
  }

  const stoneMesh = stone.build(look, undefined, "bluff-trial");
  env.own(stoneMesh.geometry);
  group.add(stoneMesh);
  const glowMesh = glow.build(look, glowMat(look, PAL.goldHi, 0.7), "bluff-trial-glow");
  glowMesh.castShadow = false;
  env.own(glowMesh.geometry);
  group.add(glowMesh);

  let mode = 0;
  let left = 0;
  let hits = 0;

  const setFace = (i: number, f: number) => { meshes[i].material = mats[f]; };

  const place = (i: number) => {
    const p = props[i].pos, pv = pivots[i];
    if (!pv) return;
    pv.rotation.z = 0;
    p.x = pvx[i];
    p.y = pvy[i] - hang[i];
    p.z = pvz[i] + 0.18;
  };

  const reset = () => {
    mode = 0; left = 0; hits = 0;
    for (let i = 0; i < TOTAL; i++) {
      props[i].active = false;
      hit[i] = 0; burstQ[i] = 0; pendingFace[i] = -1; spinT[i] = 2;
      tgs[i].rotation.y = 0;
      tgs[i].scale.setScalar(1);
      setFace(i, FACE_DORMANT);
      if (pivots[i]) { amp[i] = 0; place(i); }
    }
  };
  reset();

  const fail = (emit: Emit) => {
    emit({ type: "trialFail", beacon: BEACON });
    reset();
  };

  return {
    beacon: BEACON,
    get active() { return mode === 1; },
    props,
    get timeLeft() { return mode === 1 ? Math.max(0, left) : null; },
    canStart(ctx: FrameCtx) {
      return ctx.player.hasBow ? null : "The targets are out of reach";
    },
    start(_ctx: FrameCtx, emit: Emit) {
      if (mode === 1 || mode === 3) return;
      reset();
      mode = 1;
      left = TIME_LIMIT;
      for (let i = 0; i < TOTAL; i++) {
        props[i].active = true;
        setFace(i, FACE_LIVE);
      }
      emit({ type: "trialStart", beacon: BEACON });
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      if (mode !== 1 && !near) return;
      if (mode === 1) {
        left -= ctx.realDt;
        if (left <= 0) { fail(emit); return; }
      }
      const dt = ctx.dt, t = ctx.time;
      const ampGoal = mode === 3 ? 0 : mode === 1 ? 0.4 : 0.14;
      const k = Math.min(1, dt * 1.5);
      for (let i = 0; i < TOTAL; i++) {
        const pv = pivots[i];
        if (pv) {
          amp[i] += (ampGoal - amp[i]) * k;
          const a = amp[i] * Math.sin(t * sw[i] + phase[i]);
          pv.rotation.z = a;
          const p = props[i].pos;
          p.x = pvx[i] + Math.sin(a) * hang[i];
          p.y = pvy[i] - Math.cos(a) * hang[i];
        }
        if (burstQ[i]) {
          burstQ[i] = 0;
          ctx.fx.burst("spark", props[i].pos, 16, undefined, 5);
          ctx.fx.burst("glimmer", props[i].pos, 6);
        }
        if (spinT[i] < 1) {
          spinT[i] += dt / SPIN_TIME;
          if (spinT[i] >= 0 && pendingFace[i] >= 0) {
            setFace(i, pendingFace[i]);
            pendingFace[i] = -1;
            ctx.fx.burst("glimmer", props[i].pos, 4);
          }
          const s = spinT[i] < 0 ? 0 : Math.min(1, spinT[i]);
          const e = 1 - (1 - s) * (1 - s) * (1 - s);
          if (s >= 1) {
            tgs[i].rotation.y = 0;
            tgs[i].scale.setScalar(1);
            spinT[i] = 2;
          } else {
            tgs[i].rotation.y = e * TAU;
            tgs[i].scale.setScalar(1 + 0.25 * Math.sin(Math.PI * s));
          }
        }
      }
    },
    handle(e: GameEvent, emit: Emit) {
      switch (e.type) {
        case "propHit": {
          if (mode !== 1) return;
          for (let i = 0; i < TOTAL; i++) {
            const p = props[i];
            if (!p.active || p.id !== e.id) continue;
            p.active = false;
            hit[i] = 1;
            burstQ[i] = 1;
            spinT[i] = 0;
            setFace(i, FACE_HIT);
            hits++;
            emit({ type: "trialProgress", beacon: BEACON, value: hits, total: TOTAL });
            if (hits >= TOTAL) {
              mode = 2;
              emit({ type: "trialDone", beacon: BEACON });
            }
            return;
          }
          return;
        }
        case "died":
        case "respawned":
          if (mode === 1) reset();
          return;
        case "trialFail":
          if (e.beacon === BEACON && mode === 1) reset();
          return;
        default:
          return;
      }
    },
    abort() {
      reset();
    },
    solved(animated: boolean) {
      mode = 3;
      left = 0;
      for (let i = 0; i < TOTAL; i++) {
        props[i].active = false;
        burstQ[i] = 0;
        if (animated) {
          pendingFace[i] = FACE_GOLD;
          spinT[i] = -i * 0.12;
          setFace(i, hit[i] ? FACE_HIT : FACE_LIVE);
        } else {
          pendingFace[i] = -1;
          spinT[i] = 2;
          tgs[i].rotation.y = 0;
          tgs[i].scale.setScalar(1);
          setFace(i, FACE_GOLD);
        }
      }
    },
    setQuality(q: Quality) {
      const sh = q !== "low";
      for (let i = 0; i < TOTAL; i++) meshes[i].castShadow = sh;
      stoneMesh.castShadow = sh;
    },
  };
}
