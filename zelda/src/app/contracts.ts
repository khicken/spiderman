import type * as THREE from "three";

// =====================================================================================================================
// HOLLOWMERE: module contracts. Every builder implements its part exactly as written here.
// This file is frozen for builders. Need something extra? Export it from your own file as an `XPlus` type and list the
// request in your final summary. Read DESIGN.md for the numbers behind the tables below.
//
// UNITS: meters, seconds, radians. +y is up. Sea level is y = 0 (SEA_LEVEL).
// WORLD: origin at the island's center on the sea surface. The island fits inside x, z in [-WORLD.half, +WORLD.half].
//        NORTH is -z, EAST is +x (the in-game map draws -z at the top, +x to the right).
// YAW:   facing angle around +y. Facing direction = (sin(yaw), 0, cos(yaw)), the three.js convention where
//        object.rotation.y = yaw turns local +z toward that direction. Models face local +z.
//        yaw 0 faces south (+z), yaw PI faces north (-z), yaw PI/2 faces east (+x).
//        Compass bearing (0 = north, clockwise, radians) of a direction (dx, dz) is atan2(dx, -dz).
// CAMERA YAW: CameraRig.yaw uses the same convention for the direction the camera LOOKS. Stick "forward" (move.y = +1)
//        moves the player toward F = (sin(camYaw), 0, cos(camYaw)); move.x = +1 moves to the camera's right,
//        R = (-cos(camYaw), 0, sin(camYaw)). Turning the view right DEcreases yaw (InputState.look.x > 0 = turn right).
// TIME:  game.ts owns the single requestAnimationFrame loop. dt is clamped to MAX_FRAME_DT. Modules that move fast
//        (player, projectiles) substep internally (at most SUBSTEP_MAX m per substep).
// HEALTH: the player's hp is counted in QUARTER hearts (1 heart = 4 hp). Enemy hp is in plain damage points.
// ALLOC: no allocations inside update paths. Preallocate. GameEvent objects are the only exception (they are rare);
//        an events array returned from update() is reused by its owner and is only valid until that owner's next update.
//        Event payload vectors are plain V3 copies, never live THREE.Vector3 references.
// OWNERSHIP: each module mutates only its own state. Cross-module effects travel as GameEvents routed by game.ts
//        (example: combat emits "hit"; player/enemies apply the damage in their own handle()).
// =====================================================================================================================

export type V3 = { x: number; y: number; z: number }; // THREE.Vector3 satisfies this.
export type V2 = { x: number; y: number };

export const MAX_FRAME_DT = 1 / 30; // frame time clamp (s)
export const SUBSTEP_MAX = 0.25; // max travel per physics substep (m)
export const HUD_HZ = 10; // HudSnapshot push rate
export const GRAVITY = 22; // m/s^2, slightly heavier than real for snappy jumps

// ---------------------------------------------------------------------------------------------------------------------
// World layout. All landmark positions are (x, z) on the ground plane. Heights come from World.heightAt().
// The terrain owner shapes the heightmap so every LANDMARK site is flat inside `flat` meters and blends out to `r`.
// ---------------------------------------------------------------------------------------------------------------------
export const SEA_LEVEL = 0;
export const WORLD = {
  half: 640, // heightmap extent: x, z in [-640, 640]
  islandR: 560, // mean coast radius (coast wobbles +-40 m with noise)
  chunk: 64, // terrain chunk size (m): 20 x 20 chunks
  chunks: 20,
  maxHeight: 230, // nothing in the heightmap is higher than this
  seed: 1337, // default world seed. The island is the same for every player.
  oceanFloor: -30, // heightAt() far outside the coast
} as const;

export type LandmarkId =
  | "shrine" | "village" | "whisperwood" | "cliffs" | "lake" | "cinder" | "spire"
  | "beacon-cliff" | "beacon-wood" | "beacon-lake" | "beacon-bluff";

export interface Landmark {
  id: LandmarkId;
  name: string; // shown on the map and in the "areaEnter" banner
  x: number;
  z: number;
  r: number; // area radius (m) for "areaEnter" and map labels
  flat: number; // terrain flattened inside this radius (0 = do not flatten)
}

export const LANDMARKS: readonly Landmark[] = [
  { id: "shrine", name: "Hollow Shrine", x: -60, z: 380, r: 45, flat: 22 },
  { id: "village", name: "Mirebrook Ruin", x: -250, z: 170, r: 70, flat: 40 },
  { id: "whisperwood", name: "Whisperwood", x: -330, z: -150, r: 170, flat: 0 },
  { id: "cliffs", name: "Ashen Cliffs", x: 370, z: 110, r: 120, flat: 0 },
  { id: "lake", name: "Sunken Lake", x: 230, z: -300, r: 110, flat: 0 },
  { id: "cinder", name: "Mt. Cinder", x: 0, z: -40, r: 230, flat: 0 },
  { id: "spire", name: "Gloam Spire", x: 0, z: -40, r: 40, flat: 34 },
  { id: "beacon-cliff", name: "Cliffwatch Beacon", x: 420, z: 150, r: 30, flat: 16 },
  { id: "beacon-wood", name: "Thornring Beacon", x: -360, z: -190, r: 35, flat: 26 },
  { id: "beacon-lake", name: "Drowned Beacon", x: 250, z: -330, r: 30, flat: 18 },
  { id: "beacon-bluff", name: "Windward Beacon", x: -140, z: -430, r: 35, flat: 20 },
];

export const PLAYER_SPAWN: V3 = { x: -60, y: 0, z: 368 }; // y is resolved with heightAt at spawn; faces north (yaw PI)

/** Mt. Cinder cone. Peak plateau (the Spire arena) is flat at `peak` inside LANDMARKS spire.flat. */
export const MOUNTAIN = { x: 0, z: -40, baseR: 260, peak: 190 } as const;
/** Ashen Cliffs: a near-vertical rock wall along this east-coast segment, top plateau at `top`. */
export const CLIFFS = { x0: 330, z0: 20, x1: 400, z1: 220, top: 95, base: 12 } as const;
/** Sunken Lake: a bowl with a flat water surface. */
export const LAKE = { x: 230, z: -300, r: 95, level: 34, depth: 9 } as const;
/** River from the mountain flank to the south-west sea, through Mirebrook Ruin. Width in m. Water surface = bed + 1.2 m. */
export const RIVER: readonly { x: number; z: number; w: number }[] = [
  { x: -60, z: 80, w: 6 },
  { x: -150, z: 120, w: 9 },
  { x: -250, z: 150, w: 12 },
  { x: -330, z: 230, w: 14 },
  { x: -420, z: 330, w: 18 },
  { x: -500, z: 420, w: 24 },
];
/** Whisperwood forest disc (dense trees, darker grass, fog). */
export const FOREST = { x: -330, z: -150, r: 190 } as const;

export type BeaconId = 0 | 1 | 2 | 3; // 0 cliff (climb/glide), 1 wood (combat), 2 lake (blocks), 3 bluff (archery)
export const BEACON_LANDMARK: readonly LandmarkId[] = ["beacon-cliff", "beacon-wood", "beacon-lake", "beacon-bluff"];
export const BEACON_COLOR: readonly string[] = ["#f08a3c", "#e2b04a", "#6fc7c0", "#c58be0"]; // flame tint per beacon

export type Biome = "beach" | "meadow" | "forest" | "ash" | "highland" | "lakeshore" | "summit" | "sea";
export type Surface = "grass" | "dirt" | "rock" | "sand" | "stone" | "wood" | "water" | "ash";

// ---------------------------------------------------------------------------------------------------------------------
// World query API (pure data, no rendering). Files: world.ts, world-*.ts (owner: terrain).
// Every query is deterministic for a seed and allocation free. Hot paths (heightAt) must cost under ~1 us.
// ---------------------------------------------------------------------------------------------------------------------
export type ColliderTag = "solid" | "climbable" | "pushable" | "water-gate" | "barrier" | "tree" | "plate";

/** Axis-aligned box collider. Static scenery is AABB only; rotated props use their bounding box or several boxes. */
export interface Box {
  id: number; // assigned by addBox
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  tag: ColliderTag;
  owner: string; // module + item id, e.g. "landmarks:block-2"; lets a module find its own boxes
}

export interface RayHit {
  hit: boolean;
  dist: number;
  point: THREE.Vector3; // caller-owned, written in place
  normal: THREE.Vector3; // caller-owned, written in place
  kind: "terrain" | "box" | "water";
  box: Box | null; // when kind === "box"
}

export interface World {
  readonly seed: number;
  /** Terrain height at (x, z). Outside the island it falls to WORLD.oceanFloor. Bilinear on the heightmap grid. */
  heightAt(x: number, z: number): number;
  /** Unit terrain normal at (x, z), written into `out`. */
  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** Highest walkable surface (terrain or box top) at (x, z) that is at or below y + 0.5. */
  groundAt(x: number, y: number, z: number): number;
  /** Water surface height at (x, z): SEA_LEVEL in the sea, LAKE.level in the lake, river surface in the river. -Infinity if none. */
  waterAt(x: number, z: number): number;
  /** True when the point is below the water surface at (x, z). */
  isWater(x: number, y: number, z: number): boolean;
  /** True when a surface with this normal can be climbed (slope >= 50 deg) or the box is tagged "climbable" / "solid". */
  isClimbable(normal: V3, box?: Box | null): boolean;
  surfaceAt(x: number, z: number): Surface;
  biomeAt(x: number, z: number): Biome;
  /** Ray against terrain (march + bisect), boxes (slab test) and optionally water. Direction need not be unit. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, out: RayHit, water?: boolean): boolean;
  addBox(b: Omit<Box, "id">): number;
  moveBox(id: number, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void;
  setBoxTag(id: number, tag: ColliderTag): void;
  removeBox(id: number): void;
  /** Boxes overlapping the vertical column around (x, z) within r. Returns ONE SHARED Set: do not call near() again while looping over it. */
  near(x: number, z: number, r: number): ReadonlySet<Box>;
  readonly landmarks: readonly Landmark[];
  /** Nearest landmark whose area contains (x, z), smallest r first. null in the wilds. */
  areaAt(x: number, z: number): Landmark | null;
  dispose(): void;
}
/** world.ts: export function createWorld(seed: number): World */
export type CreateWorld = (seed: number) => World;

// ---------------------------------------------------------------------------------------------------------------------
// Quality presets. One table holds every heavy setting. Render picks the start preset with detectQuality().
// Dynamic resolution moves renderScale inside [minScale, maxScale] to hold the target frame rate
// (60 fps on laptops/desktops, 30 fps on touch devices: Platform.touch).
// ---------------------------------------------------------------------------------------------------------------------
export type Quality = "low" | "medium" | "high" | "ultra";

export interface QualityPreset {
  label: string;
  pixelRatio: number; // cap on devicePixelRatio
  minScale: number; // dynamic resolution floor (fraction of pixelRatio-sized canvas)
  maxScale: number; // dynamic resolution ceiling
  shadow: number; // shadow map size, 0 = off (blob shadows only)
  shadowDist: number; // shadow camera half extent around the player (m)
  outline: 0 | 1 | 2; // ink outline: 0 depth edges at half res, 1 depth edges, 2 depth + normal edges
  bloom: boolean; // lantern and beacon glow
  drawDist: number; // camera far plane and terrain chunk cull radius (m)
  fogNear: number;
  fogFar: number;
  terrainLod: readonly [number, number, number]; // distance (m) where chunk LOD 0 -> 1, 1 -> 2, 2 -> 3
  grassDensity: number; // 0..1 blades per m^2 fraction of the max (ultra = 1 = 24 blades/m^2 near the camera)
  grassDist: number; // grass fades out by this distance (m)
  treeDist: number; // trees drawn to this distance (m)
  treeDetailDist: number; // full mesh trees inside, billboard impostors outside
  rockDist: number;
  water: 0 | 1 | 2; // 0 flat tinted, 1 waves + foam, 2 waves + foam + screen-space refraction
  particles: number; // particle pool size (one draw call)
  rainDrops: number; // rain streak instances at full rain
  enemyLodDist: number; // enemies beyond this distance animate at 10 Hz
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    label: "Low", pixelRatio: 1, minScale: 0.5, maxScale: 1, shadow: 0, shadowDist: 0, outline: 0, bloom: false,
    drawDist: 420, fogNear: 120, fogFar: 400, terrainLod: [80, 160, 280], grassDensity: 0.2, grassDist: 30,
    treeDist: 260, treeDetailDist: 45, rockDist: 140, water: 0, particles: 256, rainDrops: 1200, enemyLodDist: 40,
  },
  medium: {
    label: "Medium", pixelRatio: 1.25, minScale: 0.6, maxScale: 1, shadow: 1024, shadowDist: 40, outline: 1, bloom: false,
    drawDist: 650, fogNear: 180, fogFar: 620, terrainLod: [110, 220, 400], grassDensity: 0.4, grassDist: 45,
    treeDist: 420, treeDetailDist: 70, rockDist: 220, water: 1, particles: 512, rainDrops: 2500, enemyLodDist: 60,
  },
  high: {
    label: "High", pixelRatio: 1.5, minScale: 0.7, maxScale: 1, shadow: 2048, shadowDist: 60, outline: 2, bloom: true,
    drawDist: 900, fogNear: 260, fogFar: 880, terrainLod: [150, 300, 550], grassDensity: 0.7, grassDist: 65,
    treeDist: 650, treeDetailDist: 100, rockDist: 320, water: 2, particles: 1024, rainDrops: 5000, enemyLodDist: 90,
  },
  ultra: {
    label: "Ultra", pixelRatio: 2, minScale: 0.8, maxScale: 1, shadow: 4096, shadowDist: 80, outline: 2, bloom: true,
    drawDist: 1300, fogNear: 360, fogFar: 1250, terrainLod: [200, 400, 750], grassDensity: 1, grassDist: 90,
    treeDist: 1000, treeDetailDist: 150, rockDist: 450, water: 2, particles: 2048, rainDrops: 9000, enemyLodDist: 140,
  },
};

/** Device facts, measured once by state.ts detectPlatform(). */
export interface Platform {
  touch: boolean; // coarse pointer or touch points > 0 with no fine pointer
  phone: boolean; // touch and min(screen w, h) < 600
  gpu: string; // unmasked renderer string or ""
  weakGpu: boolean; // software, old Intel HD, Mali-4xx/T, Adreno 3xx/4xx, PowerVR, or unknown on touch
  targetFps: 30 | 60;
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings (persisted by the UI in localStorage "hollowmere.settings.v1").
// ---------------------------------------------------------------------------------------------------------------------
export interface Settings {
  quality: Quality | "auto";
  dynamicRes: boolean;
  master: number; // 0..1
  music: number; // 0..1
  sfx: number; // 0..1
  lookSens: number; // 0.25..3, 1 = default
  invertY: boolean;
  touchScale: number; // 0.75..1.4 touch button size
  showFps: boolean;
  reduceMotion: boolean; // no camera shake, gentler cinematics and HUD motion
  renderScale: number; // 0.5..1 multiplier on the preset pixel ratio
  ambience: number; // 0..1 ambience bed volume
}
export const DEFAULT_SETTINGS: Settings = {
  quality: "auto", dynamicRes: true, master: 0.8, music: 0.7, sfx: 0.9, lookSens: 1, invertY: false, touchScale: 1, showFps: false, reduceMotion: false, renderScale: 1, ambience: 1,
};

// ---------------------------------------------------------------------------------------------------------------------
// Tuning. Player, combat and enemy numbers. DESIGN.md explains them.
// ---------------------------------------------------------------------------------------------------------------------
export const PLAYER = {
  radius: 0.35, height: 1.7, eye: 1.5,
  walk: 3.0, run: 6.0, sprint: 9.0, // m/s
  accel: 40, airAccel: 10, turnRate: 12, // m/s^2, m/s^2, rad/s
  jumpV: 7.2, coyote: 0.12, jumpBuffer: 0.12, // m/s, s, s
  climb: 1.8, climbJump: 3.2, // m/s along the wall, m climb-jump burst
  glideFwd: 8.5, glideSink: 2.0, glideMinHeight: 2.5, // m/s, m/s, glider only opens this high above ground
  swim: 2.6, swimFast: 4.4,
  stepUp: 0.45, slopeWalk: 0.75, // max step height (m), min normal.y that counts as walkable ground
  // stamina is 0..staminaMax; 1 = one full ring
  staminaMax: 1, staminaRegen: 0.4, staminaDelay: 0.6,
  sprintCost: 0.18, climbCost: 0.11, climbJumpCost: 0.2, glideCost: 0.06, swimCost: 0.05, swimFastCost: 0.16,
  dodgeCost: 0.12, spinCost: 0.3, rainClimbMul: 1.5,
  // health in quarter hearts
  startHearts: 3, maxHearts: 12, shardsPerHeart: 4,
  fallSafe: 13, fallPerQuarter: 2.2, // m/s impact speed: above fallSafe lose 1 quarter per fallPerQuarter m/s
  drownPenalty: 2, // quarters lost when stamina runs out while swimming (respawn on last safe ground)
  hurtIFrames: 0.9, dodgeIFrames: 0.32, dodgeTime: 0.45, dodgeDist: 4.2,
  maxArrows: 30, startArrows: 15,
} as const;

export const SWORD = {
  combo: [10, 10, 16] as const, // damage per hit
  comboWindup: [0.08, 0.08, 0.14] as const, // s before the hit frame
  comboRecover: [0.28, 0.28, 0.42] as const, // s after the hit frame; next press inside recover chains
  reach: 2.0, arc: 2.2, // m, radians (horizontal sweep)
  chargeTime: 0.8, spinDamage: 26, spinReach: 2.6,
  parryWindow: 0.18, // s after raising the shield where a hit is parried
  parryStun: 1.4, riposte: 30, // enemy stun (s), damage of the counter strike during that stun
  blockChip: 0, // quarters taken through the shield (0: full block from the front 120 deg)
  blockArc: 2.1,
  knockback: 4, // m/s
  hitstop: 0.06, // s of global slow on a sword hit (game.ts applies it)
} as const;

export const BOW = {
  drawTime: 0.55, minDraw: 0.25, // s
  speedMin: 28, speedMax: 60, // m/s by draw fraction
  damageMin: 8, damageMax: 18,
  gravity: 9, // m/s^2 (arrows drop less than real)
  aimSlowMo: 0.5, // time scale while drawing in mid air (glide/jump), like a focus beat
  life: 4, // s before an arrow despawns
} as const;

export type EnemyKind = "brambling" | "mossback" | "wisp" | "warden";

export interface EnemySpec {
  hp: number;
  damage: number; // quarter hearts per hit
  walk: number; // m/s patrol
  chase: number; // m/s
  sight: number; // m aggro radius (halved when the player crouch-walks? not in v1)
  leash: number; // m from home before giving up
  reach: number; // m melee reach (or preferred range for wisps)
  windup: number; // s telegraph before the hit frame
  cooldown: number; // s between attacks
  radius: number; // body radius for collisions and hit tests
  height: number;
  glimmers: number; // dropped on death
}
export const ENEMY: Record<EnemyKind, EnemySpec> = {
  brambling: { hp: 30, damage: 2, walk: 2.2, chase: 6.6, sight: 18, leash: 40, reach: 1.4, windup: 0.35, cooldown: 1.0, radius: 0.4, height: 1.0, glimmers: 3 },
  mossback: { hp: 120, damage: 6, walk: 1.4, chase: 3.4, sight: 16, leash: 35, reach: 2.6, windup: 0.9, cooldown: 2.2, radius: 1.1, height: 2.6, glimmers: 10 },
  wisp: { hp: 40, damage: 3, walk: 2.0, chase: 4.0, sight: 32, leash: 50, reach: 18, windup: 0.8, cooldown: 2.6, radius: 0.45, height: 0.9, glimmers: 6 },
  warden: { hp: 600, damage: 6, walk: 2.4, chase: 5.0, sight: 60, leash: 80, reach: 4.0, windup: 0.75, cooldown: 1.6, radius: 2.2, height: 6.0, glimmers: 100 },
};
/** Boss phases start at these hp fractions (phase 1 at 1.0, phase 2 at 0.66, phase 3 at 0.33). */
export const WARDEN_PHASES = [1, 0.66, 0.33] as const;
export const WISP_BOLT = { speed: 16, life: 3, radius: 0.3 } as const;

/** Enemy camps. Enemies owner spawns these at start and respawns killed camps on "rest" (or 12 real minutes). */
export interface Camp { id: string; x: number; z: number; kinds: readonly EnemyKind[]; night?: boolean }
export const CAMPS: readonly Camp[] = [
  { id: "glade-edge", x: 40, z: 300, kinds: ["brambling", "brambling"] },
  { id: "village-n", x: -230, z: 110, kinds: ["brambling", "brambling", "brambling"] },
  { id: "village-bridge", x: -300, z: 200, kinds: ["mossback"] },
  { id: "wood-1", x: -260, z: -60, kinds: ["brambling", "brambling", "wisp"] },
  { id: "wood-2", x: -420, z: -100, kinds: ["mossback", "brambling"] },
  { id: "cliff-base", x: 300, z: 140, kinds: ["brambling", "wisp"] },
  { id: "cliff-top", x: 390, z: 60, kinds: ["wisp", "wisp"] },
  { id: "lake-shore", x: 140, z: -260, kinds: ["mossback", "brambling", "brambling"] },
  { id: "lake-ruin", x: 300, z: -360, kinds: ["wisp"] },
  { id: "bluff", x: -60, z: -380, kinds: ["brambling", "brambling", "mossback"] },
  { id: "cinder-path", x: 60, z: 60, kinds: ["mossback", "wisp"] },
  { id: "night-meadow", x: 120, z: 220, kinds: ["wisp", "wisp", "wisp"], night: true },
  { id: "night-wood", x: -340, z: -220, kinds: ["wisp", "wisp"], night: true },
];

// ---------------------------------------------------------------------------------------------------------------------
// Input. Files: input.ts, input-*.ts (owner: input-camera). Keyboard + mouse (pointer lock optional), touch, gamepad.
// ---------------------------------------------------------------------------------------------------------------------
export type Device = "keys" | "touch" | "pad";

export interface Btn {
  down: boolean; // held now
  pressed: boolean; // went down this frame
  released: boolean; // went up this frame
  held: number; // seconds held (0 when up)
}

export type BtnName =
  | "jump" // Space / A / touch jump: jump, climb-jump, let go while climbing with dodge
  | "attack" // LMB or J / X / touch sword: tap = combo, hold = charge spin
  | "block" // RMB-hold or K / LT / touch shield: shield up (parry window on raise)
  | "dodge" // Shift-tap or L / B / touch roll: dodge roll; on ground hold = sprint (keys use Shift hold)
  | "sprint" // Shift hold / B hold / touch: double tap stick to toggle (derived by input)
  | "bow" // F or MMB / RT / touch bow: hold to draw, release to shoot
  | "glide" // G / A in air / touch glide: open or close the glider
  | "lock" // Q or Tab / RB press / touch lock: toggle lock-on
  | "use" // E / Y / touch hand (appears only with a prompt): interact, pick up, read
  | "map" // M / View / touch map
  | "pause"; // Esc or P / Menu / touch pause

export interface InputState {
  device: Device; // last device that produced input (HUD swaps glyphs, touch overlay hides on keys/pad)
  move: V2; // -1..1 each axis, length <= 1. y = +1 forward (away from the camera), x = +1 right
  look: V2; // camera orbit delta for THIS frame in radians, x > 0 = turn right, y > 0 = look down (lookSens, invertY applied)
  zoom: number; // camera distance delta this frame (wheel / pinch), + = farther
  aim: boolean; // bow is drawn (camera goes over the shoulder)
  btn: Record<BtnName, Btn>;
  pointerLocked: boolean;
}

export interface Input {
  readonly state: InputState;
  /** Poll gamepads, fold events into state, compute edges. Call once per frame before anything reads state. */
  update(dt: number): void;
  /** Touch overlay (left stick, right buttons, right-half camera drag) is built as plain DOM inside `container`
   *  with inline styles that read the CSS tokens in globals.css (var(--color-ink) etc). Shown only when device === "touch". */
  setTouchVisible(on: boolean): void;
  /** The "use" button and its label appear only while a prompt is active. */
  setPrompt(label: string | null): void;
  setSettings(s: Settings): void;
  /** Menus call this; while false, gameplay buttons read as up and pointer lock is released. */
  setEnabled(on: boolean): void;
  /** Gamepad / keyboard menu navigation for the UI. Returns an unsubscribe function. */
  onNav(cb: (dir: "up" | "down" | "left" | "right" | "ok" | "back") => void): () => void;
  rumble(strength: number, seconds: number): void;
  dispose(): void;
}
/** input.ts: export function createInput(canvas: HTMLCanvasElement, container: HTMLElement): Input */
export type CreateInput = (canvas: HTMLCanvasElement, container: HTMLElement) => Input;

// ---------------------------------------------------------------------------------------------------------------------
// Player state. Files: player.ts, player-*.ts (owner: player).
// ---------------------------------------------------------------------------------------------------------------------
export type MoveMode = "ground" | "air" | "climb" | "glide" | "swim" | "dead";
export type PlayerAction =
  | "none" | "attack1" | "attack2" | "attack3" | "charge" | "spin" | "block" | "parry" | "riposte"
  | "dodge" | "aim" | "hurt" | "push" | "interact" | "land";

export interface PlayerState {
  pos: THREE.Vector3; // feet position
  vel: THREE.Vector3;
  yaw: number;
  mode: MoveMode;
  action: PlayerAction;
  actionT: number; // seconds in the current action
  grounded: boolean;
  sprinting: boolean;
  hp: number; // quarter hearts
  maxHp: number; // quarter hearts (hearts * 4)
  stamina: number; // 0..PLAYER.staminaMax
  exhausted: boolean; // stamina hit 0: no sprint/climb until it refills to full
  iFrames: number; // seconds of invulnerability left
  charge: number; // 0..1 sword charge, or bow draw fraction while aiming
  shieldUp: boolean;
  parryT: number; // seconds since the shield went up (parry if < SWORD.parryWindow)
  lockId: number; // enemy id the player is locked onto (copied from CameraRig.lockId), -1 none
  pushBox: number; // id of the "pushable" Box the player is shoving this frame, -1 none
  pushDir: V2; // unit push direction on xz while pushBox >= 0
  lastSafe: THREE.Vector3; // last grounded, non-water, non-hazard position (drown / void respawn)
  glimmers: number;
  shards: number; // heart shards held (0..3, rolls into a heart at 4)
  arrows: number;
  hasBow: boolean;
  hasGlider: boolean;
  lanternPos: THREE.Vector3; // world position of the lantern on the hip (render puts the ember point light here)
  handPos: THREE.Vector3; // sword hand (fx trails)
}

// ---------------------------------------------------------------------------------------------------------------------
// Enemy state. Files: enemies.ts, enemy-*.ts (owner: enemies). A fixed pool; `alive` toggles slots.
// ---------------------------------------------------------------------------------------------------------------------
export type EnemyBrain = "idle" | "patrol" | "alert" | "chase" | "windup" | "attack" | "recover" | "stunned" | "hurt" | "flee" | "dead";

export interface EnemyState {
  id: number; // stable slot index
  kind: EnemyKind;
  alive: boolean;
  pos: THREE.Vector3; // feet (wisps: body center)
  vel: THREE.Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  brain: EnemyBrain;
  brainT: number;
  group: string; // camp id, or "trial-1" / "boss"
  home: THREE.Vector3;
  stun: number; // seconds of stun left (parry)
  phase: number; // warden phase 1..3, others 1
  lockable: boolean; // false while dead, dissolving or hidden
  aimPoint: THREE.Vector3; // chest / weak point: lock-on and arrows aim here
}

// ---------------------------------------------------------------------------------------------------------------------
// Combat: strikes, projectiles, hit resolution, damage numbers. Files: combat.ts, combat-*.ts (owner: combat).
// Player and enemies submit strikes and shots during their update(); combat resolves them in its own update() (same
// frame, game.ts runs combat after both). Combat never edits hp: it emits "hit" events that the target applies.
// ---------------------------------------------------------------------------------------------------------------------
export type Team = "player" | "enemy";

export interface Strike {
  team: Team;
  source: number; // enemy id, or -1 for the player
  origin: V3; // attacker center at chest height
  yaw: number; // swing facing
  reach: number;
  arc: number; // radians, full width of the sweep (Math.PI * 2 = spin)
  height: number; // vertical half extent around origin.y
  damage: number; // player strikes: damage points; enemy strikes: quarter hearts
  kind: "sword" | "spin" | "riposte" | "claw" | "slam" | "warden";
  knockback: number;
  unblockable?: boolean;
}

export interface Shot {
  team: Team;
  source: number;
  kind: "arrow" | "bolt"; // bolt = wisp / warden magic
  pos: V3;
  vel: V3;
  damage: number;
  gravity: number;
}

/** A thing arrows and swords can hit that is not an enemy (archery targets, switches, crystal). Owned by landmarks. */
export interface Prop {
  id: string;
  pos: V3;
  radius: number;
  active: boolean;
}

export interface CombatSink {
  strike(s: Strike): void; // copy the data, the caller reuses its object
  shoot(s: Shot): void;
}

export interface Combat extends CombatSink {
  update(ctx: FrameCtx): readonly GameEvent[]; // resolves strikes, moves projectiles, emits "hit", "arrowHit", "propHit"
  /** Props from landmarks, refreshed by game.ts when landmarks changes them (array identity may stay the same). */
  setProps(props: readonly Prop[]): void;
  handle(events: readonly GameEvent[]): void;
  clear(): void; // remove all projectiles (respawn, load)
  setQuality(q: Quality): void;
  dispose(): void;
}
/** combat.ts: export function createCombat(scene: THREE.Scene, world: World, look: Look): Combat */
export type CreateCombat = (scene: THREE.Scene, world: World, look: Look) => Combat;

// ---------------------------------------------------------------------------------------------------------------------
// Quest, save, HUD data.
// ---------------------------------------------------------------------------------------------------------------------
export type QuestStage = "awaken" | "beacons" | "spire" | "boss" | "ending" | "free";

export interface QuestState {
  stage: QuestStage;
  beacons: [boolean, boolean, boolean, boolean]; // lit, by BeaconId
  trial: BeaconId | -1; // trial in progress
  barrierDown: boolean;
  wardenDefeated: boolean;
  visited: LandmarkId[]; // for map labels; first visit shows the area banner
}

export interface SaveData {
  v: 1;
  pos: V3;
  yaw: number;
  maxHp: number;
  hp: number;
  shards: number;
  glimmers: number;
  arrows: number;
  hasBow: boolean;
  hasGlider: boolean;
  quest: QuestState;
  collected: string[]; // collectible ids already picked up (glimmer clusters, shards, chests)
  timeOfDay: number; // hours 0..24
  playTime: number; // seconds
}
export const SAVE_KEY = "hollowmere.save.v1";

export type Weather = "clear" | "cloudy" | "rain" | "storm";

/** Environment state. Owned and advanced by render (day/night + weather). Everyone else reads it from FrameCtx. */
export interface EnvState {
  timeOfDay: number; // hours 0..24. 6 sunrise, 18 sunset. Full day = DAY_SECONDS.
  daylight: number; // 0 night .. 1 noon (smooth)
  sunDir: THREE.Vector3; // unit, toward the sun (moon at night)
  weather: Weather;
  rain: number; // 0..1 intensity (smoothed)
  wind: THREE.Vector2; // m/s on xz, gusting
  wet: number; // 0..1 surfaces wetness (slower than rain)
}
export const DAY_SECONDS = 960; // one in-game day lasts 16 real minutes
export const START_HOUR = 7.5;

// ---------------------------------------------------------------------------------------------------------------------
// Events. Modules return GameEvent[] from update(); game.ts routes every event to every module's handle().
// ---------------------------------------------------------------------------------------------------------------------
export type PickupKind = "glimmer" | "shard" | "arrows" | "heart" | "bow" | "glider";

export type GameEvent =
  // player movement
  | { type: "footstep"; pos: V3; surface: Surface; run: boolean }
  | { type: "jump"; pos: V3 }
  | { type: "land"; pos: V3; speed: number; surface: Surface }
  | { type: "fallDamage"; amount: number }
  | { type: "climb"; on: boolean }
  | { type: "glide"; on: boolean }
  | { type: "swim"; on: boolean }
  | { type: "splash"; pos: V3; size: number }
  | { type: "staminaOut" }
  | { type: "dodge"; pos: V3 }
  | { type: "push"; on: boolean }
  // player combat
  | { type: "swing"; pos: V3; combo: 1 | 2 | 3 }
  | { type: "chargeReady" }
  | { type: "spin"; pos: V3 }
  | { type: "shield"; on: boolean }
  | { type: "bowDraw" }
  | { type: "arrowFired"; pos: V3; dir: V3 }
  | { type: "lock"; id: number } // -1 = released
  // combat resolution (from combat)
  | { type: "hit"; team: Team; target: number; source: number; damage: number; pos: V3; dir: V3; kind: Strike["kind"] | Shot["kind"]; blocked: boolean; parried: boolean; knockback: number }
  | { type: "arrowHit"; pos: V3; on: "enemy" | "prop" | "ground" | "water" }
  | { type: "propHit"; id: string; pos: V3; by: "arrow" | "sword" }
  | { type: "hitstop"; seconds: number }
  | { type: "shake"; strength: number } // 0..1
  // player results (from player)
  | { type: "hurt"; amount: number; hp: number; pos: V3 }
  | { type: "heal"; amount: number; hp: number }
  | { type: "died"; pos: V3 }
  | { type: "respawned"; pos: V3 }
  | { type: "drowned"; pos: V3 }
  // enemies (from enemies)
  | { type: "enemyAlert"; id: number; kind: EnemyKind; pos: V3 }
  | { type: "enemyWindup"; id: number; kind: EnemyKind; pos: V3 }
  | { type: "enemyHurt"; id: number; kind: EnemyKind; pos: V3; hp: number }
  | { type: "enemyDied"; id: number; kind: EnemyKind; pos: V3; group: string }
  | { type: "bossPhase"; phase: number }
  | { type: "bossDefeated"; pos: V3 }
  // world, quest (from landmarks)
  | { type: "spawn"; kind: EnemyKind; pos: V3; group: string } // request: enemies spawns it
  | { type: "despawnGroup"; group: string } // request: enemies removes a group (trial reset)
  | { type: "pickup"; kind: PickupKind; amount: number; pos: V3; id: string }
  | { type: "areaEnter"; id: LandmarkId; name: string; first: boolean }
  | { type: "trialStart"; beacon: BeaconId }
  | { type: "trialProgress"; beacon: BeaconId; value: number; total: number }
  | { type: "trialFail"; beacon: BeaconId }
  | { type: "trialDone"; beacon: BeaconId }
  | { type: "beaconLit"; beacon: BeaconId; pos: V3 }
  | { type: "barrierDown" }
  | { type: "bossWake"; pos: V3 }
  | { type: "plate"; id: string; on: boolean }
  | { type: "blockMove"; id: string; pos: V3 }
  | { type: "rest"; pos: V3 } // at the shrine or a lit beacon: heal, save, respawn camps
  | { type: "read"; title: string; text: string } // lore stone, sign
  | { type: "ending" }
  // environment (from render)
  | { type: "weather"; weather: Weather }
  | { type: "thunder"; pos: V3; delay: number }
  | { type: "dawn" }
  | { type: "dusk" }
  // system (from game.ts)
  | { type: "saved" }
  | { type: "toast"; text: string };

// ---------------------------------------------------------------------------------------------------------------------
// Per-frame context. game.ts owns ONE FrameCtx object and rewrites its fields every frame. Modules read it only.
// ---------------------------------------------------------------------------------------------------------------------
export interface FrameCtx {
  dt: number; // seconds, clamped, already scaled by hitstop / bow slow-mo
  realDt: number; // unscaled clamped frame time (UI, camera smoothing, dynamic resolution)
  time: number; // seconds of game time since load
  world: World;
  input: InputState;
  player: PlayerState;
  enemies: readonly EnemyState[];
  env: EnvState;
  quest: QuestState;
  camera: THREE.PerspectiveCamera;
  cameraYaw: number; // CameraRig.yaw from the previous frame
  combat: CombatSink;
  fx: Fx;
  quality: QualityPreset;
}

// ---------------------------------------------------------------------------------------------------------------------
// Render: renderer, look (toon materials + shared uniforms), sky, day/night, weather, particles, post (ink outlines),
// dynamic resolution, quality detection. Files: render.ts, render-*.ts (owner: render).
// ---------------------------------------------------------------------------------------------------------------------
/** Shared uniforms. Every custom ShaderMaterial in the game (terrain, grass, water, trees) references THESE objects,
 *  so one write per frame updates them all. Values are written by render.update(). */
export interface SharedUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSkyColor: { value: THREE.Color }; // ambient from above
  uGroundColor: { value: THREE.Color }; // ambient from below
  uRimColor: { value: THREE.Color }; // warm rim light
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uWind: { value: THREE.Vector2 }; // m/s
  uRain: { value: number }; // 0..1, darkens and adds sheen
  uPlayerPos: { value: THREE.Vector3 }; // grass bends away from it
  uLanternPos: { value: THREE.Vector3 };
  uLanternColor: { value: THREE.Color }; // ember, scaled by night
}

export interface ToonOpts {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  rim?: number; // rim light strength 0..1 (default 0.35)
  bands?: 2 | 3 | 4; // cel bands (default 3)
}

/** The art style in one handle. Any module that makes meshes uses this, never its own lighting model. */
export interface Look {
  readonly uniforms: SharedUniforms;
  /** Cached cel material (same opts -> same material instance). Fog, rim light, lantern light and bands included. */
  toon(opts: ToonOpts): THREE.Material;
  /** Patch any built-in material (MeshStandard/Lambert/Toon) with the same cel ramp, rim and lantern light. Idempotent. */
  patch<M extends THREE.Material>(m: M): M;
  /** GLSL chunk for custom ShaderMaterials: declares every SharedUniforms uniform and defines
   *  `vec3 hmShade(vec3 albedo, vec3 n, vec3 worldPos, vec3 viewDir)` (cel bands + rim + lantern) and
   *  `vec3 hmFog(vec3 c, float dist)`. Paste it before main() and pass `uniforms: { ...look.uniforms, ...yours }`.
   *  Still add the tonemapping_fragment and colorspace_fragment includes at the end of main(). */
  readonly glsl: string;
}

export type FxKind = "dust" | "spark" | "leaf" | "splash" | "ember" | "glimmer" | "gloam" | "heal" | "blood-sap" | "rain-splash" | "beacon";

/** One particle pool, one draw call. Owned by render. Safe to call many times per frame (it drops when full). */
export interface Fx {
  burst(kind: FxKind, pos: V3, count: number, dir?: V3, speed?: number): void;
  /** A trail ribbon point for the sword (`id` 0) or arrows (id 1..n). */
  trail(id: number, pos: V3, on: boolean): void;
}

export interface RenderStats {
  fps: number;
  ms: number;
  scale: number; // current dynamic resolution scale
  calls: number;
  tris: number;
}

export interface Render {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly look: Look;
  readonly fx: Fx;
  readonly env: EnvState;
  readonly quality: Quality;
  setQuality(q: Quality): void;
  setDynamicRes(on: boolean, targetFps: 30 | 60): void;
  /** Hours 0..24. Used by load, rest (skip to morning) and the lab pages. */
  setTime(hours: number): void;
  setWeather(w: Weather): void;
  resize(): void; // reads canvas.clientWidth / clientHeight
  /** Advance env (clock, weather, wind), write shared uniforms, move sun/shadow camera (texel-snapped), particles. */
  update(ctx: FrameCtx): readonly GameEvent[];
  handle(events: readonly GameEvent[]): void; // particles, flashes, lantern flare, beacon light columns
  render(ctx: FrameCtx): void;
  stats(): RenderStats;
  dispose(): void;
}
/** render.ts: export function createRender(canvas: HTMLCanvasElement, quality: Quality): Render
 *  render.ts: export function detectQuality(p: Platform): Quality */
export type CreateRender = (canvas: HTMLCanvasElement, quality: Quality) => Render;
export type DetectQuality = (p: Platform) => Quality;

// ---------------------------------------------------------------------------------------------------------------------
// Terrain meshes and water. Files: terrain.ts, terrain-*.ts (owner: terrain, who also owns world.ts / world-*.ts).
// ---------------------------------------------------------------------------------------------------------------------
export interface Terrain {
  readonly group: THREE.Group;
  /** Chunk LOD + culling around the camera, water animation. */
  update(ctx: FrameCtx): void;
  setQuality(q: Quality): void;
  dispose(): void;
}
/** terrain.ts: export function createTerrain(scene: THREE.Scene, world: World, look: Look, quality: Quality): Terrain */
export type CreateTerrain = (scene: THREE.Scene, world: World, look: Look, quality: Quality) => Terrain;

// ---------------------------------------------------------------------------------------------------------------------
// Nature: grass, flowers, bushes, trees, rocks, driftwood, birds/fireflies. Files: nature.ts, nature-*.ts.
// Registers tree trunk and big rock colliders in the world ("tree" / "solid" tags, owner "nature:*").
// Keeps clear of every LANDMARK inside its `flat` radius and of RIVER / LAKE water.
// ---------------------------------------------------------------------------------------------------------------------
export interface Nature {
  readonly group: THREE.Group;
  update(ctx: FrameCtx): void; // instance density by distance, wind (via uniforms), grass bend, cut grass
  handle(events: readonly GameEvent[]): void; // "spin"/"swing" near grass cuts it (leaf fx)
  setQuality(q: Quality): void;
  dispose(): void;
}
/** nature.ts: export function createNature(scene: THREE.Scene, world: World, look: Look, quality: Quality): Nature */
export type CreateNature = (scene: THREE.Scene, world: World, look: Look, quality: Quality) => Nature;

// ---------------------------------------------------------------------------------------------------------------------
// Landmarks: shrine, ruins, beacons and their trials, the spire and its barrier, collectibles, quest logic,
// interact prompts, lore stones. Files: landmarks.ts, landmark-*.ts (owner: landmarks).
// ---------------------------------------------------------------------------------------------------------------------
export interface Landmarks {
  readonly group: THREE.Group;
  /** Prompt for the HUD and the touch "use" button, e.g. "Rest", "Open", "Read", "Light". null when none. */
  readonly prompt: string | null;
  /** Archery targets, switches, the spire crystal. game.ts passes this to combat.setProps every frame. */
  readonly props: readonly Prop[];
  /** Checkpoint: the shrine, or the last lit beacon. Respawn point after death. */
  checkpoint(out: THREE.Vector3): THREE.Vector3;
  /** Rebuild from a save: lit beacons, lowered barrier, collected ids hidden, block positions reset. */
  load(quest: QuestState, collected: readonly string[]): void;
  /** Ids collected since load (game.ts copies them into SaveData.collected). */
  collected(): readonly string[];
  update(ctx: FrameCtx): readonly GameEvent[]; // pickups, trials, plates, blocks, areaEnter, interact (ctx.input.btn.use)
  handle(events: readonly GameEvent[]): void; // propHit, enemyDied (trial waves), bossDefeated, died (trial fail)
  setQuality(q: Quality): void;
  dispose(): void;
}
/** landmarks.ts: export function createLandmarks(scene: THREE.Scene, world: World, look: Look, quality: Quality): Landmarks */
export type CreateLandmarks = (scene: THREE.Scene, world: World, look: Look, quality: Quality) => Landmarks;

// ---------------------------------------------------------------------------------------------------------------------
// Player: Wren. Movement state machine, collisions against World, combat inputs, gear, model and animation.
// Files: player.ts, player-*.ts (owner: player).
// ---------------------------------------------------------------------------------------------------------------------
export interface Player {
  readonly state: PlayerState;
  readonly group: THREE.Group;
  /** Moves, collides, submits strikes/shots through ctx.combat, animates. Reads ctx.input and ctx.cameraYaw. */
  update(ctx: FrameCtx): readonly GameEvent[];
  /** Applies "hit" (team "enemy", target -1), "pickup", "rest", "fallDamage"; emits hurt/died through the next update. */
  handle(events: readonly GameEvent[]): void;
  /** Teleport (load, respawn). Resets velocity and action; hp to `hp` when given. */
  place(pos: V3, yaw: number, hp?: number): void;
  load(s: SaveData): void;
  setQuality(q: Quality): void;
  dispose(): void;
}
/** player.ts: export function createPlayer(scene: THREE.Scene, world: World, look: Look, quality: Quality): Player */
export type CreatePlayer = (scene: THREE.Scene, world: World, look: Look, quality: Quality) => Player;

// ---------------------------------------------------------------------------------------------------------------------
// Enemies: pool, AI brains, meshes, animation, the Gloam Warden boss. Files: enemies.ts, enemy-*.ts (owner: enemies).
// ---------------------------------------------------------------------------------------------------------------------
export interface Enemies {
  readonly list: readonly EnemyState[]; // fixed pool (32 slots), iterate and skip !alive
  readonly group: THREE.Group;
  /** Brains, movement against World, strikes/shots through ctx.combat, camp spawning by distance (spawn within 120 m,
   *  sleep beyond 160 m), night camps only at night. */
  update(ctx: FrameCtx): readonly GameEvent[];
  /** Applies "hit" (team "player"), "spawn", "despawnGroup", "bossWake", "rest" (respawn camps), "died" (reset aggro). */
  handle(events: readonly GameEvent[]): void;
  /** Boss bar data, null when no boss is awake. */
  boss(): { name: string; hp: number; maxHp: number; phase: number } | null;
  clear(): void;
  setQuality(q: Quality): void;
  dispose(): void;
}
/** enemies.ts: export function createEnemies(scene: THREE.Scene, world: World, look: Look, quality: Quality): Enemies */
export type CreateEnemies = (scene: THREE.Scene, world: World, look: Look, quality: Quality) => Enemies;

// ---------------------------------------------------------------------------------------------------------------------
// Camera: third-person orbit with collision against World, lock-on targeting, aim mode, shake, cinematics.
// Files: camera.ts, camera-*.ts (owner: input-camera).
// ---------------------------------------------------------------------------------------------------------------------
export interface ScreenPoint {
  x: number; // CSS px from the canvas left
  y: number; // CSS px from the canvas top
  on: boolean; // in front of the camera and inside the viewport
}

export interface CameraRig {
  readonly yaw: number; // look direction, contract YAW convention
  readonly pitch: number; // + looks down
  /** Lock-on target enemy id, -1 none. Picks the best target on ctx.input.btn.lock.pressed (nearest to screen center
   *  within 30 m, line of sight), drops it when dead or beyond 40 m. */
  readonly lockId: number;
  update(ctx: FrameCtx): readonly GameEvent[]; // emits { type: "lock" } on change
  handle(events: readonly GameEvent[]): void; // shake, beaconLit / bossWake short cinematic pans
  /** Project a world point to canvas CSS pixels. */
  toScreen(p: V3, out: ScreenPoint): ScreenPoint;
  snapBehind(): void; // after place()/respawn
  setSettings(s: Settings): void;
  dispose(): void;
}
/** camera.ts: export function createCamera(camera: THREE.PerspectiveCamera, world: World): CameraRig */
export type CreateCamera = (camera: THREE.PerspectiveCamera, world: World) => CameraRig;

// ---------------------------------------------------------------------------------------------------------------------
// Audio: Web Audio synthesis only. Adaptive score (explore / night / combat / boss layers), ambience, SFX.
// Files: audio.ts, audio-*.ts (owner: audio). Catch every error inside the module.
// ---------------------------------------------------------------------------------------------------------------------
export interface Audio {
  /** Score + ambience mix from ctx: combat intensity = alerted enemies near the player, night = env.daylight,
   *  boss = enemies boss awake, area from world.areaAt, wind / rain / water proximity from env and world. */
  update(ctx: FrameCtx): void;
  handle(events: readonly GameEvent[]): void;
  ui(cue: "move" | "ok" | "back" | "open" | "close" | "error"): void; // menu sounds
  setVolumes(master: number, music: number, sfx: number): void;
  menuMusic(on: boolean): void; // title theme while the menu shows
  suspend(on: boolean): void; // pause menu / tab hidden
  dispose(): void;
}
/** audio.ts: export function createAudio(ctx: AudioContext): Audio. game.ts creates the AudioContext on the first gesture. */
export type CreateAudio = (ac: AudioContext) => Audio;

// ---------------------------------------------------------------------------------------------------------------------
// HUD + game API for React. Files: ui-*.tsx (owner: ui). React renders menus and HUD only.
// ---------------------------------------------------------------------------------------------------------------------
export interface HudSnapshot {
  hp: number; // quarter hearts
  maxHp: number;
  shards: number;
  glimmers: number;
  arrows: number;
  hasBow: boolean;
  beacons: [boolean, boolean, boolean, boolean];
  objective: string; // one line, from game.ts objectiveText()
  area: string | null; // current area name
  timeOfDay: number;
  weather: Weather;
  prompt: string | null;
  boss: { name: string; hp: number; maxHp: number; phase: number } | null;
  trial: { beacon: BeaconId; value: number; total: number; timeLeft?: number | null } | null;
  device: Device;
  fps: number;
  scale: number;
  quality: Quality;
}

/** Per-frame HUD data, written by game.ts into ONE reused object. The HUD writes it to DOM refs, never React state. */
export interface HudFrame {
  stamina: number; // 0..1
  staminaShow: boolean; // false when full for > 1.5 s
  exhausted: boolean;
  staminaAt: ScreenPoint; // beside the player's shoulder
  heading: number; // camera compass bearing (0 = north, clockwise radians)
  markers: { bearing: number; dist: number; lit: boolean; on: boolean }[]; // 4 beacons + spire (index 4), fixed length 5
  lockAt: ScreenPoint; // lock-on reticle
  lockOn: boolean;
  charge: number; // sword charge / bow draw 0..1 (reticle fill)
  aiming: boolean;
  damageFlash: number; // 0..1, decays
}

export interface HudHandle {
  frame(f: HudFrame): void; // per frame
  event(e: GameEvent): void; // banners (areaEnter, beaconLit, trial*), pickup counters, toasts, read panels
}

export interface GameCallbacks {
  hud(h: HudSnapshot): void; // at HUD_HZ
  hudRef(): HudHandle | null;
  progress(p: number): void; // loading 0..1
  pause(): void; // the player pressed pause / map in game: UI opens its menu and calls game.pause(true)
  map(): void;
  died(): void; // UI shows the "lantern gutters" screen, then calls game.respawn()
  ending(): void; // UI shows the ending page
}

/** game.ts: export function startGame(canvas: HTMLCanvasElement, overlay: HTMLElement, cb: GameCallbacks, settings: Settings): Game */
export interface Game {
  /** Begin play. `save` null = new game. Resolves once the world is built and the first frame rendered. */
  start(save: SaveData | null): Promise<void>;
  pause(on: boolean): void;
  /** Title screen: a slow aerial flyover over the island (stops play). start() turns it off. */
  menuCamera(on: boolean): void;
  readonly paused: boolean;
  respawn(): void; // after death: checkpoint, full hearts
  setSettings(s: Settings): void;
  save(): SaveData; // also writes localStorage
  readonly world: World; // the map screen samples heightAt / landmarks
  readonly input: Input;
  readonly platform: Platform;
  readonly quest: QuestState;
  playerPos(out: V3): V3; // map marker
  unlockAudio(): void; // call from the first click / tap
  readonly audio: Audio | null;
  dispose(): void;
}
export type StartGame = (canvas: HTMLCanvasElement, overlay: HTMLElement, cb: GameCallbacks, settings: Settings) => Game;
