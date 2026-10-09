import type * as THREE from "three";

// Shared types between modules. Change only with the lead.

export type Action =
  | "swing" // hold LMB with no aware enemy near, or hold Shift (sprint starts by itself after 0.8 s of running)
  | "jump" // Space (in air: forward web zip)
  | "attack" // LMB with an enemy near
  | "trick" // T in air
  | "web" // RMB (in combat: web shooter, else: web zip to aimed point)
  | "launch" // E tap: point launch, E hold: perch, near a civilian: greet
  | "strike" // F tap: web strike, F hold: yank
  | "dodge" // Q
  | "wings" // C in air: toggle web wings
  | "dive" // hold Z in air
  | "gadget" // G: use gadget
  | "gadgetNext" // Tab: next gadget
  | "heal" // H
  | "finisher" // X
  | "scan" // V: spider-sense pulse, shows nearby activities
  | "reset"; // hold R 1 s: back to the spawn roof

export type Input = {
  wish: THREE.Vector3; // camera-relative flat move direction, unit length or zero
  look: THREE.Vector3; // camera forward, unit length
  camPos: THREE.Vector3;
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>; // went down this frame
  released: ReadonlySet<Action>; // went up this frame
  holdTime: (a: Action) => number; // seconds the action has been held, 0 if up
  swingFromMouse: boolean; // the swing hold comes from LMB, so it may start from the ground
  chain: boolean; // settings "Hold to chain swings": a held swing fires the next web by itself
};

export type PlayerMode = "ground" | "air" | "swing" | "wall" | "zip" | "perch" | "wings" | "launch";

export type HeroPose =
  | "idle" | "run" | "sprint" | "air" | "dive" | "swing" | "zip" | "crouch" | "wall" | "flip" | "spin" | "kick" | "land"
  | "perch" | "launch" | "wings"
  | "punch1" | "punch2" | "punch3" | "punch4" | "uppercut" | "airPunch" | "dodge" | "webShoot" | "yank" | "throw" | "finisher" | "hurt" | "down"
  | "wave" | "fistBump" | "selfie" | "handshake" | "hug"
  | "swim" | "backflip" | "corkscrew" | "split" | "takedown" | "counter" | "grabbed";

export type Sfx =
  | "thwip" | "zip" | "land" | "bigLand" | "collect" | "checkpoint" | "hit" | "ko" | "whoosh" | "trick" | "complete" | "fail" | "start" | "levelUp" | "countdown" | "go" | "siren" | "ui"
  | "punch" | "punchHeavy" | "dodge" | "perfectDodge" | "spiderSense" | "webShot" | "webImpact" | "whiff" | "glide" | "finisher" | "hurt" | "heal" | "focusFull"
  | "bossIntro" | "bossPhase" | "bossDefeat" | "cheer" | "gasp" | "photo" | "gunshot" | "rocket" | "explosion" | "shock" | "metal" | "fistBump" | "ping"
  | "takedown" | "alert" | "unlock" | "shutter" | "charge";

export type MusicState = "menu" | "explore" | "swing" | "combat" | "boss" | "race" | "stealth" | "victory";

export type GameEvent =
  | { type: "sfx"; name: Sfx; pan?: number; volume?: number }
  | { type: "toast"; title: string; text?: string }
  | { type: "xp"; amount: number; reason: string }
  | { type: "shake"; strength: number }
  | { type: "kick"; x: number; z: number; strength: number } // camera jolt along a flat hit direction
  | { type: "slowmo"; scale: number; duration: number }
  | { type: "hurt"; amount: number } // damage to the player, fraction of max health 0..1
  | { type: "penalty"; reason: string } // a civilian was endangered; costs XP
  | { type: "music"; state: MusicState; duration: number } // force a music state for a while (boss intro, victory)
  | { type: "token"; amount: number; reason: string }; // suit tokens, spent in the suit menu

// Modules with progress implement this. game.ts stores every snapshot under one localStorage key.
// restore() gets what snapshot() returned in an earlier session, or garbage from an old version: validate it.
export interface Saveable {
  snapshot(): unknown;
  restore(data: unknown): void;
}

// The player as other modules see it. player.ts implements it.
export interface PlayerApi {
  readonly pos: THREE.Vector3; // body center, feet are 0.95 m below
  readonly vel: THREE.Vector3;
  readonly mode: PlayerMode;
  readonly facing: THREE.Vector3; // flat unit vector
  readonly grounded: boolean;
  readonly airTime: number;
  readonly aim: AimState; // what the next swing press would use, refreshed every frame
  readonly swingCue: number; // 0..1, strength of the release boost window right now
  // Combat control. While busy, movement input is ignored and the given pose is shown.
  act(pose: HeroPose, progress: number): void; // call every frame the action runs
  lunge(to: THREE.Vector3, speed: number): void; // move toward a point this frame (melee close-in)
  push(impulse: THREE.Vector3): void; // add velocity (knockback, launch)
  face(dir: THREE.Vector3): void;
  teleport(pos: THREE.Vector3): void;
  busy: boolean; // set by combat while an attack or dodge animation runs
}

export type AimKind = "none" | "aim" | "auto" | "far" | "blocked"; // aim: anchor under the crosshair, auto: fallback pick
export type AimState = { kind: AimKind; dist: number; point: THREE.Vector3 };

export type Marker = {
  x: number;
  z: number;
  kind: "race" | "crime" | "chase" | "collectible" | "checkpoint" | "enemy" | "boss" | "photo" | "cache" | "request" | "pigeon" | "hideout" | "challenge" | "civilian";
};

export type Objective = { title: string; text: string; timer?: number; progress?: string; medal?: string; target?: { x: number; y: number; z: number } };

export type HudState = {
  playing: boolean;
  fps: number;
  speed: number; // km/h
  height: number;
  x: number;
  z: number;
  heading: number; // camera yaw, forward = (sin, cos)
  health: number; // 0..1
  focus: number; // 0..focusMax, fractional
  focusMax: number;
  inCombat: boolean;
  sense: null | { level: "white" | "red"; x: number; y: number }; // screen position 0..1 above the hero head
  boss: null | { name: string; title: string; health: number; phase: number; phases: number };
  gadget: null | { name: string; charges: number; max: number };
  objective: Objective | null;
  prompts: { key: string; label: string }[];
  markers: Marker[];
  combo: number;
  tokens: number;
  clock: number; // time of day in hours, 0..24
  aim: AimKind;
  swingCue: number;
  mode: PlayerMode;
  aimDist: number;
  stealth: null | { hidden: boolean; alert: number }; // set while unaware enemies are near; alert 0..1 is the highest suspicion
  progress: {
    level: number;
    levelProgress: number;
    collected: number;
    totalCollectibles: number;
    completed: Record<string, number>; // e.g. races, crimes, chases, bosses, photos
    districts: { name: string; pct: number }[]; // pct is 0..100
  };
};
