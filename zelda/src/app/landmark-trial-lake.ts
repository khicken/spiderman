import * as THREE from "three";
import { BEACON_COLOR } from "./contracts";
import type { FrameCtx, GameEvent, Prop, Quality } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { PAL, Mesher, glowMat, groundMin, lerp, rng, smooth, solidBox } from "./landmark-kit";
import type { Emit, SiteEnv, TrialHandle } from "./landmark-kit";

// Drowned Beacon trial: a walled 6 x 5 courtyard west of the tower, cells are 2 m, (col, row) with col to the east and
// row to the south. Entrance gap in the south wall at col 2. Pillars (0,1) (2,1) (3,2). Blocks start at (1,4) (3,4) (1,3).
// Plates: plate-0 (1,2), plate-1 (4,2), plate-2 (2,0) is the pool plate. Solution, one push per step (from -> to), 19 in
// all, checked by an exhaustive search that also requires the player to reach the pushing side each time:
// 3,4>4,4  1,3>2,3  2,3>3,3  4,4>3,4  3,3>4,3  1,4>2,4  2,4>2,3  2,3>3,3  4,3>4,2  4,2>4,1  3,3>4,3  3,4>2,4  2,4>2,3
// 2,3>1,3  1,3>1,2  4,1>4,0  4,3>4,2  4,0>3,0  3,0>2,0
const COLS = 6, ROWS = 5, CELL = 2;
const PILLARS: readonly (readonly [number, number])[] = [[0, 1], [2, 1], [3, 2]];
const START: readonly (readonly [number, number])[] = [[1, 4], [3, 4], [1, 3]];
const PLATES: readonly (readonly [number, number])[] = [[1, 2], [4, 2], [2, 0]];
const WATER_PLATE = 2;
const ENTRY_COL = 2;
const MOVE_T = 0.5;
const SINK = -0.38;
const STEPS = 10;
const STEP_GAP = 0.12, STEP_DUR = 0.7;
const STAIR_TOTAL = (STEPS - 1) * STEP_GAP + STEP_DUR;
const GATE_T = 0.9;

export function buildLakeTrial(env: SiteEnv, tower: BeaconTower, _sky: THREE.Group): TrialHandle {
  const { world, look, group, reg } = env;
  const R = rng(3302);
  const gx0 = tower.cx - 19, gz0 = tower.cz - 6;
  const gx1 = gx0 + COLS * CELL, gz1 = gz0 + ROWS * CELL;
  const fy = world.heightAt(gx0 + COLS, gz0 + ROWS);
  const X = (c: number) => gx0 + (c + 0.5) * CELL;
  const Z = (r: number) => gz0 + (r + 0.5) * CELL;
  const isPillar = (c: number, r: number) => PILLARS.some((p) => p[0] === c && p[1] === r);
  const wc = PLATES[WATER_PLATE];
  const sinkAt = (c: number, r: number) => (c === wc[0] && r === wc[1] ? SINK : 0);

  const stone = new Mesher(301), moss = new Mesher(302);
  const commit = (m: Mesher, name: string, mat?: THREE.Material) => {
    if (m.empty) return null;
    const mesh = m.build(look, mat, name);
    env.own(mesh.geometry);
    group.add(mesh);
    return mesh;
  };

  const floorCols = [PAL.rock, PAL.rockHi, PAL.mist, PAL.rockLo];
  const inlay = new Mesher(303);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = X(c), z = Z(r);
      const y0 = groundMin(world, x, z, 1, 1) - 0.5;
      const water = c === wc[0] && r === wc[1];
      stone.box(x, y0, z, 1.96, fy + 0.05 - y0, 1.96, water ? PAL.teal : floorCols[Math.floor(R() * 4)], 0, { ao: 0.05 });
      if (R() < 0.4 && !water) stone.box(x + (R() - 0.5) * 0.5, fy + 0.05, z + (R() - 0.5) * 0.5, 0.9 + R() * 0.6, 0.012, 0.05, PAL.ashLo, R() * Math.PI, { jit: 0, ao: 0 });
      if (R() < 0.3 && !isPillar(c, r)) moss.ball(x + (R() - 0.5) * 1.3, fy + 0.05, z + (R() - 0.5) * 1.3, 0.22 + R() * 0.2, R() < 0.5 ? PAL.moss : PAL.mossHi, 0.25, 0);
    }
  }
  inlay.box((gx0 + gx1) / 2, fy + 0.05, gz0 + 0.18, COLS * CELL - 0.4, 0.012, 0.09, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box((gx0 + gx1) / 2, fy + 0.05, gz1 - 0.18, COLS * CELL - 0.4, 0.012, 0.09, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box(gx0 + 0.18, fy + 0.05, (gz0 + gz1) / 2, 0.09, 0.012, ROWS * CELL - 0.4, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box(gx1 - 0.18, fy + 0.05, (gz0 + gz1) / 2, 0.09, 0.012, ROWS * CELL - 0.4, PAL.gold, 0, { ao: 0, jit: 0 });
  for (let c = 1; c < COLS; c++) {
    for (let r = 1; r < ROWS; r++) inlay.box(gx0 + c * CELL, fy + 0.05, gz0 + r * CELL, 0.16, 0.014, 0.16, PAL.goldHi, Math.PI / 4, { ao: 0, jit: 0 });
  }

  const wallBit = (x0: number, z0: number, x1: number, z1: number) => {
    const alongX = x1 - x0 >= z1 - z0;
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      const sx0 = alongX ? lerp(x0, x1, a) : x0, sx1 = alongX ? lerp(x0, x1, b) : x1;
      const sz0 = alongX ? z0 : lerp(z0, z1, a), sz1 = alongX ? z1 : lerp(z0, z1, b);
      const cx = (sx0 + sx1) / 2, cz = (sz0 + sz1) / 2, w = sx1 - sx0, d = sz1 - sz0;
      const top = fy + 2.2 + R() * 0.55;
      solidBox(world, stone, "landmarks:lake-wall", cx, cz, w, d, top, R() < 0.5 ? PAL.rock : PAL.rockHi, "solid", { y0: groundMin(world, cx, cz, w / 2, d / 2) - 0.6 });
      if (R() < 0.55) moss.box(cx + (R() - 0.5) * w * 0.4, top - 0.02, cz + (R() - 0.5) * d * 0.4, Math.max(0.3, w * 0.55), 0.12, Math.max(0.3, d * 0.55), R() < 0.5 ? PAL.mossLo : PAL.moss, 0, { ao: 0 });
      if (R() < 0.3) stone.box(cx, top, cz, w * 0.5, 0.12, d * 0.5, PAL.gold, 0, { ao: 0, jit: 0 });
    }
  };
  const gateZ = gz0 + (ROWS - 1) * CELL + CELL / 2;
  wallBit(gx0 - 0.8, gz0 - 0.8, gx1 + 0.8, gz0);
  wallBit(gx0 - 0.8, gz1, gx0 + ENTRY_COL * CELL, gz1 + 0.8);
  wallBit(gx0 + (ENTRY_COL + 1) * CELL, gz1, gx1 + 0.8, gz1 + 0.8);
  wallBit(gx0 - 0.8, gz0, gx0, gz1);
  wallBit(gx1, gz0, gx1 + 0.8, gz1 - CELL);
  for (const [c, r] of PILLARS) {
    const x = X(c), z = Z(r);
    const top = fy + 2.5;
    solidBox(world, stone, "landmarks:lake-pillar", x, z, 1.9, 1.9, top, PAL.rockHi, "solid", { y0: fy });
    stone.box(x, top, z, 2.1, 0.22, 2.1, PAL.rock);
    inlay.box(x, fy + 1.5, z, 1.94, 0.12, 1.94, PAL.gold, 0, { ao: 0, jit: 0 });
    moss.ball(x + 0.5, top + 0.2, z - 0.4, 0.5, PAL.mossLo, 0.35, 0);
  }

  const wx = X(wc[0]), wz = Z(wc[1]);
  stone.box(wx - 0.93, fy + 0.05, wz, 0.14, 0.42, 1.86, PAL.rockHi);
  stone.box(wx + 0.93, fy + 0.05, wz, 0.14, 0.42, 1.86, PAL.rockHi);
  stone.box(wx, fy + 0.05, wz - 0.93, 1.86, 0.42, 0.14, PAL.rockHi);
  stone.box(wx, fy + 0.05, wz + 0.93, 1.86, 0.42, 0.14, PAL.rockHi);
  inlay.box(wx, fy + 0.47, wz - 0.93, 1.86, 0.03, 0.1, PAL.goldHi, 0, { ao: 0, jit: 0 });

  const plateGeo = env.own(new THREE.BoxGeometry(1.5, 0.05, 1.5).translate(0, 0.025, 0));
  const dimMat = glowMat(look, PAL.rune, 0.25);
  const litMat = glowMat(look, BEACON_COLOR[2], 1.6);
  const plateMesh: THREE.Mesh[] = [];
  const plateOn = [false, false, false];
  const plateCol: number[] = [];
  for (let j = 0; j < 3; j++) {
    const x = X(PLATES[j][0]), z = Z(PLATES[j][1]);
    inlay.box(x, fy + 0.05, z, 1.8, 0.02, 1.8, PAL.gold, 0, { ao: 0, jit: 0 });
    const m = new THREE.Mesh(plateGeo, dimMat);
    m.position.set(x, fy + 0.07, z);
    group.add(m);
    plateMesh.push(m);
    plateCol.push(world.addBox({ minX: x - 0.75, maxX: x + 0.75, minZ: z - 0.75, maxZ: z + 0.75, minY: fy, maxY: fy + 0.1, tag: "plate", owner: `landmarks:plate-${j}` }));
  }

  commit(stone, "lake-court");
  commit(moss, "lake-moss");
  commit(inlay, "lake-inlay");

  const poolGeo = env.own(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2));
  const poolMat = look.toon({ color: PAL.water, emissive: PAL.water, emissiveIntensity: 0.3, transparent: true, opacity: 0.55, rim: 0.6 });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(wx, fy + 0.32, wz);
  pool.renderOrder = 2;
  group.add(pool);
  const ringGeo = env.own(new THREE.RingGeometry(0.22, 0.28, 20).rotateX(-Math.PI / 2));
  const rings: THREE.Mesh[] = [];
  const ringMats: THREE.MeshBasicMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const mt = env.own(new THREE.MeshBasicMaterial({ color: PAL.foam, transparent: true, opacity: 0, depthWrite: false }));
    const rm = new THREE.Mesh(ringGeo, mt);
    rm.position.set(wx, fy + 0.335, wz);
    rm.renderOrder = 3;
    group.add(rm);
    rings.push(rm);
    ringMats.push(mt);
  }

  const bm = new Mesher(310);
  bm.box(0, 0, 0, 1.94, 1.94, 1.94, PAL.rock, 0, { ao: 0.18 });
  bm.box(0, 1.9, 0, 1.7, 0.08, 1.7, PAL.rockHi, 0, { ao: 0 });
  bm.box(0, 1.97, 0, 1.3, 0.02, 0.1, PAL.gold, 0, { ao: 0, jit: 0 });
  bm.box(0, 1.97, 0, 0.1, 0.02, 1.3, PAL.gold, 0, { ao: 0, jit: 0 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    bm.box(dx * 0.97, 0.3, dz * 0.97, k % 2 ? 0.1 : 0.12, 1.2, k % 2 ? 0.12 : 0.1, PAL.gold, 0, { ao: 0, jit: 0 });
    bm.box(dx * 0.97, 0.88, dz * 0.97, k % 2 ? 0.12 : 0.5, 0.14, k % 2 ? 0.5 : 0.12, PAL.goldHi, 0, { ao: 0, jit: 0 });
  }
  bm.ball(0.55, 1.9, 0.45, 0.38, PAL.moss, 0.3, 0);
  bm.ball(-0.5, 1.9, -0.55, 0.3, PAL.mossHi, 0.3, 0);
  const blockProto = bm.build(look, undefined, "lake-block");
  env.own(blockProto.geometry);
  const blockMesh: THREE.Mesh[] = [];
  const blockCol: number[] = [];
  const bc = [0, 0, 0], br = [0, 0, 0];
  const mv = [false, false, false];
  const bt = [1, 1, 1];
  const fxA = [0, 0, 0], fzA = [0, 0, 0], txA = [0, 0, 0], tzA = [0, 0, 0], fsA = [0, 0, 0], tsA = [0, 0, 0];
  const bx = [0, 0, 0], bz = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(blockProto.geometry, blockProto.material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    blockMesh.push(m);
    blockCol.push(world.addBox({ minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: fy, maxY: fy + 2.05, tag: "pushable", owner: `landmarks:block-${i}` }));
  }
  const setBlock = (i: number, x: number, z: number, sink: number) => {
    bx[i] = x; bz[i] = z;
    blockMesh[i].position.set(x, fy + 0.05 + sink, z);
    world.moveBox(blockCol[i], x - 0.99, fy, z - 0.99, x + 0.99, fy + 2.05, z + 0.99);
  };
  const parkAt = (i: number, c: number, r: number) => {
    bc[i] = c; br[i] = r; mv[i] = false; bt[i] = 1;
    setBlock(i, X(c), Z(r), sinkAt(c, r));
  };
  const occupied = (c: number, r: number, except: number) => {
    for (let j = 0; j < 3; j++) if (j !== except && bc[j] === c && br[j] === r) return true;
    return false;
  };
  const slide = (i: number, c: number, r: number) => {
    fxA[i] = bx[i]; fzA[i] = bz[i]; fsA[i] = blockMesh[i].position.y - fy - 0.05;
    bc[i] = c; br[i] = r;
    txA[i] = X(c); tzA[i] = Z(r); tsA[i] = sinkAt(c, r);
    mv[i] = true; bt[i] = 0;
  };

  const gateX = gx1 + 0.4;
  const gm = new Mesher(320);
  gm.box(0, 0, 0, 0.7, 2.7, 1.96, PAL.rockHi, 0, { ao: 0.12 });
  gm.box(0, 2.55, 0, 0.84, 0.28, 2.1, PAL.gold, 0, { ao: 0, jit: 0 });
  for (let k = -2; k <= 2; k++) gm.box(0.37, 0.2, k * 0.38, 0.06, 2.1, 0.12, PAL.rockLo, 0, { ao: 0 });
  const gateMesh = gm.build(look, undefined, "lake-gate");
  env.own(gateMesh.geometry);
  const gr = new Mesher(321);
  gr.box(0.38, 0.5, 0, 0.05, 0.12, 1.5, PAL.rune, 0, { ao: 0, jit: 0 });
  gr.box(0.38, 1.4, 0, 0.05, 0.12, 1.1, PAL.rune, 0, { ao: 0, jit: 0 });
  const gateRunes = gr.build(look, glowMat(look, BEACON_COLOR[2], 0.9), "lake-gate-runes");
  gateRunes.castShadow = false;
  env.own(gateRunes.geometry);
  const gateG = new THREE.Group();
  gateG.add(gateMesh, gateRunes);
  gateG.position.set(gateX, fy, gateZ);
  group.add(gateG);
  const addGate = () => world.addBox({ minX: gx1, maxX: gx1 + 0.8, minZ: gateZ - 1, maxZ: gateZ + 1, minY: fy - 0.5, maxY: fy + 2.8, tag: "water-gate", owner: "landmarks:lake-gate" });
  let gateId = addGate();
  let gateOpen = false, gateP = 0;

  const stepGeo = env.own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const stepMats = [look.toon({ color: PAL.rockHi, vertexColors: false }), look.toon({ color: PAL.mist, vertexColors: false })];
  const stepMesh: THREE.Mesh[] = [];
  const stepCol: number[] = [];
  const stepH: number[] = [];
  const sBase = tower.gy - 0.3;
  const stepZ = (k: number) => tower.cz - 15 + 1.2 * (k + 0.5);
  for (let k = 0; k < STEPS; k++) {
    const h = tower.gy + 0.4 * (k + 1) - sBase;
    stepH.push(h);
    const m = new THREE.Mesh(stepGeo, stepMats[k % 2]);
    m.scale.set(2.6, h, 1.2);
    m.position.set(tower.cx, sBase - h, stepZ(k));
    m.castShadow = true;
    m.receiveShadow = true;
    m.visible = false;
    group.add(m);
    stepMesh.push(m);
    stepCol.push(-1);
  }
  let stairOn = false, stairT = 0;
  const stairApply = () => {
    for (let k = 0; k < STEPS; k++) {
      const p = Math.min(1, Math.max(0, (stairT - k * STEP_GAP) / STEP_DUR));
      const m = stepMesh[k];
      m.visible = p > 0;
      m.position.y = sBase - (1 - smooth(p)) * stepH[k];
      if (p >= 1 && stepCol[k] < 0) {
        const z = stepZ(k);
        stepCol[k] = world.addBox({ minX: tower.cx - 1.3, maxX: tower.cx + 1.3, minZ: z - 0.6, maxZ: z + 0.6, minY: sBase, maxY: tower.gy + 0.4 * (k + 1), tag: "climbable", owner: `landmarks:lake-stair-${k}` });
      } else if (p < 1 && stepCol[k] >= 0) {
        world.removeBox(stepCol[k]);
        stepCol[k] = -1;
      }
    }
  };

  const lx = gx0 + (ENTRY_COL + 2) * CELL + 0.5, lz = gz1 + 2.4;
  const lv = new Mesher(330);
  lv.box(lx, fy - 0.3, lz, 0.7, 1.3, 0.5, PAL.rock);
  lv.box(lx, fy + 1.0, lz, 0.9, 0.12, 0.7, PAL.gold, 0, { ao: 0 });
  commit(lv, "lake-lever");
  const hm = new Mesher(331);
  hm.box(0, 0, 0, 0.1, 0.9, 0.1, PAL.woodHi);
  hm.ball(0, 0.95, 0, 0.14, PAL.goldHi, 1, 0);
  const handle = hm.build(look, undefined, "lake-lever-handle");
  env.own(handle.geometry);
  handle.position.set(lx, fy + 1.08, lz);
  handle.rotation.z = -0.5;
  group.add(handle);
  let leverT = 1;
  let resetQ = false;

  let started = false, done = false;

  const recompute = (emit: Emit | null) => {
    let changed = false, count = 0;
    for (let j = 0; j < 3; j++) {
      let on = false;
      for (let i = 0; i < 3; i++) if (!mv[i] && bc[i] === PLATES[j][0] && br[i] === PLATES[j][1]) on = true;
      if (on !== plateOn[j]) {
        plateOn[j] = on;
        plateMesh[j].material = on ? litMat : dimMat;
        changed = true;
        emit?.({ type: "plate", id: `plate-${j}`, on });
      }
      if (on) count++;
    }
    if (changed) emit?.({ type: "trialProgress", beacon: 2, value: count, total: 3 });
    return count;
  };

  const openGate = () => {
    if (gateId >= 0) {
      world.removeBox(gateId);
      gateId = -1;
    }
    gateOpen = true;
  };
  const applyGate = () => {
    gateG.position.y = fy - smooth(gateP) * 3.0;
    gateG.visible = gateP < 1;
  };

  const resetBlocks = () => {
    for (let i = 0; i < 3; i++) slide(i, START[i][0], START[i][1]);
    recompute(null);
  };

  for (let i = 0; i < 3; i++) parkAt(i, START[i][0], START[i][1]);
  applyGate();

  reg.interact({
    id: "lever-lake", x: lx, y: fy + 1.2, z: lz, r: 2.4,
    label: () => (done ? null : "Reset blocks"),
    use: () => {
      if (done) return;
      resetQ = true;
      leverT = 0;
    },
  });

  const props: Prop[] = [];

  const tryPush = (i: number, dc: number, dr: number, ctx: FrameCtx) => {
    const tc = bc[i] + dc, tr = br[i] + dr;
    if (tc < 0 || tc >= COLS || tr < 0 || tr >= ROWS || isPillar(tc, tr) || occupied(tc, tr, i)) return;
    const p = ctx.player.pos;
    if (Math.abs(p.x - X(tc)) < 1.35 && Math.abs(p.z - Z(tr)) < 1.35 && p.y < fy + 2.2) return;
    slide(i, tc, tr);
  };

  const complete = (emit: Emit) => {
    if (!started) emit({ type: "trialStart", beacon: 2 });
    done = true;
    started = false;
    emit({ type: "trialDone", beacon: 2 });
    openGate();
    stairOn = true;
  };

  const handleObj: TrialHandle = {
    beacon: 2,
    get active() { return started && !done; },
    props,
    timeLeft: null,
    canStart: () => null,
    start(_ctx, emit) {
      if (started || done) return;
      started = true;
      emit({ type: "trialStart", beacon: 2 });
    },
    update(ctx, emit, near) {
      const dt = ctx.dt;
      const busy = mv[0] || mv[1] || mv[2] || resetQ || leverT < 1 || (gateOpen && gateP < 1) || (stairOn && stairT < STAIR_TOTAL);
      if (!near && !started && !busy) {
        return;
      }

      if (resetQ) {
        resetQ = false;
        if (!done) resetBlocks();
      }

      let finished = false;
      for (let i = 0; i < 3; i++) {
        if (!mv[i]) continue;
        bt[i] = Math.min(1, bt[i] + dt / MOVE_T);
        const e = smooth(bt[i]);
        setBlock(i, lerp(fxA[i], txA[i], e), lerp(fzA[i], tzA[i], e), lerp(fsA[i], tsA[i], e));
        if (bt[i] >= 1) {
          mv[i] = false;
          emit({ type: "blockMove", id: `block-${i}`, pos: { x: txA[i], y: fy, z: tzA[i] } });
          finished = true;
        }
      }
      if (finished) {
        const count = recompute(emit);
        if (count === 3 && !done) complete(emit);
      }

      if (!done) {
        const pl = ctx.player;
        if (pl.pushBox >= 0) {
          const i = blockCol.indexOf(pl.pushBox);
          if (i >= 0 && !mv[i]) {
            const dc = pl.pushDir.x > 0.5 ? 1 : pl.pushDir.x < -0.5 ? -1 : 0;
            const dr = pl.pushDir.y > 0.5 ? 1 : pl.pushDir.y < -0.5 ? -1 : 0;
            if ((dc !== 0) !== (dr !== 0)) tryPush(i, dc, dr, ctx);
          }
        }
      }

      if (gateOpen && gateP < 1) {
        gateP = Math.min(1, gateP + dt / GATE_T);
        applyGate();
      }
      if (stairOn && stairT < STAIR_TOTAL) {
        stairT = Math.min(STAIR_TOTAL, stairT + dt);
        stairApply();
      }
      if (leverT < 1) {
        leverT = Math.min(1, leverT + dt / 0.7);
        handle.rotation.z = -0.5 + Math.sin(Math.PI * leverT);
      }

      if (near && rings[0].visible) {
        const t = ctx.time;
        pool.position.y = fy + 0.32 + Math.sin(t * 1.7) * 0.012;
        for (let k = 0; k < 3; k++) {
          const p = (t * 0.45 + k / 3) % 1;
          rings[k].scale.setScalar(1 + p * 3.2);
          ringMats[k].opacity = (1 - p) * 0.45;
        }
      }
    },
    handle(e: GameEvent) {
      if (e.type === "trialFail" && e.beacon === 2) handleObj.abort();
    },
    abort() {
      started = false;
      done = false;
      resetQ = false;
      leverT = 1;
      handle.rotation.z = -0.5;
      for (let i = 0; i < 3; i++) parkAt(i, START[i][0], START[i][1]);
      recompute(null);
      stairOn = false;
      stairT = 0;
      stairApply();
      gateOpen = false;
      gateP = 0;
      if (gateId < 0) gateId = addGate();
      applyGate();
    },
    solved(animated) {
      if (done && animated) return;
      for (let i = 0; i < 3; i++) parkAt(i, PLATES[i][0], PLATES[i][1]);
      recompute(null);
      done = true;
      started = false;
      resetQ = false;
      openGate();
      stairOn = true;
      if (!animated) {
        gateP = 1;
        stairT = STAIR_TOTAL;
      }
      applyGate();
      stairApply();
    },
    setQuality(q: Quality) {
      const on = q !== "low";
      for (const r of rings) r.visible = on;
    },
  };
  return handleObj;
}
