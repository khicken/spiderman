import * as THREE from "three";
import type { BeaconId, FrameCtx, GameEvent, Prop, Quality, SiteRegistryV2, V3 } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { Mesher, PAL, glowMat, groundMin, rng, smooth, solidBox, type Emit, type Registry, type SiteEnv, type TrialHandle } from "./landmark-kit";

const BEACON: BeaconId = 1;
const GROUP = "trial-1";
const GROUP_TEACH = "trial-1-teach";
const GROUP_TEST = "trial-1-test";
const RING_R = 26;
const TOTAL = 2;
const WAVE_DELAY = 2.5;
const PAIR_TIMEOUT = 4;
const MAX_ALIVE = 2;
const HINT_AFTER = 90;
const TAU = Math.PI * 2;
const GAPS = [0.35, 1.92, 3.5, 5.07];
const GAP_HALF = 0.2;
const THORN = "#617f3d";
const THORN_HI = "#8c5f3b";
const WICK_ID = "wick-wood";
const WICK_GIVEN = new Set<string>();
void GROUP;

type Kind = "brambling" | "mossback" | "wisp";
const WAVES: readonly (readonly Kind[])[] = [
  ["brambling", "brambling", "brambling"],
  ["brambling", "brambling", "wisp"],
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

// ---------------------------------------------------------------------------------------------------------------------
// Pure plan + state machine (no THREE). buildWoodTrial wires visuals and events around it.
// ---------------------------------------------------------------------------------------------------------------------
export interface WoodSpawn { kind: Kind; pos: V3 }
export interface WoodPlan {
  cx: number;
  cz: number;
  ringR: number;
  brazier: V3;
  total: number;
  spawnPoints: V3[];
  teach: { rule: string; hint: string; group: string; mossback: V3 };
  test: { rule: string; hint: string; group: string; waves: WoodSpawn[][]; maxAlive: number; pairTimeout: number; waveDelay: number };
  bonus: { rule: string; hint: string; reward: "wick"; id: string; pos: V3 };
}
export interface WoodWorld { heightAt(x: number, z: number): number }
export type WoodOut = GameEvent;
export type WoodPhase = "idle" | "teach" | "test" | "bonus" | "done";
export interface WoodInput { px: number; pz: number; grounded: boolean }
export interface WoodOpts { bonusDone?: boolean | (() => boolean) }
export interface WoodSnapshot {
  phase: WoodPhase;
  wave: number;
  deadCount: number;
  alive: number;
  spawned: number;
  flags: { teachDone: boolean; flawless: boolean; bonusGiven: boolean; hintFired: boolean };
}
export interface WoodMachine {
  start(): WoodOut[];
  step(input: WoodInput, dt: number): WoodOut[];
  onEvent(e: GameEvent): WoodOut[];
  abort(): WoodOut[];
  reload(solved: boolean): WoodOut[];
  snapshot(): WoodSnapshot;
}

export function planWoodTrial(world: WoodWorld, cx: number, cz: number): WoodPlan {
  const at = (a: number, r: number, lift = 0): V3 => {
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    return { x, y: world.heightAt(x, z) + lift, z };
  };
  const waves: WoodSpawn[][] = WAVES.map((w, wi) => w.map((kind, i) => ({
    kind,
    pos: at((i / w.length) * TAU + wi * 0.9 + 0.5, 18 + ((i * 7 + wi * 3) % 5) * 0.8, kind === "wisp" ? 2.5 : 0),
  })));
  const spawnPoints: V3[] = [];
  for (const w of waves) for (const s of w) spawnPoints.push(s.pos);
  return {
    cx, cz, ringR: RING_R, total: TOTAL, spawnPoints,
    brazier: { x: cx, y: world.heightAt(cx, cz), z: cz },
    teach: {
      rule: "Shield on the glint. Right mouse or K.",
      hint: "Raise your shield just as it glints.",
      group: GROUP_TEACH,
      mossback: at(2.4, 14),
    },
    test: {
      rule: "Clear 2 waves. Bind pairs, burn at the brazier.",
      hint: "Thread two enemies together to bind them.",
      group: GROUP_TEST,
      waves, maxAlive: MAX_ALIVE, pairTimeout: PAIR_TIMEOUT, waveDelay: WAVE_DELAY,
    },
    bonus: {
      rule: "Bonus: clear wave 2 without a hit.",
      hint: "Bonus: clear wave 2 without taking damage.",
      reward: "wick", id: WICK_ID, pos: at(0.6, 4),
    },
  };
}

export function createWoodMachine(plan: WoodPlan, opts: WoodOpts = {}): WoodMachine {
  let phase: WoodPhase = "idle";
  let teachDone = false;
  let wave = 0, spawned = 0, dead = 0, alive = 0;
  let sinceSpawn = 0, delay = 0;
  let flawless = true;
  let hintT = 0, hintFired = false;
  let bonusGiven = false;
  const groups = new Set<string>();

  const bonusDone = () => bonusGiven || (typeof opts.bonusDone === "function" ? opts.bonusDone() : !!opts.bonusDone);
  const progress = () => { hintT = 0; };
  const clearGroups = (out: WoodOut[]) => {
    for (const g of groups) out.push({ type: "despawnGroup", group: g });
    groups.clear();
  };
  const wipe = () => {
    wave = 0; spawned = 0; dead = 0; alive = 0; sinceSpawn = 0; delay = 0;
    flawless = true; hintT = 0; hintFired = false;
  };
  const spawnNext = (out: WoodOut[]) => {
    const list = plan.test.waves[wave];
    const n = Math.min(plan.test.maxAlive - alive, list.length - spawned);
    for (let i = 0; i < n; i++) {
      const s = list[spawned + i];
      out.push({ type: "spawn", kind: s.kind, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z }, group: plan.test.group });
      groups.add(plan.test.group);
    }
    spawned += n; alive += n; sinceSpawn = 0;
  };
  const startWave = (out: WoodOut[], first: boolean) => {
    spawned = 0; dead = 0; alive = 0; sinceSpawn = 0;
    if (wave === plan.test.waves.length - 1 && flawless) {
      phase = "bonus";
      out.push({ type: "trialRule", trial: BEACON, text: plan.bonus.rule });
    }
    if (first) { delay = 0; spawnNext(out); } else { delay = plan.test.waveDelay; }
  };
  const beginTest = (out: WoodOut[]) => {
    wipe();
    phase = "test";
    out.push({ type: "trialRule", trial: BEACON, text: plan.test.rule });
    startWave(out, true);
  };
  const beginTeach = (out: WoodOut[]) => {
    wipe();
    phase = "teach";
    out.push({ type: "trialRule", trial: BEACON, text: plan.teach.rule });
    out.push({ type: "spawn", kind: "mossback", pos: { ...plan.teach.mossback }, group: plan.teach.group });
    groups.add(plan.teach.group);
  };
  const failTest = (out: WoodOut[]) => {
    clearGroups(out);
    out.push({ type: "trialFail", beacon: BEACON });
    phase = "idle";
    wipe();
  };
  const quitTeach = (out: WoodOut[]) => {
    clearGroups(out);
    phase = "idle";
    teachDone = false;
    wipe();
  };
  const finish = (out: WoodOut[]) => {
    phase = "done";
    delay = 0;
    if (flawless && !bonusDone()) {
      bonusGiven = true;
      out.push({ type: "pickup", kind: "wick", amount: 1, pos: { ...plan.bonus.pos }, id: plan.bonus.id });
    }
    out.push({ type: "power", power: "burning" });
    out.push({ type: "memory", beacon: BEACON });
    out.push({ type: "trialDone", beacon: BEACON });
  };
  const inTest = () => phase === "test" || phase === "bonus";

  return {
    start() {
      if (phase !== "idle") return [];
      const out: WoodOut[] = [{ type: "trialStart", beacon: BEACON }];
      if (teachDone) beginTest(out); else beginTeach(out);
      return out;
    },
    step(input, dt) {
      if (phase === "idle" || phase === "done") return [];
      const out: WoodOut[] = [];
      const dx = input.px - plan.cx, dz = input.pz - plan.cz;
      if (dx * dx + dz * dz > plan.ringR * plan.ringR) {
        if (phase === "teach") quitTeach(out); else failTest(out);
        return out;
      }
      hintT += dt;
      if (hintT >= HINT_AFTER && !hintFired) {
        hintFired = true;
        out.push({ type: "toast", text: phase === "teach" ? plan.teach.hint : plan.test.hint });
      }
      if (inTest()) {
        if (delay > 0) {
          delay -= dt;
          if (delay <= 0) { delay = 0; spawnNext(out); }
        } else if (spawned < plan.test.waves[wave].length) {
          sinceSpawn += dt;
          if (alive === 0 || sinceSpawn >= plan.test.pairTimeout) spawnNext(out);
        }
      }
      return out;
    },
    onEvent(e) {
      const out: WoodOut[] = [];
      if (phase === "idle" || phase === "done") return out;
      if (e.type === "parry") {
        if (phase !== "teach") return out;
        clearGroups(out);
        teachDone = true;
        out.push({ type: "toast", text: "Good parry. Now the test." });
        beginTest(out);
      } else if (e.type === "enemyDied") {
        if (phase === "teach" && e.group === plan.teach.group) {
          groups.delete(plan.teach.group);
          teachDone = true;
          out.push({ type: "toast", text: "Mossback down. Now the test." });
          beginTest(out);
        } else if (inTest() && e.group === plan.test.group && delay <= 0 && alive > 0) {
          alive--; dead++; progress();
          if (dead >= plan.test.waves[wave].length) {
            wave++;
            out.push({ type: "trialProgress", beacon: BEACON, value: wave, total: plan.total });
            if (wave >= plan.total) finish(out);
            else {
              out.push({ type: "toast", text: `Wave ${wave + 1} of ${plan.total}` });
              startWave(out, false);
            }
          } else if (alive === 0 && spawned < plan.test.waves[wave].length) {
            spawnNext(out);
          }
        }
      } else if (e.type === "hurt") {
        if (inTest()) { flawless = false; if (phase === "bonus") phase = "test"; }
      } else if (e.type === "died" || e.type === "respawned") {
        if (phase === "teach") quitTeach(out); else failTest(out);
      }
      return out;
    },
    abort() {
      const out: WoodOut[] = [];
      clearGroups(out);
      phase = "idle";
      teachDone = false;
      wipe();
      return out;
    },
    reload(solved) {
      const out: WoodOut[] = [];
      clearGroups(out);
      teachDone = solved;
      phase = solved ? "done" : "idle";
      wipe();
      return out;
    },
    snapshot() {
      return { phase, wave, deadCount: dead, alive, spawned, flags: { teachDone, flawless, bonusGiven, hintFired } };
    },
  };
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

  const plan = planWoodTrial(world, cx, cz);
  const flame = new Mesher(105);
  {
    const b = plan.brazier;
    wood.cyl(b.x, b.y - 0.2, b.z, 0.9, 0.7, 0.9, PAL.rockLo, 8);
    wood.cyl(b.x, b.y + 0.7, b.z, 1.15, 0.9, 0.35, PAL.rock, 8);
    flame.cone(b.x, b.y + 1.0, b.z, 0.6, 1.5, PAL.ember, 6, 0, { jit: 0, ao: 0 });
    flame.cone(b.x, b.y + 1.0, b.z, 0.35, 2.1, PAL.emberHi, 5, 0.4, { jit: 0, ao: 0 });
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
  addMesh(flame, "thorn-brazier", glowMat(look, PAL.ember, 1.2), false);
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

  const machine = createWoodMachine(plan, { bonusDone: () => WICK_GIVEN.has(WICK_ID) });
  const reg = env.reg as Registry & Partial<SiteRegistryV2>;
  if (typeof reg.anchor === "function") {
    reg.anchor({ id: "wood:brazier", kind: "brazier", pos: { ...plan.brazier }, weight: 0, lit: true, enabled: true });
  }

  const props: Prop[] = [];
  let lastEmit: Emit | null = null;
  let closeT = 0;
  let lastTime = 0;
  const isActive = () => { const p = machine.snapshot().phase; return p !== "idle" && p !== "done"; };
  const send = (outs: GameEvent[], emit: Emit | null) => {
    for (const o of outs) {
      if (o.type === "pickup" && o.id === WICK_ID) WICK_GIVEN.add(WICK_ID);
      if (emit) emit(o);
    }
  };

  const applyClose = () => {
    const k = smooth(closeT);
    closeMesh.visible = k > 0.01;
    closeMesh.scale.y = Math.max(0.001, k);
    glowMesh.visible = k > 0.01;
  };

  return {
    beacon: BEACON,
    get active() { return isActive(); },
    props,
    timeLeft: null,
    canStart(_ctx: FrameCtx) { return null; },
    start(_ctx: FrameCtx, emit: Emit) {
      lastEmit = emit;
      send(machine.start(), emit);
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      const act = isActive();
      if (!act && !near && closeT <= 0.001) return;
      lastEmit = emit;
      const dt = ctx.dt;
      lastTime = ctx.time;
      if (act) send(machine.step({ px: ctx.player.pos.x, pz: ctx.player.pos.z, grounded: ctx.player.grounded }, dt), emit);
      const on = isActive();
      const target = on ? 1 : 0;
      if (closeT !== target) {
        const step = dt / (target > closeT ? 2.2 : 3.5);
        closeT = target > closeT ? Math.min(target, closeT + step) : Math.max(target, closeT - step);
        applyClose();
      }
      if (closeT > 0.01) {
        const f = 0.5 + 0.3 * Math.sin(lastTime * 3.1) + 0.2 * Math.sin(lastTime * 7.3);
        glowMatl.opacity = smooth(closeT) * (on ? 0.55 + 0.25 * f : 0.25);
      }
    },
    handle(e: GameEvent, emit: Emit) {
      lastEmit = emit;
      send(machine.onEvent(e), emit);
    },
    abort() {
      send(machine.abort(), lastEmit);
      closeT = 0;
      applyClose();
    },
    solved(animated: boolean) {
      send(machine.reload(true), lastEmit);
      WICK_GIVEN.add(WICK_ID);
      if (!animated) {
        closeT = 0;
        applyClose();
      }
    },
    setQuality(_q: Quality) {},
  };
}
