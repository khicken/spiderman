import type * as THREE from "three";

export type Box = { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };

export type Action = "hookL" | "hookR" | "jump" | "boost" | "slash" | "lock" | "reload";

export type Input = {
  wish: THREE.Vector3;
  look: THREE.Vector3;
  camPos: THREE.Vector3;
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>;
  released: ReadonlySet<Action>;
};

export type Sfx =
  | "hook" | "hookHit" | "hookMiss" | "retract" | "burst" | "slash" | "slashHit" | "napeKill" | "cripple" | "dull" | "reload" | "refill"
  | "hurt" | "grabbed" | "escape" | "death" | "stomp" | "roar" | "horn" | "land" | "lock" | "start";

export type MusicState = "menu" | "calm" | "battle";

export type GameEvent =
  | { type: "sfx"; name: Sfx; volume?: number; pan?: number }
  | { type: "toast"; title: string; text?: string }
  | { type: "score"; amount: number; reason: string }
  | { type: "shake"; strength: number }
  | { type: "slowmo"; scale: number; duration: number }
  | { type: "hurt"; amount: number }; // fraction of max health, 0..1

export type TitanBlip = { bearing: number; dist: number; height: number; abnormal: boolean };

export type HudState = {
  playing: boolean;
  fps: number;
  speed: number; // km/h
  health: number; // 0..1
  gas: number; // 0..1
  blades: number; // spare blade sets
  sharp: number; // current blade sharpness, 0..1
  wave: number;
  kills: number;
  score: number;
  left: number; // titans alive in this wave
  breakT: number; // seconds until the next wave, 0 during a wave
  aim: "none" | "world" | "titan";
  aimDist: number;
  hooks: [boolean, boolean];
  escape: number | null; // grab escape progress 0..1, null when free
  locked: boolean;
  supply: boolean; // inside a supply zone
  dead: boolean;
  blips: TitanBlip[];
};
