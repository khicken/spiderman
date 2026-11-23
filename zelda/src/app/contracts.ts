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
// V2:    v2 additions are marked "v2". Design and numbers: zelda/v2/DESIGN-V2.md. Track split: zelda/v2/TRACKS.md.
//        New module APIs are `XV2 extends X` interfaces, so v1 code keeps compiling while tracks build in parallel.
//        The "v2 optional until merge" fields were made required at merge.
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
  | "beacon-cliff" | "beacon-wood" | "beacon-lake" | "beacon-bluff"
  | "beacon-glade"; // v2: the first, small beacon 130 m north of spawn (prologue trial)

export interface Landmark {
  id: LandmarkId;
  name: string; // shown on the map and in the "areaEnter" banner
  place?: string; // region name for "You are in <place>" when the area is a site (a beacon), not a region
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
  { id: "beacon-cliff", name: "Cliffwatch Beacon", place: "Cliffwatch", x: 420, z: 150, r: 30, flat: 16 },
  { id: "beacon-wood", name: "Thornring Beacon", place: "Thornring", x: -360, z: -190, r: 35, flat: 26 },
  { id: "beacon-lake", name: "Drowned Beacon", place: "Sunken Lake", x: 250, z: -330, r: 30, flat: 18 },
  { id: "beacon-bluff", name: "Windward Beacon", place: "Windward Bluff", x: -140, z: -430, r: 35, flat: 20 },
  { id: "beacon-glade", name: "Glade Beacon", place: "Glade", x: -35, z: 240, r: 40, flat: 24 }, // v2
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

/** v2 prologue layout, spawn to Glade Beacon (DESIGN-V2.md section 2). Builders may shift a point up to 8 m to fit the
 *  terrain but must keep the order and the spawn-to-beacon distance under 150 m. y values are heights above ground. */
export const PROLOGUE = {
  gateBrazier: { x: -60, z: 350 }, // first "Light" prompt; the gate opens onto the vista
  vista: { x: -60, z: 346, lookAt: { x: -35, z: 240 } }, // camera frames the Glade Beacon, the 4 far columns behind it
  stones: { x: -56, z: 322, gap: 2.4, count: 4 }, // stepping stones over a 0.4 m deep rill (wading is safe)
  ledge: { x: -52, z: 310, h: 1.2 }, // first full jump
  climbRock: { x: -45, z: 292, h: 6, knotY: 7.5 }, // first climb; knot A on top
  knotB: { x: -40, z: 266, y: 2.3 }, // stump knot, about 26 m from knot A and 5 m lower: the first ride
  // bramble thicket along the back of the climb rock: the ride passes over it, walking round its ends is a ~110 m detour
  thicket: { x0: -87, x1: -3, z: 289.5, depth: 1.6, h: 4.3 },
  glade: { x: -35, z: 240 }, // Glade trial arena center (radius 30); the beacon stands on a plinth at its north edge
  oriel: { x: -58, z: 226 }, // Oriel's waystone, the first fast-travel point
} as const;

/** v2 waystones: rest, save, fast travel, upgrades. Ids are stable save keys. */
export const WAYSTONES: readonly { id: string; name: string; x: number; z: number }[] = [
  { id: "ws-glade", name: "Glade Waystone", x: -58, z: 226 },
  { id: "ws-mirebrook", name: "Mirebrook Waystone", x: -228, z: 190 },
  { id: "ws-whisperwood", name: "Whisperwood Waystone", x: -320, z: -150 },
  { id: "ws-ashen", name: "Ashen Waystone", x: 350, z: 158 },
  { id: "ws-sunken", name: "Sunken Waystone", x: 246, z: -346 },
  { id: "ws-windward", name: "Windward Waystone", x: -110, z: -370 },
  { id: "ws-cinder", name: "Cinder Waystone", x: 75, z: 110 },
];

/** v2 ember paths: glowing stones every 15 m from the Glade to each beacon. Index = BeaconId. Polylines on (x, z).
 *  world-gen.ts PATHS (dirt tracks) stays; these are the lit "default route" laid over it. */
export const EMBER_PATHS: readonly (readonly { x: number; z: number }[])[] = [
  [{ x: -35, z: 240 }, { x: 40, z: 248 }, { x: 140, z: 238 }, { x: 240, z: 192 }, { x: 300, z: 150 }, { x: 335, z: 140 }],
  [{ x: -58, z: 226 }, { x: -150, z: 230 }, { x: -228, z: 190 }, { x: -262, z: 130 }, { x: -300, z: -20 }, { x: -340, z: -150 }],
  [{ x: -35, z: 240 }, { x: 60, z: 140 }, { x: 150, z: 20 }, { x: 175, z: -120 }, { x: 175, z: -245 }, { x: 235, z: -315 }],
  [{ x: -228, z: 190 }, { x: -262, z: 130 }, { x: -300, z: -60 }, { x: -230, z: -200 }, { x: -170, z: -300 }, { x: -140, z: -410 }],
];

/** v2 tree-free sight lines (nature skips trees and tall props within `w` m of each segment). */
export const VIEW_CUTS: readonly { x0: number; z0: number; x1: number; z1: number; w: number }[] = [
  { x0: -60, z0: 348, x1: -35, z1: 240, w: 14 }, // gate to Glade Beacon
  { x0: -60, z0: 348, x1: 0, z1: -40, w: 8 }, // gate to the Spire (the Spire stays visible above the glade)
];

export type BeaconId = 0 | 1 | 2 | 3; // 0 cliff (climb/glide), 1 wood (combat), 2 lake (blocks), 3 bluff (archery)
export const BEACON_LANDMARK: readonly LandmarkId[] = ["beacon-cliff", "beacon-wood", "beacon-lake", "beacon-bluff"];
export const BEACON_COLOR: readonly string[] = ["#f08a3c", "#e2b04a", "#6fc7c0", "#c58be0"]; // flame tint per beacon

export type Biome = "beach" | "meadow" | "forest" | "ash" | "highland" | "lakeshore" | "summit" | "sea";
export type Surface = "grass" | "dirt" | "rock" | "sand" | "stone" | "wood" | "water" | "ash";

// ---------------------------------------------------------------------------------------------------------------------
// World query API (pure data, no rendering). Files: world.ts, world-*.ts (owner: terrain).
// Every query is deterministic for a seed and allocation free. Hot paths (heightAt) must cost under ~1 us.
// ---------------------------------------------------------------------------------------------------------------------
export type ColliderTag =
  | "solid" | "climbable" | "pushable" | "water-gate" | "barrier" | "tree" | "plate"
  | "decor" // v2: blocks movement, never climbable (lamp posts, signs, fences, anything under 0.6 m wide)
  | "knot"; // v2: a wick-knot ring; solid, not climbable, a thread anchor

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
  outline: 0 | 1 | 2; // v1 screen-space ink outline. v2: always 0 (pass removed). See heroOutline.
  bloom: boolean; // lantern and beacon glow
  // v2 perf + AA (perf track). Budgets per preset are in DESIGN-V2.md section 11.
  aa: "msaa" | "smaa" | "fxaa" | "none"; // msaa on desktop presets, fxaa/smaa on phones
  msaa: 0 | 2 | 4; // samples for the main render target when aa = "msaa"
  maxPixels: number; // device cap: canvas pixels (w * h * scale^2) never exceed this, whatever the DPR
  fpsCap: 0 | 30 | 60; // 0 = display rate. Idle / paused / hidden-tab throttling is separate (FRAME_GOVERNOR)
  heroOutline: boolean; // thin inverted-hull outline on Wren and enemies only, faded out by 25 m
  fakeGlow: boolean; // additive glow sprites for lanterns/beacons when bloom is off
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
    label: "Low", pixelRatio: 1.25, minScale: 0.5, maxScale: 1, shadow: 0, shadowDist: 0, outline: 0, bloom: false,
    drawDist: 380, fogNear: 110, fogFar: 360, terrainLod: [36, 72, 150], grassDensity: 0.15, grassDist: 26,
    treeDist: 170, treeDetailDist: 20, rockDist: 140, water: 0, particles: 192, rainDrops: 1000, enemyLodDist: 40,
    aa: "fxaa", msaa: 0, maxPixels: 1_100_000, fpsCap: 60, heroOutline: false, fakeGlow: true,
  },
  medium: {
    label: "Medium", pixelRatio: 1.25, minScale: 0.6, maxScale: 1, shadow: 1024, shadowDist: 40, outline: 0, bloom: false,
    drawDist: 650, fogNear: 180, fogFar: 620, terrainLod: [110, 220, 400], grassDensity: 0.35, grassDist: 42,
    treeDist: 420, treeDetailDist: 70, rockDist: 220, water: 1, particles: 384, rainDrops: 2200, enemyLodDist: 60,
    aa: "smaa", msaa: 0, maxPixels: 2_100_000, fpsCap: 60, heroOutline: true, fakeGlow: true,
  },
  high: {
    label: "High", pixelRatio: 1.5, minScale: 0.7, maxScale: 1, shadow: 2048, shadowDist: 60, outline: 0, bloom: true,
    drawDist: 900, fogNear: 260, fogFar: 880, terrainLod: [150, 300, 550], grassDensity: 0.6, grassDist: 60,
    treeDist: 650, treeDetailDist: 85, rockDist: 320, water: 2, particles: 768, rainDrops: 4500, enemyLodDist: 90,
    aa: "msaa", msaa: 4, maxPixels: 3_700_000, fpsCap: 0, heroOutline: true, fakeGlow: false,
  },
  ultra: {
    label: "Ultra", pixelRatio: 2, minScale: 0.8, maxScale: 1, shadow: 4096, shadowDist: 80, outline: 0, bloom: true,
    drawDist: 1300, fogNear: 360, fogFar: 1250, terrainLod: [200, 400, 750], grassDensity: 0.85, grassDist: 80,
    treeDist: 1000, treeDetailDist: 150, rockDist: 450, water: 2, particles: 1536, rainDrops: 8000, enemyLodDist: 140,
    aa: "msaa", msaa: 4, maxPixels: 8_300_000, fpsCap: 0, heroOutline: true, fakeGlow: false,
  },
};

/** v2 frame governor (perf track implements, game.ts calls it before each rAF render). */
export const FRAME_GOVERNOR = {
  idleAfter: 20, // s with no input while not in combat -> idle
  idleFps: 30,
  pausedFps: 10, // menus, journal, death screen (the scene still shows behind the book)
  hiddenFps: 0, // hidden tab: stop rendering; keep a 1 Hz timer only for audio suspend
  dynResDownFps: 55, // average under this for 3 s -> lower scale one step (0.05)
  dynResDownSecs: 3,
  dynResUpFps: 59, // average over this for 6 s -> raise one step
  dynResUpSecs: 6,
} as const;

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
  // v2
  voice: number; // 0..1 Tallow and Oriel voice lines
  subtitles: boolean; // companion lines as text (default on; lines are also text when voice is 0)
  hints: boolean; // control chips (off = never show)
  cameraFollow: boolean; // camera auto-follow behind Wren while moving
  fpsCap: 0 | 30 | 60; // user cap; the stricter of this and QualityPreset.fpsCap wins
}
export const DEFAULT_SETTINGS: Settings = {
  quality: "auto", dynamicRes: true, master: 0.8, music: 0.7, sfx: 0.9, lookSens: 1, invertY: false, touchScale: 1, showFps: false, reduceMotion: false, renderScale: 1, ambience: 1,
  voice: 0.9, subtitles: true, hints: true, cameraFollow: true, fpsCap: 0,
};

// ---------------------------------------------------------------------------------------------------------------------
// Tuning. Player, combat and enemy numbers. DESIGN.md explains them.
// ---------------------------------------------------------------------------------------------------------------------
export const PLAYER = {
  radius: 0.35, height: 1.7, eye: 1.5,
  walk: 3.0, run: 6.0, sprint: 9.0, // m/s
  accel: 40, airAccel: 10, turnRate: 12, // m/s^2, m/s^2, rad/s
  jumpV: 7.6, coyote: 0.15, jumpBuffer: 0.15, // v2: 1.3 m full jump at GRAVITY, 0.15 s coyote and buffer
  climb: 2.0, climbJump: 2.6, // v2: m/s along the wall, m climb-jump burst
  glideFwd: 9, glideSink: 2.0, glideMinHeight: 2.5, // m/s, m/s, glider only opens this high above ground
  swim: 2.6, swimFast: 4.4,
  // v2 movement feel (player track). DESIGN-V2.md section 6.
  startEase: 0.2, // s from 0 to run speed
  skidSpeed: 4.5, skidAngle: 2.36, skidTime: 0.18, skidRelaunch: 0.7, // skid-turn above 4.5 m/s when input is > 135 deg off
  sprintTurn: 7, sprintLean: 0.22, // rad/s, rad of body lean at full sprint turn
  fallGravityMul: 1.35, jumpCutT: 0.08, jumpCutMul: 0.4, // release before jumpCutT -> vy *= jumpCutMul (0.65 m short hop)
  vaultMin: 0.45, vaultMax: 1.3, vaultTime: 0.3, vaultSpeedMul: 0.8, // auto-vault on contact while moving
  mantleMax: 2.2, mantleTime: 0.45, mantleExitMul: 0.5,
  climbMinWidth: 0.6, // boxes narrower than this on both axes are never climbable
  climbDrain: 0.08, lastGasp: 0.15, hangAtZero: 0.6, ledgeCatch: 0.6, // stamina/s on the wall, s hang at 0, m reach
  glideFlareFwd: 5, glideFlareSink: 1.2, glideFlareCost: 1.5, // hold back: slow and float, x1.5 stamina
  glideDiveFwd: 16, glideDiveSink: 6, glideDiveClimb: 3, // hold forward: dive; release converts up to 3 m back to height
  glideBank: 0.44, glideTurn: 3, glidePromptSpeed: 14, glidePromptDrop: 8,
  swimDashTime: 1.2, swimDashCost: 0.2, treadCost: 0.02,
  rollLandWindow: 0.15, // press dodge within this of landing: no fall damage below fallSafe + 6 m/s
  dodgeIFrameStart: 0.05, dodgeIFrameEnd: 0.35, dodgeRecover: 0.1, dodgeCooldown: 0.25,
  backstepDist: 2.2, backstepTime: 0.3, // dodge with no stick while locked on
  hurtTime: 0.3, hurtBigTime: 0.9, hurtBigCancel: 0.5, // s; a big hit can be roll-cancelled after 0.5 s
  softLockRange: 3.5, softLockAngle: 0.785, // sword swings turn toward an enemy inside this cone
  pickupMagnet: 2.5, // glimmers fly to Wren inside this radius
  stepUp: 0.45, slopeWalk: 0.75, // max step height (m), min normal.y that counts as walkable ground
  // stamina is 0..staminaMax; 1 = one full ring
  staminaMax: 1, staminaRegen: 0.4, staminaDelay: 0.6,
  sprintCost: 0.18, climbCost: 0.11, climbJumpCost: 0.2, glideCost: 0.06, swimCost: 0.05, swimFastCost: 0.16,
  dodgeCost: 0.12, spinCost: 0.3, rainClimbMul: 1.5,
  // health in quarter hearts
  startHearts: 3, maxHearts: 9, shardsPerHeart: 4, // v2: 24 heart shards on the island ((9 - 3) * 4): 5 from beacons, 19 from secrets and the shop
  fallSafe: 19.5, fallPerQuarter: 2.2, // v2: 6.5 m of free fall (falling uses GRAVITY * fallGravityMul) before damage
  drownPenalty: 2, // quarters lost when stamina runs out while swimming (respawn on last safe ground)
  hurtIFrames: 0.9, dodgeIFrames: 0.32, dodgeTime: 0.45, dodgeDist: 4.2,
  maxArrows: 30, startArrows: 15,
} as const;

/** Heart shard model, one for every screen. `shards` (PlayerState) is the count toward the next heart (0..3); four
 *  roll into a heart. Show `toNext/perHeart` ("1/4 to next heart") on toasts and the HUD, and `found/total` ("1/24
 *  found") only where the whole island is counted (journal stats). */
export function shardProgress(maxHp: number, shards: number) {
  const perHeart = PLAYER.shardsPerHeart;
  const total = (PLAYER.maxHearts - PLAYER.startHearts) * perHeart;
  const found = Math.max(0, Math.min(total, (maxHp / 4 - PLAYER.startHearts) * perHeart + shards));
  return { toNext: shards, perHeart, found, total };
}

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
  hitstop: 0.06, // v1 global slow. v2 uses hitstopLocal (attacker and victim only)
  // v2 swing timing per combo step 1..3 (player track). comboWindup/comboRecover above are v1 and unused in v2.
  startup: [0.12, 0.10, 0.20] as const, // s before the active frames
  active: [0.06, 0.06, 0.09] as const, // s the hit arc sweeps (test the arc every substep, not one frame)
  recovery: [0.22, 0.22, 0.45] as const, // s after active; attack press inside chainWindow chains
  chainWindow: 0.25, // s at the end of recovery (and buffered 0.15 s before it) that accepts the next press
  lateBonus: 0.2, // +20% damage when the chain press lands in the last 0.08 s of the window
  knockbackStep: [5, 5, 8] as const, // m/s per combo step
  hitstopLocal: [0.05, 0.05, 0.09] as const, // s per combo step; spin and riposte use 0.09
  hitstopHurtMax: 0.05, // s, when Wren is the one hit
  parryWindowTouch: 0.22,
  parrySlowMo: 0.35, parrySlowScale: 0.4, // world time scale after a parry (Wren runs at full speed)
  parryHitstop: 0.12, parryHitstopScale: 0.5,
  rumbleParry: [0.4, 0.1] as const, rumbleBlock: [0.2, 0.05] as const, // [strength, seconds]
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
  brambling: { hp: 30, damage: 2, walk: 2.2, chase: 6.0, sight: 18, leash: 40, reach: 1.4, windup: 0.5, cooldown: 1.0, radius: 0.4, height: 1.0, glimmers: 3 },
  mossback: { hp: 120, damage: 6, walk: 1.4, chase: 3.4, sight: 16, leash: 35, reach: 2.6, windup: 1.0, cooldown: 2.2, radius: 1.1, height: 2.6, glimmers: 10 },
  wisp: { hp: 40, damage: 3, walk: 2.0, chase: 4.0, sight: 32, leash: 50, reach: 18, windup: 0.8, cooldown: 2.6, radius: 0.45, height: 0.9, glimmers: 6 },
  warden: { hp: 600, damage: 6, walk: 2.4, chase: 5.0, sight: 60, leash: 80, reach: 4.0, windup: 0.75, cooldown: 1.6, radius: 2.2, height: 6.0, glimmers: 100 },
};
/** Boss phases start at these hp fractions (phase 1 at 1.0, phase 2 at 0.66, phase 3 at 0.33). */
export const WARDEN_PHASES = [1, 0.66, 0.33] as const;
export const WISP_BOLT = { speed: 16, life: 3, radius: 0.3 } as const;
/** How a sword-only player beats a wisp or a mossback (scripts/sim/combat-sim.ts section 8 checks the kill counts). */
export const COUNTER = {
  // Wisp: it hovers at 2.8 m, above the sword. It sinks to sword height to charge a bolt (gold glint), then hangs
  // there, dim and slow, for wispSpent s. A sword hit keeps it down for wispHurtHold s so a combo can finish it.
  wispLowY: 1.1, // m above ground (body center) while low; the sword covers up to 2 m
  wispSpent: 1.6, // s it stays low after the bolt leaves
  wispHurtHold: 1.0, // s a sword hit keeps it low
  wispSink: 6, // 1/s drop rate (it rises back at the normal hover rate)
  wispSpentDrift: 0.25, // fraction of its normal speed while spent (it does not flee)
  // Mossback: it used to circle at 4.4 m between slams, out of sword reach, so a player swinging in place whiffed.
  mossbackRing: 2.4, // m it circles at between slams (sword reach 2.0 + its radius 1.1)
  mossbackSlamFrom: 2.9, // m it closes to before the slam windup (was 3.55, outside sword reach; the slam still covers 4.2 m)
  mossbackKnock: 0.1, // share of sword knockback it takes (was 0.25: hits pushed it out of reach)
  mossbackBehind: 1.5, // sword damage multiplier from behind
  mossbackBurn: 3, // burning thread damage multiplier: its moss burns (design: "burn its moss")
} as const;

/** v2 telegraphs (combat track). Every enemy attack shows all three: pose, sound, glint. */
export const TELL = {
  glintLead: 0.15, // s before the hit frame: gold glint on the weapon = "block or dodge now"
  mossbackPreHold: 0.15, // s freeze at the top of the slam, inside its windup
  maxAttackers: 2, // attack tokens: at most 2 enemies in windup/attack on Wren at once
  tokenCooldown: 0.4, // s before a returned token can be taken again
  questStartSafeR: 45, // m: no camp spawns or aggro this close to a pedestal, waystone or the prologue path
} as const;

/** Enemy camps. Enemies owner spawns these at start and respawns killed camps on "rest" (or 12 real minutes). */
export interface Camp { id: string; x: number; z: number; kinds: readonly EnemyKind[]; night?: boolean }
export const CAMPS: readonly Camp[] = [
  { id: "glade-edge", x: 120, z: 275, kinds: ["brambling", "brambling"] }, // v2: moved off the prologue path
  { id: "village-n", x: -230, z: 110, kinds: ["brambling", "brambling", "brambling"] },
  { id: "village-bridge", x: -282, z: 200, kinds: ["mossback"] },
  { id: "wood-1", x: -255, z: -44, kinds: ["brambling", "brambling", "wisp"] },
  { id: "wood-2", x: -470, z: -40, kinds: ["mossback", "brambling"] }, // v2: moved 160 m from the Thornring pedestal
  { id: "cliff-base", x: 300, z: 107, kinds: ["brambling", "wisp"] },
  { id: "cliff-top", x: 390, z: 60, kinds: ["wisp", "wisp"] },
  { id: "lake-shore", x: 126, z: -266, kinds: ["mossback", "brambling", "brambling"] },
  { id: "lake-ruin", x: 312, z: -381, kinds: ["wisp"] },
  { id: "bluff", x: -58, z: -380, kinds: ["brambling", "brambling", "mossback"] },
  { id: "cinder-path", x: 60, z: 17, kinds: ["mossback", "wisp"] },
  { id: "night-meadow", x: 120, z: 220, kinds: ["wisp", "wisp", "wisp"], night: true },
  { id: "night-wood", x: -250, z: -265, kinds: ["wisp", "wisp"], night: true }, // v2: moved off the Thornring arena
];

// ---------------------------------------------------------------------------------------------------------------------
// v2 signature mechanic: the Thread (design name Emberthread). Files: thread.ts, thread-*.ts (owner: thread track).
// The lantern spins a line of light between two anchors. Pin end 1, pin end 2: the pair decides what the thread does.
// Rules and examples: DESIGN-V2.md section 3.
// ---------------------------------------------------------------------------------------------------------------------
export const THREAD = {
  range: 18, rangeLong: 30, // m from the lantern to an anchor (Long Thread power)
  wickStart: 2, wickMax: 5, // live threads allowed at once
  life: 12, // s; a thread being ridden does not age; pinning beyond the wick limit cuts the oldest
  pendingLife: 6, // s that end 1 waits for end 2 before it lets go
  aimCone: 0.14, // rad around the reticle ray that snaps to an anchor (lock-on target wins when locked)
  aimSnapR: 2.5, // m: or an anchor within this of the reticle ray's hit point
  maxLen: 40, // m between the two ends; longer pairs are refused ("Too far")
  recallHold: 0.4, // s hold of the Thread button: cut all threads
  // ride (knot <-> knot)
  rideGrabR: 1.2, // m from the line: jump into it or press use/jump near an end to hang on
  rideSpeed: 10, rideMax: 16, rideAccel: 9, // m/s base, cap, m/s^2 from slope (downhill)
  rideUpMaxSlope: 0.44, rideUpSpeed: 5, rideUpCost: 0.15, // uphill rides up to 25 deg, stamina/s
  rideExitBoost: 1.0, // jump off keeps velocity and adds this much up (m/s * jumpV fraction)
  // pull (movable <-> fixed): the movable end slides toward the fixed end
  pullSpeed: [3, 2, 1.2] as const, // m/s for weight 1, 2, 3 (weight 3 needs Heavy Pull)
  pullStop: 1.5, // m from the fixed end
  // bind (enemy <-> enemy / enemy <-> fixed)
  bindYank: 6, // m/s the two enemies fly together
  bindDamage: 8, bindStagger: 2, // per enemy on contact; s staggered
  tetherStagger: 1, // s, enemy pinned to a fixed anchor; it cannot move beyond the thread length
  // burn (any thread with a lit brazier at one end, or the Burning Thread power)
  burnDps: 6, burnTime: 4, // damage points per s on a threaded enemy, s it keeps burning after the thread goes
  burnBrambleTime: 1, // s to burn away bramble walls and thorn gates touching the thread
  burnTouchDamage: 6, // enemies that walk into a burning thread take this and are pushed back; they will not path through
  carrySecs: 0.8, // s for fire to travel along a thread to a cold brazier, lamp or beacon bowl
} as const;

export type AnchorKind =
  | "knot" // fixed brass ring: ride lines, pull targets, tether points
  | "brazier" // fixed; lit ones make the thread burn, cold ones can be lit by fire carried along a thread
  | "lamp" // fixed; dark until fire or light reaches it, then opens what it is wired to
  | "block" // movable, weight 1 or 3
  | "float" // movable lantern-float on water, weight 1
  | "enemy" // movable; brambling and wisp weight 1, mossback weight 3, warden never
  | "target" // archery target / sea stack; Thread Arrow pins here
  | "chain"; // the Warden's gloam chains (boss phase 2): burn to stagger

export interface ThreadAnchor {
  id: string; // landmarks: "<site>:<name>"; enemies: "enemy:<id>"
  kind: AnchorKind;
  pos: V3; // live position (landmarks / enemies update it in place)
  weight: 0 | 1 | 2 | 3; // 0 = fixed
  lit: boolean; // braziers and lamps: burning now
  enabled: boolean; // false hides it from aiming (collected, sunk, dead)
}

export type ThreadUse = "ride" | "pull" | "bind" | "tether" | "carry" | "inert";

export interface ThreadLine {
  id: number;
  a: string; // anchor id of end 1
  b: string; // anchor id of end 2
  use: ThreadUse;
  burning: boolean;
  age: number; // s
  len: number; // m, current
}

/** Read-only view the thread module publishes every frame (FrameCtx.threads). Fixed arrays, no allocation. */
export interface ThreadState {
  wick: number; // live threads allowed (THREAD.wickStart + Wick Oil, max wickMax)
  used: number; // live threads now
  lines: readonly ThreadLine[]; // live threads; length = used
  pending: string | null; // anchor id of a pinned end 1 waiting for end 2
  aimAnchor: string | null; // anchor under the reticle now (HUD reticle snaps here)
  aimValid: boolean; // aimAnchor can pair with `pending` (or can be end 1)
  aimReason: "ok" | "far" | "none" | "pair" | "heavy"; // pair = these two anchors make no thread; heavy = weight 3 without Heavy Thread ("Too heavy")
  ride: { on: boolean; line: number; pos: THREE.Vector3; vel: THREE.Vector3; t: number }; // player follows pos while on
  /** Movable anchors being pulled this frame: landmarks / enemies move their own objects toward `to` at `speed`. */
  pulls: readonly { anchor: string; to: V3; speed: number }[];
}

/** Lantern powers, one per main beacon (DESIGN-V2.md section 9). */
export type LanternPower = "long" | "burning" | "heavy" | "arrow";
export const BEACON_POWER: readonly LanternPower[] = ["long", "burning", "heavy", "arrow"]; // index = BeaconId

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
  | "dodge" // v2: C or L / B / touch roll, fires on press (Shift is sprint only; Ctrl is never bound)
  | "sprint" // Shift hold / B hold / touch: double tap stick to toggle (derived by input)
  | "bow" // v2: F / RT / touch bow: hold to draw, release to shoot (MMB moves to lock)
  | "glide" // G / A in air / touch glide: open or close the glider
  | "lock" // v2: Q or MMB / RB / tap an enemy on touch: toggle lock-on; with no target it recenters the camera (Tab is never bound)
  | "use" // E / Y / touch hand (appears only with a prompt): interact, pick up, read
  | "map" // M / View / touch map
  | "pause" // Esc or P / Menu / touch pause
  | "thread"; // v2: R / LB / touch lantern button. Press = pin an end, hold THREAD.recallHold = cut all

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

/** v2 input additions. */
export interface InputV2 extends Input {
  /** Ask for pointer lock again (after Resume / closing the map). Must run inside the click / key handler. */
  relock(): void;
  /** Glyph text for a button on the current device: "R", "LB", "Lantern"... HUD chips and prompts use it. */
  glyph(b: BtnName | "move" | "look"): string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Player state. Files: player.ts, player-*.ts (owner: player).
// ---------------------------------------------------------------------------------------------------------------------
export type MoveMode = "ground" | "air" | "climb" | "glide" | "swim" | "dead" | "ride"; // v2 ride = hanging on a thread
export type PlayerAction =
  | "none" | "attack1" | "attack2" | "attack3" | "charge" | "spin" | "block" | "parry" | "riposte"
  | "dodge" | "aim" | "hurt" | "push" | "interact" | "land"
  | "skid" | "vault" | "mantle" | "backstep" | "rollLand" | "pin"; // v2

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
  // v2 (player track fills them every frame)
  aimOrigin: THREE.Vector3; // camera-reticle ray origin for thread / bow aiming
  aimDir: THREE.Vector3; // unit
  staminaRings: number; // 1..2 (Ember Seeds); staminaMax scales by this
  softLockId: number; // enemy the current swing turned toward, -1 none
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
  kind: "sword" | "spin" | "riposte" | "claw" | "slam" | "warden" | "bind" | "burn"; // v2 bind/burn come from the thread module
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
/** v2: "awaken" now lasts until the Glade Beacon is lit (the prologue). It no longer ends on leaving the shrine. */
export type QuestStage = "awaken" | "beacons" | "spire" | "boss" | "ending" | "free";

/** v2 prologue beats, in order. The onboarding track advances them; objective text and hints key off them. */
export type PrologueStep =
  | "wake" | "gate" | "vista" | "stones" | "climb" | "ride" | "glade" | "gladePull" | "gladeFight" | "gladeCarry" | "done";

/** v2 tracked target: what the compass, lantern pull and objective line point at. */
export type TrackTarget =
  | { kind: "beacon"; id: BeaconId }
  | { kind: "glade" }
  | { kind: "spire" }
  | { kind: "waystone"; id: string }
  | { kind: "item"; id: string } // e.g. "chest-bow" (the Mirebrook mill)
  | { kind: "none" };

export interface QuestState {
  stage: QuestStage;
  beacons: [boolean, boolean, boolean, boolean]; // lit, by BeaconId
  trial: BeaconId | -1; // trial in progress
  barrierDown: boolean;
  wardenDefeated: boolean;
  visited: LandmarkId[]; // for map labels; first visit shows the area banner
  // v2 (newQuest + save migration fill them)
  prologue: PrologueStep;
  gladeLit: boolean;
  tracked: TrackTarget; // null-free: { kind: "none" } when nothing is tracked
  autoTrack: boolean; // true until the player picks Track in the journal; then the choice sticks
  waystones: string[]; // WAYSTONES ids found (fast travel targets)
  memories: BeaconId[]; // memory pages already shown
  endingChoice: "keeper" | "sky" | null;
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

/** v2 progress that is not quest state (save track owns; player / thread / UI read it). */
export interface Progress {
  wickOil: number; // 0..3 found; wick = THREAD.wickStart + wickOil
  seeds: number; // Ember Seeds, 3 = +1/3 stamina ring, 0..9
  powers: LanternPower[];
  hintsSeen: HintId[];
  glimmersSpent: number;
}

/** v2 save. game.ts writes this from v2 on; readSave() migrates v1 (keeps beacons, collected, hearts, gear; new fields
 *  default; a v1 save with any beacon lit gets prologue "done" and gladeLit true). Saves match items by id, never index. */
export interface SaveDataV2 extends Omit<SaveData, "v" | "quest"> {
  v: 2;
  quest: Required<QuestState>;
  progress: Progress;
  waystone: string | null; // last rest point id, respawn there
}
export const SAVE_KEY_V2 = "hollowmere.save.v2";

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
export const START_HOUR = 5.5; // v2: pre-dawn; the sun clears the horizon about 40 s in, as the gate opens
/** v2: the clock runs at this rate until the first main beacon is lit (or 25 real minutes), so the first session
 *  stays in daylight (dusk not before ~17 real minutes). */
export const FIRST_DAY_SCALE = 0.5;

// ---------------------------------------------------------------------------------------------------------------------
// Events. Modules return GameEvent[] from update(); game.ts routes every event to every module's handle().
// ---------------------------------------------------------------------------------------------------------------------
export type PickupKind = "glimmer" | "shard" | "arrows" | "heart" | "bow" | "glider" | "wick" | "seed"; // v2 wick = Wick Oil

/** v2 control chips. Each shows once (Progress.hintsSeen), only until the verb is used. DESIGN-V2.md section 10. */
export type HintId =
  | "move" | "look" | "use" | "jump" | "climb" | "thread" | "ride" | "attack" | "block" | "parry" | "dodge" | "sprint"
  | "glide" | "lock" | "bow" | "map" | "journal" | "recall"
  | "edge"; // soft world edge: "Turn back" (game.ts, never marked seen)

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
  | { type: "trialRespawn"; beacon: BeaconId; pos: V3; yaw: number } // request: game places Wren at a trial checkpoint (feet)
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
  // v2 thread (from thread)
  | { type: "threadPin"; end: 1 | 2; anchor: string; kind: AnchorKind; pos: V3 }
  | { type: "threadLink"; id: number; use: ThreadUse; a: string; b: string; burning: boolean }
  | { type: "threadCut"; id: number; why: "expired" | "recall" | "replaced" | "broken" | "pending" }
  | { type: "threadRide"; on: boolean; id: number; pos: V3 }
  | { type: "threadFizzle"; why: "far" | "none" | "pair" | "heavy"; pos: V3 }
  | { type: "threadFire"; anchor: string; pos: V3 } // fire reached a brazier / lamp / beacon bowl / bramble wall
  | { type: "threadBind"; a: number; b: number; pos: V3 } // two enemy ids yanked together (b = -1 for a tether)
  // v2 combat feel (from combat)
  | { type: "parry"; id: number; pos: V3 }
  | { type: "slowmo"; scale: number; seconds: number } // world time scale; Wren and the camera keep real time
  | { type: "tell"; id: number; kind: EnemyKind; pos: V3; lead: number } // glint: hit lands in `lead` s
  // v2 guidance (from onboarding: companion / hints / objective)
  | { type: "say"; who: "tallow" | "oriel" | "mulberry"; line: string; text: string; voice: string | null; seconds: number }
  | { type: "hint"; id: HintId; btn: BtnName | "move" | "look"; text: string } // show a chip
  | { type: "hintDone"; id: HintId } // the verb was used: hide the chip, mark seen
  | { type: "prologue"; step: PrologueStep }
  | { type: "objective"; text: string; sub: string | null } // only on change
  | { type: "track"; target: TrackTarget; auto: boolean }
  | { type: "cine"; shot: "wake" | "vista" | "arena" | "beacon" | "memory"; pos: V3; look: V3; seconds: number }
  // v2 world (from landmarks)
  | { type: "gladeLit"; pos: V3 }
  | { type: "trialRule"; trial: BeaconId | "glade"; text: string } // rule card, shown until the first progress tick
  | { type: "waystone"; id: string; first: boolean }
  | { type: "travel"; to: string } // request from the UI map: fast travel to a waystone id
  | { type: "memory"; beacon: BeaconId }
  | { type: "power"; power: LanternPower }
  | { type: "upgrade"; kind: "wick" | "stamina" | "heart"; level: number }
  | { type: "shop"; item: "wick" | "quiver" | "dye"; cost: number }
  | { type: "endingChoice"; choice: "keeper" | "sky" }
  | { type: "secret"; id: string; kind: "trail" | "knots" | "critter" | "chime" | "blight" | "lore"; pos: V3 }
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
  // v2 (game.ts fills them)
  threads: ThreadState; // from the thread module, previous frame
  progress: Progress;
  anchors: readonly ThreadAnchor[]; // landmarks anchors + live enemy anchors, rebuilt by game.ts when either changes
  worldScale: number; // slow-mo scale applied to dt for the world (Wren uses realDt during parry slow-mo)
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
  gpu?: GpuTiming; // v2: null-safe; present when EXT_disjoint_timer_query_webgl2 exists
}

/** v2 per-pass GPU timing (perf track). Averages over the last 60 frames, in ms. */
export interface GpuTiming {
  supported: boolean;
  total: number;
  passes: Record<string, number>; // "shadow", "opaque", "grass", "water", "transparent", "post", "ui-fx" ...
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

/** v2 render additions (perf track: governor, AA, timing; look/sky tracks: region color, columns). */
export interface RenderV2 extends Render {
  /** Frame governor. game.ts calls it at the top of each rAF tick; false = skip this tick entirely (no update, no draw). */
  shouldRender(nowMs: number, state: "play" | "idle" | "paused" | "hidden"): boolean;
  setFpsCap(cap: 0 | 30 | 60): void;
  /** 0 = full Gloam (desaturated) .. 1 = color restored, per main beacon region. Look track reads it in hmShade. */
  setRegionColor(beacon: BeaconId, t: number): void;
  /** Toggle per-pass GPU timing (dev only; costs a query per pass). */
  setTiming(on: boolean): void;
}
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

/** v2 landmarks additions (world track; trials and prologue plug in through SiteRegistryV2). */
export interface LandmarksV2 extends Landmarks {
  /** Every thread anchor the landmarks own (knots, braziers, lamps, blocks, floats, targets, chains). Stable array. */
  readonly anchors: readonly ThreadAnchor[];
  /** Where to place Wren after a fast travel / respawn at a waystone. Returns false for an unknown or unfound id. */
  waystonePos(id: string, out: THREE.Vector3): boolean;
  /** Current target position for the compass / lantern pull; false when the target has no position. */
  targetPos(t: TrackTarget, out: THREE.Vector3): boolean;
  /** Short name of the checkpoint for the death screen: "Glade Waystone", "Cliffwatch Beacon", "Hollow Shrine". */
  checkpointName(): string;
}

/** v2 registry extension the world track adds to landmark-kit.ts Registry. Trials and the prologue build against it
 *  (cast env.reg to `Registry & SiteRegistryV2` until landmark-kit.ts lands). */
export interface SiteRegistryV2 {
  anchor(a: ThreadAnchor): ThreadAnchor; // registers it in LandmarksV2.anchors; the caller keeps and moves `pos`
  /** A trigger volume; enter -> `onEnter` once per load (prologue beats, hint zones, trial arrival pans). */
  zone(def: { id: string; x: number; y: number; z: number; r: number; h?: number; onEnter: () => void }): void;
  waystone(id: string): void; // builds the waystone at WAYSTONES[id] with rest + travel + shop interactions
}

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

/** v2: player-model.ts input. The player track fills it every frame; the hero-model track animates from it.
 *  Superset of v1 WrenAnimIn (player-model.ts), which the hero-model track replaces with this type. */
export interface HeroAnimIn {
  mode: MoveMode; action: PlayerAction; actionT: number;
  speed: number; vy: number; grounded: boolean; sprint: boolean; turn: number;
  climbX: number; climbY: number; mantle: number;
  combo: number; windup: number; recover: number; charge: number; draw: number; shield: boolean;
  swimMove: number; wade: number; hurtBig: boolean; armed: boolean; hasBow: boolean;
  time: number; windX: number; windZ: number; slope: number; exhausted: boolean;
  // v2
  lean: number; // -1..1 sprint/glide bank (+ = lean left)
  skid: number; // -1 none, else 0..1
  vault: number; // -1 none, else 0..1
  rideT: number; // -1 not riding, else s on the line (hang pose, legs swing with speed)
  pinAim: boolean; // lantern arm raised toward aimDir (thread aim)
  lanternLean: V2; // xz unit direction the lantern flame leans (tracked target), length 0 = none
  glideMode: 0 | 1 | 2; // 0 cruise, 1 flare, 2 dive
}

/** v2 hero model API (hero-model track). Same sockets as v1 WrenModel, single skinned or merged mesh. */
export interface HeroModel {
  readonly group: THREE.Group;
  readonly lanternWorld: THREE.Vector3;
  readonly handWorld: THREE.Vector3;
  readonly bladeTipWorld: THREE.Vector3;
  readonly bowHandWorld: THREE.Vector3;
  footstep: boolean;
  trailOn: boolean;
  update(a: HeroAnimIn, dt: number): void;
  setOutline(on: boolean): void; // QualityPreset.heroOutline
  dispose(): void;
}

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

/** v2 enemies additions (combat track). Enemies read ctx.threads for pulls/binds on "enemy:<id>" anchors. */
export interface EnemiesV2 extends Enemies {
  /** One anchor per live enemy slot (weight from AnchorKind rules), positions updated in place. Stable array. */
  readonly anchors: readonly ThreadAnchor[];
  /** Thin inverted-hull outline on enemy rigs (QualityPreset.heroOutline). Default off. */
  setOutline(on: boolean): void;
}

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

/** v2 camera numbers (player + camera track). DESIGN-V2.md section 6. */
export const CAMERA = {
  followRate: 0.52, // rad/s auto-follow toward behind Wren (30 deg/s); 0 on a pure strafe (|move.x| > 0.9, |move.y| < 0.2)
  followDelayMouse: 1.6, followDelayStick: 0.6, // s after manual look input before follow resumes
  dist: 5.2, distSprint: 5.8, distClimb: 7, climbPitch: 0.15, distGlide: 6.5, distRide: 6.5,
  minCollideDist: 0.9, // never closer; fade Wren's mesh out under 1.2 m instead of clipping into the head
  recenterTime: 0.25, // s to swing behind Wren on recenter
} as const;

/** v2 camera additions. */
export interface CameraRigV2 extends CameraRig {
  recenter(): void;
  /** Scripted shot (cold open, vista, trial arena pan, beacon lit). Input look is ignored while it plays; any key skips
   *  shots marked skippable. */
  cine(shot: { pos: V3; look: V3; seconds: number; skippable: boolean } | null): void;
  readonly cineOn: boolean;
}

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
  suspend(on: boolean): void; // game paused (book, death, ending, title): mutes the world ambience; a hidden tab suspends the context
  dispose(): void;
}
/** audio.ts: export function createAudio(ctx: AudioContext): Audio. game.ts creates the AudioContext on the first gesture. */
export type CreateAudio = (ac: AudioContext) => Audio;

/** v2 audio: recorded instruments + recorded SFX/ambience + optional voice. One sample loader for everything. */
export interface SampleBank {
  /** Fetch + decode a manifest (public/<dir>/manifest.json). Resolves when the listed "boot" set is ready. */
  load(manifestUrl: string, onProgress?: (p: number) => void): Promise<void>;
  /** A decoded take for a sound id ("step-grass", "sword-swing", "harp-D4"...). Picks among takes, never the same
   *  take twice in a row. null if not loaded yet. */
  take(id: string): AudioBuffer | null;
  has(id: string): boolean;
}

/** v2 loudness targets (LUFS integrated, measured per layer solo through the master bus). audit-audio.md has the method. */
export const MIX = {
  full: [-18, -16], truePeak: -1, // whole mix while playing, dBFS ceiling
  musicExplore: -24, musicCombat: -21, musicBoss: -20, stings: -18, voice: -18,
  ambienceDay: -30, ambienceNight: -31, footsteps: -30, swing: -20, hit: -17, ui: -26,
  duckVoice: -8, duckSting: -8, duckImpact: -3, duckAmbienceInCombat: -6, // dB
  silenceGap: [30, 90], // s of no score between explore cues
} as const;

export interface AudioV2 extends Audio {
  setVolumes(master: number, music: number, sfx: number, voice?: number): void;
  /** Dev/test: running loudness per bus (short-term LUFS approx.) and how many OscillatorNode.start calls ran. */
  levels(): { music: number; sfx: number; ambience: number; voice: number; master: number; oscStarts: number };
}

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
  objective: string; // one line, from guide.ts objectiveFor()
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
  // v2 (game.ts fills them)
  objectiveSub: string | null; // second line: distance-free hint ("On the cliff top, east")
  gladeLit: boolean;
  wick: number; // live threads allowed
  wickUsed: number;
  seeds: number;
  trialRule: string | null; // rule card text while a trial is active and before its first progress tick
  checkpointName: string; // death screen: "Respawning at <checkpointName>."
}

/** Per-frame HUD data, written by game.ts into ONE reused object. The HUD writes it to DOM refs, never React state. */
export interface HudFrame {
  stamina: number; // 0..1
  staminaShow: boolean; // false when full for > 1.5 s
  exhausted: boolean;
  staminaAt: ScreenPoint; // beside the player's shoulder
  heading: number; // camera compass bearing (0 = north, clockwise radians)
  markers: { bearing: number; dist: number; lit: boolean; on: boolean; kind: "beacon" | "glade" | "spire" | "waystone" | "item"; tracked: boolean }[]; // fixed length 13: 4 beacons (0..3), spire (4), glade (5), 7 waystones (6..12)
  lockAt: ScreenPoint; // lock-on reticle
  lockOn: boolean;
  charge: number; // sword charge / bow draw 0..1 (reticle fill)
  aiming: boolean;
  damageFlash: number; // 0..1, decays
  // v2
  lanternAt: ScreenPoint; // subtitles anchor above the lantern
  threadAim: { at: ScreenPoint; valid: boolean; reason: ThreadState["aimReason"]; pending: boolean };
  trackedDist: number; // m to the tracked target, smoothed (never jumps between targets: fade 0.3 s on change)
  trackedAt: ScreenPoint; // world marker over the tracked target
  riposteAt: ScreenPoint; // riposte glyph over the enemy just parried
}

export interface HudHandle {
  frame(f: HudFrame): void; // per frame
  event(e: GameEvent): void; // banners (areaEnter, beaconLit, trial*), pickup counters, toasts, read panels
}

/** What took Wren's last heart. game.ts reads it from the hit, fall or drown that came just before "died". */
export type DeathCause = "fall" | "enemy" | "drown";
/** Death screen title per cause (v2/copy-rule.md: say what happened, plainly). */
export const DEATH_TITLE: Record<DeathCause, string> = {
  fall: "You fell",
  enemy: "You were knocked out",
  drown: "You drowned",
};

export interface GameCallbacks {
  hud(h: HudSnapshot): void; // at HUD_HZ
  hudRef(): HudHandle | null;
  progress(p: number): void; // loading 0..1
  pause(): void; // the player pressed pause / map in game: UI opens its menu and calls game.pause(true)
  map(): void;
  /** v2: UI shows DEATH_TITLE[cause] ("You fell" when cause is absent) + "Respawning at <where>.", then calls game.respawn() */
  died(where: string, cause?: DeathCause): void;
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

/** v2 game additions (integrator). */
export interface GameV2 extends Game {
  track(t: TrackTarget): void; // journal "Track" button
  travel(waystone: string): void; // map fast travel
  chooseEnding(c: "keeper" | "sky"): void;
  readonly progress: Progress;
}

// ---------------------------------------------------------------------------------------------------------------------
// v2 new modules. Each is a createX() factory with update/handle/dispose like the rest.
// ---------------------------------------------------------------------------------------------------------------------

/** Thread (thread track): thread.ts. Reads ctx.input.btn.thread, ctx.player.aimOrigin/aimDir, ctx.anchors.
 *  Submits bind/burn strikes through ctx.combat. Publishes ThreadState; moves nothing it does not own. */
export interface Thread {
  readonly state: ThreadState;
  readonly group: THREE.Group; // thread ribbons + aim arc, one draw call each
  update(ctx: FrameCtx): readonly GameEvent[];
  handle(events: readonly GameEvent[]): void; // died/respawned/travel: cut all; power/upgrade: range and wick
  setWick(n: number): void;
  setPowers(p: readonly LanternPower[]): void;
  cutAll(): void;
  dispose(): void;
}
export type CreateThread = (scene: THREE.Scene, world: World, look: Look) => Thread;

/** Companion (onboarding track): companion.ts. Tallow's event-driven line bank. Emits "say". Cooldowns: guidance
 *  lines 8 s, idle lines 45 s; never two lines within 4 s; drops a line rather than queueing it past 3 s. */
export interface Companion {
  update(ctx: FrameCtx): readonly GameEvent[];
  handle(events: readonly GameEvent[]): void;
  dispose(): void;
}
export type CreateCompanion = (seen: Progress) => Companion;

/** Guide (onboarding track): guide.ts. Owns the hint chips, the prologue step machine and the objective line.
 *  Emits "hint", "hintDone", "prologue", "objective", "track" (auto-track), "cine". */
export interface Guide {
  update(ctx: FrameCtx): readonly GameEvent[];
  handle(events: readonly GameEvent[]): void;
  /** Objective line for a quest + progress, plain words (DESIGN-V2.md section 10 table). Pure function. */
  objective(q: QuestState, hasBow: boolean): { text: string; sub: string | null };
  dispose(): void;
}
export type CreateGuide = (progress: Progress, settings: Settings) => Guide;
