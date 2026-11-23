import * as THREE from "three";
import type { BeaconId, FrameCtx, GameEvent, Quality, Prop, SiteRegistryV2, ThreadAnchor, World } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { Mesher, PAL, glowMat, groundMin, solidBox, vcMat, type Emit, type Registry, type SiteEnv, type TrialHandle } from "./landmark-kit";

const BEACON: BeaconId = 3;
const TAU = Math.PI * 2;
const DISK_R = 1.0;
const HANG_KNOB = 1.1;
const SPIN_TIME = 0.8;
const HINT_SECS = 90;
const RESTOCK_SECS = 3;
const NEED_BOW = "You need a bow. Find it in the Mirebrook mill.";
export const BLUFF_NEAR_KNOT = "bluff:near-knot";
export const BLUFF_BRIDGE_KNOT = "bluff:bridge-knot";
const WICK_ID = "wick-bluff";

// ---------------------------------------------------------------------------------------------------------------------
// Plan: pure geometry and text for all three parts. Only `world.heightAt` is used (a fake world works in the sim).
// ---------------------------------------------------------------------------------------------------------------------
export interface BluffPole { id: string; x: number; y: number; z: number; baseY: number; ground: boolean; mast: boolean }
export interface BluffChain { id: string; x: number; y: number; z: number; baseY: number; armY: number; hang: number; w: number; phase: number; amp: number }
export interface BluffDeck { x: number; z: number; w: number; d: number; top: number }
export interface BluffPlan {
  center: { x: number; z: number };
  leaveR: number;
  pier: { x: number; z: number; top: number };
  teach: { rule: string; hint: string; targets: BluffPole[] };
  test: {
    rule: string; hint: string; fallToast: string;
    chainTargets: BluffChain[];
    farTarget: BluffPole;
    nearDeck: BluffDeck; farDeck: BluffDeck;
    nearKnot: { id: string; x: number; y: number; z: number };
    bridgeKnot: { id: string; x: number; y: number; z: number };
    gap: { x0: number; x1: number; z0: number; z1: number; floorY: number };
    goal: { x: number; z: number; hw: number; hd: number; top: number };
  };
  bonus: { rule: string; hint: string; targets: BluffPole[] };
}

type HeightWorld = Pick<World, "heightAt">;

function gMax(w: HeightWorld, x: number, z: number, hw: number, hd: number): number {
  let m = -Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) m = Math.max(m, w.heightAt(x + i * hw, z + j * hd));
  return m;
}

export function planBluffTrial(world: HeightWorld, cx: number, cz: number): BluffPlan {
  const px = cx + 5, pz = cz - 22;
  const pierTop = world.heightAt(px, pz) + 0.7;
  const pole = (id: string, x: number, z: number, y: number, baseY: number, ground: boolean, mast = false): BluffPole => ({ id, x, y, z, baseY, ground, mast });

  const teach: BluffPole[] = [-4, 0, 4].map((dx, i) => {
    const x = px + dx, z = pz - 10, g = world.heightAt(x, z);
    return pole(`bluff-teach-${i}`, x, z, Math.max(pierTop + 1.4, g + 2.0), g, true);
  });

  const chain = (i: number, x: number, z: number, hang: number, w: number, phase: number): BluffChain => {
    const g = world.heightAt(x, z), y = Math.max(pierTop + 1.4, g + 2.2);
    return { id: `bluff-chain-${i}`, x, z, baseY: g, armY: y + hang, y, hang, w, phase, amp: 0.4 };
  };
  const chains = [chain(0, px - 10, cz - 44, 3.4, 1.15, 0.4), chain(1, px + 10, cz - 46, 3.7, 0.95, 2.1)];

  const nd = { x: px, z: cz - 58, w: 10, d: 6 };
  const nearTop = gMax(world, nd.x, nd.z, nd.w / 2, nd.d / 2) + 0.5;
  const fd = { x: px, z: cz - 76, w: 10, d: 6 };
  const farTop = Math.max(nearTop - 1.2, gMax(world, fd.x, fd.z, fd.w / 2, fd.d / 2) + 0.5);
  const far = pole("bluff-far", px, cz - 75, farTop + 2.2, farTop, false);
  const nearKnot = { id: BLUFF_NEAR_KNOT, x: px, y: nearTop + 1.0, z: cz - 60 };
  const bridgeKnot = { id: BLUFF_BRIDGE_KNOT, x: far.x, y: far.y, z: far.z };

  const bonus = [[-6, -92], [4, -100], [-2, -108]].map(([dx, dz], i) => {
    const x = px + dx, z = cz + dz, g = world.heightAt(x, z);
    return pole(`bluff-bonus-${i}`, x, z, Math.max(farTop - 0.5 - 2.5 * i, g + 2.2), g, true, true);
  });

  return {
    center: { x: cx, z: cz },
    leaveR: 130,
    pier: { x: px, z: pz, top: pierTop },
    teach: { rule: "Hit all 3 targets with arrows.", hint: "Hold F to aim, release to shoot.", targets: teach },
    test: {
      rule: "Hit the swinging targets, then the far target.",
      hint: "Shoot the far target, then Thread to it.",
      fallToast: "You fell. Shoot the far target, then Thread to it.",
      chainTargets: chains,
      farTarget: far,
      nearDeck: { ...nd, top: nearTop }, farDeck: { ...fd, top: farTop },
      nearKnot, bridgeKnot,
      gap: { x0: px - 14, x1: px + 14, z0: fd.z + fd.d / 2, z1: nd.z - nd.d / 2, floorY: Math.min(nearTop, farTop) - 2 },
      goal: { x: fd.x, z: fd.z, hw: fd.w / 2, hd: fd.d / 2, top: farTop },
    },
    bonus: { rule: "Hit 3 targets in one glide.", hint: "Glide off the far platform and shoot 3 targets.", targets: bonus },
  };
}

/** Swing pattern of a chain target: a pure function of time. Returns the target position. */
export function bluffChainPos(c: BluffChain, t: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const a = c.amp * Math.sin(t * c.w + c.phase);
  out.x = c.x + Math.sin(a) * c.hang;
  out.y = c.armY - Math.cos(a) * c.hang;
  out.z = c.z;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Machine: pure rules. No THREE. Outputs are plain GameEvent values.
// ---------------------------------------------------------------------------------------------------------------------
export type BluffPhase = "idle" | "teach" | "test" | "bonus" | "done";
export interface BluffInput { pos: { x: number; y: number; z: number }; grounded: boolean; mode: string; arrows?: number }
export interface BluffOpts { bonusDone?: boolean; awarded?: Set<string> }
export interface BluffSnapshot {
  phase: BluffPhase; teachHits: number; chainHits: number; farHit: boolean; bridgeEnabled: boolean;
  linked: boolean; rode: boolean; bonusHits: number; bonusDone: boolean; progress: number; total: number;
}

const AWARDED = new Set<string>();

export function createBluffMachine(plan: BluffPlan, opts: BluffOpts = {}) {
  const awarded = opts.awarded ?? AWARDED;
  let bonusDone = !!opts.bonusDone || awarded.has(WICK_ID);
  let phase: BluffPhase = "idle";
  const hit = new Set<string>();
  let bridge = false, linked = false, rode = false;
  let hintT = 0, hintShown = false, restockT = 0;
  let airborne = false;
  const T = plan.test;
  const total = plan.teach.targets.length + T.chainTargets.length + 2;
  const at = plan.pier;
  const v = (x: number, y: number, z: number) => ({ x, y, z });

  const count = (list: readonly { id: string }[]) => list.reduce((n, t) => n + (hit.has(t.id) ? 1 : 0), 0);
  const teachHits = () => count(plan.teach.targets);
  const chainHits = () => count(T.chainTargets);
  const bonusHits = () => count(plan.bonus.targets);
  const progress = () => teachHits() + chainHits() + (hit.has(T.farTarget.id) ? 1 : 0);
  const prog = (): GameEvent => ({ type: "trialProgress", beacon: BEACON, value: progress(), total });
  const rule = (text: string): GameEvent => ({ type: "trialRule", trial: BEACON, text });
  const toast = (text: string): GameEvent => ({ type: "toast", text });

  const clearAll = () => { hit.clear(); bridge = linked = rode = false; hintT = 0; hintShown = false; restockT = 0; };
  const clearTest = () => {
    for (const t of T.chainTargets) hit.delete(t.id);
    hit.delete(T.farTarget.id);
    bridge = linked = rode = false; hintT = 0; hintShown = false;
  };
  const clearBonus = () => { for (const t of plan.bonus.targets) hit.delete(t.id); };
  const reset = () => { clearAll(); phase = "idle"; airborne = false; };

  const finishTest = (): GameEvent[] => {
    const out: GameEvent[] = [{ type: "trialProgress", beacon: BEACON, value: total, total }, { type: "power", power: "arrow" }, { type: "memory", beacon: BEACON }, { type: "trialDone", beacon: BEACON }];
    hit.clear();
    hintT = 0; hintShown = false;
    if (bonusDone) phase = "done";
    else { phase = "bonus"; out.push(rule(plan.bonus.rule)); }
    return out;
  };

  const onHitBonus = (id: string): GameEvent[] => {
    const t = plan.bonus.targets.find((b) => b.id === id);
    if (!t || hit.has(id) || !airborne) return [];
    hit.add(id);
    const out: GameEvent[] = [{ type: "trialProgress", beacon: BEACON, value: bonusHits(), total: plan.bonus.targets.length }];
    if (bonusHits() >= plan.bonus.targets.length) {
      bonusDone = true;
      phase = "done";
      if (!awarded.has(WICK_ID)) {
        awarded.add(WICK_ID);
        out.push({ type: "pickup", kind: "wick", amount: 1, pos: v(t.x, t.y, t.z), id: WICK_ID });
      }
    }
    return out;
  };

  return {
    plan,
    canStart(hasBow: boolean): string | null { return hasBow ? null : NEED_BOW; },
    start(): GameEvent[] {
      if (phase !== "idle") return [];
      clearAll();
      phase = "teach";
      return [{ type: "trialStart", beacon: BEACON }, rule(plan.teach.rule)];
    },
    step(input: BluffInput, dt: number): GameEvent[] {
      airborne = !input.grounded && (input.mode === "air" || input.mode === "glide");
      const p = input.pos;
      if (phase === "bonus") {
        if (input.grounded && bonusHits() > 0) clearBonus();
        return [];
      }
      if (phase !== "teach" && phase !== "test") return [];
      const out: GameEvent[] = [];
      if (Math.hypot(p.x - plan.center.x, p.z - plan.center.z) > plan.leaveR) {
        reset();
        return [{ type: "trialFail", beacon: BEACON }];
      }
      hintT += dt;
      if (!hintShown && hintT >= HINT_SECS) {
        hintShown = true;
        out.push(toast(phase === "teach" ? plan.teach.hint : T.hint));
      }
      restockT = Math.max(0, restockT - dt);
      if (input.arrows !== undefined && input.arrows <= 0 && restockT <= 0) {
        restockT = RESTOCK_SECS;
        out.push({ type: "pickup", kind: "arrows", amount: 10, pos: v(at.x, at.top, at.z), id: "arrows-bluff-restock" });
      }
      if (phase === "test") {
        const g = T.gap;
        const fell = (p.x > g.x0 && p.x < g.x1 && p.z > g.z0 && p.z < g.z1 && p.y < g.floorY) || input.mode === "swim";
        if (fell) {
          clearTest();
          out.push(toast(T.fallToast), prog());
          return out;
        }
        const gl = T.goal;
        if (rode && input.grounded && input.mode !== "ride" && Math.abs(p.x - gl.x) <= gl.hw && Math.abs(p.z - gl.z) <= gl.hd && p.y >= gl.top - 0.8) {
          out.push(...finishTest());
        }
      }
      return out;
    },
    onEvent(e: GameEvent): GameEvent[] {
      switch (e.type) {
        case "propHit": {
          if (e.by !== "arrow") return [];
          if (phase === "bonus") return onHitBonus(e.id);
          if (phase === "teach") {
            if (!plan.teach.targets.some((t) => t.id === e.id) || hit.has(e.id)) return [];
            hit.add(e.id);
            const out: GameEvent[] = [prog()];
            if (teachHits() >= plan.teach.targets.length) {
              phase = "test"; hintT = 0; hintShown = false;
              out.push(rule(T.rule));
            }
            return out;
          }
          if (phase === "test") {
            const chainDone = chainHits() >= T.chainTargets.length;
            if (hit.has(e.id)) return [];
            if (T.chainTargets.some((t) => t.id === e.id)) { hit.add(e.id); return [prog()]; }
            if (e.id === T.farTarget.id && chainDone) {
              hit.add(e.id);
              bridge = true;
              return [prog(), toast("Far target hit. Thread to it.")];
            }
          }
          return [];
        }
        case "threadLink":
          if (phase === "test" && bridge && e.use === "ride" && (e.a === BLUFF_BRIDGE_KNOT || e.b === BLUFF_BRIDGE_KNOT)) linked = rode = true;
          return [];
        case "threadRide":
          if (phase === "test" && bridge && e.on && linked) rode = true;
          return [];
        case "died":
        case "respawned":
          if (phase === "teach" || phase === "test") reset();
          else if (phase === "bonus") clearBonus();
          return [];
        case "trialFail":
          if (e.beacon === BEACON && (phase === "teach" || phase === "test")) reset();
          return [];
        default:
          return [];
      }
    },
    abort() { reset(); },
    reload(solved: boolean) {
      clearAll();
      airborne = false;
      if (solved) { phase = bonusDone ? "done" : "bonus"; bridge = true; } else phase = "idle";
    },
    isLive(id: string): boolean {
      if (hit.has(id)) return false;
      if (phase === "teach") return plan.teach.targets.some((t) => t.id === id);
      if (phase === "test") {
        if (T.chainTargets.some((t) => t.id === id)) return true;
        return id === T.farTarget.id && chainHits() >= T.chainTargets.length;
      }
      if (phase === "bonus") return plan.bonus.targets.some((t) => t.id === id);
      return false;
    },
    isHit(id: string): boolean { return hit.has(id); },
    snapshot(): BluffSnapshot {
      return {
        phase, teachHits: teachHits(), chainHits: chainHits(), farHit: hit.has(T.farTarget.id), bridgeEnabled: bridge,
        linked, rode, bonusHits: bonusHits(), bonusDone, progress: progress(), total,
      };
    },
  };
}
export type BluffMachine = ReturnType<typeof createBluffMachine>;

const FACE_DORMANT = 0, FACE_LIVE = 1, FACE_HIT = 2, FACE_GOLD = 3;

export function buildBluffTrial(env: SiteEnv, tower: BeaconTower, _sky: THREE.Group): TrialHandle {
  const { world, look, group } = env;
  const owner = "landmarks:trial-bluff";
  const plan = planBluffTrial(world, tower.cx, tower.cz);
  const T = plan.test;
  const flx = plan.pier.x, flz = plan.pier.z;
  const fg = world.heightAt(flx, flz);
  const tmp2 = { x: 0, y: 0, z: 0 };

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
  const kinds: ("pole" | "swing")[] = [];
  const ids: string[] = [];
  const all: (BluffPole | BluffChain)[] = [...plan.teach.targets, ...T.chainTargets, T.farTarget, ...plan.bonus.targets];
  const N = all.length;
  const isBonus = (id: string) => id.startsWith("bluff-bonus-");
  const shown = new Int8Array(N).fill(-1);
  const spinT = new Float32Array(N).fill(2);
  const burstQ = new Uint8Array(N);

  const faceGeo = env.own(faceM.build(look).geometry);
  const chainGeo = env.own(chainM.build(look).geometry);
  const mats = [
    look.toon({ color: "#8d8a82", vertexColors: true, transparent: true, opacity: 0.5 }),
    vcMat(look),
    look.toon({ color: "#ffffff", vertexColors: true, emissive: "#ffb84a", emissiveIntensity: 0.8, rim: 0 }),
    glowMat(look, PAL.goldHi, 0.95),
  ];
  const chainMat = vcMat(look);

  const deck = (d: BluffDeck, tag: string) => {
    const y0 = groundMin(world, d.x, d.z, d.w / 2, d.d / 2) - 0.6;
    solidBox(world, stone, owner + tag, d.x, d.z, d.w, d.d, d.top - 0.1, PAL.woodLo, "solid", { y0 });
    stone.box(d.x, d.top - 0.1, d.z, d.w - 0.2, 0.1, d.d - 0.2, PAL.woodHi, 0, { ao: 0.05 });
    world.addBox({ minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2, minY: d.top - 0.1, maxY: d.top, tag: "solid", owner: owner + tag + "-top" });
  };
  deck(T.nearDeck, "-near");
  deck(T.farDeck, "-far");
  {
    const nd = T.nearDeck;
    const sz = nd.z + nd.d / 2 + 0.7, sTop = nd.top - 0.5;
    solidBox(world, stone, owner + "-near-step", nd.x, sz, 3, 1.4, sTop, PAL.woodLo, "solid", { y0: groundMin(world, nd.x, sz, 1.5, 0.7) - 0.4 });
    const nk = T.nearKnot;
    stone.cyl(nk.x, nd.top, nk.z, 0.4, 0.32, 1.0, PAL.rock, 6);
    stone.cyl(nk.x, nd.top + 0.95, nk.z, 0.3, 0.3, 0.12, PAL.gold, 6);
    const fk = T.farDeck;
    stone.box(fk.x, fk.top - 0.1, fk.z, fk.w, 0.04, 0.2, PAL.gold, 0, { jit: 0, ao: 0 });
  }

  for (let i = 0; i < N; i++) {
    const t = all[i];
    const swing = "armY" in t;
    kinds.push(swing ? "swing" : "pole");
    ids.push(t.id);
    const px = t.x, pz = t.z, cy = t.y, gy = t.baseY;
    if (swing) {
      const c = t as BluffChain;
      const hx = 2.7;
      for (const s of [-1, 1]) {
        stone.cyl(px + s * hx, gy - 0.7, pz - 0.2, 0.2, 0.17, c.armY - gy + 0.95, PAL.woodHi, 6);
        stone.beam(px + s * hx, c.armY - 1.2, pz - 0.2, px + s * (hx - 1.3), c.armY + 0.05, pz - 0.2, 0.12, PAL.woodLo);
      }
      stone.boxc(px, c.armY + 0.12, pz - 0.2, hx * 2 + 0.6, 0.26, 0.26, PAL.woodHi);
      stone.cyl(px, c.armY - 0.14, pz - 0.2, 0.09, 0.09, 0.1, PAL.gold, 6);
    } else {
      const pl = t as BluffPole;
      const poleTop = cy + 0.6;
      if (pl.ground) stone.cyl(px, gy - 0.9, pz - 0.34, 0.6, 0.45, 1.3, PAL.rock, 8);
      stone.cyl(px, gy + 0.3, pz - 0.34, 0.14, 0.11, poleTop - gy - 0.3, PAL.woodLo, 6);
      stone.cyl(px, poleTop, pz - 0.34, 0.16, 0.16, 0.14, PAL.gold, 6);
      if (pl.mast) {
        stone.cyl(px, poleTop + 0.1, pz - 0.34, 0.06, 0.06, 1.3, PAL.woodHi, 5);
        stone.box(px + 0.48, poleTop + 0.75, pz - 0.34, 0.96, 0.38, 0.04, PAL.gloamHi, 0, { ao: 0 });
      }
    }

    const tg = new THREE.Group();
    const mesh = new THREE.Mesh(faceGeo, mats[FACE_DORMANT]);
    mesh.castShadow = true;
    tg.add(mesh);
    meshes.push(mesh);
    tgs.push(tg);
    if (swing) {
      const c = t as BluffChain;
      const pv = new THREE.Group();
      pv.position.set(px, c.armY, pz - 0.18);
      const len = c.hang - HANG_KNOB;
      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.y = -len;
      chain.scale.y = len;
      tg.position.set(0, -c.hang, 0.18);
      pv.add(chain, tg);
      group.add(pv);
      pivots.push(pv);
    } else {
      tg.position.set(px, cy, pz);
      group.add(tg);
      pivots.push(null);
    }
    props.push({ id: t.id, pos: { x: px, y: cy, z: pz }, radius: 0.9, active: false });
  }

  const stoneMesh = stone.build(look, undefined, "bluff-trial");
  env.own(stoneMesh.geometry);
  group.add(stoneMesh);
  const glowMesh = glow.build(look, glowMat(look, PAL.goldHi, 0.7), "bluff-trial-glow");
  glowMesh.castShadow = false;
  env.own(glowMesh.geometry);
  group.add(glowMesh);

  const markGeo = env.own(new THREE.TorusGeometry(0.75, 0.06, 6, 24));
  const markMat = env.own(glowMat(look, PAL.goldHi, 0.9));
  const mark = new THREE.Mesh(markGeo, markMat);
  mark.position.set(T.bridgeKnot.x, T.bridgeKnot.y, T.bridgeKnot.z);
  mark.visible = false;
  group.add(mark);

  const machine = createBluffMachine(plan, { bonusDone: false });
  let solvedFlag = false;

  let bridgeAnchor: ThreadAnchor | null = null;
  const regV2 = env.reg as Registry & Partial<SiteRegistryV2>;
  if (typeof regV2.anchor === "function") {
    regV2.anchor({ id: T.nearKnot.id, kind: "knot", pos: { x: T.nearKnot.x, y: T.nearKnot.y, z: T.nearKnot.z }, weight: 0, lit: false, enabled: true });
    bridgeAnchor = regV2.anchor({ id: T.bridgeKnot.id, kind: "knot", pos: { x: T.bridgeKnot.x, y: T.bridgeKnot.y, z: T.bridgeKnot.z }, weight: 0, lit: false, enabled: false });
  }

  const sync = () => {
    const on = machine.snapshot().bridgeEnabled;
    if (bridgeAnchor) bridgeAnchor.enabled = on;
    mark.visible = on;
  };
  const setFace = (i: number, f: number) => { meshes[i].material = mats[f]; };
  const faceOf = (i: number) => {
    if (solvedFlag && !isBonus(ids[i])) return FACE_GOLD;
    if (machine.isHit(ids[i])) return FACE_HIT;
    return machine.isLive(ids[i]) ? FACE_LIVE : FACE_DORMANT;
  };
  const refresh = (spin: boolean) => {
    for (let i = 0; i < N; i++) {
      props[i].active = machine.isLive(ids[i]);
      const want = faceOf(i);
      if (want === shown[i]) continue;
      if (spin && shown[i] >= 0 && want >= FACE_HIT) { spinT[i] = 0; burstQ[i] = 1; }
      shown[i] = want;
      setFace(i, want);
    }
    sync();
  };
  const flush = (out: GameEvent[], emit: Emit) => { for (const e of out) emit(e); };
  refresh(false);

  const tmp = { x: 0, y: 0, z: 0 };
  const inp = { pos: tmp, grounded: false, mode: "ground", arrows: 0 };

  return {
    beacon: BEACON,
    get active() { const p = machine.snapshot().phase; return p === "teach" || p === "test"; },
    props,
    get timeLeft() { return null; },
    canStart(ctx: FrameCtx) { return machine.canStart(ctx.player.hasBow); },
    start(_ctx: FrameCtx, emit: Emit) {
      flush(machine.start(), emit);
      refresh(false);
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      const ph = machine.snapshot().phase;
      if (ph === "idle" && !near && !solvedFlag) return;
      const p = ctx.player.pos;
      tmp.x = p.x; tmp.y = p.y; tmp.z = p.z;
      inp.grounded = ctx.player.grounded; inp.mode = ctx.player.mode; inp.arrows = ctx.player.arrows;
      flush(machine.step(inp, ctx.realDt), emit);
      refresh(true);
      const dt = ctx.dt, t = ctx.time;
      for (let i = 0; i < N; i++) {
        const pv = pivots[i];
        if (pv) {
          const c = all[i] as BluffChain;
          bluffChainPos(c, t, tmp2);
          pv.rotation.z = c.amp * Math.sin(t * c.w + c.phase);
          const pp = props[i].pos;
          pp.x = tmp2.x; pp.y = tmp2.y; pp.z = tmp2.z + 0.0;
        }
        if (burstQ[i]) {
          burstQ[i] = 0;
          ctx.fx.burst("spark", props[i].pos, 16, undefined, 5);
          ctx.fx.burst("glimmer", props[i].pos, 6);
        }
        if (spinT[i] < 1) {
          spinT[i] += dt / SPIN_TIME;
          const s = Math.min(1, spinT[i]);
          const e = 1 - (1 - s) * (1 - s) * (1 - s);
          if (s >= 1) { tgs[i].rotation.y = 0; tgs[i].scale.setScalar(1); spinT[i] = 2; }
          else { tgs[i].rotation.y = e * TAU; tgs[i].scale.setScalar(1 + 0.25 * Math.sin(Math.PI * s)); }
        }
      }
    },
    handle(e: GameEvent, emit: Emit) {
      flush(machine.onEvent(e), emit);
      refresh(true);
    },
    abort() {
      machine.abort();
      solvedFlag = false;
      for (let i = 0; i < N; i++) { spinT[i] = 2; burstQ[i] = 0; tgs[i].rotation.y = 0; tgs[i].scale.setScalar(1); }
      refresh(false);
    },
    solved(animated: boolean) {
      machine.reload(true);
      solvedFlag = true;
      for (let i = 0; i < N; i++) { spinT[i] = 2; burstQ[i] = 0; tgs[i].rotation.y = 0; tgs[i].scale.setScalar(1); }
      refresh(animated);
      if (animated) for (let i = 0; i < N; i++) if (!isBonus(ids[i])) spinT[i] = -i * 0.12;
    },
    setQuality(q: Quality) {
      const sh = q !== "low";
      for (let i = 0; i < N; i++) meshes[i].castShadow = sh;
      stoneMesh.castShadow = sh;
    },
  } satisfies TrialHandle;
}
