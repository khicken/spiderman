import * as THREE from "three";
import { BEACON_COLOR, THREAD } from "./contracts";
import type { FrameCtx, GameEvent, Prop, Quality, SiteRegistryV2, ThreadAnchor, V3 } from "./contracts";
import type { BeaconTower } from "./landmark-beacon";
import { PAL, Mesher, glowMat, groundMin, lerp, rng, smooth, solidBox } from "./landmark-kit";
import type { Emit, Registry, SiteEnv, TrialHandle } from "./landmark-kit";

// Drowned Beacon trial (v2, Thread pulls). A walled 6 x 5 court west of the tower, cells are 2 m, (col, row) with col to
// the east and row to the south. The entrance gap in the south wall is at col 2. Terrain never changes: pillars #,
// open water ~ (a block stops at the shore), floats o (a water cell a block may enter), the pool cell p (plate under
// water, a block may enter and rest on it). Blocks, posts and plates change per part (teach, test, bonus).
// Pull = (block, post): the post sits in the same row or column as the block, no pillar between. The block slides cell
// by cell toward the post and stops one cell short of it (1.5 m stop), or earlier at a pillar, post, block, wall or
// open water. Weight 3 needs Heavy Thread. The player is not part of the state (threads reach 18 m).
// The solver (scripts/trials/drowned-solver.ts) proves test <= 6 pulls and the bonus needs Heavy Thread.

// ---------------------------------------------------------------------------------------------------------------------
// Pull model (pure; shared by the solver and the machine)
// ---------------------------------------------------------------------------------------------------------------------
export type LakeCell = readonly [number, number];
export interface LakeBlockDef { at: LakeCell; weight: 1 | 2 | 3 }
export interface LakeLayout {
  posts: readonly LakeCell[];
  plates: readonly LakeCell[];
  blocks: readonly LakeBlockDef[];
}
/** Cell index of each block, c + r * cols. */
export type LakeState = readonly number[];
export interface LakePull { block: number; post: number }

const COLS = 6, ROWS = 5, CELL = 2;
const TERRAIN: readonly string[] = [
  "......",
  ".p...~",
  "~~o..o",
  "......",
  "......",
];

function cellsOf(ch: string): LakeCell[] {
  const out: LakeCell[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (TERRAIN[r][c] === ch) out.push([c, r]);
  return out;
}

const TEACH_LAYOUT: LakeLayout = {
  posts: [[3, 3]],
  plates: [[2, 3]],
  blocks: [{ at: [0, 3], weight: 1 }],
};
const TEST_LAYOUT: LakeLayout = {
  posts: [[1, 3], [2, 0], [3, 0], [5, 4]],
  plates: [[1, 1], [2, 1], [3, 1]],
  blocks: [{ at: [5, 3], weight: 1 }, { at: [2, 3], weight: 1 }, { at: [0, 0], weight: 1 }],
};
// block 0 is the heavy block, block 1 the light one that stands in its way
const BONUS_LAYOUT: LakeLayout = {
  posts: [[4, 2], [1, 0], [5, 3]],
  plates: [[3, 3]],
  blocks: [{ at: [1, 3], weight: 3 }, { at: [2, 3], weight: 1 }],
};

export const LAKE_MODEL = {
  cols: COLS,
  rows: ROWS,
  cell: CELL,
  entryCol: 2,
  grid: TERRAIN,
  floats: cellsOf("o"),
  pool: cellsOf("p")[0],
  teach: TEACH_LAYOUT,
  test: TEST_LAYOUT,
  bonus: BONUS_LAYOUT,
  posts: TEST_LAYOUT.posts,
  plates: TEST_LAYOUT.plates,
  blocks: TEST_LAYOUT.blocks,
  heavyBlock: 0, // index of the weight 3 block in `bonus`
} as const;

export const startState = (layout: LakeLayout = TEST_LAYOUT): LakeState => layout.blocks.map((b) => b.at[0] + b.at[1] * COLS);
/** The state with block i resting on plate i (the solved look). */
export const platesState = (layout: LakeLayout = TEST_LAYOUT): LakeState => layout.plates.map((p) => p[0] + p[1] * COLS);

/** Cells a pull would carry the block through (first entry is the cell after the start), null when it has no line or no room. */
export function pullCells(state: LakeState, pull: LakePull, layout: LakeLayout = TEST_LAYOUT): number[] | null {
  const post = layout.posts[pull.post];
  const from = state[pull.block];
  if (!post || from === undefined) return null;
  const bc = from % COLS, br = (from / COLS) | 0;
  const pc = post[0], pr = post[1];
  let dc = 0, dr = 0;
  if (pr === br && pc !== bc) dc = pc > bc ? 1 : -1;
  else if (pc === bc && pr !== br) dr = pr > br ? 1 : -1;
  else return null;
  for (let c = bc + dc, r = br + dr; c !== pc || r !== pr; c += dc, r += dr) if (TERRAIN[r][c] === "#") return null;
  const path: number[] = [];
  let c = bc, r = br;
  for (;;) {
    const nc = c + dc, nr = r + dr;
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) break;
    if (nc === pc && nr === pr) break;
    const t = TERRAIN[nr][nc];
    if (t === "#" || t === "~") break;
    if (layout.posts.some((p) => p[0] === nc && p[1] === nr)) break;
    const idx = nc + nr * COLS;
    if (state.some((s, i) => i !== pull.block && s === idx)) break;
    c = nc; r = nr;
    path.push(idx);
  }
  return path.length ? path : null;
}

/** Every pull that moves a block. A weight 3 block is skipped without Heavy Thread. */
export function legalPulls(state: LakeState, heavy: boolean, layout: LakeLayout = TEST_LAYOUT): LakePull[] {
  const out: LakePull[] = [];
  for (let b = 0; b < state.length; b++) {
    if (layout.blocks[b].weight === 3 && !heavy) continue;
    for (let p = 0; p < layout.posts.length; p++) if (pullCells(state, { block: b, post: p }, layout)) out.push({ block: b, post: p });
  }
  return out;
}

/** The state after the pull; the same state when the pull moves nothing. Weight is not checked here (see legalPulls). */
export function applyPull(state: LakeState, pull: LakePull, layout: LakeLayout = TEST_LAYOUT): LakeState {
  const path = pullCells(state, pull, layout);
  if (!path) return state;
  const next = state.slice();
  next[pull.block] = path[path.length - 1];
  return next;
}

/** Plate j is pressed when any block rests on its cell. */
export function platesPressed(state: LakeState, layout: LakeLayout = TEST_LAYOUT): boolean[] {
  return layout.plates.map((p) => state.includes(p[0] + p[1] * COLS));
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan and machine (pure, no THREE)
// ---------------------------------------------------------------------------------------------------------------------
const LEAVE_R = 120; // m from the tower; walking farther fails the trial
const IDLE_HINT = 90; // s without a pull before the hint toast
const TEXT_HEAVY = "Needs Heavy Thread.";
const TEXT_STUCK = "That block can't move that way.";

export const lakeBlockId = (i: number) => `lake:block-${i}`;
export const lakePostId = (i: number) => `lake:post-${i}`;

export type LakePartName = "teach" | "test" | "bonus";
export interface LakePart {
  name: LakePartName;
  rule: string;
  hint: string;
  layout: LakeLayout;
  /** Pulls the best solution needs (test: at most 6). */
  minPulls: number;
}
export interface LakePlan {
  cx: number; cz: number; // tower
  gx0: number; gz0: number; gx1: number; gz1: number;
  fy: number;
  cols: number; rows: number; cell: number;
  cellX: number[]; cellZ: number[];
  leaveR: number;
  teach: LakePart;
  test: LakePart;
  bonus: LakePart;
}

export function planLakeTrial(world: { heightAt(x: number, z: number): number }, cx: number, cz: number): LakePlan {
  const gx0 = cx - 19, gz0 = cz - 6;
  const cellX: number[] = [], cellZ: number[] = [];
  for (let c = 0; c < COLS; c++) cellX.push(gx0 + (c + 0.5) * CELL);
  for (let r = 0; r < ROWS; r++) cellZ.push(gz0 + (r + 0.5) * CELL);
  return {
    cx, cz, gx0, gz0, gx1: gx0 + COLS * CELL, gz1: gz0 + ROWS * CELL,
    fy: world.heightAt(gx0 + COLS, gz0 + ROWS),
    cols: COLS, rows: ROWS, cell: CELL, cellX, cellZ, leaveR: LEAVE_R,
    teach: { name: "teach", rule: "Thread the block, then the post.", hint: "Link the block to the post.", layout: TEACH_LAYOUT, minPulls: 1 },
    test: { name: "test", rule: "Put a block on all 3 plates.", hint: "Pull a block along a row toward a post.", layout: TEST_LAYOUT, minPulls: 5 },
    bonus: { name: "bonus", rule: "Pull the heavy block onto the plate.", hint: "Move the light block out of the way.", layout: BONUS_LAYOUT, minPulls: 2 },
  };
}

export type LakePhase = "idle" | "teach" | "test" | "bonus" | "done";
export interface LakeInput {
  player?: { x: number; z: number };
  pulls?: readonly { anchor: string; speed: number }[];
  heavy?: boolean;
}
export interface LakeOpts { heavy?: boolean; bonusDone?: boolean }
export interface LakeBlockSnap { id: string; x: number; z: number; cell: number; weight: 1 | 2 | 3; moving: boolean; enabled: boolean }
export interface LakeSnapshot {
  phase: LakePhase;
  part: LakePartName; // which layout is on the court
  pulls: number;
  plates: boolean[];
  count: number;
  moving: boolean;
  heavy: boolean;
  bonusPaid: boolean;
  state: number[];
  blocks: LakeBlockSnap[];
}
export interface LakeMachine {
  start(): GameEvent[];
  startBonus(): GameEvent[];
  step(input: LakeInput, dt: number): GameEvent[];
  onEvent(e: GameEvent): GameEvent[];
  reset(): GameEvent[];
  abort(): void;
  reload(solved: boolean): void;
  snapshot(): LakeSnapshot;
}

/** Bonus ids already paid out this session (the save keeps the pickup id too). */
export const lakeBonusPaid = new Set<string>();
const BONUS_ID = "lake-heavy";

export function createLakeMachine(plan: LakePlan, opts: LakeOpts = {}): LakeMachine {
  let phase: LakePhase = "idle";
  let part: LakePart = plan.teach;
  let state: number[] = [...startState(part.layout)];
  let plates: boolean[] = part.layout.plates.map(() => false);
  let pulls = 0, idle = 0, hinted = false;
  let heavy = opts.heavy === true;
  let paid = opts.bonusDone === true;
  let mv: { i: number; from: number; to: number; dist: number; got: number; speed: number } | null = null;

  const wx = (cell: number) => plan.cellX[cell % COLS];
  const wz = (cell: number) => plan.cellZ[(cell / COLS) | 0];
  const active = () => phase === "teach" || phase === "test" || phase === "bonus";
  const count = () => plates.reduce((n, p) => n + (p ? 1 : 0), 0);

  const load = (p: LakePart) => {
    part = p;
    state = [...startState(p.layout)];
    plates = p.layout.plates.map(() => false);
    mv = null;
    pulls = 0; idle = 0; hinted = false;
  };
  const hardIdle = () => {
    phase = "idle";
    load(plan.teach);
  };
  const showSolved = () => {
    part = plan.test;
    state = [...platesState(plan.test.layout)];
    plates = plan.test.layout.plates.map(() => true);
    mv = null;
    pulls = 0; idle = 0; hinted = false;
  };
  const rule = (p: LakePart): GameEvent => ({ type: "trialRule", trial: 2, text: p.rule });

  const settle = (out: GameEvent[]) => {
    const now = platesPressed(state, part.layout);
    let changed = false;
    for (let j = 0; j < now.length; j++) {
      if (now[j] === plates[j]) continue;
      plates[j] = now[j];
      changed = true;
      out.push({ type: "plate", id: `plate-${j}`, on: now[j] });
    }
    if (changed && part.name !== "bonus") out.push({ type: "trialProgress", beacon: 2, value: count(), total: plates.length });
  };

  const arrive = (out: GameEvent[]) => {
    if (!mv) return;
    const m = mv;
    mv = null;
    state[m.i] = m.to;
    out.push({ type: "blockMove", id: `block-${m.i}`, pos: { x: wx(m.to), y: plan.fy, z: wz(m.to) } });
    settle(out);
    if (phase === "teach" && count() === plates.length) {
      for (let j = 0; j < plates.length; j++) out.push({ type: "plate", id: `plate-${j}`, on: false });
      phase = "test";
      load(plan.test);
      out.push(rule(plan.test));
    } else if (phase === "test" && count() === plates.length) {
      heavy = true;
      phase = "done";
      out.push({ type: "power", power: "heavy" }, { type: "memory", beacon: 2 }, { type: "trialDone", beacon: 2 });
    } else if (phase === "bonus" && count() === plates.length) {
      const pl = plan.bonus.layout.plates[0];
      phase = "done";
      if (!paid && !lakeBonusPaid.has(BONUS_ID)) {
        paid = true;
        lakeBonusPaid.add(BONUS_ID);
        out.push({ type: "pickup", kind: "glimmer", amount: 50, pos: { x: plan.cellX[pl[0]], y: plan.fy + 1, z: plan.cellZ[pl[1]] }, id: BONUS_ID });
      }
      out.push({ type: "toast", text: "Heavy block on the plate." });
    }
  };

  const link = (e: Extract<GameEvent, { type: "threadLink" }>): GameEvent[] => {
    if (!active() || mv) return [];
    const ids = [e.a, e.b];
    let block = -1, post = -1;
    for (const id of ids) {
      const b = /^lake:block-(\d+)$/.exec(id), p = /^lake:post-(\d+)$/.exec(id);
      if (b) block = +b[1];
      if (p) post = +p[1];
    }
    if (block < 0 || post < 0 || block >= state.length || post >= part.layout.posts.length) return [];
    const def = part.layout.blocks[block];
    if (def.weight === 3 && !heavy) return [{ type: "toast", text: TEXT_HEAVY }];
    const path = pullCells(state, { block, post }, part.layout);
    if (!path) return [{ type: "toast", text: TEXT_STUCK }];
    const to = path[path.length - 1];
    mv = { i: block, from: state[block], to, dist: path.length * CELL, got: 0, speed: THREAD.pullSpeed[def.weight - 1] };
    pulls++;
    idle = 0;
    return [];
  };

  const resetPart = (): GameEvent[] => {
    const out: GameEvent[] = [];
    const start = startState(part.layout);
    mv = null;
    for (let i = 0; i < state.length; i++) {
      if (state[i] !== start[i]) out.push({ type: "blockMove", id: `block-${i}`, pos: { x: wx(start[i]), y: plan.fy, z: wz(start[i]) } });
    }
    state = [...start];
    settle(out);
    pulls = 0; idle = 0; hinted = false;
    return out;
  };

  const leave = (): GameEvent[] => {
    if (phase === "bonus") {
      phase = "done";
      showSolved();
      return [];
    }
    hardIdle();
    return [{ type: "trialFail", beacon: 2 }];
  };

  return {
    start() {
      if (phase !== "idle") return [];
      phase = "teach";
      load(plan.teach);
      return [{ type: "trialStart", beacon: 2 }, rule(plan.teach)];
    },
    startBonus() {
      if (phase !== "done") return [];
      phase = "bonus";
      load(plan.bonus);
      return [rule(plan.bonus)];
    },
    step(input, dt) {
      const out: GameEvent[] = [];
      if (input.heavy !== undefined) heavy = input.heavy || heavy;
      if (!active()) return out;
      const p = input.player;
      if (p && Math.hypot(p.x - plan.cx, p.z - plan.cz) > plan.leaveR) return leave();
      if (mv) {
        const m = mv;
        const fed = input.pulls?.find((q) => q.anchor === lakeBlockId(m.i));
        if (fed && fed.speed > 0) m.speed = fed.speed;
        m.got += m.speed * dt;
        if (m.got >= m.dist) arrive(out);
        return out;
      }
      idle += dt;
      if (!hinted && idle >= IDLE_HINT) {
        hinted = true;
        out.push({ type: "toast", text: part.hint });
      }
      return out;
    },
    onEvent(e) {
      if (e.type === "threadLink") return e.use === "pull" ? link(e) : [];
      if (e.type === "power" && e.power === "heavy") heavy = true;
      if (e.type === "died" || e.type === "respawned") {
        if (phase === "bonus") {
          phase = "done";
          showSolved();
        } else if (phase === "teach" || phase === "test") hardIdle();
      }
      return [];
    },
    reset() {
      return active() ? resetPart() : [];
    },
    abort() {
      hardIdle();
    },
    reload(solved) {
      if (solved) {
        phase = "done";
        showSolved();
      } else hardIdle();
    },
    snapshot() {
      const blocks: LakeBlockSnap[] = [];
      for (let i = 0; i < state.length; i++) {
        let x = wx(state[i]), z = wz(state[i]);
        const m = mv && mv.i === i ? mv : null;
        if (m) {
          const t = Math.min(1, m.got / m.dist);
          x = lerp(wx(m.from), wx(m.to), t);
          z = lerp(wz(m.from), wz(m.to), t);
        }
        blocks.push({ id: lakeBlockId(i), x, z, cell: state[i], weight: part.layout.blocks[i].weight, moving: !!m, enabled: true });
      }
      return { phase, part: part.name, pulls, plates: [...plates], count: count(), moving: !!mv, heavy, bonusPaid: paid || lakeBonusPaid.has(BONUS_ID), state: [...state], blocks };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------------------------------------------------------------
const ENTRY_COL = LAKE_MODEL.entryCol;
const SINK = -0.38;
const DEPTH = -0.4; // water floor below the court
const STEPS = 10;
const STEP_GAP = 0.12, STEP_DUR = 0.7;
const STAIR_TOTAL = (STEPS - 1) * STEP_GAP + STEP_DUR;
const GATE_T = 0.9;
const MAX_BLOCKS = 3, MAX_POSTS = 4, MAX_PLATES = 4;

export function buildLakeTrial(env: SiteEnv, tower: BeaconTower, _sky: THREE.Group): TrialHandle {
  const { world, look, group } = env;
  const reg = env.reg as Registry & Partial<SiteRegistryV2>;
  const plan = planLakeTrial(world, tower.cx, tower.cz);
  const machine = createLakeMachine(plan);
  const R = rng(3302);
  const { gx0, gz0, gx1, gz1, fy } = plan;
  const X = (c: number) => plan.cellX[c];
  const Z = (r: number) => plan.cellZ[r];
  const terrain = (c: number, r: number) => TERRAIN[r][c];
  const wc = LAKE_MODEL.pool;

  const stone = new Mesher(301), moss = new Mesher(302);
  const commit = (m: Mesher, name: string, mat?: THREE.Material) => {
    if (m.empty) return null;
    const mesh = m.build(look, mat, name);
    env.own(mesh.geometry);
    group.add(mesh);
    return mesh;
  };

  const parkY = fy - 60;
  const floorCols = [PAL.rock, PAL.rockHi, PAL.mist, PAL.rockLo];
  const inlay = new Mesher(303);
  const padMesh = new Mesher(304);
  const wetCells: LakeCell[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = X(c), z = Z(r);
      const t = terrain(c, r);
      const y0 = groundMin(world, x, z, 1, 1) - 0.5;
      const wet = t === "~" || t === "o";
      const top = wet ? fy + DEPTH : fy + 0.05;
      stone.box(x, y0, z, 1.96, top - y0, 1.96, t === "p" || wet ? PAL.teal : floorCols[Math.floor(R() * 4)], 0, { ao: 0.05 });
      if (wet) {
        wetCells.push([c, r]);
        if (t === "~") world.addBox({ minX: x - 0.98, maxX: x + 0.98, minZ: z - 0.98, maxZ: z + 0.98, minY: fy + DEPTH, maxY: fy + 1.2, tag: "decor", owner: `landmarks:lake-water-${c}-${r}` });
        else {
          padMesh.box(x, fy - 0.1, z, 1.5, 0.15, 1.5, PAL.rockHi, 0, { ao: 0.1 });
          padMesh.box(x, fy + 0.05, z, 1.2, 0.02, 1.2, PAL.mossHi, 0, { ao: 0, jit: 0 });
          padMesh.ball(x + 0.55, fy + 0.07, z - 0.5, 0.2, PAL.goldHi, 1, 0);
          world.addBox({ minX: x - 0.75, maxX: x + 0.75, minZ: z - 0.75, maxZ: z + 0.75, minY: fy + DEPTH, maxY: fy + 0.05, tag: "solid", owner: `landmarks:lake-float-${c}-${r}` });
        }
        continue;
      }
      if (R() < 0.4 && t !== "p") stone.box(x + (R() - 0.5) * 0.5, fy + 0.05, z + (R() - 0.5) * 0.5, 0.9 + R() * 0.6, 0.012, 0.05, PAL.ashLo, R() * Math.PI, { jit: 0, ao: 0 });
      if (R() < 0.3 && t !== "#" && t !== "p") moss.ball(x + (R() - 0.5) * 1.3, fy + 0.05, z + (R() - 0.5) * 1.3, 0.22 + R() * 0.2, R() < 0.5 ? PAL.moss : PAL.mossHi, 0.25, 0);
    }
  }
  inlay.box((gx0 + gx1) / 2, fy + 0.05, gz0 + 0.18, COLS * CELL - 0.4, 0.012, 0.09, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box((gx0 + gx1) / 2, fy + 0.05, gz1 - 0.18, COLS * CELL - 0.4, 0.012, 0.09, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box(gx0 + 0.18, fy + 0.05, (gz0 + gz1) / 2, 0.09, 0.012, ROWS * CELL - 0.4, PAL.gold, 0, { ao: 0, jit: 0 });
  inlay.box(gx1 - 0.18, fy + 0.05, (gz0 + gz1) / 2, 0.09, 0.012, ROWS * CELL - 0.4, PAL.gold, 0, { ao: 0, jit: 0 });

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
  for (const [c, r] of cellsOf("#")) {
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
  const plateCol: number[] = [];
  for (let j = 0; j < MAX_PLATES; j++) {
    const m = new THREE.Mesh(plateGeo, dimMat);
    m.visible = false;
    group.add(m);
    plateMesh.push(m);
    plateCol.push(world.addBox({ minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: parkY, maxY: parkY + 0.1, tag: "plate", owner: `landmarks:plate-${j}` }));
  }

  const pm = new Mesher(305);
  pm.box(0, 0, 0, 0.5, 1.25, 0.5, PAL.rockHi, 0, { ao: 0.12 });
  pm.box(0, 1.25, 0, 0.62, 0.1, 0.62, PAL.rock, 0, { ao: 0 });
  const postProto = pm.build(look, undefined, "lake-post");
  env.own(postProto.geometry);
  const ringGeoP = env.own(new THREE.TorusGeometry(0.3, 0.06, 8, 18));
  const ringMatP = glowMat(look, PAL.goldHi, 1.1);
  const postGroup: THREE.Group[] = [];
  const postCol: number[] = [];
  for (let j = 0; j < MAX_POSTS; j++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(postProto.geometry, postProto.material);
    body.castShadow = true;
    const ring = new THREE.Mesh(ringGeoP, ringMatP);
    ring.position.set(0, 0.95, 0.27);
    g.add(body, ring);
    g.visible = false;
    group.add(g);
    postGroup.push(g);
    postCol.push(world.addBox({ minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.5, minY: parkY, maxY: parkY + 1, tag: "knot", owner: `landmarks:lake-post-${j}` }));
  }

  commit(stone, "lake-court");
  commit(moss, "lake-moss");
  commit(inlay, "lake-inlay");
  commit(padMesh, "lake-floats");

  const waterGeo = env.own(new THREE.PlaneGeometry(1.96, 1.96).rotateX(-Math.PI / 2));
  const waterMat = look.toon({ color: PAL.water, emissive: PAL.water, emissiveIntensity: 0.3, transparent: true, opacity: 0.55, rim: 0.6 });
  const pool = new THREE.Mesh(waterGeo, waterMat);
  pool.position.set(wx, fy + 0.32, wz);
  pool.scale.setScalar(0.92);
  pool.renderOrder = 2;
  group.add(pool);
  for (const [c, r] of wetCells) {
    const w = new THREE.Mesh(waterGeo, waterMat);
    w.position.set(X(c), fy - 0.12, Z(r));
    w.renderOrder = 2;
    group.add(w);
  }
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

  const mkBlock = (seed: number, heavyBlock: boolean) => {
    const bm = new Mesher(seed);
    const body = heavyBlock ? PAL.rockLo : PAL.rock;
    bm.box(0, 0, 0, 1.94, 1.94, 1.94, body, 0, { ao: 0.18 });
    bm.box(0, 1.9, 0, 1.7, 0.08, 1.7, heavyBlock ? PAL.rock : PAL.rockHi, 0, { ao: 0 });
    bm.box(0, 1.97, 0, 1.3, 0.02, 0.1, PAL.gold, 0, { ao: 0, jit: 0 });
    bm.box(0, 1.97, 0, 0.1, 0.02, 1.3, PAL.gold, 0, { ao: 0, jit: 0 });
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      bm.box(dx * 0.97, 0.3, dz * 0.97, k % 2 ? 0.1 : 0.12, 1.2, k % 2 ? 0.12 : 0.1, PAL.gold, 0, { ao: 0, jit: 0 });
      bm.box(dx * 0.97, 0.88, dz * 0.97, k % 2 ? 0.12 : 0.5, 0.14, k % 2 ? 0.5 : 0.12, PAL.goldHi, 0, { ao: 0, jit: 0 });
      if (heavyBlock) bm.box(dx * 0.98, 1.5, dz * 0.98, k % 2 ? 0.14 : 0.9, 0.2, k % 2 ? 0.9 : 0.14, PAL.goldHi, 0, { ao: 0, jit: 0 });
    }
    if (!heavyBlock) {
      bm.ball(0.55, 1.9, 0.45, 0.38, PAL.moss, 0.3, 0);
      bm.ball(-0.5, 1.9, -0.55, 0.3, PAL.mossHi, 0.3, 0);
    }
    const proto = bm.build(look, undefined, heavyBlock ? "lake-block-heavy" : "lake-block");
    env.own(proto.geometry);
    return proto;
  };
  const lightProto = mkBlock(310, false), heavyProto = mkBlock(311, true);
  const blockMesh: THREE.Mesh[] = [];
  const blockCol: number[] = [];
  const bx = [NaN, NaN, NaN], bz = [NaN, NaN, NaN];
  for (let i = 0; i < MAX_BLOCKS; i++) {
    const m = new THREE.Mesh(lightProto.geometry, lightProto.material);
    m.castShadow = true;
    m.receiveShadow = true;
    m.visible = false;
    group.add(m);
    blockMesh.push(m);
    blockCol.push(world.addBox({ minX: 0, maxX: 1, minZ: 0, maxZ: 1, minY: parkY, maxY: parkY + 2, tag: "solid", owner: `landmarks:block-${i}` }));
  }

  const aim = new Map<string, ThreadAnchor>();
  const addAnchor = (a: ThreadAnchor) => {
    aim.set(a.id, reg.anchor ? reg.anchor(a) : a);
  };
  if (typeof reg.anchor === "function") {
    for (let i = 0; i < MAX_BLOCKS; i++) addAnchor({ id: lakeBlockId(i), kind: "block", pos: { x: 0, y: parkY, z: 0 }, weight: 1, lit: false, enabled: false });
    for (let j = 0; j < MAX_POSTS; j++) addAnchor({ id: lakePostId(j), kind: "knot", pos: { x: 0, y: parkY, z: 0 }, weight: 0, lit: false, enabled: false });
  }

  const setBlock = (i: number, x: number, z: number) => {
    bx[i] = x; bz[i] = z;
    const d = Math.hypot(x - wx, z - wz);
    const sink = SINK * Math.max(0, 1 - d / CELL);
    blockMesh[i].position.set(x, fy + 0.05 + sink, z);
    world.moveBox(blockCol[i], x - 0.99, fy, z - 0.99, x + 0.99, fy + 2.05, z + 0.99);
    const a = aim.get(lakeBlockId(i));
    if (a) { a.pos.x = x; a.pos.y = fy + 1 + sink; a.pos.z = z; }
  };

  let shown: LakePartName | "" = "";
  const layoutFor = (name: LakePartName) => (name === "teach" ? plan.teach : name === "test" ? plan.test : plan.bonus).layout;
  const showPart = (name: LakePartName) => {
    if (shown === name) return;
    shown = name;
    const L = layoutFor(name);
    for (let j = 0; j < MAX_PLATES; j++) {
      const p = L.plates[j];
      plateMesh[j].visible = !!p;
      if (p) {
        const x = X(p[0]), z = Z(p[1]);
        plateMesh[j].position.set(x, fy + 0.07, z);
        world.moveBox(plateCol[j], x - 0.75, fy, z - 0.75, x + 0.75, fy + 0.1, z + 0.75);
      } else world.moveBox(plateCol[j], 0, parkY, 0, 1, parkY + 0.1, 1);
    }
    for (let j = 0; j < MAX_POSTS; j++) {
      const p = L.posts[j];
      postGroup[j].visible = !!p;
      const a = aim.get(lakePostId(j));
      if (p) {
        const x = X(p[0]), z = Z(p[1]);
        postGroup[j].position.set(x, fy + 0.05, z);
        world.moveBox(postCol[j], x - 0.25, fy, z - 0.25, x + 0.25, fy + 1.3, z + 0.25);
        if (a) { a.pos.x = x; a.pos.y = fy + 1; a.pos.z = z; a.enabled = true; }
      } else {
        world.moveBox(postCol[j], 0, parkY, 0, 0.5, parkY + 1, 0.5);
        if (a) a.enabled = false;
      }
    }
    for (let i = 0; i < MAX_BLOCKS; i++) {
      const b = L.blocks[i];
      blockMesh[i].visible = !!b;
      const a = aim.get(lakeBlockId(i));
      if (b) {
        const proto = b.weight === 3 ? heavyProto : lightProto;
        bx[i] = NaN;
        blockMesh[i].geometry = proto.geometry;
        blockMesh[i].material = proto.material;
        if (a) { a.weight = b.weight; a.enabled = true; }
      } else {
        world.moveBox(blockCol[i], 0, parkY, 0, 1, parkY + 2, 1);
        if (a) a.enabled = false;
      }
    }
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
  const bonusX = gx0 + (ENTRY_COL - 2) * CELL - 0.5;
  const lv = new Mesher(330);
  lv.box(lx, fy - 0.3, lz, 0.7, 1.3, 0.5, PAL.rock);
  lv.box(lx, fy + 1.0, lz, 0.9, 0.12, 0.7, PAL.gold, 0, { ao: 0 });
  lv.box(bonusX, fy - 0.3, lz, 0.7, 1.3, 0.5, PAL.rockLo);
  lv.box(bonusX, fy + 1.0, lz, 0.9, 0.12, 0.7, PAL.goldHi, 0, { ao: 0 });
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
  let resetQ = false, bonusQ = false;

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

  reg.interact({
    id: "lever-lake", x: lx, y: fy + 1.2, z: lz, r: 2.4,
    label: () => (machine.snapshot().phase === "teach" || machine.snapshot().phase === "test" || machine.snapshot().phase === "bonus" ? "Reset blocks" : null),
    use: () => {
      resetQ = true;
      leverT = 0;
    },
  });
  reg.interact({
    id: "lever-lake-bonus", x: bonusX, y: fy + 1.2, z: lz, r: 2.4,
    label: () => (machine.snapshot().phase === "done" && !machine.snapshot().bonusPaid ? "Try the heavy block" : null),
    use: () => {
      bonusQ = true;
    },
  });

  const props: Prop[] = [];

  const apply = (snap: LakeSnapshot) => {
    showPart(snap.part);
    const L = layoutFor(snap.part);
    for (let j = 0; j < L.plates.length; j++) plateMesh[j].material = snap.plates[j] ? litMat : dimMat;
    for (let i = 0; i < L.blocks.length; i++) {
      const b = snap.blocks[i];
      if (b && (b.x !== bx[i] || b.z !== bz[i])) setBlock(i, b.x, b.z);
    }
  };
  apply(machine.snapshot());
  applyGate();

  const emitAll = (outs: GameEvent[], emit: Emit) => {
    for (const e of outs) {
      emit(e);
      if (e.type === "trialDone") {
        openGate();
        stairOn = true;
      }
    }
  };

  const handleObj: TrialHandle = {
    beacon: 2,
    get active() { const p = machine.snapshot().phase; return p === "teach" || p === "test"; },
    props,
    timeLeft: null,
    canStart: () => null,
    start(_ctx, emit) {
      emitAll(machine.start(), emit);
      apply(machine.snapshot());
    },
    update(ctx: FrameCtx, emit: Emit, near: boolean) {
      const dt = ctx.dt;
      const snap0 = machine.snapshot();
      const busy = snap0.moving || resetQ || bonusQ || leverT < 1 || (gateOpen && gateP < 1) || (stairOn && stairT < STAIR_TOTAL);
      if (!near && snap0.phase !== "teach" && snap0.phase !== "test" && !busy) return;

      if (resetQ) {
        resetQ = false;
        emitAll(machine.reset(), emit);
      }
      if (bonusQ) {
        bonusQ = false;
        emitAll(machine.startBonus(), emit);
      }
      const heavy = ctx.progress ? ctx.progress.powers.includes("heavy") : undefined;
      const p = ctx.player.pos;
      emitAll(machine.step({ player: { x: p.x, z: p.z }, pulls: ctx.threads?.pulls, heavy }, dt), emit);
      const snap = machine.snapshot();
      apply(snap);

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
          const q = (t * 0.45 + k / 3) % 1;
          rings[k].scale.setScalar(1 + q * 3.2);
          ringMats[k].opacity = (1 - q) * 0.45;
        }
      }
    },
    handle(e: GameEvent, emit: Emit) {
      if (e.type === "trialFail" && e.beacon === 2) {
        handleObj.abort();
        return;
      }
      emitAll(machine.onEvent(e), emit);
      if (e.type === "died" || e.type === "respawned" || e.type === "threadLink") apply(machine.snapshot());
    },
    abort() {
      const was = machine.snapshot().phase;
      machine.abort();
      if (was === "done" || was === "bonus") machine.reload(true);
      resetQ = false;
      bonusQ = false;
      leverT = 1;
      handle.rotation.z = -0.5;
      apply(machine.snapshot());
      if (was !== "done" && was !== "bonus") {
        stairOn = false;
        stairT = 0;
        stairApply();
        gateOpen = false;
        gateP = 0;
        if (gateId < 0) gateId = addGate();
        applyGate();
      }
    },
    solved(animated) {
      if (machine.snapshot().phase === "done" && animated) return;
      machine.reload(true);
      resetQ = false;
      bonusQ = false;
      openGate();
      stairOn = true;
      if (!animated) {
        gateP = 1;
        stairT = STAIR_TOTAL;
      }
      apply(machine.snapshot());
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
