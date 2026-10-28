// Shared types for every module. Agents build against these in parallel.
// Change a type here only with the owner of every module that uses it.

import type * as THREE from "three";

// ---------- World layout ----------

export const CHUNK = 16;
export const MIN_Y = -64;
export const HEIGHT = 384;
export const MAX_Y = MIN_Y + HEIGHT - 1;
export const SECTIONS = HEIGHT / CHUNK;
export const SEA_LEVEL = 63;
export const TPS = 20;
export const DAY_TICKS = 24000;

export type Dim = "overworld" | "nether" | "end";

// Column-major chunk index. x, z in 0..15, y in MIN_Y..MAX_Y.
export const chunkIndex = (x: number, y: number, z: number) =>
  ((y - MIN_Y) << 8) | (z << 4) | x;

// ---------- Block state ----------

// 12-bit block id plus 4-bit meta, the same as pre-1.13 Minecraft.
export type BlockState = number;
export const AIR: BlockState = 0;
export const stateOf = (id: number, meta = 0): BlockState => id | (meta << 12);
export const idOf = (s: BlockState) => s & 0xfff;
export const metaOf = (s: BlockState) => s >>> 12;

// Face order for meshes, normals and texture lookup.
export const enum Face {
  East = 0, // +x
  West = 1, // -x
  Up = 2, // +y
  Down = 3, // -y
  South = 4, // +z
  North = 5, // -z
}

// Horizontal facing in meta, in Minecraft order: 0 south, 1 west, 2 north, 3 east.
export type Horizontal = 0 | 1 | 2 | 3;

// Meta meaning per shape. Mechanics and the mesher must agree on these.
//  log / pillar:  0 y, 1 x, 2 z (axis)
//  stairs:        bits 0-1 facing (Horizontal), bit 2 top half
//  slab:          0 bottom, 1 top, 2 double
//  facing blocks (furnace, chest, dispenser, observer, piston, crafter): 0-5 Face the front points to
//  torch / wall torch: 0 standing, 1-4 wall torch facing Horizontal+1
//  door:          bits 0-1 facing, bit 2 open, bit 3 upper half
//  trapdoor:      bits 0-1 facing, bit 2 open, bit 3 top
//  fluid:         0 source, 1-7 flowing level (1 highest), 8 falling
//  crop:          age 0-7
//  snow layer:    layers - 1 (0-7)
//  redstone wire: power 0-15
//  repeater:      bits 0-1 facing, bits 2-3 delay - 1 (powered is a separate block id)
//  lever / button: bits 0-2 attach Face, bit 3 powered
//  bed:           bits 0-1 facing, bit 2 head part
//  ladder / wall sign / wall attachments: Horizontal facing
//  leaves:        bit 0 player placed (no decay)
//  vault:         bits 0-1 facing (Horizontal), bit 2 active, bit 3 ominous
//  trial spawner: bits 0-1 0 inactive, 1 active, 2 ejecting reward; bit 3 ominous
export type Shape =
  | "air"
  | "cube"
  | "cross" // flowers, saplings, grass
  | "crop" // wheat-style hash
  | "slab"
  | "stairs"
  | "fluid"
  | "torch"
  | "door"
  | "trapdoor"
  | "fence"
  | "fence_gate"
  | "wall"
  | "pane" // glass pane, iron bars
  | "ladder"
  | "carpet"
  | "snow_layer"
  | "farmland"
  | "path"
  | "rail"
  | "redstone_wire"
  | "repeater"
  | "comparator"
  | "button"
  | "lever"
  | "pressure_plate"
  | "bed"
  | "chest"
  | "cactus"
  | "cake"
  | "sign"
  | "lantern"
  | "chain"
  | "anvil"
  | "enchanting_table"
  | "cauldron"
  | "hopper"
  | "flower_pot"
  | "vine"
  | "portal"
  | "end_portal_frame"
  | "lectern"
  | "campfire"
  | "custom"; // drawn by an entity or special renderer

export type RenderLayer = "opaque" | "cutout" | "translucent";
export type ToolKind = "pickaxe" | "axe" | "shovel" | "hoe" | "sword" | "shears";
export type SoundGroup =
  | "stone" | "wood" | "gravel" | "grass" | "sand" | "glass" | "wool" | "metal"
  | "snow" | "ladder" | "anvil" | "slime" | "honey" | "netherrack" | "nether_bricks"
  | "deepslate" | "copper" | "amethyst" | "mud" | "cherry_wood" | "bamboo_wood"
  | "tuff" | "trial_spawner" | "heavy_core" | "vault" | "lantern" | "chain" | "plant";

// Texture keys use vanilla texture file names: "grass_block_top", "oak_log_top", "furnace_front".
export interface BlockTextures {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  front?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  end?: string; // log ends
}

export type Tint = "grass" | "foliage" | "water" | "birch" | "spruce" | "redstone" | "stem" | null;

export interface DropEntry {
  item: string;
  count?: [number, number];
  chance?: number;
  group?: string; // entries sharing a group are one-of alternatives: at most one drops, picked by chance
}
// undefined drops the block item itself. null drops nothing. "silk" entries need silk touch.
export type DropSpec = undefined | null | string | DropEntry[];

export interface BlockDef {
  id: number;
  name: string; // vanilla id without "minecraft:"
  displayName: string;
  shape: Shape;
  textures: BlockTextures;
  layer: RenderLayer;
  solid: boolean; // has collision
  opaque: boolean; // fills the cube and blocks light and faces
  lightEmission: number; // 0-15
  lightFilter: number; // 0-15 light lost when it passes through. Opaque blocks are 15.
  hardness: number; // -1 is unbreakable
  blastResistance: number;
  tool?: ToolKind;
  toolTier?: number; // 0 wood/gold, 1 stone, 2 iron, 3 diamond, 4 netherite. Needed for drops.
  drops?: DropSpec;
  silkDrops?: boolean; // drops itself with silk touch
  xp?: [number, number];
  replaceable?: boolean; // placing a block replaces it (grass, water, snow layer)
  gravity?: boolean;
  flammable?: boolean;
  climbable?: boolean;
  tint?: Tint;
  sound: SoundGroup;
  slipperiness?: number; // ice 0.98, default 0.6
  speedFactor?: number; // soul sand 0.4
  item?: string | null; // item name if different. null means no item.
  emissiveTexture?: boolean;
  tags?: string[]; // "logs", "leaves", "planks", "wool", "flowers", "saplings", "dirt", "base_stone_overworld"
}

// ---------- Items ----------

export interface ToolStats {
  kind: ToolKind;
  tier: number;
  speed: number; // mining speed multiplier
  durability: number;
  attackDamage: number;
  attackSpeed: number;
}

export interface ArmorStats {
  slot: "head" | "chest" | "legs" | "feet";
  points: number;
  toughness: number;
  durability: number;
  knockbackResistance?: number;
}

export interface FoodStats {
  hunger: number;
  saturation: number;
  alwaysEat?: boolean;
  eatTicks?: number; // default 32
  effects?: { effect: string; seconds: number; amplifier: number; chance: number }[];
}

export interface ItemDef {
  id: number;
  name: string; // vanilla id
  displayName: string;
  maxStack: number; // 1, 16 or 64
  texture?: string; // item texture key. Unset for block items, which use a 3D block icon.
  block?: string; // block this item places
  tool?: ToolStats;
  armor?: ArmorStats;
  food?: FoodStats;
  fuelTicks?: number;
  durability?: number; // for non-tools such as bow, shield, flint_and_steel
  rarity?: "common" | "uncommon" | "rare" | "epic";
  tags?: string[];
}

export interface ItemStack {
  item: string;
  count: number;
  damage?: number;
  ench?: Record<string, number>;
  name?: string; // anvil rename
  data?: Record<string, unknown>; // potion type, written book, etc.
}

// ---------- Biomes ----------

export interface BiomeDef {
  id: number;
  name: string; // vanilla id
  displayName: string;
  dim: Dim;
  temperature: number;
  downfall: number;
  grassColor: number; // 0xRRGGBB
  foliageColor: number;
  waterColor: number;
  skyColor: number;
  fogColor: number;
  precipitation: "rain" | "snow" | "none";
}

// ---------- Chunk data ----------

export interface ChunkData {
  cx: number;
  cz: number;
  dim: Dim;
  blocks: Uint16Array; // CHUNK * CHUNK * HEIGHT, chunkIndex
  light: Uint8Array; // same index, high nibble sky light, low nibble block light
  biomes: Uint8Array; // CHUNK * CHUNK, index z * 16 + x
  heightmap: Int16Array; // CHUNK * CHUNK, y of top non-air block
  blockEntities?: BlockEntityData[];
  entities?: EntitySave[]; // mobs placed by world gen (village, structures)
  waterlogged?: number[]; // chunkIndex of waterlogged cells (blocks/waterlog.ts)
  caveBiomes?: Uint8Array; // 4x4x4-block cells, index (((y - MIN_Y) >> 2) * 4 + (lz >> 2)) * 4 + (lx >> 2); 255 = surface biome
}

// Mesher input: one 16^3 section plus a 1-block border = 18^3, index (y * 18 + z) * 18 + x.
export const PAD = 18;
export interface MeshInput {
  cx: number;
  sy: number; // section index 0..SECTIONS-1
  cz: number;
  blocks: Uint16Array; // PAD^3
  light: Uint8Array; // PAD^3
  biomes: Uint8Array; // PAD * PAD, index z * 18 + x
  waterlogged?: Uint8Array; // PAD^3, 1 = cell holds water; absent when none
  tints?: Uint32Array; // 768: blended grass, foliage, water 0xRRGGBB per column z * 16 + x; overrides biomes for tints
}

export interface MeshBuffers {
  attributes: Record<string, { array: Float32Array | Uint8Array | Uint16Array | Int16Array | Uint32Array; itemSize: number; normalized?: boolean }>;
  index: Uint32Array | Uint16Array;
}

export interface MeshOutput {
  cx: number;
  sy: number;
  cz: number;
  opaque: MeshBuffers | null;
  cutout: MeshBuffers | null;
  translucent: MeshBuffers | null;
  vis?: number; // face-to-face open paths for cave culling, bit a * 6 + b for faces a < b
}

// Uniforms every chunk material exposes. The renderer writes them each frame.
export interface ChunkUniforms {
  uDaylight: { value: number }; // 0 night .. 1 noon
  uFogColor: { value: THREE.Color };
  uFogNear: { value: number };
  uFogFar: { value: number };
  uTime: { value: number }; // seconds, for water and lava animation
  uAtlas: { value: THREE.DataArrayTexture | null };
  uSkyTint: { value: THREE.Color }; // sky light color, red at sunset, dim in the nether
  uGamma: { value: number }; // brightness option 0..1
  uNightVision?: { value: number }; // 0..1, scales light so its brightest channel is full
  uSkyColor?: { value: THREE.Color }; // zenith color: far fog above the camera fades into the sky dome
  uSkyFogEnd?: { value: number };
  uSkyMix?: { value: number }; // 0 plain fog color, 1 sky dome color
  uDimLight?: { value: THREE.Vector2 }; // x dimension ambient light, y 1 for the End fixed lightmap
  uDarkness?: { value: THREE.Vector2 }; // darkness effect: x light pulse subtracted, y blend that cancels the brightness option
}

// ---------- Block entities ----------

export interface BlockEntityData {
  x: number;
  y: number;
  z: number;
  type: string; // "chest", "furnace", "sign", "crafter", "spawner", "brewing_stand", "hopper", "vault", "trial_spawner"
  items?: (ItemStack | null)[];
  data?: Record<string, unknown>;
}

// ---------- Entities ----------

export interface EntitySave {
  type: string;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  data?: Record<string, unknown>;
}

export interface Aabb {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

// A moving box. Player, mobs and item drops all use moveBody() in player/physics.ts.
export interface Body {
  pos: THREE.Vector3; // feet center
  vel: THREE.Vector3; // blocks per tick
  width: number;
  height: number;
  onGround: boolean;
  inWater: boolean;
  inLava: boolean;
  onClimbable: boolean;
  horizontalCollision: boolean;
  fallDistance: number;
  stepHeight: number; // 0.6 for the player and most mobs
  noClip?: boolean;
}

export type DamageSource =
  | "generic" | "fall" | "lava" | "fire" | "drown" | "starve" | "void" | "cactus"
  | "explosion" | "mob" | "player" | "arrow" | "suffocate" | "magic" | "wither"
  | "lightning" | "freeze" | "thorns" | "mace" | "fly_into_wall" | "trident" | "sonic_boom" | "cramming";

export interface EntityHit {
  id: number;
  dist: number;
  point: THREE.Vector3;
}

export interface Effect {
  id: string; // "speed", "regeneration", "poison", "wind_charged", "oozing", ...
  amplifier: number;
  ticks: number;
  ambient?: boolean; // beacon and conduit: other HUD frame, no blinking
}

// One live entity. The entity manager owns the list.
export interface Entity {
  id: number;
  type: string; // "zombie", "item", "arrow", "xp_orb", "tnt", "falling_block", "breeze"
  body: Body;
  yaw: number;
  pitch: number;
  headYaw: number;
  health: number;
  maxHealth: number;
  age: number; // ticks
  dead: boolean;
  hurtTicks: number;
  effects: Effect[];
  data: Record<string, unknown>;
}

export interface MobModel {
  root: THREE.Object3D;
  // walk: 0..1 limb swing amount, phase: limb swing angle. hurt flashes red.
  animate(e: Entity, partialTick: number, walk: number, phase: number): void;
  dispose(): void;
}

export interface MobDef {
  type: string;
  displayName: string;
  category: "hostile" | "passive" | "neutral" | "water" | "ambient" | "misc";
  width: number;
  height: number;
  maxHealth: number;
  speed: number; // blocks per tick
  attackDamage?: number;
  xp?: [number, number];
  drops?: DropEntry[];
  sounds?: { ambient?: string; hurt?: string; death?: string; step?: string };
  spawn?: {
    dims: Dim[];
    biomes?: string[]; // unset means all
    light: "dark" | "grass" | "any"; // dark: block light 0 and sky light <= 7. grass: on grass with light >= 9.
    group: [number, number];
    weight: number;
  };
  seat?: number; // rider feet height above the mob feet
  createModel(): MobModel;
  // Runs each tick. Use ctx for world, physics, player, and entity calls.
  tick(e: Entity, ctx: GameCtx): void;
  onDeath?(e: Entity, ctx: GameCtx): void;
  onInteract?(e: Entity, ctx: GameCtx, held: ItemStack | null): boolean; // shear, milk, breed, ride
}

// ---------- Events ----------

// Sound names follow vanilla sound events: "block.stone.break", "entity.zombie.ambient", "entity.player.hurt".
// Block sounds use the SoundGroup: "block.<group>.<break|place|step|hit|fall>".
export type GameEvent =
  | { type: "sound"; name: string; x?: number; y?: number; z?: number; volume?: number; pitch?: number }
  | { type: "particles"; kind: "block" | "smoke" | "flame" | "explosion" | "splash" | "bubble" | "heart" | "angry" | "crit" | "portal" | "drip" | "note" | "dust" | "gust" | "trial_omen" | "happy" | "sweep" | "enchant" | "lava"; x: number; y: number; z: number; count?: number; state?: BlockState; color?: number }
  | { type: "block_changed"; x: number; y: number; z: number; from: BlockState; to: BlockState }
  | { type: "open_container"; kind: ContainerKind; x?: number; y?: number; z?: number; entityId?: number }
  | { type: "close_container" }
  | { type: "player_hurt"; amount: number; source: DamageSource }
  | { type: "player_died"; message: string }
  | { type: "chat"; text: string; color?: string }
  | { type: "title"; text: string; subtitle?: string }
  | { type: "action_bar"; text: string }
  | { type: "change_dim"; dim: Dim; x: number; y: number; z: number }
  | { type: "explosion"; x: number; y: number; z: number; power: number }
  | { type: "advancement"; title: string };

// ---------- Containers and inventory ----------

export type ContainerKind =
  | "inventory" | "creative" | "crafting_table" | "furnace" | "blast_furnace" | "smoker"
  | "chest" | "large_chest" | "barrel" | "shulker_box" | "ender_chest" | "dispenser" | "dropper"
  | "hopper" | "crafter" | "anvil" | "enchanting_table" | "brewing_stand" | "grindstone"
  | "stonecutter" | "smithing_table" | "loom" | "cartography_table" | "villager" | "beacon" | "horse";

export type SlotRole =
  | "storage" | "hotbar" | "armor_head" | "armor_chest" | "armor_legs" | "armor_feet"
  | "offhand" | "craft_input" | "craft_output" | "fuel" | "smelt_input" | "smelt_output"
  | "container" | "special";

export interface SlotView {
  index: number; // pass to clickSlot
  role: SlotRole;
  stack: ItemStack | null;
  disabled?: boolean; // crafter slots can be disabled
}

export interface ContainerView {
  kind: ContainerKind;
  title: string;
  // Groups in draw order. The UI lays out each kind like the vanilla screen.
  groups: { name: string; slots: SlotView[] }[];
  cursor: ItemStack | null;
  progress?: Record<string, number>; // "cook" 0..1, "burn" 0..1, "brew" 0..1, "xp_cost"
  options?: { id: string; label: string; cost?: number; enabled: boolean }[]; // enchant, trade, stonecutter
  merchant?: MerchantView; // villager and wandering trader screen
  mount?: { type: string; age: number; data: Record<string, unknown> }; // horse screen preview
}

export interface MerchantView {
  level: number; // 1..5, 0 for a wandering trader
  xp: number;
  xpMin: number;
  xpMax: number;
  selected: number;
  trades: { buy: ItemStack; buyB?: ItemStack; sell: ItemStack; price: number; out: boolean }[];
}

export type ClickKind = "left" | "right" | "shift" | "middle" | "drop" | "drop_all" | "double" | { hotbar: number } | { drag: "left" | "right" | "middle"; slots: number[] };

export interface InventoryApi {
  // Player storage: 0..8 hotbar, 9..35 main, 36..39 armor head..feet, 40 offhand.
  slots: (ItemStack | null)[];
  selected: number; // hotbar 0..8
  held(): ItemStack | null;
  add(stack: ItemStack): ItemStack | null; // returns the remainder
  removeHeld(count: number): void;
  damageHeld(amount: number): void; // breaks the tool at durability 0
  setSlot(i: number, s: ItemStack | null): void;
  // Container screen.
  open(kind: ContainerKind, at?: { x: number; y: number; z: number; entityId?: number }): void;
  close(): void;
  view(): ContainerView | null;
  clickSlot(index: number, click: ClickKind): void;
  chooseOption(id: string): void; // enchant row, trade, stonecutter recipe
  creativeItems(tab: string, search: string): ItemStack[];
  creativeTabs(): { id: string; label: string; icon: string }[];
  takeCreative(stack: ItemStack | null, click: ClickKind): void; // null = empty grid slot or the destroy slot
  armorPoints(): number;
  version: number; // increments on every change, for the UI
}

// ---------- Player ----------

export type GameMode = "survival" | "creative" | "adventure" | "spectator";

export interface PlayerApi {
  body: Body;
  yaw: number; // radians. 0 looks to -z (north)
  pitch: number;
  eye(): THREE.Vector3;
  lookDir(): THREE.Vector3;
  health: number; // 0..20
  maxHealth: number;
  food: number; // 0..20
  saturation: number;
  exhaustion: number;
  air: number; // 0..300 ticks
  xpLevel: number;
  xpProgress: number; // 0..1
  xpTotal: number;
  gameMode: GameMode;
  flying: boolean;
  sprinting: boolean;
  sneaking: boolean;
  sleeping: boolean;
  spawn: { x: number; y: number; z: number };
  effects: Effect[];
  dead: boolean;
  thirdPerson: 0 | 1 | 2; // F5 cycle
  target: RaycastHit | null; // block under the crosshair
  targetEntity: EntityHit | null;
  breakProgress: number; // 0..1 for crack overlay
  vehicle?: number | null; // entity id the player rides
  fallFlying?: boolean; // elytra glide
  damageFrom?: { x: number; y: number; z: number } | null; // set before damage() for a source with no attacker (explosion, arrow), so shields can face it
  pose?: "standing" | "crouching" | "swimming" | "fall_flying" | "spin_attack" | "sleeping";
  damage(amount: number, source: DamageSource, attacker?: Entity): void;
  heal(amount: number): void;
  addXp(points: number): void;
  addExhaustion(v: number): void;
  teleport(x: number, y: number, z: number): void;
  respawn(): void;
}

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  face: Face;
  state: BlockState;
  point: THREE.Vector3;
  dist: number;
}

// ---------- World ----------

export interface ChunkEvent {
  type: "loaded" | "unloaded" | "dirty";
  cx: number;
  cz: number;
  sy?: number; // section for "dirty"
}

// setBlock flags
export const SET_NOTIFY = 1; // run neighbor updates
export const SET_NO_LIGHT = 2;
export const SET_NO_DROP = 4;
export const SET_DEFAULT = SET_NOTIFY;

// Multi-block edits a multiplayer client asks the host to run instead of sending each block.
export type HostAction = "bone_meal" | "portal" | "end_portal" | "use" | "use_off" | "brush";

export interface WorldApi {
  dim: Dim;
  seed: number;
  getBlock(x: number, y: number, z: number): BlockState; // AIR when unloaded or out of range
  setBlock(x: number, y: number, z: number, s: BlockState, flags?: number): boolean;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  getBiome(x: number, z: number): BiomeDef;
  getBiomeAt?(x: number, y: number, z: number): BiomeDef; // cave biomes underground, else getBiome
  spawn?: { x: number; y: number; z: number }; // world spawn point, one shared object for every dimension
  topY(x: number, z: number): number;
  isLoaded(x: number, z: number): boolean;
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, fluids?: boolean): RaycastHit | null;
  collide(box: Aabb, out: Aabb[]): Aabb[]; // block collision boxes that touch the box
  scheduleTick(x: number, y: number, z: number, delay: number): void;
  getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined;
  blockEntitiesIn?(cx: number, cz: number): Iterable<BlockEntityData> | undefined;
  setBlockEntity(be: BlockEntityData | null, x: number, y: number, z: number): void;
  isWaterlogged?(x: number, y: number, z: number): boolean;
  setWaterlogged?(x: number, y: number, z: number, on: boolean): boolean;
  // Multiplayer client only: runs predict with writes muted, then sends the action to the host when predict is true.
  hostAction?(kind: HostAction, x: number, y: number, z: number, predict?: () => boolean, face?: number): boolean;
  meshInput(cx: number, sy: number, cz: number): MeshInput | null; // null when the section is empty or neighbors are missing
  on(fn: (e: ChunkEvent) => void): () => void;
  // Load and unload chunks around the center. Call each frame.
  update(centerX: number, centerZ: number, radius: number): void;
  tick(ctx: GameCtx): void; // random ticks and scheduled ticks
  loadedChunks(): number;
  pendingChunks(): number;
  ready(x: number, z: number): boolean; // spawn area generated and lit
  save(): Promise<void>;
  dispose(): void;
}

// Block behavior. Mechanics modules register one per block name.
export interface PlaceInfo {
  face: Face; // face of the clicked block
  hitX: number; // 0..1 on the clicked face
  hitY: number;
  hitZ: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
}

export interface BlockBehavior {
  // Return the state to place, or null to cancel.
  place?(ctx: GameCtx, x: number, y: number, z: number, info: PlaceInfo, defaultState: BlockState): BlockState | null;
  canSurvive?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): boolean;
  // Right click. Return true if the click did something, so no block is placed.
  use?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, held: ItemStack | null): boolean;
  neighborChanged?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, fromX: number, fromY: number, fromZ: number): void;
  randomTick?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): void;
  scheduledTick?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): void;
  onPlaced?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): void;
  onRemoved?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): void;
  entityInside?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, e: Body, entity: Entity | null): void;
  // Redstone.
  power?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, toward: Face): number; // weak power out of a face
  strongPower?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState, toward: Face): number;
  comparatorOutput?(ctx: GameCtx, x: number, y: number, z: number, s: BlockState): number;
  // Collision and outline boxes in block-local 0..1 units. Default is the full cube for solid blocks.
  boxes?(s: BlockState, world: WorldApi, x: number, y: number, z: number): Aabb[];
}

// ---------- Entities API ----------

export interface EntityApi {
  spawn(type: string, x: number, y: number, z: number, data?: Record<string, unknown>): Entity | null;
  dropItem(stack: ItemStack, x: number, y: number, z: number, velocity?: THREE.Vector3): void;
  dropXp(amount: number, x: number, y: number, z: number): void;
  get(id: number): Entity | undefined;
  all(): Iterable<Entity>;
  near(x: number, y: number, z: number, r: number, out: Entity[]): Entity[];
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): EntityHit | null;
  damage(id: number, amount: number, source: DamageSource, attacker?: Entity | "player"): void;
  knockback(id: number, dx: number, dz: number, strength: number): void;
  interact(id: number, held: ItemStack | null): boolean;
  explode(x: number, y: number, z: number, power: number, fire?: boolean, kind?: "block" | "tnt"): void;
  count(category: MobDef["category"]): number;
  tick(ctx: GameCtx): void;
  frame(dt: number, partialTick: number): void;
  save(): EntitySave[];
  load(list: EntitySave[]): void;
  dispose(): void;
}

// ---------- Audio ----------

export interface AudioApi {
  play(name: string, x?: number, y?: number, z?: number, volume?: number, pitch?: number): void;
  setListener(pos: THREE.Vector3, yaw: number, pitch: number): void;
  setUnderwater?(on: boolean): void;
  setVolume(master: number, music: number, sfx: number): void;
  setMusic(kind: "menu" | "overworld" | "creative" | "underwater" | "nether" | "end" | "none"): void;
  playRecord?(id: string, disc: string, x: number, y: number, z: number, seconds: number): void;
  stopRecord?(id: string): void;
  dispose(): void;
}

// ---------- Renderer ----------

export interface RendererApi {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setDim(dim: Dim): void;
  setTime(dayTicks: number): void; // 0..23999
  setWeather(rain: number, thunder: number): void; // 0..1
  setRenderDistance(chunks: number): void;
  setOptions(o: { fov: number; quality: Quality; clouds: boolean; brightness: number; biomeBlend?: number; particles?: "all" | "decreased" | "minimal" }): void;
  setOutline(hit: RaycastHit | null, boxes: Aabb[] | null): void;
  setBreak(hit: RaycastHit | null, progress: number): void;
  setUnderwater(kind: "none" | "water" | "lava" | "powder_snow"): void;
  setEffects?(v: { nightVision: number; blindness: number; darkness: number }): void; // status effect fog and light, each 0..1
  setVisionFog?(far: number): void; // blindness / darkness fog end in blocks, 0 for none
  flash?(): void; // lightning sky flash
  addParticles(e: Extract<GameEvent, { type: "particles" }>): void;
  meshQueue(): number; // sections waiting
  chunkMeshed?(cx: number, cz: number): boolean; // chunk is ready and none of its sections wait for a mesh
  stats?(): RenderStats;
  render(dt: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

// Last-frame renderer costs in ms and chunk counts, for the F3 profiler.
export interface RenderStats {
  atmosphere: number;
  upload: number;
  draw: number;
  sections: number;
  visible: number;
  queued: number;
  inFlight: number;
  results: number;
  workers: number;
  pages: number;
  verts: number;
}

export type Quality = "low" | "medium" | "high";

// ---------- Game context ----------

export interface Rules {
  difficulty: "peaceful" | "easy" | "normal" | "hard";
  keepInventory: boolean;
  doDaylightCycle: boolean;
  doMobSpawning: boolean;
  mobGriefing: boolean;
  doFireTick: boolean;
  randomTickSpeed: number;
  cheats: boolean;
  // Other vanilla rules (ui/gamerules.ts). Absent in older saves: read as the vanilla default.
  naturalRegeneration?: boolean;
  fallDamage?: boolean;
  fireDamage?: boolean;
  drowningDamage?: boolean;
  freezeDamage?: boolean;
  showDeathMessages?: boolean;
  doImmediateRespawn?: boolean;
  doInsomnia?: boolean;
  doMobLoot?: boolean;
  doTileDrops?: boolean;
  doEntityDrops?: boolean;
  announceAdvancements?: boolean;
  doWeatherCycle?: boolean;
  doPatrolSpawning?: boolean;
  doWardenSpawning?: boolean;
  disableRaids?: boolean;
  playersSleepingPercentage?: number;
  waterSourceConversion?: boolean;
  lavaSourceConversion?: boolean;
  maxEntityCramming?: number;
  spawnRadius?: number;
  projectilesCanBreakBlocks?: boolean;
  blockExplosionDropDecay?: boolean;
  mobExplosionDropDecay?: boolean;
  tntExplosionDropDecay?: boolean;
  universalAnger?: boolean;
  forgiveDeadPlayers?: boolean;
  enderPearlsVanishOnDeath?: boolean;
  reducedDebugInfo?: boolean;
  doLimitedCrafting?: boolean;
  globalSoundEvents?: boolean;
  spectatorsGenerateChunks?: boolean;
}

// Every module gets this object. game.ts creates it and fills each field.
export interface GameCtx {
  world: WorldApi;
  player: PlayerApi;
  inventory: InventoryApi;
  entities: EntityApi;
  audio: AudioApi;
  renderer: RendererApi;
  rules: Rules;
  time: { tick: number; dayTime: number; day: number; rain: number; thunder: number };
  emit(e: GameEvent): void;
  random: () => number;
  behaviors: Record<string, BlockBehavior>;
}

// HUD state pushed to React at 10 Hz.
export interface HudState {
  health: number;
  maxHealth: number;
  food: number;
  saturation: number;
  armor: number;
  air: number;
  xpLevel: number;
  xpProgress: number;
  hotbar: (ItemStack | null)[];
  offhand: ItemStack | null;
  selected: number;
  gameMode: GameMode;
  effects: Effect[];
  hardcore: boolean;
  poisoned: boolean;
  withered: boolean;
  frozen: boolean;
  mountHealth?: number;
  mountMaxHealth?: number; // sets the number of vehicle hearts
  absorption?: number; // absorption health points
  mountJump?: number; // 0..1 horse jump bar charge
  mountJumpCooldown?: boolean; // camel dash cooldown
  bossBars: { id: string; name: string; progress: number; color: string; notches?: 6 | 10 | 12 | 20 }[];
  debug?: Record<string, string>; // F3 lines
  heldName?: string; // shows above the hotbar on change
  underwater: boolean;
  dead: boolean;
  deathMessage?: string;
  sleeping: number; // 0..1 fade
  pumpkin?: boolean; // carved pumpkin on the head
  spyglass?: boolean; // scoped in first person
  freeze?: number; // 0..1 powder snow overlay
  portal?: number; // 0..1 nether portal swirl
  light?: number; // 0..1 brightness at the eye, for the vignette
  thirdPerson?: 0 | 1 | 2; // F5 camera, hides the crosshair
  attack?: number; // 0..1 attack cooldown, for the attack indicator
}
