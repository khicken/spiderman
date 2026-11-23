import * as THREE from "three";
import type { FrameCtx, GameEvent, Prop, Quality, V3, World } from "./contracts";
import type { SiteRegistryV2 } from "./contracts";
import { BEACON_COLOR, CLIFFS, PLAYER } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import type { Emit, Registry, SiteEnv, TrialHandle } from "./landmark-kit";
import { Mesher, PAL, clamp, glowMat, groundMin, haloSprite, lerp, rng } from "./landmark-kit";

export const CLIFF_TRIAL_TOTAL = 6;
const RING_R = 4.5;
const HIT_R = 5.6;
const BRAZIER_R = 6;
const RING_STAMINA = 0.25;
const UPDRAFT_SPEED = 6;
const UPDRAFT_R = 6.5;
const UPDRAFT_H = 40;
const FLARE_T = 3;
const TAU = Math.PI * 2;
const HINT_AFTER = 90;
const BONUS_GLIMMERS = 50;
const BONUS_ID = "cliff-bonus";
const GLIDE_HOLD = 0.5;
const TEST_STEPS = 5;
const KNOT_POST_H = 1.4; // knot anchor height above the ground (plan geometry)
const KNOT_REACH = 3; // m: a knot counts as reached (fall checkpoint) once Wren got this close to it

export interface Updraft { x: number; z: number; r: number }
const updrafts: Updraft[] = [];
/** Filled when the trial is built. Same columns `updraftAt` tests. */
export const CLIFF_UPDRAFTS: readonly Updraft[] = updrafts;

export interface CliffRing { x: number; y: number; z: number; nx: number; ny: number; nz: number }

export interface CliffTeachPlan {
  rule: string;
  hint: string;
  geometry: { ledge: V3; r: number; minDrop: number };
}
export interface CliffTestPlan {
  rule: string;
  hint: string;
  geometry: { knots: V3[]; plinth: V3; baseY: number; climbY: number; reachR: number };
}
export interface CliffBonusPlan {
  rule: string;
  hint: string;
  geometry: { rings: CliffRing[]; brazier: V3; topY: number; reachR: number; reward: number };
}
export interface CliffPlan {
  teach: CliffTeachPlan;
  test: CliffTestPlan;
  bonus: CliffBonusPlan;
  rules: { teach: string; test: string; bonus: string };
  hints: { teach: string; test: string; bonus: string };
  rings: CliffRing[];
  brazier: V3;
  edge: V3;
  updrafts: Updraft[];
}

export const CLIFF_RULES = {
  teach: "Jump off the ledge. Press G to glide.",
  test: "Ride two knots up the cliff. Reach the beacon.",
  bonus: `Glide through all ${CLIFF_TRIAL_TOTAL} rings to the beach.`,
} as const;
export const CLIFF_HINTS = {
  teach: "Walk off the ledge, then press G in the air.",
  test: "Press R on a knot, then R on the next knot. Jump onto the Thread.",
  bonus: "Hold forward while gliding to fly through each ring.",
} as const;

export function planCliffTrial(world: Pick<World, "heightAt">, front: V3): CliffPlan {
  const fx = front.x, fz = front.z, top = front.y;

  let bx = fx + 40, bz = fz + 150, best = Infinity;
  for (let x = fx + 8; x <= fx + 110; x += 4) {
    for (let z = fz + 80; z <= fz + 200; z += 4) {
      const y = world.heightAt(x, z);
      if (y < 1.2 || y > 3.5) continue;
      let ok = true;
      for (let k = 0; k < 6 && ok; k++) {
        const dx = k < 2 ? (k ? -6 : 6) : k < 4 ? 0 : (k === 4 ? 6 : -6);
        const dz = k < 2 ? 0 : k < 4 ? (k === 2 ? 6 : -6) : (k === 4 ? 6 : -6);
        const q = world.heightAt(x + dx, z + dz);
        if (q < 0.4 || Math.abs(q - y) > 1.8) ok = false;
      }
      if (!ok) continue;
      const s = Math.abs(Math.hypot(x - fx, z - fz) - 150);
      if (s < best) { best = s; bx = x; bz = z; }
    }
  }
  if (best === Infinity) {
    const ux = 0.45, uz = 0.89;
    for (let d = 40; d < 420; d += 4) {
      const y = world.heightAt(fx + ux * d, fz + uz * d);
      if (y > 0.8 && y < 4) { bx = fx + ux * d; bz = fz + uz * d; }
    }
  }
  const by = world.heightAt(bx, bz);

  const clen = Math.hypot(CLIFFS.x1 - CLIFFS.x0, CLIFFS.z1 - CLIFFS.z0);
  const nx = (CLIFFS.z1 - CLIFFS.z0) / clen, nz = -(CLIFFS.x1 - CLIFFS.x0) / clen;
  let dx = nx + 0.45 * -nz, dz = nz + 0.45 * nx;
  const dl = Math.hypot(dx, dz);
  dx /= dl; dz /= dl;
  let ex = fx, ez = fz;
  for (let d = 0; d < 260; d += 2) {
    const x = fx + dx * d, z = fz + dz * d;
    if (world.heightAt(x, z) < top - 8) break;
    ex = x; ez = z;
  }

  const N = 48;
  const px = new Float64Array(N + 1), pz = new Float64Array(N + 1), cum = new Float64Array(N + 1);
  const mx = (ex + bx) / 2, mz = (ez + bz) / 2;
  let total = 0;
  for (let sag = 60; sag <= 130; sag += 10) {
    const cx = mx + nx * sag * 2, cz = mz + nz * sag * 2;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      px[i] = u * u * ex + 2 * u * t * cx + t * t * bx;
      pz[i] = u * u * ez + 2 * u * t * cz + t * t * bz;
      cum[i] = i ? cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]) : 0;
    }
    total = cum[N];
    if (total >= 236) break;
  }

  const s0 = 6;
  const sp = clamp((total - s0 - 50) / (CLIFF_TRIAL_TOTAL - 1), 18, 22);
  const at = (s: number, out: number[]) => {
    let i = 1;
    while (i < N && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = clamp((s - cum[i - 1]) / seg, 0, 1);
    out[0] = lerp(px[i - 1], px[i], t);
    out[1] = lerp(pz[i - 1], pz[i], t);
    out[2] = (px[i] - px[i - 1]) / seg;
    out[3] = (pz[i] - pz[i - 1]) / seg;
  };

  // the lip can sit up to 8 m below the summit; launch height is the lip's ground plus a jump
  const yTop = world.heightAt(ex, ez) + 1.5;
  const tmp = [0, 0, 0, 0];
  const rings: CliffRing[] = [];
  // A straight glide drops 0.235 m per metre (glideSink / glideFwd); a steered, curving glide measures ~0.3. Rings sit on
  // that line so holding forward threads them; a ring below the line is fine (drop out of the glide), above is not.
  const GLIDE_DROP = 0.3;
  const slope = -GLIDE_DROP;
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const s = s0 + i * sp;
    at(s, tmp);
    const x = tmp[0], z = tmp[1];
    const y = Math.max(yTop - 2 - s * GLIDE_DROP, Math.max(0, world.heightAt(x, z)) + 7);
    const hl = Math.hypot(tmp[2], tmp[3]) || 1;
    let tx = tmp[2] / hl, tz = tmp[3] / hl, ty = slope;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    rings.push({ x, y, z, nx: tx, ny: ty, nz: tz });
  }

  const ups: Updraft[] = [];
  const lx = -dz, lz = dx;
  const spec: [number, number][] = [[10, 8], [22, -7], [34, 4]];
  for (const [k, lat] of spec) ups.push({ x: ex - dx * k + lx * lat, z: ez - dz * k + lz * lat, r: UPDRAFT_R });

  const brazierP: V3 = { x: bx, y: by, z: bz };
  const edge: V3 = { x: ex, y: top, z: ez };

  // Test route: knots from the cliff foot up toward the lip. Foot = first point out from the lip that is 34 m below the top.
  let kb = 60;
  for (let k = 4; k <= 120; k += 2) {
    if (world.heightAt(ex + dx * k, ez + dz * k) <= top - 34) { kb = k; break; }
  }
  const baseX = ex + dx * kb, baseZ = ez + dz * kb;
  const knots: V3[] = [0, 0.38, 0.76].map((f) => {
    const x = baseX + (ex - baseX) * f, z = baseZ + (ez - baseZ) * f;
    return { x, y: world.heightAt(x, z) + KNOT_POST_H, z };
  });
  const baseY = world.heightAt(baseX, baseZ);

  // Teach ledge: the lip itself, pulled back 3 m so the player starts on solid ground.
  const ledge: V3 = { x: ex - dx * 3, y: world.heightAt(ex - dx * 3, ez - dz * 3), z: ez - dz * 3 };

  const teach: CliffTeachPlan = { rule: CLIFF_RULES.teach, hint: CLIFF_HINTS.teach, geometry: { ledge, r: 12, minDrop: 3 } };
  const test: CliffTestPlan = {
    rule: CLIFF_RULES.test, hint: CLIFF_HINTS.test,
    geometry: { knots, plinth: { x: fx, y: top, z: fz }, baseY, climbY: top - 3, reachR: 5 },
  };
  const bonus: CliffBonusPlan = {
    rule: CLIFF_RULES.bonus, hint: CLIFF_HINTS.bonus,
    geometry: { rings, brazier: brazierP, topY: top, reachR: BRAZIER_R, reward: BONUS_GLIMMERS },
  };
  return {
    teach, test, bonus,
    rules: { ...CLIFF_RULES }, hints: { ...CLIFF_HINTS },
    rings, brazier: brazierP, edge, updrafts: ups,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure state machine. No THREE. The build function feeds it player data each frame and forwards what it returns.
// ---------------------------------------------------------------------------------------------------------------------
const claimedBonus = new Set<string>();

export type CliffPhase = "idle" | "teach" | "test" | "bonus" | "done";
export interface CliffInput {
  pos: { x: number; y: number; z: number };
  grounded: boolean;
  mode: string; // MoveMode; "glide" while the glider is open
  hp: number;
  /** Optional extra flag for callers that know the glider is open. */
  gliding?: boolean;
}
export interface CliffOpts {
  /** Session-wide set of claimed bonus ids. Pass a shared Set to make the reward once per session. */
  claimed?: Set<string>;
  onRing?: (index: number, ring: CliffRing) => void;
  onPhase?: (phase: CliffPhase) => void;
}
export interface CliffSnapshot {
  phase: CliffPhase;
  /** teach: 0/1, test: steps done of TEST_STEPS, bonus: rings hit. */
  progress: number;
  rides: number;
  climbed: boolean;
  teachDone: boolean;
  bonusProgress: number;
  bonusClaimed: boolean;
  bonusOpen: boolean;
  idleT: number;
  hinted: boolean;
}
export interface CliffMachine {
  start(): GameEvent[];
  step(input: CliffInput, dt: number): GameEvent[];
  onRide(): GameEvent[];
  onDied(): GameEvent[];
  abort(): void;
  reload(solved: boolean): void;
  snapshot(): CliffSnapshot;
}

export function createCliffMachine(plan: CliffPlan, opts: CliffOpts = {}): CliffMachine {
  const claimed = opts.claimed ?? new Set<string>();
  const T = plan.teach.geometry, S = plan.test.geometry, B = plan.bonus.geometry;
  let phase: CliffPhase = "idle";
  let idleT = 0, hinted = false;
  // teach
  let launched = false, peakY = 0, glideT = 0, tipShown = false;
  // test
  let rides = 0, climbed = false, checkY = -Infinity, lastY = 0, knotAt = 0; // knotAt: highest knot reached
  // bonus
  let bProg = 0, bLeft = false, havePrev = false, pvx = 0, pvy = 0, pvz = 0;

  const setPhase = (p: CliffPhase) => { phase = p; opts.onPhase?.(p); };
  const resetTeach = () => { launched = false; peakY = 0; glideT = 0; tipShown = false; };
  const resetTest = () => { rides = 0; climbed = false; checkY = S.baseY - 8; knotAt = 0; };
  const resetBonus = () => { bProg = 0; bLeft = false; havePrev = false; };
  const resetIdle = () => { idleT = 0; hinted = false; };
  const resetAll = () => { resetTeach(); resetTest(); resetBonus(); resetIdle(); };
  const rule = (text: string): GameEvent => ({ type: "trialRule", trial: 0, text });
  const bonusOpen = () => (phase === "bonus" || phase === "done") && !claimed.has(BONUS_ID);

  const testSteps = () => rides === 0 ? 0 : Math.min(rides, 2) + (climbed ? 1 : 0);

  function bonusStep(inp: CliffInput, out: GameEvent[]) {
    const p = inp.pos;
    if (bProg < CLIFF_TRIAL_TOTAL) {
      const r = B.rings[bProg];
      const d1 = (p.x - r.x) * r.nx + (p.y - r.y) * r.ny + (p.z - r.z) * r.nz;
      if (havePrev) {
        const d0 = (pvx - r.x) * r.nx + (pvy - r.y) * r.ny + (pvz - r.z) * r.nz;
        if (d0 < 0 && d1 >= 0) {
          const t = d0 / (d0 - d1);
          const hx = pvx + (p.x - pvx) * t - r.x, hy = pvy + (p.y - pvy) * t - r.y, hz = pvz + (p.z - pvz) * t - r.z;
          if (hx * hx + hy * hy + hz * hz <= HIT_R * HIT_R) {
            const i = bProg;
            bProg++;
            bLeft = true;
            opts.onRing?.(i, r);
            if (phase === "bonus") { idleT = 0; hinted = false; }
          }
        }
      }
    }
    pvx = p.x; pvy = p.y; pvz = p.z; havePrev = true;
    if (!bLeft && !inp.grounded && p.y < B.topY - 4) bLeft = true;
    if (!bLeft) return;
    const lost = inp.mode === "swim" || inp.mode === "dead";
    if (lost || (inp.grounded && bProg < CLIFF_TRIAL_TOTAL)) {
      if (bProg > 0) out.push({ type: "toast", text: "Missed a ring. Climb up and try again." });
      resetBonus();
      return;
    }
    if (!inp.grounded) return;
    const dx = p.x - B.brazier.x, dz = p.z - B.brazier.z;
    if (bProg >= CLIFF_TRIAL_TOTAL && dx * dx + dz * dz <= B.reachR * B.reachR && Math.abs(p.y - B.brazier.y) < 5) {
      claimed.add(BONUS_ID);
      out.push({ type: "pickup", kind: "glimmer", amount: B.reward, pos: { x: B.brazier.x, y: B.brazier.y + 1, z: B.brazier.z }, id: BONUS_ID });
      out.push({ type: "toast", text: `Bonus done. +${B.reward} glimmers.` });
      resetBonus();
      resetIdle();
      setPhase("done");
    }
  }

  return {
    start() {
      if (phase !== "idle") return [];
      resetAll();
      setPhase("teach");
      return [{ type: "trialStart", beacon: 0 }, rule(plan.rules.teach)];
    },
    step(inp, dt) {
      const out: GameEvent[] = [];
      const p = inp.pos;
      lastY = p.y;
      if (phase === "idle") return out;
      if (phase === "teach" || phase === "test" || phase === "bonus") {
        idleT += dt;
        if (!hinted && idleT >= HINT_AFTER) {
          hinted = true;
          out.push({ type: "toast", text: plan.hints[phase] });
        }
      }
      const gliding = inp.mode === "glide" || inp.gliding === true;

      if (phase === "teach") {
        const dx = p.x - T.ledge.x, dz = p.z - T.ledge.z;
        const near = dx * dx + dz * dz <= (T.r + 10) * (T.r + 10);
        if (!launched) {
          if (!inp.grounded && near && p.y > T.ledge.y - 3 && inp.mode !== "ride") { launched = true; peakY = p.y; glideT = 0; }
        } else {
          peakY = Math.max(peakY, p.y);
          glideT = gliding ? glideT + dt : 0;
          if (glideT >= GLIDE_HOLD) {
            resetTeach();
            resetIdle();
            setPhase("test");
            resetTest();
            out.push({ type: "trialProgress", beacon: 0, value: 1, total: TEST_STEPS }, rule(plan.rules.test));
          } else if (inp.grounded) {
            if (peakY - p.y >= T.minDrop && !tipShown) out.push({ type: "toast", text: "Press G in the air to glide." });
            tipShown = peakY - p.y >= T.minDrop || tipShown;
            launched = false; peakY = 0; glideT = 0;
          }
        }
        return out;
      }

      if (phase === "test") {
        if (inp.mode === "ride") checkY = Math.max(checkY, p.y);
        for (let i = knotAt + 1; i < S.knots.length && i <= rides; i++) {
          const kk = S.knots[i];
          if ((p.x - kk.x) ** 2 + (p.y - kk.y) ** 2 + (p.z - kk.z) ** 2 <= KNOT_REACH * KNOT_REACH) knotAt = i;
        }
        const lost = inp.mode === "swim" || inp.mode === "dead" || (inp.grounded && p.y < checkY - 4);
        if (lost && rides > 0) {
          resetIdle();
          if (inp.mode === "dead") { resetTest(); return out; } // death respawns at the checkpoint (onDied)
          // back to the highest knot Wren reached: knot k is reached by ride k (knot 0 is the foot)
          const kn = S.knots, k = knotAt;
          const at = kn[k], next = kn[Math.min(k + 1, kn.length - 1)], prev = kn[Math.max(k - 1, 0)];
          // stand 1.2 m down-route of the post, facing the next knot (the last knot faces up the route too)
          let bx = prev.x - at.x, bz = prev.z - at.z;
          if (k === 0) { bx = at.x - next.x; bz = at.z - next.z; }
          const bl = Math.hypot(bx, bz) || 1;
          const fx = (k < kn.length - 1 ? next.x : at.x) - (at.x + (bx / bl) * 1.2), fz = (k < kn.length - 1 ? next.z : at.z) - (at.z + (bz / bl) * 1.2);
          const pos = { x: at.x + (bx / bl) * 1.2, y: at.y - KNOT_POST_H, z: at.z + (bz / bl) * 1.2 };
          rides = k;
          climbed = false;
          checkY = pos.y;
          out.push(
            { type: "trialRespawn", beacon: 0, pos, yaw: Math.atan2(fx, fz) },
            { type: "trialProgress", beacon: 0, value: 1 + testSteps(), total: TEST_STEPS },
            { type: "toast", text: "You fell. Back to the last knot." },
          );
          return out;
        }
        if (rides >= 2 && !climbed && p.y >= S.climbY) {
          climbed = true;
          checkY = Math.max(checkY, p.y);
          idleT = 0; hinted = false;
          out.push({ type: "trialProgress", beacon: 0, value: 1 + testSteps(), total: TEST_STEPS });
        }
        if (rides >= 2 && climbed && inp.grounded) {
          const dx = p.x - S.plinth.x, dy = p.y - S.plinth.y, dz = p.z - S.plinth.z;
          if (dx * dx + dy * dy + dz * dz <= S.reachR * S.reachR) {
            resetTest();
            resetIdle();
            resetBonus();
            setPhase("bonus");
            out.push(
              { type: "power", power: "long" },
              { type: "memory", beacon: 0 },
              { type: "trialDone", beacon: 0 },
              rule(plan.rules.bonus),
            );
          }
        }
        return out;
      }

      if (bonusOpen()) bonusStep(inp, out);
      return out;
    },
    onRide() {
      if (phase !== "test") return [];
      rides++;
      idleT = 0; hinted = false;
      checkY = Math.max(checkY, lastY);
      if (rides > 2) return [];
      return [{ type: "trialProgress", beacon: 0, value: rides + 1, total: TEST_STEPS }];
    },
    onDied() {
      if (phase === "teach" || phase === "test") { resetAll(); setPhase("idle"); }
      else resetBonus();
      return [];
    },
    abort() { resetAll(); setPhase("idle"); },
    reload(solved) { resetAll(); setPhase(solved ? "done" : "idle"); },
    snapshot() {
      return {
        phase,
        progress: phase === "teach" ? 0 : phase === "test" ? 1 + testSteps() : phase === "bonus" || phase === "done" ? bProg : 0,
        rides, climbed,
        teachDone: phase === "test" || phase === "bonus" || phase === "done",
        bonusProgress: bProg, bonusClaimed: claimed.has(BONUS_ID), bonusOpen: bonusOpen(),
        idleT, hinted,
      };
    },
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const cDim = new THREE.Color("#5a4f44");
const cNextA = new THREE.Color("#8a5a2a");
const cNextB = new THREE.Color(BEACON_COLOR[0]).lerp(new THREE.Color("#ffffff"), 0.35);
const cLit = new THREE.Color(PAL.emberHi).lerp(new THREE.Color("#fff3c4"), 0.4);
const cBurnt = new THREE.Color("#3a322b");
const _c = new THREE.Color();

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  const r = rng(31);
  for (let i = 0; i < 14; i++) {
    const x = r() * 64, w = 1.5 + r() * 3.5, y0 = r() * 128, len = 40 + r() * 70;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len);
    gr.addColorStop(0, "rgba(255,255,255,0)");
    gr.addColorStop(0.5, `rgba(255,255,255,${0.35 + r() * 0.5})`);
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    for (const o of [-128, 0, 128]) g.fillRect(x - w / 2, y0 + o, w, len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


export function buildCliffTrial(env: SiteEnv, tower: BeaconTower, sky: THREE.Group): TrialHandle & { updraftAt(x: number, y: number, z: number): number } {
  void sky;
  const { world, look, group } = env;
  const plan = planCliffTrial(world, tower.front);
  const { rings, brazier } = plan;
  const owner = "landmarks:cliff-trial";
  const flameColor = BEACON_COLOR[0];

  updrafts.length = 0;
  for (const u of plan.updrafts) updrafts.push(u);
  const upBase: number[] = plan.updrafts.map((u) => world.heightAt(u.x, u.z));

  const torus = new THREE.TorusGeometry(RING_R, 0.38, 6, 24).toNonIndexed();
  const lantern = new THREE.IcosahedronGeometry(0.8, 0);
  const tPos = torus.attributes.position as THREE.BufferAttribute;
  const lPos = lantern.attributes.position as THREE.BufferAttribute;
  const perRing = tPos.count + 4 * lPos.count;
  const ringPos = new Float32Array(CLIFF_TRIAL_TOTAL * perRing * 3);
  const ringCol = new Float32Array(CLIFF_TRIAL_TOTAL * perRing * 3);
  const gain = new Float32Array(CLIFF_TRIAL_TOTAL * perRing);
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const r = rings[i];
    _q.setFromUnitVectors(_z, _v.set(r.nx, r.ny, r.nz));
    _m.compose(_p.set(r.x, r.y, r.z), _q, _s);
    let o = i * perRing;
    for (let k = 0; k < tPos.count; k++, o++) {
      _v.fromBufferAttribute(tPos, k).applyMatrix4(_m);
      ringPos.set([_v.x, _v.y, _v.z], o * 3);
      gain[o] = 1;
    }
    for (let l = 0; l < 4; l++) {
      const a = l * (TAU / 4) + Math.PI / 4;
      for (let k = 0; k < lPos.count; k++, o++) {
        _v.fromBufferAttribute(lPos, k);
        _v.x += Math.cos(a) * RING_R;
        _v.y += Math.sin(a) * RING_R;
        _v.applyMatrix4(_m);
        ringPos.set([_v.x, _v.y, _v.z], o * 3);
        gain[o] = 1.3;
      }
    }
  }
  torus.dispose();
  lantern.dispose();
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
  const colAttr = new THREE.BufferAttribute(ringCol, 3);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute("color", colAttr);
  ringGeo.computeBoundingSphere();
  env.own(ringGeo);
  const ringMat = env.own(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.name = "cliff-trial-rings";
  ringMesh.matrixAutoUpdate = false;
  ringMesh.updateMatrix();

  const ringsG = new THREE.Group();
  ringsG.name = "cliff-trial-rings-group";
  ringsG.add(ringMesh);
  const halos: THREE.Sprite[] = [];
  for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
    const h = haloSprite(env.glow, flameColor, 16);
    env.own(h.material);
    h.position.set(rings[i].x, rings[i].y, rings[i].z);
    h.visible = false;
    ringsG.add(h);
    halos.push(h);
  }

  const cylSeg = 10, cylRows = 4;
  let upPos: number[] = [], upUv: number[] = [], upCol: number[] = [];
  for (let i = 0; i < plan.updrafts.length; i++) {
    const u = plan.updrafts[i];
    const g = new THREE.CylinderGeometry(u.r * 1.15, u.r * 0.85, UPDRAFT_H, cylSeg, cylRows, true).toNonIndexed();
    const pa = g.attributes.position as THREE.BufferAttribute;
    const ua = g.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < pa.count; k++) {
      const y = pa.getY(k);
      const t = y / UPDRAFT_H + 0.5;
      upPos.push(pa.getX(k) + u.x, y + UPDRAFT_H / 2 + upBase[i] - 1, pa.getZ(k) + u.z);
      upUv.push(ua.getX(k) + i * 0.37, ua.getY(k));
      const f = Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.8);
      upCol.push(f, f, f);
    }
    g.dispose();
  }
  const upGeo = new THREE.BufferGeometry();
  upGeo.setAttribute("position", new THREE.Float32BufferAttribute(upPos, 3));
  upGeo.setAttribute("uv", new THREE.Float32BufferAttribute(upUv, 2));
  upGeo.setAttribute("color", new THREE.Float32BufferAttribute(upCol, 3));
  upGeo.computeBoundingSphere();
  upPos = upUv = upCol = [];
  env.own(upGeo);
  const stripes = env.own(stripeTexture());
  const upMat = env.own(new THREE.MeshBasicMaterial({
    map: stripes, color: "#ffd9a0", vertexColors: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  const upMesh = new THREE.Mesh(upGeo, upMat);
  upMesh.name = "cliff-trial-updrafts";
  upMesh.frustumCulled = false;
  upMesh.matrixAutoUpdate = false;
  upMesh.updateMatrix();

  const bx = brazier.x, bz = brazier.z;
  const gb = groundMin(world, bx, bz, 1.6, 1.6);
  const bm = new Mesher(77);
  bm.cyl(bx, gb - 0.6, bz, 2.1, 1.7, 1.2, PAL.rockLo, 8, Math.PI / 8);
  bm.cyl(bx, gb + 0.55, bz, 1.2, 1.0, 1.2, PAL.rock, 8, Math.PI / 8);
  bm.cyl(bx, gb + 1.7, bz, 0.95, 1.5, 0.7, PAL.ashLo, 10);
  bm.cyl(bx, gb + 2.3, bz, 1.55, 1.55, 0.14, PAL.goldLo, 10, 0, { ao: 0 });
  bm.ball(bx, gb + 2.3, bz, 1.2, PAL.ink, 0.25, 1);
  for (let k = 0; k < 3; k++) {
    const a = k * (TAU / 3) + 0.5;
    bm.beam(bx + Math.cos(a) * 1.7, gb + 0.3, bz + Math.sin(a) * 1.7, bx + Math.cos(a) * 1.0, gb + 1.9, bz + Math.sin(a) * 1.0, 0.26, PAL.woodLo);
  }
  bm.beam(bx + 2.3, gb - 0.2, bz, bx + 2.3, gb + 7.5, bz, 0.22, PAL.woodLo);
  bm.box(bx + 2.3, gb + 4.3, bz - 0.05, 0.05, 3.0, 1.3, PAL.cloth, 0, { ao: 0 });
  const bMesh = bm.build(look, undefined, "cliff-trial-brazier");
  env.own(bMesh.geometry);
  world.addBox({ minX: bx - 1.3, maxX: bx + 1.3, minZ: bz - 1.3, maxZ: bz + 1.3, minY: gb - 0.6, maxY: gb + 2.0, tag: "solid", owner: owner + "-brazier" });

  const flameGeo = env.own(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0));
  const flame = new THREE.Mesh(flameGeo, glowMat(look, flameColor, 1.6));
  flame.position.set(bx, gb + 2.35, bz);
  flame.visible = false;
  const bHalo = haloSprite(env.glow, flameColor, 9);
  env.own(bHalo.material);
  bHalo.position.set(bx, gb + 3.2, bz);
  bHalo.visible = false;
  const flamePos: V3 = { x: bx, y: gb + 2.6, z: bz };

  const brazierG = new THREE.Group();
  brazierG.name = "cliff-trial-brazier-group";
  brazierG.add(bMesh, flame, bHalo);

  ringsG.visible = brazierG.visible = upMesh.visible = false;
  group.add(ringsG, upMesh, brazierG);


  // test knots: stone posts the Thread can pin. Anchors are registered when the registry supports them.
  const knotG = new THREE.Group();
  knotG.name = "cliff-trial-knots";
  const km = new Mesher(91);
  const kn = plan.test.geometry.knots;
  for (const k of kn) {
    const g0 = k.y - 1.4;
    km.cyl(k.x, g0 - 0.4, k.z, 0.9, 0.7, 1.4, PAL.rockLo, 7);
    km.ball(k.x, k.y, k.z, 0.7, PAL.goldLo, 1, 1);
  }
  const kMesh = km.build(look, undefined, "cliff-trial-knots-mesh");
  env.own(kMesh.geometry);
  knotG.add(kMesh);
  const knotHalos: THREE.Sprite[] = kn.map((k) => {
    const h = haloSprite(env.glow, flameColor, 6);
    env.own(h.material);
    h.position.set(k.x, k.y, k.z);
    h.visible = false;
    knotG.add(h);
    return h;
  });
  const ledgeHalo = haloSprite(env.glow, flameColor, 8);
  env.own(ledgeHalo.material);
  ledgeHalo.position.set(plan.teach.geometry.ledge.x, plan.teach.geometry.ledge.y + 1.2, plan.teach.geometry.ledge.z);
  ledgeHalo.visible = false;
  knotG.add(ledgeHalo);
  knotG.visible = false;
  group.add(knotG);
  const reg2 = env.reg as Registry & Partial<SiteRegistryV2>;
  if (typeof reg2.anchor === "function") {
    kn.forEach((k, i) => {
      reg2.anchor!({ id: `cliff:knot${i}`, kind: "knot", pos: { x: k.x, y: k.y, z: k.z }, weight: 0, lit: false, enabled: true });
    });
  }

  const props: Prop[] = [];
  let solvedFlag = false;
  let lit = false;
  let flareT = 0;
  let shown = false;

  const machine = createCliffMachine(plan, { claimed: claimedBonus, onRing: (_i, r) => ringHit(r) });
  function ringHit(r: CliffRing) {
    const c = curCtx;
    if (!c) return;
    c.player.stamina = Math.min(PLAYER.staminaMax, c.player.stamina + RING_STAMINA);
    c.fx.burst("spark", r, 14);
  }
  let curCtx: FrameCtx | null = null;

  const paintRing = (i: number, c: THREE.Color) => {
    const a = i * perRing;
    for (let k = 0; k < perRing; k++) {
      const gk = gain[a + k], o = (a + k) * 3;
      ringCol[o] = c.r * gk;
      ringCol[o + 1] = c.g * gk;
      ringCol[o + 2] = c.b * gk;
    }
    colAttr.needsUpdate = true;
  };

  const refreshRings = () => {
    const s = machine.snapshot();
    const live = s.bonusOpen;
    for (let i = 0; i < CLIFF_TRIAL_TOTAL; i++) {
      const h = halos[i];
      if (s.bonusClaimed) {
        paintRing(i, cBurnt);
        h.visible = false;
      } else if (live && i < s.bonusProgress) {
        paintRing(i, cLit);
        h.visible = true;
        h.scale.set(14, 14, 1);
        h.material.opacity = 0.75;
      } else if (live && i === s.bonusProgress) {
        paintRing(i, cNextB);
        h.visible = true;
      } else {
        paintRing(i, cDim);
        h.visible = false;
      }
    }
  };

  const setLit = (on: boolean) => {
    lit = on;
    flame.visible = on;
    bHalo.visible = on;
  };

  const resetVisuals = () => {
    setLit(solvedFlag);
    if (!solvedFlag) flareT = 0;
    refreshRings();
  };

  const setShown = (on: boolean) => {
    if (shown === on) return;
    shown = on;
    ringsG.visible = on;
    brazierG.visible = on;
    upMesh.visible = on;
    knotG.visible = on;
  };

  const animate = (dt: number, time: number) => {
    stripes.offset.y -= dt * 0.55;
    upMat.opacity = 0.42 + 0.08 * Math.sin(time * 1.7);
    const s = machine.snapshot();
    const k = 0.5 + 0.5 * Math.sin(time * 6);
    if (s.bonusOpen && s.bonusProgress < CLIFF_TRIAL_TOTAL) {
      paintRing(s.bonusProgress, _c.copy(cNextA).lerp(cNextB, k));
      const h = halos[s.bonusProgress];
      h.visible = true;
      const sz = 12 + 6 * k;
      h.scale.set(sz, sz, 1);
      h.material.opacity = 0.45 + 0.45 * k;
    }
    ledgeHalo.visible = s.phase === "teach";
    if (ledgeHalo.visible) { const z = 7 + 3 * k; ledgeHalo.scale.set(z, z, 1); }
    for (let i = 0; i < knotHalos.length; i++) {
      const on = s.phase === "test";
      knotHalos[i].visible = on;
      if (on) { const z = 5 + 2 * k; knotHalos[i].scale.set(z, z, 1); }
    }
    if (lit) {
      if (flareT > 0) flareT = Math.max(0, flareT - dt);
      const f = flareT / FLARE_T;
      const flick = 1 + 0.07 * Math.sin(time * 9) + 0.05 * Math.sin(time * 17.3);
      const sc = flick * (1 + 1.7 * f * f);
      flame.scale.set(1.05 * sc, 3.2 * sc, 1.05 * sc);
      const hs = (9 + 14 * f) * flick;
      bHalo.scale.set(hs, hs, 1);
      bHalo.material.opacity = 0.7 + 0.3 * f;
    }
  };

  const isActive = () => { const p = machine.snapshot().phase; return p === "teach" || p === "test"; };
  const send = (outs: GameEvent[], emit: Emit) => { for (const o of outs) emit(o); };

  const trial: TrialHandle & { updraftAt(x: number, y: number, z: number): number } = {
    beacon: 0,
    get active() { return isActive(); },
    props,
    get timeLeft() { return null; },
    canStart() { return null; },
    start(ctx: FrameCtx, emit: Emit) {
      if (isActive() || solvedFlag) return;
      curCtx = ctx;
      machine.abort();
      send(machine.start(), emit);
      refreshRings();
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      const phase = machine.snapshot().phase;
      if (!near && phase !== "teach" && phase !== "test") {
        setShown(false);
        return;
      }
      setShown(true);
      animate(ctx.dt, ctx.time);
      if (phase === "idle") return;
      curCtx = ctx;
      const pl = ctx.player;
      const before = machine.snapshot().bonusProgress;
      const outs = machine.step({ pos: pl.pos, grounded: pl.grounded, mode: pl.mode, hp: pl.hp }, ctx.dt);
      if (machine.snapshot().bonusProgress !== before) refreshRings();
      for (const o of outs) {
        emit(o);
        if (o.type === "trialDone") {
          solvedFlag = true;
          setLit(true);
          flareT = FLARE_T;
          ctx.fx.burst("beacon", flamePos, 24);
        }
      }
      refreshRings();
    },
    handle(e: GameEvent, emit: Emit) {
      if (e.type === "threadRide" && e.on) {
        if (isActive()) send(machine.onRide(), emit);
        return;
      }
      if (e.type === "died" || e.type === "respawned") {
        if (machine.snapshot().phase !== "idle") { send(machine.onDied(), emit); refreshRings(); }
      } else if (e.type === "trialFail" && e.beacon === 0 && isActive()) {
        machine.abort();
        resetVisuals();
      }
    },
    abort() {
      solvedFlag = false;
      machine.abort();
      resetVisuals();
    },
    solved(animated: boolean) {
      solvedFlag = true;
      const ph = machine.snapshot().phase;
      if (ph !== "bonus" && ph !== "done") machine.reload(true);
      setLit(true);
      flareT = animated ? FLARE_T : 0;
      refreshRings();
    },
    setQuality(_q: Quality) {},
    updraftAt(x: number, y: number, z: number): number {
      for (let i = 0; i < updrafts.length; i++) {
        const u = updrafts[i];
        const dx = x - u.x, dz = z - u.z;
        if (dx * dx + dz * dz > u.r * u.r) continue;
        const b = upBase[i];
        if (y > b - 2 && y < b + UPDRAFT_H) return UPDRAFT_SPEED;
      }
      return 0;
    },
  };

  refreshRings();
  return trial;
}
