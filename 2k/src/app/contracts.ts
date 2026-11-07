import type * as THREE from "three";
import type { PlayerData, Position, TeamData } from "./data/types";

// =====================================================================================================================
// HOOPS: module contracts. Every builder implements its part exactly as written here.
// This file is frozen for builders. Need something extra? Export it from your own file as an `XPlus` type.
//
// UNITS: meters, seconds, radians, kg. +y is up. Floor is y = 0.
// WORLD: origin at center court on the floor. The court's LENGTH runs along x (baskets at x = ±COURT.rimX),
//        its WIDTH runs along z (sidelines at z = ±COURT.halfW).
//        The main broadcast camera sits on the -z side, looking toward +z. So on screen +x is right, +z is "up/away".
//        The team benches and the scorer's table are on the -z sideline (near side, under the camera).
// YAW:   facing angle around +y. Facing direction = (sin(yaw), 0, cos(yaw)), the three.js convention where
//        object.rotation.y = yaw turns local +z toward that direction. Models face local +z.
// SLOTS: the 10 players on the floor have a fixed slot index 0..9. Team 0 (home) uses slots 0..4, team 1 (away) uses
//        5..9. Within a team, slot order is the lineup order PG, SG, SF, PF, C at tip-off. A substitution keeps the slot
//        and swaps the PlayerData in it (PlayerState.data / rosterIndex change).
// TEAMS: TeamSide 0 = home, 1 = away.
// TIME:  the sim runs at a fixed SIM_DT. game.ts owns the single requestAnimationFrame loop.
// ALLOC: no allocations inside update/step/sync paths. Preallocate. GameEvent objects are the only exception
//        (they are rare); events arrays returned from step() are reused by the owner and only valid until the next call.
// =====================================================================================================================

export type { PlayerData, Position, TeamData };

export type TeamSide = 0 | 1;
export type Dir = 1 | -1; // attack direction along x: +1 attacks the basket at +COURT.rimX
export type V3 = { x: number; y: number; z: number }; // THREE.Vector3 satisfies this. Event payloads use plain copies.

export const SIM_DT = 1 / 120; // fixed sim step (s). game.ts runs up to 8 steps per frame.
export const MAX_FRAME_DT = 1 / 30; // frame time clamp
export const HUD_HZ = 10; // HudSnapshot push rate

// ---------------------------------------------------------------------------------------------------------------------
// Court geometry. Official pro court: 94 x 50 ft, 10 ft rim. All values in meters.
// ---------------------------------------------------------------------------------------------------------------------
export const FT = 0.3048;
export const IN = 0.0254;

export const COURT = {
  length: 94 * FT, // 28.6512
  width: 50 * FT, // 15.24
  halfL: 47 * FT, // 14.3256, baselines at x = ±halfL
  halfW: 25 * FT, // 7.62, sidelines at z = ±halfW
  lineW: 2 * IN, // painted line width, lines are drawn INSIDE the playing area measurement
  apron: 6 * FT, // out-of-bounds floor around the court before the first row / bench
  // basket and backboard
  rimHeight: 10 * FT, // 3.048, top of rim
  rimX: 41.75 * FT, // 12.7254, |x| of the basket center (5.25 ft in from the baseline)
  rimRadius: 9 * IN, // 0.2286, inner radius (18 in diameter)
  rimTube: 0.3125 * IN, // 0.0079, radius of the rim's steel ring
  rimToBoard: 6 * IN, // gap from the rim's inner edge to the backboard face
  boardX: 43 * FT, // 13.1064, |x| of the backboard FACE (4 ft in from the baseline)
  boardThick: 0.05,
  boardW: 6 * FT, // 1.8288 (along z)
  boardH: 3.5 * FT, // 1.0668
  boardBottom: 9.5 * FT, // 2.8956, lower edge height
  boxW: 2 * FT, // inner shooter's square, 24 in wide
  boxH: 1.5 * FT, // 18 in tall, its bottom edge is level with the rim top
  netLength: 18 * IN, // 0.4572
  netBottomRadius: 5.5 * IN, // net narrows toward the bottom
  stanchionX: 47 * FT + 4 * FT, // |x| of the padded base behind the baseline
  // painted areas (distances from the basket center unless noted)
  laneW: 16 * FT, // 4.8768, lane width (z from -8 ft to +8 ft)
  ftLineX: 28 * FT, // 8.5344, |x| of the free throw line (19 ft from the baseline, 15 ft from the board face)
  ftDist: 13.75 * FT, // 4.191, basket center to free throw line
  ftCircleR: 6 * FT, // 1.8288
  centerCircleR: 6 * FT, // 1.8288
  innerCircleR: 2 * FT, // 0.6096
  restrictedR: 4 * FT, // 1.2192, restricted arc radius from the basket center
  threeR: 23.75 * FT, // 7.239, arc radius from the basket center
  threeCornerZ: 22 * FT, // 6.7056, |z| of the straight corner three lines
  threeCornerLen: 14.1978 * FT, // 4.3275, corner line length measured from the baseline (meets the arc there)
  // ball
  ballR: 0.1193, // size 7 ball, 29.5 in circumference
  ballMass: 0.624,
  ballRestitutionFloor: 0.78, // bounce height ratio ~0.6 from 1.8 m (rules: 49-54 in from 72 in)
  ballRestitutionRim: 0.6,
  ballRestitutionBoard: 0.55,
  gravity: 9.81,
  // off-court layout (near side is -z)
  benchZ: -(25 + 8) * FT, // bench row center, near side
  benchHomeX: [-11 * FT, -3 * FT] as const, // home bench x range (left of the scorer's table on screen)
  benchAwayX: [3 * FT, 11 * FT] as const,
  tableZ: -(25 + 7) * FT, // scorer's table front edge
  firstRowZ: (25 + 6) * FT, // far side courtside row
} as const;

/** Basket center (rim ring center, y = rim height) for a team attacking in direction `dir`. */
export function basketPos(dir: Dir, out: THREE.Vector3): THREE.Vector3 {
  return out.set(dir * COURT.rimX, COURT.rimHeight, 0);
}

/** Horizontal distance from (x, z) to the basket attacked in direction `dir`. */
export function distToBasket(x: number, z: number, dir: Dir): number {
  const dx = x - dir * COURT.rimX;
  return Math.sqrt(dx * dx + z * z);
}

/** 3 if a shot released with feet at (x, z) toward basket `dir` is a three pointer, else 2. */
export function shotValue(x: number, z: number, dir: Dir): 2 | 3 {
  const fromBaseline = COURT.halfL - x * dir; // distance in from that baseline
  if (Math.abs(z) >= COURT.threeCornerZ && fromBaseline <= COURT.threeCornerLen) return 3;
  return distToBasket(x, z, dir) > COURT.threeR ? 3 : 2;
}

export function inBounds(x: number, z: number, margin = 0): boolean {
  return Math.abs(x) < COURT.halfL - margin && Math.abs(z) < COURT.halfW - margin;
}

/** Inside the painted lane (key) at basket `dir`. */
export function inPaint(x: number, z: number, dir: Dir): boolean {
  return Math.abs(z) < COURT.laneW / 2 && x * dir > COURT.ftLineX;
}

export function inRestricted(x: number, z: number, dir: Dir): boolean {
  return distToBasket(x, z, dir) < COURT.restrictedR && x * dir < COURT.rimX + 0.01;
}

/** True when (x) is in the frontcourt of a team attacking `dir`. */
export function inFrontcourt(x: number, dir: Dir): boolean {
  return x * dir > 0;
}

export type ShotZone = "rim" | "paint" | "mid" | "corner3" | "above3";
export function shotZone(x: number, z: number, dir: Dir): ShotZone {
  const d = distToBasket(x, z, dir);
  if (shotValue(x, z, dir) === 3) return Math.abs(z) >= COURT.threeCornerZ - 0.3 ? "corner3" : "above3";
  if (d < COURT.restrictedR + 0.6) return "rim";
  if (inPaint(x, z, dir)) return "paint";
  return "mid";
}

/** Standing height in meters from roster inches. Reach and wingspan derive from it. */
export function heightM(p: PlayerData): number {
  return p.heightIn * IN;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings, quality, difficulty
// ---------------------------------------------------------------------------------------------------------------------
export type Quality = "low" | "medium" | "high" | "ultra";
export type Difficulty = "rookie" | "pro" | "allStar" | "superstar" | "hallOfFame";
export type CameraMode = "broadcast" | "broadcastHigh" | "baseline" | "follow" | "skycam";
export type Device = "keys" | "pad";
export type MatchMode = "exhibition" | "practice"; // practice: user team only, no defense, rebounds come back, no clocks

export interface Settings {
  quarterMinutes: number; // 1..12, default 6. Overtime is ceil(5/12 * quarterMinutes) minutes, at least 1.
  difficulty: Difficulty;
  camera: CameraMode;
  shotMeter: boolean; // show the meter. With it off, timing still matters but the HUD shows only the result text.
  quality: Quality;
  master: number; // 0..1 volumes
  music: number;
  crowd: number;
  sfx: number;
  vibration: boolean;
  fatigue: boolean; // stamina drains, rests on the bench
  fouls: boolean; // false: only shooting fouls are called
  autoSubs: boolean; // CPU coach also manages the user team's rotation
  playerNames: boolean; // name tag over the user player
  replays?: boolean; // instant replays after big plays (default on)
}

export const DEFAULT_SETTINGS: Settings = {
  quarterMinutes: 6,
  difficulty: "pro",
  camera: "broadcast",
  shotMeter: true,
  quality: "high",
  master: 0.9,
  music: 0.6,
  crowd: 0.8,
  sfx: 0.9,
  vibration: true,
  fatigue: true,
  fouls: true,
  autoSubs: true,
  playerNames: true,
  replays: true,
};

/** All heavy render settings in one table. Every module reads its knobs from here (render, arena, players, fx). */
export interface QualityPreset {
  label: string;
  pixelRatio: number; // max devicePixelRatio used
  msaa: number; // 0, 2, 4 render target samples
  aa: "none" | "fxaa" | "smaa";
  shadow: number; // shadow map size, 0 = off
  shadowCasters: "players" | "all"; // "players": only players+ball+hoops cast shadows
  ao: boolean; // screen-space ambient occlusion (GTAO / SAO)
  bloom: boolean;
  floorReflection: "off" | "probe" | "planar"; // glossy hardwood: planar mirror pass at high/ultra
  floorReflectionScale: number; // planar reflection render target scale, 0..1
  crowd: number; // crowd density 0..1 (fraction of seats filled with instanced fans)
  crowdAnim: boolean; // vertex-shader crowd animation
  playerDetail: 0 | 1 | 2; // 0 simple capsules, 1 segmented body, 2 full detail (fingers, shoes, wrinkles normal tex)
  textureSize: number; // canvas texture size for jerseys, floor decals (px)
  anisotropy: number;
  particles: number; // fx pool size
  dof: boolean; // depth of field during cinematic cues only
  vignette: boolean;
  grain: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    label: "Low", pixelRatio: 1, msaa: 0, aa: "fxaa", shadow: 0, shadowCasters: "players", ao: false, bloom: false,
    floorReflection: "off", floorReflectionScale: 0, crowd: 0.35, crowdAnim: false, playerDetail: 0, textureSize: 256,
    anisotropy: 1, particles: 256, dof: false, vignette: false, grain: false,
  },
  medium: {
    label: "Medium", pixelRatio: 1.25, msaa: 0, aa: "fxaa", shadow: 1024, shadowCasters: "players", ao: false, bloom: true,
    floorReflection: "probe", floorReflectionScale: 0, crowd: 0.6, crowdAnim: true, playerDetail: 1, textureSize: 512,
    anisotropy: 4, particles: 512, dof: false, vignette: true, grain: false,
  },
  high: {
    label: "High", pixelRatio: 1.5, msaa: 4, aa: "smaa", shadow: 2048, shadowCasters: "players", ao: true, bloom: true,
    floorReflection: "planar", floorReflectionScale: 0.5, crowd: 0.85, crowdAnim: true, playerDetail: 2, textureSize: 1024,
    anisotropy: 8, particles: 1024, dof: true, vignette: true, grain: true,
  },
  ultra: {
    label: "Ultra", pixelRatio: 2, msaa: 4, aa: "smaa", shadow: 4096, shadowCasters: "all", ao: true, bloom: true,
    floorReflection: "planar", floorReflectionScale: 1, crowd: 1, crowdAnim: true, playerDetail: 2, textureSize: 2048,
    anisotropy: 16, particles: 2048, dof: true, vignette: true, grain: true,
  },
};

/** Difficulty knobs shared by sim (shot math) and ai (reaction, decisions). "user" = the human's team. */
export interface DifficultyPreset {
  label: string;
  userShot: number; // additive make-probability bonus for the user team (e.g. +0.06 on Rookie, -0.04 on Hall of Fame)
  cpuShot: number; // additive make-probability bonus for the CPU team
  perfectWindow: number; // width of the perfect release window on the meter, fraction of meter fill (0..1)
  goodWindow: number; // width of the "slightly early/late" band on each side of the perfect window
  cpuReaction: number; // seconds of delay before CPU defenders react to a move / pass
  cpuIQ: number; // 0..1 decision quality (shot selection, help D, passing reads)
  cpuSteal: number; // steal success multiplier for CPU
  userSteal: number; // steal success multiplier for the user
  foulRate: number; // reach-in / contact foul multiplier on user steal attempts and blocks
  ankleBreak: number; // chance multiplier for ankle breakers on user dribble moves
}

export const DIFFICULTY: Record<Difficulty, DifficultyPreset> = {
  rookie: { label: "Rookie", userShot: 0.08, cpuShot: -0.08, perfectWindow: 0.16, goodWindow: 0.12, cpuReaction: 0.45, cpuIQ: 0.35, cpuSteal: 0.5, userSteal: 1.5, foulRate: 0.6, ankleBreak: 1.6 },
  pro: { label: "Pro", userShot: 0.03, cpuShot: -0.03, perfectWindow: 0.062, goodWindow: 0.1, cpuReaction: 0.3, cpuIQ: 0.55, cpuSteal: 0.8, userSteal: 1.15, foulRate: 0.85, ankleBreak: 1.2 },
  allStar: { label: "All-Star", userShot: 0, cpuShot: 0, perfectWindow: 0.05, goodWindow: 0.08, cpuReaction: 0.2, cpuIQ: 0.72, cpuSteal: 1, userSteal: 1, foulRate: 1, ankleBreak: 1 },
  superstar: { label: "Superstar", userShot: -0.02, cpuShot: 0.02, perfectWindow: 0.04, goodWindow: 0.06, cpuReaction: 0.13, cpuIQ: 0.86, cpuSteal: 1.15, userSteal: 0.9, foulRate: 1.15, ankleBreak: 0.8 },
  hallOfFame: { label: "Hall of Fame", userShot: -0.04, cpuShot: 0.04, perfectWindow: 0.032, goodWindow: 0.05, cpuReaction: 0.08, cpuIQ: 0.97, cpuSteal: 1.3, userSteal: 0.8, foulRate: 1.3, ankleBreak: 0.6 },
};

// ---------------------------------------------------------------------------------------------------------------------
// Game state (sim owns and mutates; everyone else reads)
// ---------------------------------------------------------------------------------------------------------------------
export type Phase =
  | "pregame" // players walk out / warm up, clocks stopped, waiting for game.ts to call sim.begin()
  | "tipoff" // center jump. Sim places players around the circle, ball tossed, jumpers contest
  | "live" // ball in play
  | "dead" // whistle: short pause (state.deadTimer) before the next restart phase
  | "inbound" // throw-in setup and pass; clock starts when the ball is touched in bounds
  | "freeThrow" // free throw sequence (state.freeThrow)
  | "timeout" // timeout break (state.deadTimer counts down)
  | "periodBreak" // between quarters / halftime (state.deadTimer)
  | "final"; // game over

export type FoulKind = "shooting" | "reach" | "blocking" | "charge" | "offensive" | "loose" | "away";
export type TurnoverKind =
  | "steal" | "badPass" | "outOfBounds" | "travel" | "shotClock" | "backcourt" | "eightSeconds" | "threeSeconds"
  | "offensiveFoul" | "fiveSeconds";
export type DeadReason = "made" | "foul" | "violation" | "outOfBounds" | "timeout" | "periodEnd" | "jumpBall" | "sub";

export interface FreeThrowState {
  shooter: number; // slot
  team: TeamSide;
  index: number; // 1-based current attempt
  total: number; // 1, 2 or 3
  made: number;
  live: boolean; // last attempt: rebound is live on a miss
}

export interface InboundState {
  team: TeamSide;
  passer: number; // slot
  spot: THREE.Vector3; // on the floor just out of bounds
  timer: number; // five-second count (s)
  afterMake: boolean; // baseline inbound after a made basket: passer may run the baseline
}

export interface GameState {
  phase: Phase;
  period: number; // 1..4 regulation, 5 = OT1, 6 = OT2...
  periodLength: number; // seconds for this period
  clock: number; // seconds left in the period
  clockRunning: boolean;
  shotClock: number; // seconds (24 full, 14 reset)
  shotClockOn: boolean; // false when the game clock is below the shot clock in a period (display off)
  possession: TeamSide | -1; // team with the ball (or last possession during loose balls). -1 before the tip
  arrow: TeamSide; // alternating possession arrow (who gets the next jump-ball situation)
  firstPossession: TeamSide | -1; // team that won the opening tip, decides period-start possessions
  attackDir: [Dir, Dir]; // per team; flips at halftime
  score: [number, number];
  periodScores: [number[], number[]]; // points per period per team
  teamFouls: [number, number]; // team fouls this period (reset each period, OT counts separately)
  bonus: [boolean, boolean]; // bonus[t]: team t shoots free throws on any defensive foul (opponent in penalty)
  timeouts: [number, number]; // remaining (7 per team per game, max 2 in the last 3 min of Q4 rule is simplified away)
  ballHandler: number; // slot holding / dribbling the ball, -1 none
  lastTouch: number; // slot that last touched the ball (out-of-bounds, assists)
  assistCandidate: number; // slot of the last passer, valid for ~2 s after the catch
  deadTimer: number; // seconds until the next restart in dead/timeout/periodBreak phases
  deadReason: DeadReason | null;
  freeThrow: FreeThrowState | null;
  inbound: InboundState | null;
  backcourtTimer: number; // eight-second count
  laneTimer: number[]; // per slot: seconds in the offensive lane (three seconds)
  run: [number, number]; // current unanswered scoring run, for crowd hype and banners
  hype: number; // 0..1 crowd excitement, decays over time, spikes on big plays (arena, audio read it)
  clutch: boolean; // last 2 minutes of Q4/OT and margin <= 6
  winner: TeamSide | -1; // set in "final"
}

// ---------------------------------------------------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------------------------------------------------
export type BallMode =
  | "held" // in a player's hands (triple threat, catch, gather, post up, inbound)
  | "dribble" // bouncing between the holder's hand and the floor, position computed by sim
  | "pass" // flying to a receiver
  | "shot" // flying to the basket after release
  | "loose" // free physics: rebounds, deflections, tipped balls
  | "dead"; // out of play: sim moves it to the restart spot

export type ShotKind =
  | "jumper" | "pullUp" | "stepBack" | "fadeaway" | "three"
  | "layup" | "reverseLayup" | "floater" | "hook" | "dunk" | "alleyOopDunk" | "alleyOopLayup" | "putback"
  | "freeThrow" | "tip";
export type DunkStyle = "oneHand" | "twoHand" | "tomahawk" | "windmill" | "reverse" | "cuff" | "putback";
export type PassKind = "chest" | "bounce" | "lob" | "alleyOop" | "overhead" | "inbound" | "outlet";
export type MeterGrade = "early" | "slightlyEarly" | "perfect" | "slightlyLate" | "late" | "none";
export type DribbleMove = "crossover" | "behindBack" | "spin" | "stepBack" | "hesitation" | "between";

export interface ShotInfo {
  shooter: number; // slot
  team: TeamSide;
  kind: ShotKind;
  points: 1 | 2 | 3;
  dist: number; // horizontal distance to the basket at release (m)
  from: THREE.Vector3; // release point
  target: Dir; // which basket
  contest: number; // 0 open .. 1 smothered, at release
  timing: MeterGrade;
  chance: number; // final make probability used (0..1)
  make: boolean; // decided at release. Misses follow a physical path that hits rim/board; makes go in.
  swish: boolean; // make without touching the rim
  blocked: boolean;
  assister: number; // slot or -1
  airTime: number; // planned flight time (s)
  releaseT: number; // sim time of release
  touchedRim: boolean; // set on first rim contact (shot clock resets to 14 on offensive rebound after rim)
}

export interface PassInfo {
  from: number;
  to: number;
  kind: PassKind;
  flight: number; // planned flight time (s)
  t: number; // elapsed (s)
  start: THREE.Vector3;
  end: THREE.Vector3; // planned catch point
}

export interface BallState {
  mode: BallMode;
  pos: THREE.Vector3; // center
  vel: THREE.Vector3;
  spin: THREE.Vector3; // angular velocity (rad/s) for the visual roll and the backspin on shots
  holder: number; // slot when held/dribble, else -1
  dribbleHand: -1 | 1; // -1 left hand, 1 right hand (in the holder's frame)
  dribblePhase: number; // 0..1 cycle, 0 = in hand at the top, 0.5 = floor contact
  shot: ShotInfo | null; // while mode === "shot" and until the next possession resolves
  pass: PassInfo | null; // while mode === "pass"
  lastRim: number; // sim time of the last rim contact
  inNet: number; // 0..1 how deep the ball is in the net (arena animates the net), 0 when not in the cylinder
  side: Dir | 0; // basket side the ball is near (for net / rim fx), 0 when far from both
}

// ---------------------------------------------------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------------------------------------------------
/** Animation / action state. Sim sets it; the player rig poses from it. */
export type Action =
  | "idle" | "run" | "sprint" | "dribble" | "crossover" | "behindBack" | "spin" | "stepBack" | "hesitation" | "between"
  | "jumpShot" | "layup" | "dunk" | "floater" | "hook" | "pass" | "catch" | "defend" | "contest" | "block" | "steal"
  | "rebound" | "boxOut" | "postUp" | "screen" | "celebrate" | "fall" | "freeThrow" | "inbound" | "jumpBall" | "pumpFake"
  | "tired" | "walk";

/**
 * Nominal durations (s) for one-shot actions. 0 = looping/continuous. Sim may scale a duration by ratings
 * (e.g. quicker release) and writes the real one to PlayerState.actionDur; the rig always poses from actionP (0..1).
 * Key moments, as fractions of actionDur:
 *   jumpShot: 0..0.3 dip+gather, 0.3..0.55 rise, ball release when the user lets go (sim clamps to 0.45..0.8), 1 land.
 *   layup: 0..0.35 gather steps, 0.35..0.6 rise, release ~0.6, 1 land.  dunk: release (slam) at 0.6, hang to 0.8.
 *   crossover/between/behindBack: ball changes hands at 0.5. spin: 360 turn over 0..1. stepBack: hop back 0.2..0.7.
 *   pass: release at 0.4. block/contest: peak height at 0.5. steal: reach peak at 0.4.
 */
export const ACTION_DUR: Record<Action, number> = {
  idle: 0, run: 0, sprint: 0, walk: 0, dribble: 0, defend: 0, boxOut: 0, postUp: 0, screen: 0, tired: 0,
  crossover: 0.32, between: 0.34, behindBack: 0.42, hesitation: 0.4, spin: 0.55, stepBack: 0.5, pumpFake: 0.45,
  jumpShot: 0.95, layup: 1.0, dunk: 1.15, floater: 0.85, hook: 0.9, pass: 0.35, catch: 0.22,
  contest: 0.8, block: 0.9, steal: 0.45, rebound: 1.0, celebrate: 1.8, fall: 1.4, freeThrow: 1.6, inbound: 0.6,
  jumpBall: 1.1,
};

/** What a player wants to do this step. Written by AI (all CPU slots) or by sim.control() (user slot). Sim consumes. */
export type IntentCmd =
  | "none"
  | "shoot" // offense: start a shot gather (jumper; layup/dunk/floater chosen by sim when driving near the rim)
  | "pass" | "bouncePass" | "lobPass" // offense: to intent.target (slot) or, if -1, the best receiver in intent.aim
  | "dribbleMove" // offense with ball: intent.move2 holds the move
  | "pumpFake"
  | "callScreen" // offense: ask the nearest big for a ball screen (AI reacts to the "screenCall" event)
  | "steal" | "block" | "takeCharge" // defense
  | "switch"; // defense, user only: take control of the defender nearest the ball

export interface PlayerIntent {
  move: THREE.Vector3; // desired world xz direction (y ignored), length 0..1 = fraction of max speed
  sprint: number; // 0..1
  faceTarget: THREE.Vector3 | null; // optional point to face (e.g. ball, basket, matchup); null = face move dir
  cmd: IntentCmd; // one-shot command for this step; sim resets it to "none" after reading
  target: number; // slot for pass/screen, -1 = auto
  aim: THREE.Vector3; // world xz direction for directional pass / dribble move selection (may be zero)
  move2: DribbleMove | null; // for cmd "dribbleMove"
  shootHeld: boolean; // shot button state; sim releases the shot on the true->false edge (meter timing)
  post: boolean; // offense: back down / post up while held
  intense: boolean; // defense: intense D stance (better lateral speed, more stamina drain)
  handsUp: boolean; // defense: hands up (contest without jumping)
  mark: number; // defense: slot this player is guarding (AI fills it; HUD/fx may show it), -1 none
  cut: boolean; // offense off ball: "I am cutting", lets sim give priority / AI pass reads
  foul?: boolean; // added by ai: defense wants an intentional (take) foul on the ball handler late in games; sim may call a common foul on contact or on the next steal cmd
}

export interface MeterState {
  active: boolean; // a shot gather is in progress for this player
  fill: number; // 0..1 meter fill, rises from gather until the forced release at 1
  target: number; // fill value at the center of the perfect window (depends on release speed rating)
  window: number; // perfect window width (from DIFFICULTY + ratings + contest)
  grade: MeterGrade; // result after release; "none" while active or for AI shots
  shownT: number; // seconds since the meter result was decided (HUD fades it out)
}

export interface PlayerState {
  slot: number; // 0..9
  team: TeamSide;
  rosterIndex: number; // index into TeamData.players
  data: PlayerData; // current player in this slot (changes on substitution)
  // physical (derived from data on spawn/sub)
  height: number; // m
  reach: number; // standing reach (m) ~ height * 1.33
  radius: number; // body collision radius (m), 0.28..0.38 from weight
  maxSpeed: number; // sprint top speed (m/s) from speed rating, ~6.2..8.8
  // motion
  pos: THREE.Vector3; // feet center; y = jump height of the feet (0 on the floor)
  vel: THREE.Vector3;
  facing: number; // yaw (see YAW above)
  turnRate: number; // current yaw rate (rad/s), lets the rig lean into turns
  // animation
  action: Action;
  actionT: number; // seconds since the action started
  actionDur: number; // seconds, 0 = looping
  actionP: number; // 0..1 progress for one-shot actions; looping actions cycle 0..1 (gait/dribble phase)
  actionSide: -1 | 1; // mirror: direction of a crossover/spin, hand of a dunk/layup/block (-1 left, 1 right)
  variant: number; // animation variant index (dunk style, celebration, layup package), 0..7
  dunkStyle: DunkStyle | null;
  crouch: number; // 0..1 defensive stance / triple threat
  handsUp: number; // 0..1 arms raised (contest / defense)
  lookAt: THREE.Vector3; // head target, usually the ball
  // game
  hasBall: boolean;
  user: boolean; // controlled by the human this frame
  onFire: number; // -1 ice cold .. 0 neutral .. 1 on fire (streak: hot after 3 straight makes)
  stamina: number; // 0..1 current energy
  fouls: number; // personal fouls
  mark: number; // slot guarded (copied from intent), -1 none
  openness: number; // 0..1 how open this player is (sim computes each step; AI and passing read it)
  stunned: number; // seconds left of an ankle-break / fall (no control)
  meter: MeterState;
}

// ---------------------------------------------------------------------------------------------------------------------
// Box score / teams at runtime
// ---------------------------------------------------------------------------------------------------------------------
export interface StatLine {
  sec: number; // seconds played
  pts: number;
  fgm: number; fga: number;
  tpm: number; tpa: number;
  ftm: number; fta: number;
  oreb: number; dreb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  plusMinus: number;
  dunks: number;
}

export interface TeamRuntime {
  readonly side: TeamSide;
  readonly data: TeamData;
  readonly lineup: number[]; // 5 roster indices on the floor, index k = slot side*5 + k
  readonly energy: number[]; // per roster index 0..1 (bench players recover)
  readonly fouls: number[]; // per roster index
  readonly fouledOut: boolean[]; // per roster index (6 fouls)
  readonly box: StatLine[]; // per roster index
  readonly totals: StatLine; // team totals
  readonly pendingSubs: { slot: number; rosterIndex: number }[]; // applied at the next dead ball
}

// ---------------------------------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------------------------------
/** One digital button. pressed/released are edges since the last read(). held: seconds held (at release: total held). */
export interface Btn {
  down: boolean;
  pressed: boolean;
  released: boolean;
  held: number;
}
export interface Stick {
  x: number; // -1..1, right is +
  y: number; // -1..1, UP / away from the camera is + (screen space; NOT the raw gamepad axis sign)
  mag: number; // 0..1 after deadzone and curve
}

/**
 * Normalized controls for one frame. Input does not know offense from defense: one physical button sets BOTH of its
 * semantic fields (pad X sets shoot AND steal), and sim.control() reads the one that fits the context.
 *
 *   semantic   | gamepad (standard)      | keyboard
 *   -----------+-------------------------+------------------------------
 *   move       | left stick              | WASD
 *   sprint     | RT(7) analog            | Shift
 *   shoot      | X(2) hold/release       | J hold/release
 *   pass       | A(0)                    | K
 *   bounce     | B(1)                    | L
 *   lob        | Y(3)                    | I
 *   screen     | LB(4)                   | E
 *   icon       | RB(5) held              | R held (or digits 1-4 directly)
 *   post       | LT(6) held              | Q
 *   dribble    | right stick flick       | arrow keys (tap = flick)
 *   steal      | X(2)                    | L
 *   block      | Y(3)                    | J
 *   switchP    | A(0)                    | K
 *   charge     | B(1)                    | F
 *   intense    | LT(6) held              | Q
 *   handsUp    | right stick held > 0.5  | arrow key held
 *   pause      | Start(9)                | Esc
 *   camera     | Back(8)                 | C
 *
 * Icon passing: while `icon` is down, pad A/B/X/Y pick teammate icons 0/1/2/3 (iconPick) and those presses are NOT
 * also reported as pass/bounce/shoot/lob. Keyboard digits 1..4 always set iconPick 0..3. Icon order = the four
 * teammates in ascending slot order, skipping the ball handler. HUD/fx draw glyphs A, B, X, Y (pad) or 1..4 (keys).
 */
export interface InputFrame {
  device: Device; // last device with activity, for glyphs
  move: Stick; // left stick / WASD (screen space)
  rstick: Stick; // right stick / arrows (screen space)
  flick: boolean; // a right stick flick (fast push past 0.8 from center) or arrow tap happened this frame
  flickDir: Stick; // direction of that flick (screen space, unit length)
  moveWorld: THREE.Vector3; // FILLED BY game.ts via camera.stickToWorld(move) before sim.control(). xz, length = move.mag
  flickWorld: THREE.Vector3; // FILLED BY game.ts via camera.stickToWorld(flickDir). xz unit or zero
  sprint: number; // 0..1
  shoot: Btn; pass: Btn; bounce: Btn; lob: Btn; screen: Btn; icon: Btn; post: Btn;
  steal: Btn; block: Btn; switchP: Btn; charge: Btn; intense: Btn;
  pause: Btn; camera: Btn;
  handsUp: boolean;
  iconPick: number; // -1 none, else 0..3 picked this frame
  any: boolean; // any button pressed this frame (skip cutscenes)
  buffer?: InputBuffer; // added by input-camera: 120 ms press buffer (see InputBuffer). Same object every frame.
}

// added by input-camera: names of the semantic buttons in InputFrame.
export type BtnName =
  | "shoot" | "pass" | "bounce" | "lob" | "screen" | "icon" | "post" | "steal" | "block" | "switchP" | "charge"
  | "intense" | "pause" | "camera";

/**
 * added by input-camera. Press buffer for snappy controls: a press is remembered for `win` seconds (default 0.12)
 * until something takes it. Sim can use it when a press arrives while the player is busy (catching, landing, in a
 * move): `if (frame.buffer?.take("pass")) ...` fires once, as soon as the action becomes possible.
 */
export interface InputBuffer {
  has(name: BtnName, win?: number): boolean; // pressed within win seconds and not taken yet
  take(name: BtnName, win?: number): boolean; // like has(), and marks the press as used
  clear(name?: BtnName): void;
}

// added by input-camera: face-button family of the active pad, for glyphs (input-glyphs.ts draws them).
export type PadStyle = "xbox" | "playstation" | "nintendo" | "generic";

// ---------------------------------------------------------------------------------------------------------------------
// Events: modules return GameEvent[], game.ts forwards them to every module's handle()
// ---------------------------------------------------------------------------------------------------------------------
export type CrowdReaction = "cheer" | "roar" | "ooh" | "aww" | "boo" | "gasp" | "defense" | "groan";
export type HypeReason = "dunk" | "three" | "block" | "ankleBreaker" | "run" | "clutch" | "alleyOop" | "andOne" | "buzzerBeater" | "steal";

export type GameEvent =
  | { type: "tipoff"; winner: TeamSide; jumper: number }
  | { type: "possession"; team: TeamSide }
  | { type: "shotStart"; slot: number; kind: ShotKind } // gather started (meter appears for the user)
  | { type: "shot"; slot: number; team: TeamSide; kind: ShotKind; points: 1 | 2 | 3; dist: number; contest: number; timing: MeterGrade; chance: number; at: V3 }
  | { type: "make"; slot: number; team: TeamSide; kind: ShotKind; points: 1 | 2 | 3; dist: number; swish: boolean; assist: number; andOne: boolean; side: Dir; at: V3 }
  | { type: "miss"; slot: number; team: TeamSide; kind: ShotKind; airball: boolean; side: Dir }
  | { type: "rim"; side: Dir; strength: number; at: V3 } // strength 0..1 (clank volume, rim wobble)
  | { type: "backboard"; side: Dir; strength: number; at: V3 }
  | { type: "swish"; side: Dir } // ball through the net without rim contact (net fx/sfx), right when it passes
  | { type: "net"; side: Dir; strength: number } // ball passing the net after a rim-in make
  | { type: "dunk"; slot: number; style: DunkStyle; side: Dir; at: V3 } // at the slam moment (rim hang, shake)
  | { type: "block"; by: number; on: number; at: V3; goaltend: boolean }
  | { type: "steal"; by: number; from: number; at: V3 }
  | { type: "deflection"; by: number; at: V3 }
  | { type: "foul"; by: number; on: number; kind: FoulKind; shots: 0 | 1 | 2 | 3; teamFouls: number; bonus: boolean; personal: number; fouledOut: boolean; at: V3 }
  | { type: "turnover"; slot: number; team: TeamSide; kind: TurnoverKind }
  | { type: "rebound"; slot: number; team: TeamSide; offensive: boolean; at: V3 }
  | { type: "pass"; from: number; to: number; kind: PassKind }
  | { type: "catch"; slot: number; at: V3 }
  | { type: "dribble"; slot: number; at: V3; strength: number } // each floor bounce (ball thump)
  | { type: "bounce"; at: V3; strength: number } // loose ball floor bounce
  | { type: "dribbleMove"; slot: number; move: DribbleMove }
  | { type: "ankleBreaker"; by: number; victim: number }
  | { type: "squeak"; slot: number; at: V3; strength: number } // sneaker squeak on hard cuts/stops
  | { type: "bump"; a: number; b: number; strength: number; at: V3 } // body contact
  | { type: "screenCall"; slot: number } // ball handler asked for a screen (AI sends a screener)
  | { type: "screen"; screener: number; for: number; at: V3 } // screen set and contact made
  | { type: "freeThrowStart"; slot: number; index: number; total: number }
  | { type: "inbound"; team: TeamSide; passer: number }
  | { type: "whistle"; reason: "foul" | "violation" | "outOfBounds" | "timeout" | "jumpBall" | "sub" }
  | { type: "buzzer"; kind: "shotClock" | "period" | "game" }
  | { type: "periodEnd"; period: number; score: [number, number] }
  | { type: "periodStart"; period: number }
  | { type: "halftime" }
  | { type: "overtime"; n: number }
  | { type: "gameEnd"; score: [number, number]; winner: TeamSide }
  | { type: "substitution"; team: TeamSide; slot: number; outId: string; inId: string }
  | { type: "timeout"; team: TeamSide; remaining: number }
  | { type: "streak"; slot: number; level: number } // onFire changed past ±0.5 / ±1
  | { type: "crowd"; reaction: CrowdReaction; strength: number }
  | { type: "crowdHype"; level: number; reason: HypeReason }
  | { type: "shake"; strength: number } // camera shake request 0..1
  | { type: "rumble"; strong: number; weak: number; ms: number } // controller vibration for the user
  | { type: "meter"; slot: number; grade: MeterGrade } // user's shot release graded
  | { type: "toast"; text: string; sub?: string; tone?: "home" | "away" | "neutral" | "hot" } // HUD banner
  | { type: "userSwitch"; slot: number };

// ---------------------------------------------------------------------------------------------------------------------
// Sim: rules, ball physics, player movement, shot resolution, stats. Files: sim.ts, sim-*.ts
// ---------------------------------------------------------------------------------------------------------------------
/** Read-only view of the match handed to camera, players, arena, fx, audio, ai and the HUD builder. */
export interface SimView {
  readonly state: GameState;
  readonly ball: BallState;
  readonly players: readonly PlayerState[]; // length 10, index = slot
  readonly teams: readonly [TeamRuntime, TeamRuntime];
  readonly userTeam: TeamSide | -1;
  readonly userSlot: number; // -1 when no human player on the floor
  readonly time: number; // sim seconds since the match was created (monotonic, includes dead time)
  readonly difficulty: Difficulty;
  readonly mode: MatchMode;
  /** Which basket team t attacks right now. */
  dir(team: TeamSide): Dir;
  /** Estimated make chance (0..1) if `slot` shot right now from where he stands, with current contest. Cheap. */
  shotChance(slot: number): number;
  /** Teammate slots of `slot` (4 entries, ascending slot order) written into `out`; returns out. */
  mates(slot: number, out: number[]): number[];
}

export interface MatchSetup {
  home: TeamData;
  away: TeamData;
  userTeam: TeamSide | -1; // -1 = watch CPU vs CPU
  mode: MatchMode;
  settings: Settings;
}

export interface Sim extends SimView {
  /** Writable intents, one per slot. AI writes CPU slots; sim.control() writes the user slot. */
  readonly intents: PlayerIntent[];
  /** Start the game: go from "pregame" to "tipoff". */
  begin(): void;
  /**
   * Turn the human's InputFrame into intents[userSlot]. Handles contextual buttons (offense vs defense),
   * auto-switching (offense: user always controls the ball handler; defense: keeps the current defender, `switchP`
   * jumps to the defender nearest the ball), pass target choice from moveWorld direction, icon passes, dribble moves
   * from flickWorld relative to the attack direction:
   *   flick across the body toward the free hand side  -> crossover (between if already low/slow)
   *   flick toward the ball-hand side                  -> hesitation (in-and-out)
   *   flick straight back (away from the basket)       -> stepBack
   *   flick back-diagonal                              -> behindBack
   *   flick toward the basket                          -> spin (direction = side of the defender)
   * Shot: shoot.pressed starts a gather, shoot.released releases (meter grade). Tap < 0.12 s while standing = pumpFake.
   * Called once per rendered frame (0..8 sim steps follow). It must never overwrite a pending, unconsumed cmd with
   * "none": a press on a frame without a sim step still fires on the next step.
   */
  control(frame: InputFrame): void;
  /** Advance one fixed step (SIM_DT). Returns this step's events (reused array, valid until the next step). */
  step(dt: number): GameEvent[];
  /** Queue a substitution (applied at the next dead ball). False if illegal (fouled out, already on the floor). */
  substitute(team: TeamSide, slot: number, rosterIndex: number): boolean;
  /** Call a timeout for `team`: only when it has the ball or during a dead ball. False if none left / not allowed. */
  callTimeout(team: TeamSide): boolean;
  /** Change rules/difficulty mid game (from the pause menu). Quarter length applies from the next period. */
  setSettings(s: Settings): void;
  /** Dev and practice: put the ball in `slot`'s hands at a position (live ball, shot clock reset). */
  debugGive(slot: number, at?: V3): void;
  dispose(): void;
}
/** sim.ts: export function createSim(setup: MatchSetup): Sim */
export type CreateSim = (setup: MatchSetup) => Sim;

// ---------------------------------------------------------------------------------------------------------------------
// AI: offense sets, defense, coaching. Files: ai.ts, ai-*.ts
// ---------------------------------------------------------------------------------------------------------------------
export interface AI {
  /**
   * Called once per sim step BEFORE sim.step(), with the previous step's events. Writes sim.intents for every slot
   * except sim.userSlot (both teams: the user's teammates are AI too). Also runs the CPU coach at low rate:
   * substitutions by fatigue/fouls (sim.substitute), timeouts on opponent runs (sim.callTimeout), and, if
   * settings.autoSubs, the user team's rotation. Uses difficulty for reaction delay and decision quality.
   * Must respect phases: during "inbound" choose the inbound passer's receiver; during "freeThrow" the shooter's
   * timing (set shootHeld then release near meter.target with noise by ft rating).
   */
  update(dt: number, events: readonly GameEvent[]): void;
  setSettings(s: Settings): void;
  /** Current offensive set for HUD flavor, e.g. "High pick and roll", "Horns", "Iso". null when none. */
  playName(team: TeamSide): string | null;
  dispose(): void;
}
/** ai.ts: export function createAI(sim: Sim, settings: Settings): AI */
export type CreateAI = (sim: Sim, settings: Settings) => AI;

// ---------------------------------------------------------------------------------------------------------------------
// Input: keyboard + gamepad. File: input.ts
// ---------------------------------------------------------------------------------------------------------------------
export interface Input {
  /** Poll gamepads and keys. Returns one reused InputFrame. Call exactly once per rendered frame. */
  read(dt: number): InputFrame;
  readonly device: Device;
  readonly padName: string | null; // connected gamepad id, null when none
  /** Controller vibration (no-op without a pad or when disabled). */
  rumble(strong: number, weak: number, ms: number): void;
  setVibration(on: boolean): void;
  readonly padStyle?: PadStyle; // added by input-camera: glyph family of the active pad ("generic" with no pad)
  /** added by input-camera: rumble from game events for the user (dunk, make, foul, block...). game.ts route() calls it. */
  handle?(events: readonly GameEvent[], view: SimView): void;
  /** Menu navigation edges for the UI (pad d-pad/left stick/A/B, keyboard arrows/Enter/Esc), polled by read(). */
  onNav(cb: (dir: "up" | "down" | "left" | "right" | "ok" | "back" | "tabLeft" | "tabRight" | "start") => void): () => void;
  dispose(): void;
}
/** input.ts: export function createInput(target: HTMLElement): Input  (keys on window, focus/contextmenu on target) */
export type CreateInput = (target: HTMLElement) => Input;

// ---------------------------------------------------------------------------------------------------------------------
// Camera. File: camera.ts
// ---------------------------------------------------------------------------------------------------------------------
export type CameraCue = "intro" | "tipoff" | "freeThrow" | "dunk" | "timeout" | "periodEnd" | "gameEnd" | "inbound";
export interface ScreenPoint {
  x: number; // 0..1 from the left of the canvas
  y: number; // 0..1 from the top
  on: boolean; // in front of the camera and inside the view
}
export interface CameraRig {
  readonly mode: CameraMode;
  setMode(m: CameraMode): void;
  cycle(): CameraMode;
  /**
   * Gameplay camera. broadcast: high side view at the near sideline, pans with the ball, leads toward the attack
   * direction, zooms in on halfcourt sets and out in transition. broadcastHigh: same, higher and wider. baseline:
   * behind the offense's backcourt looking at the basket. follow: low behind the user player. skycam: overhead cable cam.
   * Reacts to events by itself via handle(): short cinematic cues (dunk close-up, free-throw view, timeout pan).
   */
  update(dt: number, view: SimView): void;
  /** Menu showcase: slow orbit around the court with depth-of-field-friendly framing. t = seconds since start. */
  menu(dt: number, t: number): void;
  handle(events: readonly GameEvent[], view: SimView): void;
  cue(kind: CameraCue, at?: V3, seconds?: number): void;
  shake(strength: number): void;
  /** Skip smoothing on the next update (after a restart or a cut). */
  cut(): void;
  /** Convert a screen-space stick (x right, y up) into a world xz direction relative to the current view. y = 0. */
  stickToWorld(x: number, y: number, out: THREE.Vector3): THREE.Vector3;
  /** Project a world point to normalized canvas coordinates for DOM overlays. */
  toScreen(world: V3, out: ScreenPoint): ScreenPoint;
  /** Focus distance for depth of field (render reads it), meters. */
  readonly focus: number;
  readonly cinematic: boolean; // true during a cue (render may enable DOF / letterbox, HUD may hide)
  /**
   * added by input-camera: slow-motion hook, 1 = normal. Drops for hit-stops (dunk, block, ankle breaker) and the
   * buzzer-beater slow-mo. game.ts multiplies the sim accumulator dt (and players/fx dt) by it.
   */
  readonly timeScale?: number;
  /**
   * added by input-camera: instant replay. Off until setReplays(true). While non-null, game.ts must NOT step the sim
   * and must pose players from it: players.update(dt * timeScale, replayView). The rig records the live view itself.
   */
  readonly replayView?: SimView | null;
  setReplays?(on: boolean): void; // added by input-camera
  /** added by input-camera: skip the current skippable cue (intro flyover, replay). Call on frame.any. */
  skip?(): void;
  /** added by input-camera: label of the current shot for the HUD ("REPLAY"), null in normal play. */
  readonly bug?: string | null;
}
/** camera.ts: export function createCamera(camera: THREE.PerspectiveCamera): CameraRig */
export type CreateCamera = (camera: THREE.PerspectiveCamera) => CameraRig;

// ---------------------------------------------------------------------------------------------------------------------
// Render (renderer, post chain) and Arena (court, hoops, stands, crowd, lights, scoreboard).
// Files: render.ts, render-*.ts, arena.ts, arena-*.ts
// ---------------------------------------------------------------------------------------------------------------------
export interface RenderStats {
  fps: number;
  ms: number;
  calls: number;
  tris: number;
}
export interface Render {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly envMap: THREE.Texture | null; // arena reflection probe for players/ball/glass (PMREM)
  setQuality(q: Quality): void;
  resize(): void; // reads canvas.clientWidth/Height
  /** Post settings per frame: depth of field focus (m) and strength 0..1 (0 = off), letterbox 0..1. */
  setCinematic(focus: number, dof: number, letterbox: number): void;
  /** Register a callback that runs right before the main render (planar floor reflection pass etc). */
  onBeforeRender(cb: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void): () => void;
  render(dt: number): void;
  stats(): RenderStats;
  dispose(): void;
}
/** render.ts: export function createRender(canvas: HTMLCanvasElement, quality: Quality): Render; export function detectQuality(): Quality */
export type CreateRender = (canvas: HTMLCanvasElement, quality: Quality) => Render;

export interface Arena {
  readonly group: THREE.Group;
  /**
   * Court colors from home.court (wood tint, paint, lines), home city + name as a plain-text wordmark at center court
   * and along the baselines (NO logos), "HOOPS" brand on the apron, team colors on stanchion pads, LED ribbon boards
   * and the center-hung scoreboard. Rebuild only the canvas textures on a team change.
   */
  setTeams(home: TeamData, away: TeamData): void;
  /**
   * Per frame: nets (cloth-like sway, ball inside net pushes it: view.ball.inNet), rim wobble, crowd animation from
   * state.hype, scoreboard/shot clock canvases (redraw at most 4 Hz or on change), LED ribbon animation.
   * view is null in menus (crowd idles, scoreboard shows "HOOPS").
   */
  update(dt: number, view: SimView | null, camera: THREE.Camera): void;
  handle(events: readonly GameEvent[]): void; // rim hits shake the rim, makes ripple the net, dunks bend the rim
  setQuality(q: Quality): void;
  dispose(): void;
}
/** arena.ts: export function createArena(render: Render, home: TeamData, away: TeamData, quality: Quality): Arena */
export type CreateArena = (render: Render, home: TeamData, away: TeamData, quality: Quality) => Arena;

// ---------------------------------------------------------------------------------------------------------------------
// Players: procedural models, uniforms, animation, and the ball mesh. Files: players.ts, player-*.ts
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Uniform rule: the home team wears LIGHT jerseys (near white base, team primary trim and numbers); the away team
 * wears its PRIMARY color (secondary/white trim and numbers). Jersey front shows the team NAME as plain text,
 * back shows the player's last name and number. Shoes, socks, arm sleeves and headbands vary per player.
 */
export interface PlayerRig {
  /** Rebuild jersey/shorts textures. Call before the first update and after a team change. */
  setTeams(home: TeamData, away: TeamData): void;
  /**
   * Per frame. Poses all 10 slots from PlayerState (pos, facing, action, actionP, actionSide, variant, crouch,
   * handsUp, lookAt, vel for gait/strafe blend, stamina for a tired posture) and places the ball mesh at
   * view.ball.pos with spin. Hands must meet the ball: when ball.holder === slot the ball hand(s) reach view.ball.pos
   * (two hands for held/shot gather, ball hand on top of each dribble). Detects substitutions (players[i].data.id
   * changed) and re-skins that slot (body proportions from heightIn/weightLb, skin, hair, beard, headband, number).
   */
  update(dt: number, view: SimView): void;
  handle(events: readonly GameEvent[]): void; // e.g. sweat flick, jersey tug on celebrations
  /** World position just above the head of a slot (for name tags and icon glyphs). */
  headPos(slot: number, out: THREE.Vector3): THREE.Vector3;
  /** Menu showcase: place a single player model (or hide with null) at a world point, idle pose. */
  showcase(data: PlayerData | null, team: TeamData | null, at?: V3): void;
  setEnv(env: THREE.Texture | null): void;
  setQuality(q: Quality): void;
  readonly ball: THREE.Object3D;
  dispose(): void;
}
/** players.ts: export function createPlayers(scene: THREE.Scene, quality: Quality): PlayerRig */
export type CreatePlayers = (scene: THREE.Scene, quality: Quality) => PlayerRig;

// ---------------------------------------------------------------------------------------------------------------------
// FX: particles and in-world indicators. Files: fx.ts, fx-*.ts
// ---------------------------------------------------------------------------------------------------------------------
export type FxKind =
  | "swish" | "rimHit" | "dunk" | "block" | "steal" | "sweat" | "confetti" | "flashes" | "fire" | "perfect"
  | "ankleBreak" | "splash" | "andOne" | "buzzer";
/** Per-frame indicator inputs. All positions are world space; null hides that indicator. */
export interface Indicators {
  user: number; // user slot (glowing floor ring in the user team color, stamina arc around it), -1 none
  userColor: string;
  passTarget: number; // slot the next pass would go to (small floor chevron), -1 none
  icons: boolean; // icon-pass mode: show glyph rings under the 4 teammates
  shotTarget: Dir | 0; // highlight rim glow while the user gathers a shot, 0 none
  mark: number; // slot the user is guarding (thin floor ring), -1 none
}
export interface Fx {
  handle(events: readonly GameEvent[], view: SimView): void; // maps events to bursts (make -> swish sparkle, dunk -> shockwave + flashes...)
  emit(kind: FxKind, at: V3, strength?: number): void;
  indicators(view: SimView, ind: Indicators): void;
  update(dt: number, camera: THREE.Camera): void; // all particles from one pool, one draw call
  setQuality(q: Quality): void;
  clear(): void;
  dispose(): void;
}
/** fx.ts: export function createFx(scene: THREE.Scene, quality: Quality): Fx */
export type CreateFx = (scene: THREE.Scene, quality: Quality) => Fx;

// ---------------------------------------------------------------------------------------------------------------------
// Audio: Web Audio only (synthesized sfx, crowd beds, original music loops, optional speechSynthesis PA announcer).
// Files: audio.ts, audio-*.ts. Create after a user gesture.
// ---------------------------------------------------------------------------------------------------------------------
export type Sfx =
  | "dribble" | "squeak" | "swish" | "net" | "rim" | "rimRattle" | "backboard" | "dunk" | "catch" | "pass" | "block"
  | "steal" | "bump" | "whistle" | "buzzer" | "shotClock" | "horn" | "floor" | "perfect" | "meterTick"
  | "menuMove" | "menuSelect" | "menuBack" | "menuTab" | "error";
export type MusicTrack = "menu" | "game" | "timeout" | "final" | "off";
export interface Audio {
  /** Maps events to sfx, crowd reactions and PA callouts (player name on makes, "and one", "three"). */
  handle(events: readonly GameEvent[], view: SimView): void;
  sfx(name: Sfx, opts?: { volume?: number; at?: V3; rate?: number }): void;
  /** Per frame: listener (camera) pose, crowd bed level from state.hype / clutch / possession (home crowd louder). */
  update(dt: number, view: SimView | null, camera: THREE.Camera): void;
  music(track: MusicTrack): void;
  setVolume(master: number, music: number, crowd: number, sfx: number): void;
  setMuted(m: boolean): void;
  /** Resume the AudioContext (call from a user gesture). */
  resume(): void;
  dispose(): void;
}
/** audio.ts: export function createAudio(): Audio  (never throws; errors are caught inside) */
export type CreateAudio = () => Audio;

// ---------------------------------------------------------------------------------------------------------------------
// HUD (React, pushed at HUD_HZ) and per-frame DOM handle
// ---------------------------------------------------------------------------------------------------------------------
export interface HudTeam {
  abbr: string;
  city: string;
  name: string;
  primary: string;
  secondary: string;
  score: number;
  timeouts: number;
  fouls: number; // team fouls this period
  bonus: boolean;
}
export interface HudPlayer {
  slot: number;
  team: TeamSide;
  rosterIndex: number;
  id: string;
  name: string; // "F. Last"
  last: string;
  jersey: string; // as printed ("00", "7")
  pos: Position;
  overall: number;
  stamina: number;
  fouls: number;
  pts: number;
  reb: number;
  ast: number;
  fgm: number;
  fga: number;
  onFire: number;
  user: boolean;
  hasBall: boolean;
}
export interface HudSnapshot {
  phase: Phase;
  period: number;
  periodLabel: string; // "1ST", "2ND", "3RD", "4TH", "OT", "2OT"
  clock: number; // seconds
  shotClock: number;
  shotClockOn: boolean;
  teams: [HudTeam, HudTeam];
  possession: TeamSide | -1;
  arrow: TeamSide;
  userTeam: TeamSide | -1;
  user: HudPlayer | null; // the controlled player
  onCourt: [HudPlayer[], HudPlayer[]]; // 5 each, slot order
  freeThrow: { name: string; index: number; total: number } | null;
  play: string | null; // current offensive set of the team with the ball
  device: Device;
  camera: CameraMode;
  cinematic: boolean; // hide most HUD during cues
  replay?: boolean; // an instant replay is playing (HUD shows the REPLAY bug)
  clutch: boolean;
  fps: number;
}

/** Shot meter view, written per frame to DOM by the HUD through a ref. */
export interface MeterView {
  on: boolean;
  x: number; // 0..1 screen anchor (next to the shooter)
  y: number;
  fill: number;
  target: number;
  window: number;
  grade: MeterGrade;
  fade: number; // 1 visible .. 0 hidden
}
export interface ScreenTag {
  on: boolean;
  x: number; // 0..1
  y: number;
  text: string; // name tag or icon glyph ("A", "B", "X", "Y" / "1".."4")
  kind: "name" | "icon";
  color: string;
}
/** Implemented by the HUD component (ui-hud.tsx) and handed to game.ts through GameCallbacks.hudRef(). */
export interface HudHandle {
  meter(m: MeterView): void; // per frame
  tags(list: readonly ScreenTag[]): void; // per frame, fixed-size list (up to 5), reuse DOM nodes
  event(e: GameEvent): void; // banners, scorebug flashes, play-by-play ticker
}

export interface FinalReport {
  home: TeamData;
  away: TeamData;
  score: [number, number];
  periods: [number[], number[]];
  box: [StatLine[], StatLine[]]; // per roster index
  totals: [StatLine, StatLine];
  winner: TeamSide;
  mvp: { team: TeamSide; rosterIndex: number };
  userTeam: TeamSide | -1;
}

export interface GameCallbacks {
  hud(h: HudSnapshot): void; // at HUD_HZ
  hudRef(): HudHandle | null; // per frame
  progress(p: number): void; // loading 0..1
  pause(): void; // the player pressed pause in game (Start/Esc): the UI opens its pause menu and calls game.pause(true)
  ended(r: FinalReport): void;
}

/** game.ts: export function startGame(canvas: HTMLCanvasElement, cb: GameCallbacks, settings: Settings): Game */
export interface Game {
  /** Menu background: arena dressed for these teams, orbit camera, optional featured player model. */
  showcase(home: TeamData, away: TeamData, featured?: PlayerData | null): void;
  start(setup: MatchSetup): Promise<void>;
  pause(on: boolean): void;
  readonly paused: boolean;
  setSettings(s: Settings): void;
  restart(): void;
  quit(): void; // back to the menu showcase
  substitute(team: TeamSide, slot: number, rosterIndex: number): boolean;
  callTimeout(): boolean; // user team
  report(): FinalReport | null; // live box score (also during pause)
  readonly input: Input; // UI subscribes to input.onNav for gamepad menu navigation
  readonly audio: Audio | null; // null until the first user gesture (UI calls game.unlockAudio())
  unlockAudio(): void;
  dispose(): void;
}
