import * as THREE from "three";
import type { Dir, PlayerIntent, PlayerState, Settings, Sim, TeamSide } from "./contracts";
import { COURT, DIFFICULTY } from "./contracts";

// HOOPS team AI: shared types, court spots in attack-relative coordinates, steering and geometry helpers.
// Owner: ai builder. No allocations in per-step code: every helper writes into caller-provided or module scratch.

// ---------------------------------------------------------------------------------------------------------------------
// Attack-relative frame. u = distance from the attacked basket toward midcourt along the court length (0 at the rim
// center, negative behind the rim, baseline at u = -BASE_GAP). v = world z (lateral). Side s = sign(v).
// ---------------------------------------------------------------------------------------------------------------------
export const BASE_GAP = COURT.halfL - COURT.rimX; // 1.6 m: rim center to baseline
export const HALF_U = COURT.rimX; // u of the midcourt line

export function toWorld(d: Dir, u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(d * (COURT.rimX - u), 0, v);
}
export function uOf(d: Dir, x: number): number {
  return COURT.rimX - x * d;
}

/** Named spacing spots (u, |v|). Side is applied at use. */
export const SPOT = {
  top: [7.95, 0],
  slot: [7.45, 3.2],
  wing: [4.7, 6.25],
  corner: [0.35, 7.12],
  dunker: [0.05, 3.0],
  elbow: [3.9, 2.85], // just outside the lane line (half-width 2.44), so bigs parked here do not pick up 3 seconds
  block: [1.0, 2.75],
  highPost: [4.9, 0],
  rim: [0.55, 0],
  short: [0.7, 4.9],
  midWing: [3.4, 4.7],
  safety: [12.2, 0],
} as const;
export type SpotName = keyof typeof SPOT;

export function spot(d: Dir, name: SpotName, side: number, out: THREE.Vector3): THREE.Vector3 {
  const s = SPOT[name];
  return toWorld(d, s[0], s[1] * (side < 0 ? -1 : 1), out);
}

/** Spacing candidates for the off-ball solver: name and side. */
export const SPACING: readonly { name: SpotName; side: number; big: number; shooter: number }[] = [
  { name: "corner", side: -1, big: -2, shooter: 3 },
  { name: "corner", side: 1, big: -2, shooter: 3 },
  { name: "wing", side: -1, big: -1, shooter: 2 },
  { name: "wing", side: 1, big: -1, shooter: 2 },
  { name: "slot", side: -1, big: -1, shooter: 1.5 },
  { name: "slot", side: 1, big: -1, shooter: 1.5 },
  { name: "top", side: 0, big: -1.5, shooter: 1 },
  { name: "dunker", side: -1, big: 3, shooter: -2 },
  { name: "dunker", side: 1, big: 3, shooter: -2 },
  { name: "elbow", side: -1, big: 1.5, shooter: -0.5 },
  { name: "elbow", side: 1, big: 1.5, shooter: -0.5 },
];

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------
export type PlayKind =
  | "none" | "fastBreak" | "early" | "pnr" | "sidePnr" | "horns" | "motion" | "iso" | "post" | "lastShot"
  | "userFree" | "userScreen" | "inbound" | "hold";

export const PLAY_LABEL: Record<PlayKind, string | null> = {
  none: null,
  fastBreak: "Fast break",
  early: "Early offense",
  pnr: "High pick and roll",
  sidePnr: "Side pick and roll",
  horns: "Horns",
  motion: "Motion",
  iso: "Isolation",
  post: "Post up",
  lastShot: "Last shot",
  userFree: null,
  userScreen: "Ball screen",
  inbound: "Inbound",
  hold: "Run the clock",
};

export type Role =
  | "handler" | "space" | "screen" | "roll" | "pop" | "cut" | "post" | "fill" | "rimRun" | "trail" | "safety"
  | "offScreen" | "curl" | "crash" | "getBack" | "inbound" | "receive" | "lane" | "idle";

/** Per-slot memory. Preallocated once. */
export interface SlotMem {
  slot: number;
  target: THREE.Vector3;
  face: THREE.Vector3;
  faceOn: boolean;
  urgency: number; // 0..1, sprint above 0.72
  tight: boolean; // tight arrival (defense)
  role: Role;
  roleT: number; // seconds in role
  spotIdx: number; // SPACING index or -1
  spotT: number; // time until the spacing solver may move this player again
  // ball handler
  think: number; // seconds until the next decision
  holdT: number; // seconds holding the ball this possession touch
  catchT: number; // seconds since catch
  driving: boolean;
  driveSide: number;
  driveT: number;
  moveCd: number; // dribble move cooldown
  combo: "none" | "shoot" | "drive" | "pass";
  comboT: number;
  comboTarget: number;
  shooting: boolean;
  shootT: number;
  releaseAt: number; // meter fill at which to release
  fakeT: number;
  passCd: number;
  // defense
  helping: boolean;
  helpT: number;
  closeT: number; // closeout delay (counts down; <0 means active)
  closeActive: number; // seconds left of closeout sprint
  contestT: number; // seconds until contest reaction fires (-1 idle)
  contestOn: number; // seconds left of contest stance
  blockPlan: boolean;
  stealCd: number;
  chargeCd: number;
  jumpCd: number;
  doubleT: number; // seconds left of a double team
  dropT: number; // seconds left of drop coverage on a ball screen
  gambleT: number; // seconds left of jumping a passing lane
  gamble: THREE.Vector3;
  // misc
  routineT: number; // free throw / inbound routine timer
  cutT: number; // seconds left of an off-ball cut
  lastHad: boolean;
  onSince: number; // sim time the current player entered (subs)
  lastId: string;
}

export function newSlotMem(slot: number): SlotMem {
  return {
    slot, target: new THREE.Vector3(), face: new THREE.Vector3(), faceOn: false, urgency: 0, tight: false,
    role: "idle", roleT: 0, spotIdx: -1, spotT: 0,
    think: 0, holdT: 0, catchT: 99, driving: false, driveSide: 1, driveT: 0, moveCd: 0, combo: "none", comboT: 0,
    comboTarget: -1, shooting: false, shootT: 0, releaseAt: 0.85, fakeT: 0, passCd: 0,
    helping: false, helpT: 0, closeT: -1, closeActive: 0, contestT: -1, contestOn: 0, blockPlan: false, stealCd: 1,
    chargeCd: 2, jumpCd: 0, doubleT: 0, dropT: 0, gambleT: 0, gamble: new THREE.Vector3(),
    routineT: 0, cutT: 0, lastHad: false, onSince: 0, lastId: "",
  };
}

export interface TeamBrain {
  side: TeamSide;
  cpu: boolean; // true when no human plays on this team
  iq: number; // 0..1 decision quality
  reaction: number; // seconds
  // offense
  play: PlayKind;
  playT: number;
  phase: number;
  playSide: number; // ±1 lateral side the play runs toward
  star: number; // slot of the go-to scorer on the floor
  handler: number; // slot that is supposed to run the play
  screener: number; // slot setting the ball screen, -1 none
  screenFor: number;
  screenSpot: THREE.Vector3;
  screenSet: boolean;
  screenT: number;
  screenUsed: boolean;
  offScreener: number; // off-ball screener (motion)
  offTarget: number; // player getting the off-ball screen
  postSlot: number;
  motionT: number;
  transition: number; // seconds left of transition offense
  possT: number; // seconds since this team got the ball
  lastPlay: PlayKind;
  afterTimeout: boolean;
  lobCd: number; // seconds until the CPU looks for another lob (alley-oops are a rare treat)
  // defense
  marks: number[]; // per own k (0..4): opponent slot guarded
  coverage: "switch" | "drop";
  perceived: THREE.Vector3[]; // perceived positions of all 10 players (this team's eyes)
  perceivedBall: THREE.Vector3;
  helper: number; // slot currently helping, -1
  doubler: number; // slot doubling, -1
  matchT: number;
  press: boolean;
  foulMode: boolean;
  lastHolder: number;
  // coach
  subT: number;
  subBudget: number;
  gassedPeriod: number;
  toCd: number;
  runAtTO: number;
  toThisPossession: boolean;
}

export function newTeamBrain(side: TeamSide): TeamBrain {
  return {
    side, cpu: true, iq: 0.7, reaction: 0.2,
    play: "none", playT: 0, phase: 0, playSide: 1, star: side * 5, handler: side * 5, screener: -1, screenFor: -1,
    screenSpot: new THREE.Vector3(), screenSet: false, screenT: 0, screenUsed: false, offScreener: -1, offTarget: -1,
    postSlot: -1, motionT: 0, transition: 0, possT: 0, lastPlay: "none", afterTimeout: false, lobCd: 60 + side * 40,
    marks: [0, 1, 2, 3, 4].map((k) => (1 - side) * 5 + k), coverage: "switch",
    perceived: Array.from({ length: 10 }, () => new THREE.Vector3()), perceivedBall: new THREE.Vector3(),
    helper: -1, doubler: -1, matchT: 0, press: false, foulMode: false, lastHolder: -1,
    subT: 2 + side, subBudget: 2, gassedPeriod: 0, toCd: 0, runAtTO: 0, toThisPossession: false,
  };
}

/** Counters for lab pages and tests (cheap increments, never read by gameplay). */
export const AI_DEBUG: Record<string, number> = {};
export function dbg(key: string): void {
  AI_DEBUG[key] = (AI_DEBUG[key] ?? 0) + 1;
}

/** Teammate AI on the human's team plays at a fixed, solid level regardless of difficulty. */
export const TEAMMATE = { iq: 0.8, reaction: 0.18 };

export function brainSkill(b: TeamBrain, s: Settings, userTeam: TeamSide | -1): void {
  const d = DIFFICULTY[s.difficulty];
  b.cpu = userTeam !== b.side;
  if (b.cpu) {
    b.iq = d.cpuIQ;
    b.reaction = d.cpuReaction;
  } else {
    b.iq = TEAMMATE.iq;
    b.reaction = TEAMMATE.reaction;
  }
}

/** Everything a sub-module needs, built once in createAI. */
export interface Ctx {
  sim: Sim;
  settings: Settings;
  mem: SlotMem[];
  brains: [TeamBrain, TeamBrain];
  dt: number;
  time: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Math helpers (allocation free)
// ---------------------------------------------------------------------------------------------------------------------
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** AI random source. createAI seeds it from the sim seed, so a seeded game replays the same way. */
let aiRng: () => number = Math.random;
export function setAiRng(fn: () => number): void {
  aiRng = fn;
}
export function aiRandom(): number {
  return aiRng();
}
export const rand = (a: number, b: number) => a + aiRng() * (b - a);
/** Roughly normal noise, mean 0, sd ~1. */
export function gauss(): number {
  return (aiRng() + aiRng() + aiRng() + aiRng() - 2) * 1.732;
}
export function chance(p: number): boolean {
  return aiRng() < p;
}
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
/** Distance from point P to segment AB in xz, and the parameter t along it via out[0]. */
const segT = [0];
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number, tOut = segT): number {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  let t = l2 > 1e-6 ? ((px - ax) * abx + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  tOut[0] = t;
  return dist2(px, pz, ax + abx * t, az + abz * t);
}

/** Keep a target inside the court with a margin. */
export function keepIn(v: THREE.Vector3, margin = 0.35): THREE.Vector3 {
  v.x = clamp(v.x, -COURT.halfL + margin, COURT.halfL - margin);
  v.z = clamp(v.z, -COURT.halfW + margin, COURT.halfW - margin);
  v.y = 0;
  return v;
}

export function rimFloor(d: Dir, out: THREE.Vector3): THREE.Vector3 {
  return out.set(d * COURT.rimX, 0, 0);
}

export const isBig = (p: PlayerState) => p.data.pos === "C" || p.data.pos === "PF";
export const isGuard = (p: PlayerState) => p.data.pos === "PG" || p.data.pos === "SG";

/** Player tendency numbers derived from ratings, 0..1. */
export function shooter3(p: PlayerState): number {
  return clamp((p.data.ratings.three - 58) / 32, 0, 1);
}
export function slasher(p: PlayerState): number {
  const r = p.data.ratings;
  return clamp(((r.layup + r.dunk) * 0.5 + r.speed * 0.3 + r.handle * 0.2 - 55) / 40, 0, 1);
}
export function creator(p: PlayerState): number {
  const r = p.data.ratings;
  return clamp(((r.handle + r.passing) * 0.5 - 50) / 40, 0, 1);
}
export function lobThreat(p: PlayerState): number {
  const r = p.data.ratings;
  return clamp(((r.dunk + r.vertical) * 0.5 - 60) / 30, 0, 1);
}
/** Offensive "go-to" value for star selection. */
export function scorerValue(p: PlayerState): number {
  const r = p.data.ratings;
  const s = p.data.season;
  return r.overall * 1.0 + s.ppg * 0.9 + Math.max(r.three, r.mid, r.close) * 0.15 + p.onFire * 8 + p.stamina * 4;
}

// ---------------------------------------------------------------------------------------------------------------------
// Steering: write intent.move / sprint / faceTarget from mem.target
// ---------------------------------------------------------------------------------------------------------------------
const sv = new THREE.Vector3();

export function steer(p: PlayerState, it: PlayerIntent, m: SlotMem, mates: readonly PlayerState[] | null): void {
  sv.subVectors(m.target, p.pos).setY(0);
  const d = sv.length();
  const dead = m.tight ? 0.06 : 0.16;
  const slowR = m.tight ? 0.55 : 1.4;
  if (d < dead) {
    sv.set(0, 0, 0);
  } else {
    const speed = clamp(d / slowR, 0, 1) * clamp(0.55 + m.urgency * 0.6, 0.35, 1);
    sv.multiplyScalar(speed / d);
  }
  // light separation from teammates so off-ball players never stack (sim resolves real collisions)
  if (mates) {
    for (const q of mates) {
      if (q.slot === p.slot || q.team !== p.team) continue;
      const dx = p.pos.x - q.pos.x;
      const dz = p.pos.z - q.pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < 1.6 && dd > 1e-4) {
        const k = (1.6 - dd) * 0.35;
        const inv = 1 / Math.sqrt(dd);
        sv.x += dx * inv * k;
        sv.z += dz * inv * k;
      }
    }
  }
  const l = sv.length();
  if (l > 1) sv.multiplyScalar(1 / l);
  it.move.copy(sv);
  const tired = p.stamina < 0.22;
  it.sprint = m.urgency > 0.72 && d > 1.4 && !tired ? 1 : 0;
  it.faceTarget = m.faceOn ? m.face : null;
}

/** Time for a ball in free flight to fall to height h (s), -1 if it never gets that low. */
export function timeToHeight(y: number, vy: number, h: number): number {
  const g = COURT.gravity;
  const disc = vy * vy + 2 * g * (y - h);
  if (disc < 0) return -1;
  return (vy + Math.sqrt(disc)) / g;
}
