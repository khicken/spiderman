import * as THREE from "three";
import type {
  Action, BallState, DifficultyPreset, Dir, DribbleMove, DunkStyle, GameEvent, GameState, MatchMode, MatchSetup,
  MeterGrade, PassKind, PlayerIntent, PlayerState, Settings, ShotInfo, ShotKind, StatLine, TeamRuntime, TeamSide, V3,
} from "./contracts";
import { ACTION_DUR, COURT } from "./contracts";

// Shared internals of the game sim. Owner: sim builder. Everything here is private to sim-*.ts.
// One Ctx per match holds all mutable state; the sim-* modules are plain functions over it.

// ---------------------------------------------------------------------------------------------------------------------
// Restarts: what happens when the current dead-ball pause ends
// ---------------------------------------------------------------------------------------------------------------------
export type Restart =
  | { k: "inbound"; team: TeamSide; x: number; z: number; afterMake: boolean; shotClock: number } // shotClock < 0: 24
  | { k: "ft"; shooter: number; total: 1 | 2 | 3 }
  | { k: "tip" }
  | { k: "nextPeriod" }
  | { k: "endPeriod" }
  | { k: "ftResume" }
  | { k: "inboundResume" }
  | { k: "practice" };

/** A shot in progress for one player (gather, meter, release). One per player, reused. */
export interface ShotPlan {
  on: boolean;
  kind: ShotKind;
  points: 1 | 2 | 3;
  minP: number; // earliest actionP at which the ball can leave the hand
  maxP: number; // forced release
  targetP: number; // center of the perfect window
  releaseP: number; // when the ball leaves the hand (set once decided)
  decided: boolean; // release moment chosen (user let go, or CPU auto)
  released: boolean;
  grade: MeterGrade;
  user: boolean; // the human is timing this shot
  startT: number;
  finish: THREE.Vector3; // floor point to finish a layup / dunk at
  from: THREE.Vector3; // floor point at the gather (for the gather glide)
  alley: boolean;
  style: DunkStyle | null;
  window: number; // perfect window as a fraction of the meter
  contest0: number; // contest when the gather started
}

/** Per-slot sim internals not exposed in PlayerState. */
export interface PlayerX {
  active: boolean; // on the court and in play (practice mode parks the away team)
  shot: ShotPlan;
  passing: boolean; // a pass is waiting for its release moment in the "pass"/"inbound" action
  passKind: PassKind;
  passTarget: number;
  burst: THREE.Vector3; // dribble move velocity impulse (decays)
  stealCd: number;
  blockCd: number;
  moveCd: number;
  chargeT: number; // take-charge stance window
  slowT: number; // shaken / screened
  squeakCd: number;
  bumpCd: number;
  screenCd: number;
  lastMove: DribbleMove | null;
  lastMoveT: number;
  catchT: number;
  catchFrom: number;
  dribbles: number; // dribbles since the catch (assists)
  offRebT: number; // time of the last offensive rebound (putbacks)
  spot: THREE.Vector3; // forced position (tip-off, free throws, inbound passer)
  spotOn: boolean;
  spotFace: number;
  jumpH: number; // peak foot height of the current jump action
  air: THREE.Vector3; // horizontal velocity kept while airborne
  streak: number; // +consecutive makes / -consecutive misses
  contestAt: number; // scheduled reflex jump (sim time), -1 none
  contestBlock: boolean; // scheduled reflex is a block (rim) rather than a contest
  blockShot: number; // shot id this player already tried to block
  interceptPass: number; // pass id this player already tried to intercept
  prevP: number;
  oopAt: number; // alley-oop: sim time to take off, -1 none
  heldT: number; // seconds holding the ball without dribbling
  spinBase: number;
  prevMoveT: number;
  screenT: number;
}

export interface Ctx {
  setup: MatchSetup;
  settings: Settings;
  diff: DifficultyPreset;
  mode: MatchMode;
  state: GameState;
  ball: BallState;
  players: PlayerState[];
  intents: PlayerIntent[];
  teams: [TeamRuntime, TeamRuntime];
  px: PlayerX[];
  userTeam: TeamSide | -1;
  userSlot: number;
  time: number;
  events: GameEvent[];
  pending: GameEvent[]; // emitted from control() between steps, flushed into the next step's events
  rng: () => number;

  // flow
  restart: Restart | null;
  afterTimeout: Restart | null;
  deadExtra: number; // extra wait while players walk to their spots
  tipT: number;
  tipTossed: boolean;
  tipWinner: TeamSide;
  tipJumpers: [number, number];
  tipLockT: number; // until ctx.time reaches this, only tipLockTeam may grab the tipped ball
  tipLockTeam: TeamSide;
  frontEstablished: boolean;
  reboundPending: boolean;
  reboundTeam: TeamSide; // team of the last missed shot
  shotId: number;
  passId: number;
  periodEndPending: boolean;
  shotClockExpired: boolean; // the shot clock ran out while a shot was in the air
  pendingFoul: { by: number; on: number; shots: 0 | 1 | 2 | 3 } | null;
  ftDelay: number; // countdown to the next free throw attempt
  ftWait: number; // seconds the shooter has been at the line without starting
  ftResolved: boolean;
  callForBall: number; // slot asking for the ball, -1
  callLob: boolean;
  passLoose: { passer: number; team: TeamSide; deflector: number } | null;
  pokeBy: number; // defender who poked the ball loose (steal credit when his team recovers)
  pokeFrom: number;
  looseT: number;
  shotResolved: boolean; // current shot already produced make/miss
  rimEvT: number;
  boardEvT: number;
  bounceEvT: number;
  crowdT: number;
  lastHypeRun: [number, number];
  inboundPassed: boolean;
  practiceT: number;
  lastPossession: TeamSide | -1;
  clockAtRelease: number; // game clock when the current shot was released (buzzer beaters)
  inbPasser: number;
  buzzed: boolean; // period horn already sounded (shot in the air at 0:00)
  net: { on: boolean; side: Dir };

  // ball scripting (made shots roll in, bank in, swish)
  seg: { on: boolean; i: number; n: number; left: number; pts: THREE.Vector3[]; dur: number[]; ev: (0 | 1 | 2)[] }; // ev: 0 none, 1 rim, 2 board
  shotObj: ShotInfo;
  passObj: NonNullable<BallState["pass"]>;
  bounceSeg: { on: boolean; left: number; end: THREE.Vector3; t2: number };
  prevBall: THREE.Vector3;
}

// ---------------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------------
export const G = COURT.gravity;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sideOf = (slot: number): TeamSide => (slot < 5 ? 0 : 1);
export const other = (t: TeamSide): TeamSide => (t === 0 ? 1 : 0);

export function v3(v: { x: number; y: number; z: number }): V3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

export function toast(ctx: Ctx, text: string, sub?: string, tone?: "home" | "away" | "neutral" | "hot"): void {
  ctx.events.push(sub === undefined ? { type: "toast", text, tone } : { type: "toast", text, sub, tone });
}

/** Rumble only for plays that involve the human's team. */
export function rumble(ctx: Ctx, slot: number, strong: number, weak: number, ms: number): void {
  if (ctx.userTeam === -1) return;
  if (slot >= 0 && sideOf(slot) !== ctx.userTeam) return;
  ctx.events.push({ type: "rumble", strong, weak, ms });
}

export function dirOf(ctx: Ctx, team: TeamSide): Dir {
  return ctx.state.attackDir[team];
}

export function rimX(dir: Dir): number {
  return dir * COURT.rimX;
}

/** Unit xz vector from p toward the basket its team attacks. */
export function toBasket(ctx: Ctx, p: PlayerState, out: THREE.Vector3): THREE.Vector3 {
  const d = dirOf(ctx, p.team);
  out.set(d * COURT.rimX - p.pos.x, 0, -p.pos.z);
  const l = Math.hypot(out.x, out.z);
  if (l > 1e-6) out.multiplyScalar(1 / l);
  else out.set(d, 0, 0);
  return out;
}

export function fwdOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** The holder's right-hand side in world xz (models face +z; their right is -x at yaw 0). */
export function rightOf(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
}

export function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Max foot height of a full jump (m) from the vertical rating. */
export function vertOf(p: PlayerState): number {
  return 0.45 + (clamp(p.data.ratings.vertical, 25, 99) - 25) * (0.5 / 74);
}

export function canDunk(p: PlayerState): boolean {
  return p.data.ratings.dunk >= 50 && p.reach + vertOf(p) >= COURT.rimHeight + 0.18;
}

export function boxOf(ctx: Ctx, p: PlayerState): StatLine {
  return ctx.teams[p.team].box[p.rosterIndex];
}

export function stat(ctx: Ctx, slot: number, key: keyof StatLine, n = 1): void {
  const p = ctx.players[slot];
  ctx.teams[p.team].box[p.rosterIndex][key] += n;
  ctx.teams[p.team].totals[key] += n;
}

export function isUser(ctx: Ctx, slot: number): boolean {
  return slot >= 0 && slot === ctx.userSlot;
}

export function onUserTeam(ctx: Ctx, slot: number): boolean {
  return ctx.userTeam !== -1 && sideOf(slot) === ctx.userTeam;
}

/** Additive make-probability bonus for a team from the difficulty table. CPU vs CPU is neutral. */
export function shotBonus(ctx: Ctx, team: TeamSide): number {
  if (ctx.userTeam === -1) return 0;
  return team === ctx.userTeam ? ctx.diff.userShot : ctx.diff.cpuShot;
}

export function stealMult(ctx: Ctx, team: TeamSide): number {
  if (ctx.userTeam === -1) return 1;
  return team === ctx.userTeam ? ctx.diff.userSteal : ctx.diff.cpuSteal;
}

/** Foul multiplier: difficulty foulRate applies to the human's defenders, CPU defenders use 1. */
export function foulMult(ctx: Ctx, defender: number): number {
  return onUserTeam(ctx, defender) ? ctx.diff.foulRate : 1;
}

export function setAction(ctx: Ctx, slot: number, a: Action, dur = ACTION_DUR[a]): void {
  const p = ctx.players[slot];
  p.action = a;
  p.actionT = 0;
  p.actionDur = dur;
  p.actionP = 0;
  ctx.px[slot].prevP = 0;
}

/** True while a one-shot action is playing (looping actions have actionDur 0). */
export function busy(p: PlayerState): boolean {
  return p.actionDur > 0 && p.actionT < p.actionDur;
}

export function isShotAction(a: Action): boolean {
  return a === "jumpShot" || a === "layup" || a === "dunk" || a === "floater" || a === "hook" || a === "freeThrow";
}

export function isMoveAction(a: Action): boolean {
  return a === "crossover" || a === "behindBack" || a === "spin" || a === "stepBack" || a === "hesitation" || a === "between";
}

export function isJumpAction(a: Action): boolean {
  return a === "jumpShot" || a === "layup" || a === "dunk" || a === "floater" || a === "hook" || a === "block" ||
    a === "contest" || a === "rebound" || a === "jumpBall";
}

/** Foot height for jump actions at progress P with peak H. */
export function airY(a: Action, P: number, H: number): number {
  let s0 = 0;
  let s1 = 0;
  switch (a) {
    case "jumpShot": s0 = 0.3; s1 = 0.95; break;
    case "layup": s0 = 0.38; s1 = 0.98; break;
    case "floater": s0 = 0.3; s1 = 0.9; break;
    case "hook": s0 = 0.32; s1 = 0.9; break;
    case "block": s0 = 0.12; s1 = 0.88; break;
    case "contest": s0 = 0.15; s1 = 0.85; break;
    case "rebound": s0 = 0.12; s1 = 0.85; break;
    case "jumpBall": s0 = 0.15; s1 = 0.85; break;
    case "dunk": {
      if (P <= 0.3) return 0;
      if (P < 0.55) return H * Math.sin(((P - 0.3) / 0.25) * Math.PI * 0.5);
      if (P < 0.8) return H * (1 - 0.1 * ((P - 0.55) / 0.25)); // hang on the rim
      const k = (P - 0.8) / 0.2;
      return Math.max(0, H * 0.9 * (1 - k * k));
    }
    default:
      return 0;
  }
  if (P <= s0 || P >= s1) return 0;
  return H * Math.sin((Math.PI * (P - s0)) / (s1 - s0));
}

/** Ballistic launch: velocity that carries `from` to `to` in T seconds under gravity. */
export function launchTime(from: THREE.Vector3, to: THREE.Vector3, T: number, outVel: THREE.Vector3): THREE.Vector3 {
  const t = Math.max(0.05, T);
  return outVel.set((to.x - from.x) / t, (to.y - from.y) / t + 0.5 * G * t, (to.z - from.z) / t);
}

/** Ballistic launch through an apex height; returns flight time to `to` (on the way down). */
export function launchApex(from: THREE.Vector3, to: THREE.Vector3, apexY: number, outVel: THREE.Vector3): number {
  const top = Math.max(apexY, Math.max(from.y, to.y) + 0.12);
  const vy = Math.sqrt(2 * G * (top - from.y));
  const disc = Math.max(0, vy * vy - 2 * G * (to.y - from.y));
  const T = (vy + Math.sqrt(disc)) / G;
  outVel.set((to.x - from.x) / T, vy, (to.z - from.z) / T);
  return T;
}

/** Exact constant-gravity integration of the ball over dt. */
export function integrate(pos: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
  pos.x += vel.x * dt;
  pos.z += vel.z * dt;
  pos.y += vel.y * dt - 0.5 * G * dt * dt;
  vel.y -= G * dt;
}

export function horizDist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Nearest active opponent of `slot` (by floor distance); -1 when none. */
export function nearestOpponent(ctx: Ctx, slot: number): number {
  const p = ctx.players[slot];
  let best = -1;
  let bd = 1e9;
  const base = p.team === 0 ? 5 : 0;
  for (let i = base; i < base + 5; i++) {
    if (!ctx.px[i].active) continue;
    const q = ctx.players[i];
    const d = horizDist(p.pos.x, p.pos.z, q.pos.x, q.pos.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Default man-to-man matchup when the AI has not set one: same lineup index on the other team. */
export function defaultMark(slot: number): number {
  return slot < 5 ? slot + 5 : slot - 5;
}

export function periodSeconds(settings: Settings, period: number): number {
  const q = clamp(Math.round(settings.quarterMinutes), 1, 12);
  if (period <= 4) return q * 60;
  return Math.max(1, Math.ceil((5 / 12) * q)) * 60;
}

export function teamName(ctx: Ctx, t: TeamSide): string {
  return ctx.teams[t].data.name;
}

export function toneOf(ctx: Ctx, t: TeamSide): "home" | "away" {
  return t === 0 ? "home" : "away";
}

export function lastName(ctx: Ctx, slot: number): string {
  return ctx.players[slot].data.last;
}
