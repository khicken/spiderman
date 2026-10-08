import type * as THREE from "three";

// The interfaces between modules. Each module owner implements its part exactly.
// Units: meters, seconds, radians. +y is up. Yaw 0 faces +z.

export type Quality = "low" | "medium" | "high";

export type TitanKind = "normal" | "abnormal" | "crawler" | "female" | "armored" | "beast" | "smiler" | "runner" | "climber";
export type TitanPart = "nape" | "eyes" | "armL" | "armR" | "legL" | "legR";
export type HitZone = TitanPart | "body";

export type Action =
  | "anchorL" // hold LMB
  | "anchorR" // hold RMB
  | "gas" // hold Space: boost, Space on the ground: jump
  | "dash" // Shift: gas dash in the move direction
  | "attack" // hold E to charge, release to strike
  | "lock" // Q: lock on or off
  | "cycle" // Tab or mouse wheel: next part on the locked titan
  | "autoHook" // F: fire both anchors at the locked titan
  | "swap"; // R: swap blades

export type Input = {
  wish: THREE.Vector3; // camera-relative flat move direction, unit length or zero
  look: THREE.Vector3; // camera forward, unit length
  camPos: THREE.Vector3;
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>; // went down this frame
  released: ReadonlySet<Action>; // went up this frame
  holdTime: (a: Action) => number; // seconds held, 0 if up
};

export type Sfx =
  | "anchorFire" | "anchorHit" | "anchorMiss" | "reel" | "release" | "gasBurst" | "gasDash" | "land" | "roll"
  | "bladeDraw" | "charge" | "slash" | "slashHit" | "slashCrit" | "sever" | "napeKill" | "clang" | "bladeBreak" | "bladeSwap" | "resupply"
  | "hurt" | "grabbed" | "bite" | "escape" | "death"
  | "stomp" | "swat" | "titanStep" | "roar" | "titanHurt" | "titanFall" | "steamHiss" | "harden"
  | "horn" | "bell" | "gateBreak" | "lightning" | "lock" | "lockCycle" | "ui";

export type MusicState = "title" | "intro" | "explore" | "battle" | "boss" | "defeat";
export type Stinger = "wave" | "waveClear" | "kill" | "bossIntro" | "bossDown" | "death";

export type GameEvent =
  | { type: "sfx"; name: Sfx; volume?: number; at?: THREE.Vector3 } // `at` makes game.ts pan and fade it by distance
  | { type: "stinger"; name: Stinger }
  | { type: "toast"; title: string; text?: string; touch?: string; low?: boolean } // touch: text for touch screens, low: drop when busy
  | { type: "banner"; jp: string; en: string; text?: string } // big center card: waves and bosses
  | { type: "radio"; who: string; text: string } // squad callout line
  | { type: "callout"; text: string } // short line at the crosshair
  | { type: "score"; amount: number; reason: string }
  | { type: "shake"; strength: number }
  | { type: "hitstop"; duration: number } // freeze the simulation, keep rendering
  | { type: "slowmo"; scale: number; duration: number }
  | { type: "impact"; kind: "hit" | "crit" | "kill" } // anime impact frame in render
  | { type: "hurt"; amount: number; from?: THREE.Vector3 } // fraction of max health
  | { type: "kill"; height: number; kind: TitanKind; speed: number };

// ---- render.ts: createRender(canvas: HTMLCanvasElement): Render
export interface Render {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  setQuality(q: Quality): void;
  resize(): void;
  frame(dt: number, focus: THREE.Vector3, speed01: number): void; // speed01 drives speed lines
  impact(kind: "hit" | "crit" | "kill"): void;
  render(): void;
  dispose(): void;
}

// ---- toon.ts: shared materials so every module draws in one art style
// export function toon(opts: ToonOpts): THREE.Material
export type ToonOpts = {
  color: THREE.ColorRepresentation;
  map?: THREE.Texture;
  vertexColors?: boolean;
  emissive?: THREE.ColorRepresentation;
  side?: THREE.Side;
  outline?: boolean; // default true; false for things like particles or glass
};

// ---- fx.ts: createFx(scene: THREE.Scene): Fx
export interface Fx {
  steam(pos: THREE.Vector3, size: number, duration: number): void;
  steamFollow(at: () => THREE.Vector3 | null, size: number, duration: number): void; // stops when `at` returns null
  blood(pos: THREE.Vector3, dir: THREE.Vector3, size: number): void; // titan blood, evaporates to steam
  gas(pos: THREE.Vector3, dir: THREE.Vector3, strength: number): void; // ODM gas puff
  dust(pos: THREE.Vector3, size: number): void;
  slash(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void; // blade arc through three points
  update(dt: number, camera: THREE.Camera): void;
  setQuality(q: Quality): void;
  dispose(): void;
}

// ---- world.ts: createWorld(scene: THREE.Scene, fx: Fx): World
export interface World {
  readonly group: THREE.Group;
  readonly spawn: THREE.Vector3; // body center of the player at start
  readonly spawnYaw: number;
  readonly supplies: readonly THREE.Vector3[]; // ground points of supply depots
  readonly titanSpawns: readonly THREE.Vector3[]; // ground points outside the wall near the breach
  readonly breach: THREE.Vector3; // ground point just inside the broken gate
  readonly colossalHead: THREE.Vector3;
  readonly gateOpen: boolean;
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number, normal?: THREE.Vector3): number; // distance or -1, includes the ground
  // Resolves a player body: `pos` is the body center, feet are at pos.y - height / 2. Mutates pos and vel.
  collide(pos: THREE.Vector3, vel: THREE.Vector3, radius: number, height: number): { grounded: boolean; wall: THREE.Vector3 | null };
  // Pushes a titan (feet at pos, y ignored) out of anything taller than maxStep. Titans step over lower things.
  pushTitan(pos: THREE.Vector3, radius: number, maxStep: number): void;
  inside(x: number, z: number): boolean; // inside the walls
  kickGate(): GameEvent[]; // the Colossal Titan breaks the gate, once
  update(dt: number, t: number): GameEvent[];
  setQuality(q: Quality): void;
}

// ---- titans.ts: createTitans(scene: THREE.Scene, world: World, fx: Fx): Titans
export interface TitanView {
  readonly id: number;
  readonly kind: TitanKind;
  readonly name: string;
  readonly height: number;
  readonly pos: THREE.Vector3; // feet
  readonly yaw: number;
  readonly alive: boolean;
}
export type TitanHit = { t: number; point: THREE.Vector3; titan: TitanView; zone: HitZone; obj: THREE.Object3D }; // anchors attach to obj
export type Blade = { pos: THREE.Vector3; dir: THREE.Vector3; speed: number; charge: number; radius: number }; // charge 0..1, 1 is a perfect release
export type StrikeResult = { events: GameEvent[]; zone: HitZone | null; titan: TitanView | null; killed: boolean };
export type PlayerView = { pos: THREE.Vector3; vel: THREE.Vector3; alive: boolean; grounded: boolean };
export interface Titans {
  update(dt: number, t: number, player: PlayerView): GameEvent[];
  start(): void; // starts wave 1
  readonly wave: number;
  readonly kills: number;
  readonly left: number;
  readonly breakT: number; // seconds to the next wave, 0 in a wave
  list(): readonly TitanView[];
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): TitanHit | null;
  partPos(titan: TitanView, part: TitanPart, out: THREE.Vector3): THREE.Vector3 | null; // null when severed or dead
  partHealth(titan: TitanView, part: TitanPart): number; // 0..1, 0 when severed
  nearest(pos: THREE.Vector3, look: THREE.Vector3, maxDist: number): TitanView | null;
  strike(blade: Blade, target: { titan: TitanView; part: TitanPart } | null): StrikeResult;
  held(): THREE.Vector3 | null; // where the player is held, null when free
  struggle(): GameEvent[]; // one mash while held
  readonly escape: number | null; // 0..1 while held
  pushOut(pos: THREE.Vector3, radius: number, vel: THREE.Vector3): void;
  boss(): { name: string; kind: TitanKind; health: number; hardened: boolean } | null;
  dispose(): void;
}

// ---- input.ts: createInput(canvas, onSystem: (code: string) => void): Controls
// Touch UI drives the same actions through VirtualPad.
export interface VirtualPad {
  down(a: Action): void;
  up(a: Action): void;
  stick(x: number, y: number): void; // move stick, -1..1, y up = forward
  look(dx: number, dy: number): void; // pixels, same scale as mouse movement
}
export interface Controls {
  readonly state: Input;
  readonly virtual: VirtualPad;
  enabled: boolean;
  readonly mouseIdle: number;
  takeMouse(out: { x: number; y: number }): { x: number; y: number };
  aim(yaw: number, pitch: number, camPos: THREE.Vector3): void;
  endFrame(): void;
  dispose(): void;
}

// ---- camera.ts: createCameraRig(camera: THREE.PerspectiveCamera, world: World): CameraRig
export type CameraView = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mode: PlayerMode;
  lockPoint: THREE.Vector3 | null;
  charge: number; // 0..1
};
export interface CameraRig {
  readonly yaw: number;
  readonly pitch: number;
  configure(s: { sensitivity?: number; invertY?: boolean }): void;
  mouse(dx: number, dy: number): void;
  addShake(strength: number): void;
  update(dt: number, view: CameraView, playing: boolean, mouseIdle: number): void;
  cinematic(pos: THREE.Vector3 | null, look?: THREE.Vector3, fov?: number): void; // null returns control
}

// ---- player.ts: createPlayer(scene: THREE.Scene, world: World, titans: Titans, fx: Fx): Player
export type PlayerMode = "ground" | "air" | "reel" | "wall" | "held" | "dead";
export type Lock = { titan: TitanView; part: TitanPart };
export type Hint = { key: string; text: string; touch?: string }; // key "" shows no key cap
export type PlayerHud = {
  hint: Hint | null; // the next useful action for a new player
  health: number;
  gas: number;
  blades: number; // spare sets
  sharp: number; // current set, 0..1
  hooks: [boolean, boolean];
  charge: number | null;
  aim: "none" | "world" | "titan";
  aimDist: number;
  supply: boolean;
  dead: boolean;
  combo: number;
};
export interface Player {
  readonly pos: THREE.Vector3; // body center
  readonly vel: THREE.Vector3;
  readonly mode: PlayerMode;
  readonly alive: boolean;
  readonly grounded: boolean;
  readonly lock: Lock | null;
  update(dt: number, input: Input, playing: boolean): GameEvent[]; // owns anchors, lock, attacks, gas, blades
  damage(amount: number, from?: THREE.Vector3): GameEvent[];
  respawn(): void;
  hud(): PlayerHud;
  cameraView(): CameraView;
  setVisible(on: boolean): void;
  setCharacter(id: string): void; // swaps the model and stats
  dispose(): void;
}

// ---- audio.ts: createAudio(): Audio
export interface Audio {
  sfx(name: Sfx, o?: { volume?: number; pan?: number }): void;
  stinger(name: Stinger): void;
  update(dt: number, s: { music: MusicState; speed: number; gas: boolean; danger: number }): void; // danger 0..1
  setMuted(m: boolean): void;
  setVolume(v: number): void;
  resume(): Promise<void>;
  dispose(): void;
}

// ---- allies.ts: createAllies(scene: THREE.Scene, world: World, titans: Titans, fx: Fx): Allies
export type SquadOrder = "attack" | "regroup";
export type SquadHud = { alive: number; max: number; order: SquadOrder };
export type SquadLead = { pos: THREE.Vector3; vel: THREE.Vector3; alive: boolean; lock: Lock | null };
export interface Allies {
  update(dt: number, t: number, lead: SquadLead, yaw: number): GameEvent[]; // yaw: camera yaw for clock callouts
  order(o: SquadOrder): GameEvent[];
  toggle(): GameEvent[]; // attack my target <-> regroup
  hud(): SquadHud;
  dispose(): void;
}

// ---- game.ts to the UI
export type TitanBlip = { bearing: number; dist: number; height: number; kind: TitanKind };
export type HudState = {
  playing: boolean;
  intro: boolean; // the opening cinematic plays
  fps: number;
  speed: number; // km/h
  wave: number;
  kills: number;
  score: number;
  left: number;
  breakT: number;
  escape: number | null;
  lock: { part: TitanPart; health: number; height: number; kind: TitanKind; name: string } | null;
  boss: { name: string; kind: TitanKind; health: number; hardened: boolean } | null;
  blips: TitanBlip[];
  depots: { bearing: number; dist: number }[];
  squad: SquadHud;
} & PlayerHud;
