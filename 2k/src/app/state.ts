import * as THREE from "three";
import type {
  BallState, Btn, GameState, HudPlayer, HudSnapshot, InputFrame, MeterState, PlayerIntent, PlayerState, Stick, StatLine,
  TeamSide,
} from "./contracts";
import { IN } from "./contracts";
import type { PlayerData, TeamData } from "./data/types";

// Canonical constructors for the shared state shapes. Owned by the lead; sim, mocks and labs all use these
// so every object has every field from the start (stable hidden classes, no undefined checks).

export function newStatLine(): StatLine {
  return { sec: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0, dunks: 0 };
}

export function newMeter(): MeterState {
  return { active: false, fill: 0, target: 0.85, window: 0.08, grade: "none", shownT: 99 };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Physical numbers from roster data. Sim may refine them; these are the agreed defaults. */
export function physicalOf(d: PlayerData) {
  const height = d.heightIn * IN;
  const reach = height * 1.33;
  const radius = clamp(0.27 + (d.weightLb - 180) * 0.0011, 0.28, 0.38);
  const maxSpeed = 6.2 + (clamp(d.ratings.speed, 25, 99) - 25) * (2.6 / 74);
  return { height, reach, radius, maxSpeed };
}

export function newPlayerState(slot: number, team: TeamSide, rosterIndex: number, data: PlayerData): PlayerState {
  const ph = physicalOf(data);
  return {
    slot, team, rosterIndex, data,
    height: ph.height, reach: ph.reach, radius: ph.radius, maxSpeed: ph.maxSpeed,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0, turnRate: 0,
    action: "idle", actionT: 0, actionDur: 0, actionP: 0, actionSide: 1, variant: 0, dunkStyle: null,
    crouch: 0, handsUp: 0, lookAt: new THREE.Vector3(0, 1.5, 0),
    hasBall: false, user: false, onFire: 0, stamina: 1, fouls: 0, mark: -1, openness: 0, stunned: 0,
    meter: newMeter(),
  };
}

/** Re-point a slot at another roster player (substitution) and refresh the derived numbers. */
export function assignPlayer(p: PlayerState, rosterIndex: number, data: PlayerData): void {
  const ph = physicalOf(data);
  p.rosterIndex = rosterIndex;
  p.data = data;
  p.height = ph.height;
  p.reach = ph.reach;
  p.radius = ph.radius;
  p.maxSpeed = ph.maxSpeed;
  p.fouls = 0;
  p.onFire = 0;
}

export function newBallState(): BallState {
  return {
    mode: "dead", pos: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), spin: new THREE.Vector3(),
    holder: -1, dribbleHand: 1, dribblePhase: 0, shot: null, pass: null, lastRim: -99, inNet: 0, side: 0,
  };
}

export function newGameState(quarterMinutes: number): GameState {
  const len = quarterMinutes * 60;
  return {
    phase: "pregame", period: 1, periodLength: len, clock: len, clockRunning: false, shotClock: 24, shotClockOn: true,
    possession: -1, arrow: 0, firstPossession: -1, attackDir: [1, -1], score: [0, 0], periodScores: [[0], [0]],
    teamFouls: [0, 0], bonus: [false, false], timeouts: [7, 7], ballHandler: -1, lastTouch: -1, assistCandidate: -1,
    deadTimer: 0, deadReason: null, freeThrow: null, inbound: null, backcourtTimer: 0, laneTimer: new Array(10).fill(0),
    run: [0, 0], hype: 0.3, clutch: false, winner: -1,
  };
}

export function newIntent(): PlayerIntent {
  return {
    move: new THREE.Vector3(), sprint: 0, faceTarget: null, cmd: "none", target: -1, aim: new THREE.Vector3(), move2: null,
    shootHeld: false, post: false, intense: false, handsUp: false, mark: -1, cut: false,
  };
}

const btn = (): Btn => ({ down: false, pressed: false, released: false, held: 0 });
const stick = (): Stick => ({ x: 0, y: 0, mag: 0 });

export function newInputFrame(): InputFrame {
  return {
    device: "keys", move: stick(), rstick: stick(), flick: false, flickDir: stick(),
    moveWorld: new THREE.Vector3(), flickWorld: new THREE.Vector3(), sprint: 0,
    shoot: btn(), pass: btn(), bounce: btn(), lob: btn(), screen: btn(), icon: btn(), post: btn(),
    steal: btn(), block: btn(), switchP: btn(), charge: btn(), intense: btn(), pause: btn(), camera: btn(),
    handsUp: false, iconPick: -1, any: false,
  };
}

export function periodLabel(period: number): string {
  if (period <= 4) return ["1ST", "2ND", "3RD", "4TH"][period - 1];
  const n = period - 4;
  return n === 1 ? "OT" : `${n}OT`;
}

export function hudPlayer(p: PlayerState, line: StatLine | undefined, out?: HudPlayer): HudPlayer {
  const o = out ?? ({} as HudPlayer);
  o.slot = p.slot;
  o.team = p.team;
  o.rosterIndex = p.rosterIndex;
  o.id = p.data.id;
  o.name = `${p.data.first.charAt(0)}. ${p.data.last}`;
  o.last = p.data.last;
  o.jersey = p.data.jersey00 ? "00" : String(p.data.jersey);
  o.pos = p.data.pos;
  o.overall = p.data.ratings.overall;
  o.stamina = p.stamina;
  o.fouls = p.fouls;
  o.pts = line?.pts ?? 0;
  o.reb = (line?.oreb ?? 0) + (line?.dreb ?? 0);
  o.ast = line?.ast ?? 0;
  o.fgm = line?.fgm ?? 0;
  o.fga = line?.fga ?? 0;
  o.onFire = p.onFire;
  o.user = p.user;
  o.hasBall = p.hasBall;
  return o;
}

export function hudTeam(t: TeamData) {
  return { abbr: t.abbr, city: t.city, name: t.name, primary: t.primary, secondary: t.secondary, score: 0, timeouts: 7, fouls: 0, bonus: false };
}

export function emptyHud(home: TeamData, away: TeamData): HudSnapshot {
  return {
    phase: "pregame", period: 1, periodLabel: "1ST", clock: 0, shotClock: 24, shotClockOn: true,
    teams: [hudTeam(home), hudTeam(away)], possession: -1, arrow: 0, userTeam: 0, user: null, onCourt: [[], []],
    freeThrow: null, play: null, device: "keys", camera: "broadcast", cinematic: false, replay: false, clutch: false, fps: 0,
  };
}
