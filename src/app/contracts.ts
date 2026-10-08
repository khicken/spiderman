import type * as THREE from "three";

// Shared types between modules. Change only with the lead.

export type Action =
  | "swing" // hold LMB with no enemy near, or hold Shift in air (Shift on ground: parkour sprint)
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
  | "scan"; // V: spider-sense pulse, shows nearby activities

export type Input = {
  wish: THREE.Vector3; // camera-relative flat move direction, unit length or zero
  look: THREE.Vector3; // camera forward, unit length
  camPos: THREE.Vector3;
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>; // went down this frame
  released: ReadonlySet<Action>; // went up this frame
  holdTime: (a: Action) => number; // seconds the action has been held, 0 if up
  swingFromMouse: boolean; // the swing hold comes from LMB, so it may start from the ground
};

export type PlayerMode = "ground" | "air" | "swing" | "wall" | "zip" | "perch" | "wings" | "launch";

export type HeroPose =
  | "idle" | "run" | "sprint" | "air" | "dive" | "swing" | "zip" | "crouch" | "wall" | "flip" | "spin" | "kick" | "land"
  | "perch" | "launch" | "wings"
  | "punch1" | "punch2" | "punch3" | "punch4" | "uppercut" | "airPunch" | "dodge" | "webShoot" | "yank" | "throw" | "finisher" | "hurt" | "down"
  | "wave" | "fistBump" | "selfie";

export type Sfx =
  | "thwip" | "zip" | "land" | "bigLand" | "collect" | "checkpoint" | "hit" | "ko" | "whoosh" | "trick" | "complete" | "fail" | "start" | "levelUp" | "countdown" | "go" | "siren" | "ui"
  | "punch" | "punchHeavy" | "dodge" | "perfectDodge" | "spiderSense" | "webShot" | "webImpact" | "whiff" | "glide" | "finisher" | "hurt" | "heal" | "focusFull"
  | "bossIntro" | "bossPhase" | "bossDefeat" | "cheer" | "gasp" | "photo" | "gunshot" | "rocket" | "explosion" | "shock" | "metal" | "fistBump" | "ping";

export type MusicState = "menu" | "explore" | "swing" | "combat" | "boss" | "race" | "stealth" | "victory";

export type GameEvent =
  | { type: "sfx"; name: Sfx; pan?: number; volume?: number }
  | { type: "toast"; title: string; text?: string }
  | { type: "xp"; amount: number; reason: string }
  | { type: "shake"; strength: number }
  | { type: "slowmo"; scale: number; duration: number }
  | { type: "hurt"; amount: number } // damage to the player, fraction of max health 0..1
  | { type: "penalty"; reason: string } // a civilian was endangered; costs XP
  | { type: "music"; state: MusicState; duration: number }; // force a music state for a while (boss intro, victory)

// The player as other modules see it. player.ts implements it.
export interface PlayerApi {
  readonly pos: THREE.Vector3; // body center, feet are 0.95 m below
  readonly vel: THREE.Vector3;
  readonly mode: PlayerMode;
  readonly facing: THREE.Vector3; // flat unit vector
  readonly grounded: boolean;
  readonly airTime: number;
  // Combat control. While busy, movement input is ignored and the given pose is shown.
  act(pose: HeroPose, progress: number): void; // call every frame the action runs
  lunge(to: THREE.Vector3, speed: number): void; // move toward a point this frame (melee close-in)
  push(impulse: THREE.Vector3): void; // add velocity (knockback, launch)
  face(dir: THREE.Vector3): void;
  teleport(pos: THREE.Vector3): void;
  busy: boolean; // set by combat while an attack or dodge animation runs
}

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
  progress: {
    level: number;
    levelProgress: number;
    collected: number;
    totalCollectibles: number;
    completed: Record<string, number>; // e.g. races, crimes, chases, bosses, photos
    districts: { name: string; pct: number }[]; // pct is 0..100
  };
};
